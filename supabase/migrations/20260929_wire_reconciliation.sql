-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Wire reconciliation and unpaid-order expiry
--
-- Two gaps left by the payment work so far.
--
-- 1) Nothing could turn a received wire into a paid order. `mark_order_paid` is
--    service-role only and demands an exact amount match, which a wire almost
--    never satisfies: intermediary banks deduct their fee in transit, so a buyer
--    who remits the invoice total to the cent still arrives short. Admins had no
--    way to record the payment at all.
--
-- 2) `place_order` reserves stock the moment an order is created. A bank-transfer
--    order that is never paid therefore holds sellable inventory forever. Before
--    stock was reserved this was merely untidy; now it is a slow leak.
--
-- `record_wire_payment` accepts a shortfall inside a tolerance and records what
-- actually arrived, so the ledger shows the deduction instead of hiding it.
-- `expire_unpaid_orders` releases the reservation once the due date passes.
--
-- Deliberately NOT automatic: a shortfall beyond tolerance leaves the order
-- unpaid with the amount recorded rather than cancelling it. By then goods may be
-- packed, and the right answer (invoice the difference, carry it to the next
-- order, or absorb it) is a commercial decision, not a database one.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Payment deadline ───────────────────────────────────────────────────
alter table public.orders
  add column if not exists payment_due_at timestamptz,
  -- What the buyer actually sent, before bank deductions, when they tell us.
  add column if not exists payment_shortfall numeric(14,2);

comment on column public.orders.payment_due_at is
  'Wire transfers only: after this the reservation is released by expire_unpaid_orders().';
comment on column public.orders.payment_shortfall is
  'charge_amount - paid_amount when a wire arrived short (intermediary bank fees).';

create index if not exists orders_unpaid_due_idx
  on public.orders (payment_due_at)
  where payment_status = 'unpaid' and payment_method = 'bank_transfer';

-- Existing unpaid wire orders have no deadline; give them one from their order
-- date so the sweeper has something to act on.
update public.orders
   set payment_due_at = (date + interval '7 days')
 where payment_method = 'bank_transfer'
   and payment_status = 'unpaid'
   and payment_due_at is null;

