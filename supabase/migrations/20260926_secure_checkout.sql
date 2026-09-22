-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Checkout payment integrity
--
-- Before this migration the browser was the only authority on money:
--   * Checkout.tsx computed subtotal/vat/total and inserted them verbatim.
--   * `orders_insert` RLS only checked `member_id`, so a signed-in buyer could
--     insert `total: 0` (or any amount) straight through the anon key.
--   * PayPal orders were created AND captured client-side with a client-chosen
--     `amount.value`; nothing ever compared the captured money to the order.
--   * Stock was decremented in a separate RPC call, so a failed order insert
--     needed a best-effort compensating call that could itself fail.
--   * Nothing recorded HOW an order was paid — no method, no capture id, no
--     charged currency/amount — making settlement and refunds impossible.
--
-- After this migration:
--   * `place_order` is the ONLY way to create an order. It re-prices every line
--     from `products`, computes VAT/total itself, takes stock, and inserts the
--     header + items in one transaction. Direct INSERT is revoked.
--   * Orders carry a payment ledger (method, status, reference, charged
--     currency/amount, fx rate, paid_at) with the charge amount FIXED at order
--     time so a later capture can be compared against it.
--   * Only the service role may flip an order to paid; buyers cannot.
--
-- Run in the Supabase SQL Editor (or `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Payment ledger columns ─────────────────────────────────────────────
alter table public.orders
  add column if not exists payment_method   text not null default 'bank_transfer',
  add column if not exists payment_status   text not null default 'unpaid',
  add column if not exists payment_provider text,
  -- PayPal capture id (or the bank remittance reference, entered by an admin)
  add column if not exists payment_reference text,
  -- Currency/amount we actually ask the buyer for, frozen at order time so the
  -- capture can be verified and so wire transfers can be reconciled later.
  add column if not exists charge_currency  text,
  add column if not exists charge_amount    numeric(14,2),
  add column if not exists fx_rate          numeric(18,8),
  add column if not exists paid_amount      numeric(14,2),
  add column if not exists paid_currency    text,
  add column if not exists paid_at          timestamptz,
  add column if not exists payment_error    text,
  -- Lets a retried checkout resolve to the same order instead of creating a
  -- second one (the old client-side genOrderId() made a new id every attempt).
  add column if not exists idempotency_key  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_method_check') then
    alter table public.orders add constraint orders_payment_method_check
      check (payment_method in ('bank_transfer','paypal'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_payment_status_check') then
    alter table public.orders add constraint orders_payment_status_check
      check (payment_status in ('unpaid','paid','failed','refunded'));
  end if;
end $$;

-- A capture id must never be attachable to two orders (replay protection).
create unique index if not exists orders_payment_reference_key
  on public.orders (payment_reference)
  where payment_reference is not null;

create unique index if not exists orders_idempotency_key_uniq
  on public.orders (member_id, idempotency_key)
  where idempotency_key is not null;

-- ── 2. Server-authoritative order creation ────────────────────────────────
-- p_items: [{ "product_id": 12, "quantity": 2, "set_option_id": "SET-A" }, ...]
-- Prices, VAT and the total are resolved from `products` — anything the client
-- sends about money is ignored.
create or replace function public.place_order(
  p_items           jsonb,
  p_shipping        jsonb,
  p_payment_method  text default 'bank_transfer',
  p_po_number       text default null,
  p_notes           text default null,
  p_charge_currency text default null,
  p_fx_rate         numeric default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member        members%rowtype;
  v_item          jsonb;
  v_product       products%rowtype;
  v_set           jsonb;
  v_set_id        text;
  v_qty           int;
  v_units_per_set int;
  v_unit_price    numeric;
  v_units         int;
  v_line_total    numeric;
  v_subtotal      numeric := 0;
  v_vat           numeric;
  v_total         numeric;
  v_order_id      text;
  v_existing      public.orders%rowtype;
  v_charge_amount numeric;
  v_decimals      int;
  v_snapshot      jsonb;
  v_attempt       int := 0;
  -- Kept in sync with VAT_RATE in src/pages/Checkout.tsx
  c_vat_rate      constant numeric := 0.10;
begin
  if p_payment_method not in ('bank_transfer','paypal') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  select * into v_member from public.members where auth_id = auth.uid();
  if v_member.id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if v_member.status <> 'approved' then
    raise exception 'MEMBER_NOT_APPROVED';
  end if;

  -- Replay of the same submit (double click, retried request): hand back the
  -- order we already made instead of charging/reserving stock twice.
  if p_idempotency_key is not null then
    select * into v_existing from public.orders
      where member_id = v_member.id and idempotency_key = p_idempotency_key;
    if v_existing.id is not null then
      return jsonb_build_object(
        'order_id',        v_existing.id,
        'subtotal',        v_existing.subtotal,
        'vat',             v_existing.vat,
        'total',           v_existing.total,
        'charge_currency', v_existing.charge_currency,
        'charge_amount',   v_existing.charge_amount,
        'reused',          true
      );
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'TOO_MANY_LINES';
  end if;
  if p_shipping is null or coalesce(p_shipping->>'recipient','') = ''
     or coalesce(p_shipping->>'addressLine1','') = ''
     or coalesce(p_shipping->>'country','') = '' then
    raise exception 'INVALID_SHIPPING';
  end if;

  -- Reserve the order id up front so order_items can reference it. Retry on the
  -- (astronomically unlikely) primary-key collision rather than failing.
  loop
    v_attempt := v_attempt + 1;
    v_order_id := 'ORD-' || to_char(now(), 'YYYYMMDD') || '-' ||
                  upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 5));
    exit when not exists (select 1 from public.orders where id = v_order_id);
    if v_attempt > 10 then
      raise exception 'ORDER_ID_COLLISION';
    end if;
  end loop;

  insert into public.orders (
    id, member_id, member_name, subtotal, vat, total, status, date,
    po_number, notes, shipping_address,
    payment_method, payment_status, payment_provider, idempotency_key
  ) values (
    v_order_id, v_member.id, v_member.company_name, 0, 0, 0, 'pending', current_date,
    nullif(btrim(coalesce(p_po_number, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_shipping,
    p_payment_method, 'unpaid',
    case when p_payment_method = 'paypal' then 'paypal' else 'bank' end,
    nullif(btrim(coalesce(p_idempotency_key, '')), '')
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty <= 0 or v_qty > 10000 then
      raise exception 'INVALID_QUANTITY';
    end if;

    -- `for update` locks the row so two concurrent checkouts cannot both pass
    -- the stock check below.
    select * into v_product from public.products
      where id = (v_item->>'product_id')::int for update;
    if v_product.id is null then
      raise exception 'PRODUCT_NOT_FOUND:%', (v_item->>'product_id');
    end if;
    if v_product.status <> 'active' then
      raise exception 'PRODUCT_INACTIVE:%', v_product.id;
    end if;

    v_set_id := nullif(v_item->>'set_option_id', '');
    v_set := null;
    if v_set_id is not null then
      select opt into v_set
        from jsonb_array_elements(coalesce(v_product.set_options, '[]'::jsonb)) as opt
        where opt->>'id' = v_set_id
        limit 1;
      if v_set is null then
        raise exception 'SET_OPTION_NOT_FOUND:%', v_set_id;
      end if;
      v_unit_price    := (v_set->>'wholesalePrice')::numeric;
      v_units_per_set := coalesce((v_set->>'unitsPerSet')::int, 1);
    else
      v_unit_price    := v_product.wholesale_price::numeric;
      v_units_per_set := 1;
    end if;

    if v_unit_price is null or v_unit_price <= 0 then
      raise exception 'INVALID_PRICE:%', v_product.id;
    end if;

    -- `products.stock` counts pieces, so a set consumes qty × unitsPerSet.
    v_units := v_qty * greatest(v_units_per_set, 1);
    if v_product.stock is null or v_product.stock < v_units then
      raise exception 'INSUFFICIENT_STOCK:%', v_product.id;
    end if;
    update public.products set stock = stock - v_units where id = v_product.id;

    v_line_total := v_unit_price * v_qty;
    v_subtotal   := v_subtotal + v_line_total;

    -- Snapshot the product as it was priced so historical orders keep rendering
    -- after a catalogue edit. Keys stay camelCase to match the `Product` type
    -- the client casts this back into (rowToOrder in src/lib/db.ts) — the old
    -- client-side insert stored the JS object verbatim.
    v_snapshot := jsonb_build_object(
      'id',             v_product.id,
      'name',           v_product.name,
      'nameEn',         coalesce(v_product.name_en, ''),
      'nameI18n',       coalesce(v_product.name_i18n, '{}'::jsonb),
      'brand',          v_product.brand,
      'category',       v_product.category,
      'image',          coalesce(v_product.image, ''),
      'originalPrice',  v_product.original_price,
      'wholesalePrice', v_unit_price,
      'discount',       coalesce(v_product.discount, 0),
      'description',    coalesce(v_product.description, ''),
      'tags',           coalesce(to_jsonb(v_product.tags), '[]'::jsonb),
      'rating',         coalesce(v_product.rating, 0),
      'reviews',        coalesce(v_product.reviews, 0),
      'stock',          coalesce(v_product.stock, 0),
      'status',         v_product.status
    );
    insert into public.order_items (order_id, product_snapshot, quantity, set_option)
    values (v_order_id, v_snapshot, v_qty, v_set);
  end loop;

  v_vat   := round(v_subtotal * c_vat_rate);
  v_total := v_subtotal + v_vat;

  -- Freeze what we will ask for. The fx rate comes from the server endpoint
  -- (never the browser); an absent/invalid rate falls back to JPY 1:1.
  if p_charge_currency is null or p_fx_rate is null or p_fx_rate <= 0 then
    v_charge_amount := v_total;
    p_charge_currency := 'JPY';
    p_fx_rate := 1;
  else
    v_decimals := case when upper(p_charge_currency) in ('JPY','KRW','CNY') then 0 else 2 end;
    v_charge_amount := round(v_total * p_fx_rate, v_decimals);
  end if;
  if v_charge_amount <= 0 then
    raise exception 'INVALID_CHARGE_AMOUNT';
  end if;

  update public.orders set
    subtotal        = v_subtotal,
    vat             = v_vat,
    total           = v_total,
    charge_currency = upper(p_charge_currency),
    charge_amount   = v_charge_amount,
    fx_rate         = p_fx_rate
  where id = v_order_id;

  return jsonb_build_object(
    'order_id',        v_order_id,
    'subtotal',        v_subtotal,
    'vat',             v_vat,
    'total',           v_total,
    'charge_currency', upper(p_charge_currency),
    'charge_amount',   v_charge_amount,
    'fx_rate',         p_fx_rate,
    'reused',          false
  );
end;
$$;

-- ── 3. Payment settlement (service role only) ─────────────────────────────
-- Buyers must never be able to call these: being able to set payment_status
-- would be the same as being able to pay for free.
create or replace function public.mark_order_paid(
  p_order_id  text,
  p_reference text,
  p_amount    numeric,
  p_currency  text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Idempotent: replaying the same capture webhook/callback is a no-op.
  if v_order.payment_status = 'paid' then
    if v_order.payment_reference is distinct from p_reference then
      raise exception 'ALREADY_PAID_WITH_DIFFERENT_REFERENCE';
    end if;
    return jsonb_build_object('order_id', v_order.id, 'status', v_order.status, 'already_paid', true);
  end if;

  -- Defence in depth: the endpoint compares amounts too, but the ledger is the
  -- last line before money is treated as received.
  if v_order.charge_amount is not null
     and round(p_amount, 2) <> round(v_order.charge_amount, 2) then
    raise exception 'AMOUNT_MISMATCH:expected %, got %', v_order.charge_amount, p_amount;
  end if;
  if v_order.charge_currency is not null
     and upper(coalesce(p_currency, '')) <> upper(v_order.charge_currency) then
    raise exception 'CURRENCY_MISMATCH:expected %, got %', v_order.charge_currency, p_currency;
  end if;

  update public.orders set
    payment_status    = 'paid',
    payment_reference = p_reference,
    paid_amount       = p_amount,
    paid_currency     = upper(p_currency),
    paid_at           = now(),
    payment_error     = null,
    status            = case when status = 'pending' then 'processing' else status end
  where id = p_order_id;

  return jsonb_build_object('order_id', p_order_id, 'status', 'processing', 'already_paid', false);
end;
$$;

create or replace function public.fail_order_payment(
  p_order_id  text,
  p_reason    text,
  p_reference text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.orders set
    payment_status    = 'failed',
    payment_error     = left(coalesce(p_reason, 'unknown'), 500),
    payment_reference = coalesce(p_reference, payment_reference)
  where id = p_order_id and payment_status <> 'paid';
end;
$$;

-- Payment never happened (buyer abandoned PayPal, capture was declined): give
-- the reserved stock back and close the order. Replaces the old client-side
-- `restore_product_stock` compensation, which could be skipped by simply
-- closing the tab.
create or replace function public.cancel_unpaid_order(
  p_order_id text,
  p_reason   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item  public.order_items%rowtype;
  v_units int;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    return;
  end if;
  if v_order.payment_status = 'paid' then
    raise exception 'CANNOT_CANCEL_PAID_ORDER';
  end if;
  if v_order.status = 'cancelled' then
    return; -- already released; never restore stock twice
  end if;

  for v_item in select * from public.order_items where order_id = p_order_id
  loop
    v_units := v_item.quantity *
               greatest(coalesce((v_item.set_option->>'unitsPerSet')::int, 1), 1);
    update public.products
      set stock = stock + v_units
      where id = (v_item.product_snapshot->>'id')::int;
  end loop;

  update public.orders set
    status        = 'cancelled',
    payment_error = left(coalesce(p_reason, 'cancelled before payment'), 500)
  where id = p_order_id;
end;
$$;

-- ── 4. Grants ─────────────────────────────────────────────────────────────
-- This migration is deliberately ADDITIVE ONLY: it can be applied while the
-- current frontend is still live, because the old direct-INSERT path keeps
-- working. Closing that path is a separate step
-- (20260927_secure_checkout_lockdown.sql) to be run AFTER the new build is
-- deployed — applying both at once would break checkout for the minutes between
-- the migration and the deploy.
grant execute on function public.place_order(jsonb, jsonb, text, text, text, text, numeric, text) to authenticated;

-- Settlement is service-role only (called from api/paypal.ts with the service
-- key). `security definer` + no grant to authenticated = buyers can't self-pay.
-- `public` is in the revoke list because PostgreSQL grants EXECUTE on new
-- functions to PUBLIC by default — omitting it would leave these callable with
-- the anon key that ships in the JS bundle.
revoke all on function public.mark_order_paid(text, text, numeric, text)    from authenticated, anon, public;
revoke all on function public.fail_order_payment(text, text, text)          from authenticated, anon, public;
revoke all on function public.cancel_unpaid_order(text, text)               from authenticated, anon, public;
grant execute on function public.mark_order_paid(text, text, numeric, text) to service_role;
grant execute on function public.fail_order_payment(text, text, text)       to service_role;
grant execute on function public.cancel_unpaid_order(text, text)            to service_role;
