-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Server-authoritative FX rates
--
-- 20260926 moved prices, VAT and the total onto the server but still accepted
-- `p_fx_rate` from the caller. The bank-transfer path fed it straight from the
-- browser (`rates[selectedBankCurrency]` in Checkout.tsx), and `place_order`
-- computes
--     charge_amount = round(total * p_fx_rate)
-- so a buyer could send a rate of their choosing and be quoted USD 1.00 for a
-- ¥500,000 order. Reconciling an incoming wire against `charge_amount` would
-- then accept that dollar as full payment — the same class of hole as the forged
-- `total`, just one layer down.
--
-- Rates now live in `fx_rates`, written only by the service role, and
-- `place_order` reads them itself. `p_fx_rate` is accepted but IGNORED so the
-- signature stays stable across the deploy; a follow-up migration drops it.
--
-- Staleness is explicit instead of silent. src/lib/currency.ts quietly fell back
-- to rates hardcoded in June whenever frankfurter.app was unreachable, and those
-- became the real charge. Here a rate older than the hard limit refuses to price
-- a foreign-currency order at all. JPY needs no rate (1:1), so a JPY-denominated
-- checkout can never be blocked by an FX outage.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.fx_rates (
  currency   text primary key,
  -- Units of `currency` per 1 JPY, matching the JPY-base convention in
  -- src/lib/currency.ts and server/payments.mjs.
  rate_jpy   numeric(18,8) not null check (rate_jpy > 0),
  source     text not null default 'frankfurter',
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fx_rates is
  'JPY-base FX rates. Written only by the service role; read by place_order and the storefront.';
comment on column public.fx_rates.source is
  'frankfurter | manual | seed. "manual" pins a rate and survives automatic refreshes.';

-- Seed so the first deploy can price immediately. Values mirror FALLBACK_RATES
-- in src/lib/currency.ts; `fetched_at` is deliberately backdated so the first
-- real refresh always wins and so nobody mistakes these for live rates.
insert into public.fx_rates (currency, rate_jpy, source, fetched_at)
values
  ('JPY', 1,       'seed', '2026-01-01'::timestamptz),
  ('USD', 0.0067,  'seed', '2026-01-01'::timestamptz),
  ('EUR', 0.0062,  'seed', '2026-01-01'::timestamptz),
  ('GBP', 0.0053,  'seed', '2026-01-01'::timestamptz),
  ('CNY', 0.049,   'seed', '2026-01-01'::timestamptz),
  ('KRW', 9.05,    'seed', '2026-01-01'::timestamptz),
  ('SGD', 0.0091,  'seed', '2026-01-01'::timestamptz),
  ('AUD', 0.0104,  'seed', '2026-01-01'::timestamptz)
on conflict (currency) do nothing;

alter table public.fx_rates enable row level security;

-- Rates are public information (they are already visible in every price on the
-- storefront); only writes are restricted.
drop policy if exists "fx_rates_select" on public.fx_rates;
create policy "fx_rates_select" on public.fx_rates for select using (true);

revoke insert, update, delete on public.fx_rates from anon, authenticated;

-- ── Refresh entry point (service role only) ───────────────────────────────
-- p_rates: { "USD": 0.0067, "EUR": 0.0062, ... }
-- Never overwrites a row pinned with source='manual'.
create or replace function public.upsert_fx_rates(
  p_rates  jsonb,
  p_source text default 'frankfurter'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text;
  v_rate  numeric;
  v_count int := 0;
begin
  if p_rates is null or jsonb_typeof(p_rates) <> 'object' then
    raise exception 'INVALID_RATES';
  end if;

  for v_code, v_rate in select key, (value #>> '{}')::numeric from jsonb_each(p_rates)
  loop
    -- Guard against a malformed upstream payload poisoning live pricing.
    if v_rate is null or v_rate <= 0 or v_rate > 100000 then
      continue;
    end if;

    insert into public.fx_rates (currency, rate_jpy, source, fetched_at, updated_at)
    values (upper(v_code), v_rate, p_source, now(), now())
    on conflict (currency) do update
      set rate_jpy   = excluded.rate_jpy,
          source     = excluded.source,
          fetched_at = excluded.fetched_at,
          updated_at = now()
      where public.fx_rates.source <> 'manual' or p_source = 'manual';
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.upsert_fx_rates(jsonb, text) from public, anon, authenticated;
grant execute on function public.upsert_fx_rates(jsonb, text) to service_role;

-- ── place_order: read the rate, never accept it ───────────────────────────
create or replace function public.place_order(
  p_items           jsonb,
  p_shipping        jsonb,
  p_payment_method  text default 'bank_transfer',
  p_po_number       text default null,
  p_notes           text default null,
  p_charge_currency text default null,
  -- DEPRECATED and ignored: kept only so the running frontend keeps working
  -- across this deploy. Removed in a later cleanup migration.
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
  v_currency      text;
  v_fx            public.fx_rates%rowtype;
  v_rate          numeric;
  v_charge_amount numeric;
  v_decimals      int;
  v_snapshot      jsonb;
  v_attempt       int := 0;
  -- Kept in sync with VAT_RATE in src/pages/Checkout.tsx. P3 replaces this
  -- constant with a rule lookup on the destination country.
  c_vat_rate      constant numeric := 0.10;
  -- Beyond this a stored rate is treated as unusable rather than "close enough".
  c_fx_max_age    constant interval := interval '72 hours';
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
        'fx_rate',         v_existing.fx_rate,
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
    -- the client casts this back into (rowToOrder in src/lib/db.ts).
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
    'reused',          false
  );
end;
$$;

-- Re-assert the grants: `create or replace` resets nothing, but PostgreSQL gives
-- EXECUTE to PUBLIC on any newly created signature, and this file is the one
-- place a reader will look for who may call it.
revoke all on function public.place_order(jsonb, jsonb, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, text, text, text, numeric, text) to authenticated;