-- ── 2. place_order sets the deadline ──────────────────────────────────────
-- Only the INSERT changes; everything else is 20260928 verbatim. Replacing the
-- whole body keeps the function readable in one piece rather than spread across
-- migrations.
create or replace function public.place_order(
  p_items           jsonb,
  p_shipping        jsonb,
  p_payment_method  text default 'bank_transfer',
  p_po_number       text default null,
  p_notes           text default null,
  p_charge_currency text default null,
  p_fx_rate         numeric default null,  -- DEPRECATED, ignored
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
  v_currency      text;
  v_fx            public.fx_rates%rowtype;
  v_rate          numeric;
  v_charge_amount numeric;
  v_decimals      int;
  v_snapshot      jsonb;
  v_attempt       int := 0;
  v_due_at        timestamptz;
  c_vat_rate      constant numeric := 0.10;
  c_fx_max_age    constant interval := interval '72 hours';
  -- International wires clear in 2-5 business days; 7 days leaves room for a
  -- weekend without stranding stock much longer than that.
  c_wire_terms    constant interval := interval '7 days';
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
        'fx_rate',         v_existing.fx_rate,
        'payment_due_at',  v_existing.payment_due_at,
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

  -- Resolve the charge currency and its rate BEFORE taking stock, so an FX
  -- problem fails the order instead of leaving a reservation behind.
  v_currency := upper(coalesce(nullif(btrim(coalesce(p_charge_currency, '')), ''), 'JPY'));
  if v_currency = 'JPY' then
    v_rate := 1;
  else
    select * into v_fx from public.fx_rates where currency = v_currency;
    if v_fx.currency is null then
      raise exception 'FX_UNSUPPORTED:%', v_currency;
    end if;
    if v_fx.fetched_at < now() - c_fx_max_age then
      raise exception 'FX_STALE:% last updated %', v_currency, v_fx.fetched_at;
    end if;
    v_rate := v_fx.rate_jpy;
  end if;

  -- A PayPal order is captured within the minute, so it needs no deadline.
  v_due_at := case when p_payment_method = 'bank_transfer' then now() + c_wire_terms end;

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
    payment_method, payment_status, payment_provider, idempotency_key, payment_due_at
  ) values (
    v_order_id, v_member.id, v_member.company_name, 0, 0, 0, 'pending', current_date,
    nullif(btrim(coalesce(p_po_number, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_shipping,
    p_payment_method, 'unpaid',
    case when p_payment_method = 'paypal' then 'paypal' else 'bank' end,
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    v_due_at
  );

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty <= 0 or v_qty > 10000 then
      raise exception 'INVALID_QUANTITY';
    end if;

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

    v_units := v_qty * greatest(v_units_per_set, 1);
    if v_product.stock is null or v_product.stock < v_units then
      raise exception 'INSUFFICIENT_STOCK:%', v_product.id;
    end if;
    update public.products set stock = stock - v_units where id = v_product.id;

    v_line_total := v_unit_price * v_qty;
    v_subtotal   := v_subtotal + v_line_total;

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

  v_decimals := case when v_currency in ('JPY','KRW','CNY') then 0 else 2 end;
  v_charge_amount := round(v_total * v_rate, v_decimals);
  if v_charge_amount <= 0 then
    raise exception 'INVALID_CHARGE_AMOUNT';
  end if;

  update public.orders set
    subtotal        = v_subtotal,
    vat             = v_vat,
    total           = v_total,
    charge_currency = v_currency,
    charge_amount   = v_charge_amount,
    fx_rate         = v_rate
  where id = v_order_id;

  return jsonb_build_object(
    'order_id',        v_order_id,
    'subtotal',        v_subtotal,
    'vat',             v_vat,
    'total',           v_total,
    'charge_currency', v_currency,
    'charge_amount',   v_charge_amount,
    'fx_rate',         v_rate,
    'payment_due_at',  v_due_at,
    'reused',          false
  );
end;
$$;

revoke all on function public.place_order(jsonb, jsonb, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, text, text, text, numeric, text) to authenticated;

-- ── 3. Record a received wire ─────────────────────────────────────────────
-- Admin-only, unlike `mark_order_paid` which stays service-role for PayPal.
-- Tolerance exists because intermediary banks deduct in transit: industry terms
-- put those charges on the remitter ("OUR"), but SHA is most banks' default, so a
-- correctly-remitted invoice still lands $15-40 short. Refusing to fulfil over
-- that costs more than absorbing it.
create or replace function public.record_wire_payment(
  p_order_id      text,
  p_reference     text,
  p_amount        numeric,
  p_currency      text,
  p_received_at   timestamptz default now(),
  -- Whichever is larger applies: the percentage covers big orders, the absolute
  -- floor covers small ones where a flat bank fee dominates.
  p_tolerance_pct numeric default 0.02,
  p_tolerance_jpy numeric default 3000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order     public.orders%rowtype;
  v_expected  numeric;
  v_decimals  int;
  v_tolerance numeric;
  v_shortfall numeric;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.payment_method <> 'bank_transfer' then
    raise exception 'NOT_A_WIRE_ORDER';
  end if;
  if v_order.payment_status = 'paid' then
    return jsonb_build_object('order_id', v_order.id, 'already_paid', true);
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if upper(coalesce(p_currency, '')) <> upper(coalesce(v_order.charge_currency, 'JPY')) then
    raise exception 'CURRENCY_MISMATCH:expected %, got %', v_order.charge_currency, p_currency;
  end if;

  v_expected  := coalesce(v_order.charge_amount, v_order.total);
  v_decimals  := case when upper(coalesce(v_order.charge_currency,'JPY')) in ('JPY','KRW','CNY') then 0 else 2 end;
  -- The absolute floor is quoted in JPY, so convert it with the rate frozen on
  -- the order rather than a live one.
  v_tolerance := greatest(
    v_expected * p_tolerance_pct,
    round(p_tolerance_jpy * coalesce(v_order.fx_rate, 1), v_decimals)
  );
  v_shortfall := greatest(v_expected - p_amount, 0);

  if v_shortfall > v_tolerance then
    -- Recorded, not cancelled: goods may already be packed, and whether to invoice
    -- the difference, carry it forward or absorb it is a commercial call.
    update public.orders set
      payment_reference = p_reference,
      paid_amount       = p_amount,
      paid_currency     = upper(p_currency),
      payment_shortfall = v_shortfall,
      payment_error     = format('UNDERPAID: received %s of %s %s (short %s, tolerance %s)',
                                 p_amount, v_expected, v_order.charge_currency, v_shortfall, v_tolerance)
    where id = p_order_id;

    return jsonb_build_object(
      'order_id',  v_order.id,
      'accepted',  false,
      'expected',  v_expected,
      'received',  p_amount,
      'shortfall', v_shortfall,
      'tolerance', v_tolerance
    );
  end if;

  update public.orders set
    payment_status    = 'paid',
    payment_reference = p_reference,
    paid_amount       = p_amount,
    paid_currency     = upper(p_currency),
    paid_at           = p_received_at,
    -- Kept even when accepted, so the deduction is visible in the ledger instead
    -- of being rounded away.
    payment_shortfall = nullif(v_shortfall, 0),
    payment_error     = null,
    status            = case when status = 'pending' then 'processing' else status end
  where id = p_order_id;

  return jsonb_build_object(
    'order_id',  v_order.id,
    'accepted',  true,
    'expected',  v_expected,
    'received',  p_amount,
    'shortfall', v_shortfall,
    'tolerance', v_tolerance
  );
end;
$$;

revoke all on function public.record_wire_payment(text, text, numeric, text, timestamptz, numeric, numeric)
  from public, anon;
grant execute on function public.record_wire_payment(text, text, numeric, text, timestamptz, numeric, numeric)
  to authenticated;  -- is_admin() gates it inside

-- ── 4. Release reservations for orders that were never paid ───────────────
create or replace function public.expire_unpaid_orders(p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  record;
  v_item   public.order_items%rowtype;
  v_units  int;
  v_count  int := 0;
  v_ids    text[] := '{}';
begin
  for v_order in
    select id from public.orders
     where payment_method = 'bank_transfer'
       and payment_status = 'unpaid'
       and status = 'pending'
       and payment_due_at is not null
       and payment_due_at < now()
     order by payment_due_at
     limit greatest(p_limit, 1)
     for update skip locked
  loop
    -- Same restore logic as cancel_unpaid_order, inlined so one slow sweep does
    -- not hold a transaction open across hundreds of nested calls.
    for v_item in select * from public.order_items where order_id = v_order.id
    loop
      v_units := v_item.quantity *
                 greatest(coalesce((v_item.set_option->>'unitsPerSet')::int, 1), 1);
      update public.products
        set stock = stock + v_units
        where id = (v_item.product_snapshot->>'id')::int;
    end loop;

    update public.orders set
      status        = 'cancelled',
      payment_error = format('expired unpaid at %s (due %s)', now(), payment_due_at)
    where id = v_order.id;

    v_count := v_count + 1;
    v_ids := v_ids || v_order.id;
  end loop;

  return jsonb_build_object('cancelled', v_count, 'order_ids', v_ids);
end;
$$;

revoke all on function public.expire_unpaid_orders(int) from public, anon, authenticated;
grant execute on function public.expire_unpaid_orders(int) to service_role;

-- Schedule the sweep. Requires the pg_cron extension (Supabase: Database →
-- Extensions → pg_cron). Without it the function still works and can be called
-- manually or from a deploy hook.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('welmes-expire-unpaid-orders')
      where exists (select 1 from cron.job where jobname = 'welmes-expire-unpaid-orders');
    perform cron.schedule(
      'welmes-expire-unpaid-orders',
      '17 3 * * *',   -- 03:17 UTC daily, off the top of the hour
      $cron$select public.expire_unpaid_orders();$cron$
    );
  else
    raise notice 'pg_cron not installed — enable it and re-run this block to schedule expire_unpaid_orders()';
  end if;
end $$;
