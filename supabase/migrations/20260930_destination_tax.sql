-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Destination-based tax, and one pricing function for both quote and order
--
-- `place_order` charged every buyer 10%, worldwide, from a hardcoded constant.
-- The selling entity is Japanese, so that is wrong in both directions:
--
--   * Goods shipped abroad are export sales (輸出免税) and carry no Japanese
--     consumption tax. Charging 10% inflated every overseas price by a tenth and
--     billed it as tax that is not owed. The buyer then pays import VAT in their
--     own country, so it reads as double taxation.
--   * Input tax paid to suppliers is recoverable, so the 10% collected here was
--     never needed to cover it.
--
--   Domestic (JP) → 10%.  Export → 0%.
--
-- Rates live in `tax_rules` rather than a constant so a change is a row, not a
-- migration, and so the rate that applied to a given order stays auditable.
--
-- The second half of this file removes the duplicated arithmetic. VAT_RATE lived
-- in Checkout.tsx and c_vat_rate in place_order; two copies of a rule that is
-- about to depend on destination would have drifted. `_price_order` now computes
-- every figure, `quote_order` exposes it read-only for the review step, and
-- `place_order` calls the same function before it writes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Order columns ──────────────────────────────────────────────────────
alter table public.orders
  add column if not exists tax_rate      numeric(6,4),
  add column if not exists tax_mode      text,
  add column if not exists tax_note_key  text,
  add column if not exists shipping_fee  integer not null default 0,
  add column if not exists incoterms     text,
  -- ISO 3166-1 alpha-2, copied out of shipping_address so rules and reports can
  -- index on it. `shipping_address.country` stays for display.
  add column if not exists ship_to_country text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_tax_mode_check') then
    alter table public.orders add constraint orders_tax_mode_check
      check (tax_mode is null or tax_mode in ('domestic_vat','export_exempt','none'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_incoterms_check') then
    alter table public.orders add constraint orders_incoterms_check
      check (incoterms is null or incoterms in ('EXW','FOB','CIF','DAP','DDP'));
  end if;
end $$;

comment on column public.orders.tax_mode is
  'domestic_vat = Japanese consumption tax charged; export_exempt = zero-rated export (輸出免税), keep shipping documents for the refund claim.';
comment on column public.orders.incoterms is
  'DAP by default: freight is ours, import duty and VAT are the buyer''s.';

create index if not exists orders_ship_to_country_idx on public.orders (ship_to_country);
create index if not exists orders_tax_mode_idx on public.orders (tax_mode);

-- ── 2. Tax rules ──────────────────────────────────────────────────────────
create table if not exists public.tax_rules (
  id            bigserial primary key,
  -- null matches any destination; the most specific active rule wins.
  ship_to       text,
  mode          text not null check (mode in ('domestic_vat','export_exempt','none')),
  rate          numeric(6,4) not null default 0 check (rate >= 0 and rate < 1),
  note_key      text,
  priority      int not null default 100,
  active        boolean not null default true,
  effective_from date not null default current_date,
  created_at    timestamptz not null default now()
);

comment on table public.tax_rules is
  'Destination-based tax for a Japanese seller. Confirm specifics with a tax accountant; export zero-rating requires retained shipping documentation.';

insert into public.tax_rules (ship_to, mode, rate, note_key, priority)
select * from (values
  -- Domestic sales carry consumption tax.
  ('JP',      'domestic_vat',  0.10, 'tax.domesticVat',   10),
  -- Everything else is an export: zero-rated here, import VAT paid by the buyer.
  (null,      'export_exempt', 0.00, 'tax.exportExempt', 100)
) as v(ship_to, mode, rate, note_key, priority)
where not exists (select 1 from public.tax_rules);

alter table public.tax_rules enable row level security;
drop policy if exists "tax_rules_select" on public.tax_rules;
-- Readable so the storefront can explain which rate applied; writes are admin-only.
create policy "tax_rules_select" on public.tax_rules for select using (true);
revoke insert, update, delete on public.tax_rules from anon, authenticated;

-- ── 3. Single pricing implementation ──────────────────────────────────────
-- Read-only: no stock, no writes. Both `quote_order` and `place_order` call it so
-- the review screen can never disagree with what gets charged.
create or replace function public._price_order(
  p_items    jsonb,
  p_shipping jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_item       jsonb;
  v_product    products%rowtype;
  v_set        jsonb;
  v_set_id     text;
  v_qty        int;
  v_units      int;
  v_unit_price numeric;
  v_ups        int;
  v_subtotal   numeric := 0;
  v_units_tot  int := 0;
  v_country    text;
  v_rule       public.tax_rules%rowtype;
  v_tax        numeric;
  v_shipping   numeric := 0;
  v_lines      jsonb := '[]'::jsonb;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'TOO_MANY_LINES';
  end if;

  -- Prefer the explicit code; fall back to whatever the address holds so a quote
  -- can still be produced while the client is being updated.
  v_country := upper(coalesce(nullif(btrim(coalesce(p_shipping->>'countryCode','')), ''),
                              nullif(btrim(coalesce(p_shipping->>'country','')), ''),
                              ''));

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty <= 0 or v_qty > 10000 then
      raise exception 'INVALID_QUANTITY';
    end if;

    select * into v_product from public.products where id = (v_item->>'product_id')::int;
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
        where opt->>'id' = v_set_id limit 1;
      if v_set is null then
        raise exception 'SET_OPTION_NOT_FOUND:%', v_set_id;
      end if;
      v_unit_price := (v_set->>'wholesalePrice')::numeric;
      v_ups        := coalesce((v_set->>'unitsPerSet')::int, 1);
    else
      v_unit_price := v_product.wholesale_price::numeric;
      v_ups        := 1;
    end if;

    if v_unit_price is null or v_unit_price <= 0 then
      raise exception 'INVALID_PRICE:%', v_product.id;
    end if;

    v_units     := v_qty * greatest(v_ups, 1);
    v_units_tot := v_units_tot + v_units;
    v_subtotal  := v_subtotal + v_unit_price * v_qty;

    v_lines := v_lines || jsonb_build_object(
      'product_id',    v_product.id,
      'set_option_id', v_set_id,
      'quantity',      v_qty,
      'unit_price',    v_unit_price,
      'units',         v_units,
      'line_total',    v_unit_price * v_qty
    );
  end loop;

  -- Most specific active rule first: a row naming the country beats the catch-all.
  select * into v_rule from public.tax_rules
   where active
     and effective_from <= current_date
     and (ship_to is null or ship_to = v_country)
   order by (ship_to is null), priority, id
   limit 1;

  if v_rule.id is null then
    -- No rule at all: charge nothing rather than guess. A missing rule is a
    -- configuration bug, and over-charging tax is worse than under-charging.
    v_tax := 0;
    v_rule.mode := 'none';
    v_rule.rate := 0;
  else
    v_tax := round(v_subtotal * v_rule.rate);
  end if;

  -- Freight is not computed yet: carrier rates are not in the system, and a
  -- guessed number would either lose money or drive buyers away. Orders record 0
  -- and freight is invoiced separately until `shipping_rates` exists.
  v_shipping := 0;

  return jsonb_build_object(
    'subtotal',     v_subtotal,
    'shipping_fee', v_shipping,
    'tax',          v_tax,
    'tax_rate',     v_rule.rate,
    'tax_mode',     v_rule.mode,
    'tax_note_key', v_rule.note_key,
    'total',        v_subtotal + v_shipping + v_tax,
    'total_units',  v_units_tot,
    'ship_to',      nullif(v_country, ''),
    'incoterms',    'DAP',
    'lines',        v_lines
  );
end;
$$;

-- Read-only twin used by the checkout review step, so the browser displays
-- server-computed figures instead of recomputing them from its own constant.
create or replace function public.quote_order(
  p_items    jsonb,
  p_shipping jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public._price_order(p_items, p_shipping);
$$;

revoke all on function public._price_order(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.quote_order(jsonb, jsonb) from public, anon;
grant execute on function public.quote_order(jsonb, jsonb) to authenticated;

-- ── 4. place_order uses the shared pricing ────────────────────────────────
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
  v_price         jsonb;
  v_line          jsonb;
  v_product       products%rowtype;
  v_order_id      text;
  v_existing      public.orders%rowtype;
  v_currency      text;
  v_fx            public.fx_rates%rowtype;
  v_rate          numeric;
  v_charge_amount numeric;
  v_decimals      int;
  v_attempt       int := 0;
  v_due_at        timestamptz;
  v_set           jsonb;
  c_fx_max_age    constant interval := interval '72 hours';
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
        'order_id', v_existing.id, 'subtotal', v_existing.subtotal,
        'vat', v_existing.vat, 'shipping_fee', v_existing.shipping_fee,
        'total', v_existing.total, 'tax_rate', v_existing.tax_rate,
        'tax_mode', v_existing.tax_mode, 'tax_note_key', v_existing.tax_note_key,
        'incoterms', v_existing.incoterms,
        'charge_currency', v_existing.charge_currency,
        'charge_amount', v_existing.charge_amount, 'fx_rate', v_existing.fx_rate,
        'payment_due_at', v_existing.payment_due_at, 'reused', true
      );
    end if;
  end if;

  if p_shipping is null or coalesce(p_shipping->>'recipient','') = ''
     or coalesce(p_shipping->>'addressLine1','') = ''
     or coalesce(nullif(p_shipping->>'countryCode',''), p_shipping->>'country', '') = '' then
    raise exception 'INVALID_SHIPPING';
  end if;

  -- Price first: validation and tax resolution happen before any stock moves.
  v_price := public._price_order(p_items, p_shipping);

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

  v_decimals := case when v_currency in ('JPY','KRW','CNY') then 0 else 2 end;
  v_charge_amount := round((v_price->>'total')::numeric * v_rate, v_decimals);
  if v_charge_amount <= 0 then
    raise exception 'INVALID_CHARGE_AMOUNT';
  end if;

  insert into public.orders (
    id, member_id, member_name, subtotal, vat, total, status, date,
    po_number, notes, shipping_address,
    payment_method, payment_status, payment_provider, idempotency_key, payment_due_at,
    tax_rate, tax_mode, tax_note_key, shipping_fee, incoterms, ship_to_country,
    charge_currency, charge_amount, fx_rate
  ) values (
    v_order_id, v_member.id, v_member.company_name,
    (v_price->>'subtotal')::numeric, (v_price->>'tax')::numeric, (v_price->>'total')::numeric,
    'pending', current_date,
    nullif(btrim(coalesce(p_po_number, '')), ''),
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_shipping,
    p_payment_method, 'unpaid',
    case when p_payment_method = 'paypal' then 'paypal' else 'bank' end,
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    v_due_at,
    (v_price->>'tax_rate')::numeric, v_price->>'tax_mode', v_price->>'tax_note_key',
    (v_price->>'shipping_fee')::int, v_price->>'incoterms', v_price->>'ship_to',
    v_currency, v_charge_amount, v_rate
  );

  -- Stock comes out here, against the lines `_price_order` already validated.
  for v_line in select * from jsonb_array_elements(v_price->'lines')
  loop
    select * into v_product from public.products
      where id = (v_line->>'product_id')::int for update;
    if v_product.id is null then
      raise exception 'PRODUCT_NOT_FOUND:%', (v_line->>'product_id');
    end if;
    if v_product.stock is null or v_product.stock < (v_line->>'units')::int then
      raise exception 'INSUFFICIENT_STOCK:%', v_product.id;
    end if;
    update public.products set stock = stock - (v_line->>'units')::int where id = v_product.id;

    v_set := null;
    if nullif(v_line->>'set_option_id','') is not null then
      select opt into v_set
        from jsonb_array_elements(coalesce(v_product.set_options, '[]'::jsonb)) as opt
        where opt->>'id' = v_line->>'set_option_id' limit 1;
    end if;

    insert into public.order_items (order_id, product_snapshot, quantity, set_option)
    values (
      v_order_id,
      jsonb_build_object(
        'id', v_product.id, 'name', v_product.name,
        'nameEn', coalesce(v_product.name_en, ''),
        'nameI18n', coalesce(v_product.name_i18n, '{}'::jsonb),
        'brand', v_product.brand, 'category', v_product.category,
        'image', coalesce(v_product.image, ''),
        'originalPrice', v_product.original_price,
        'wholesalePrice', (v_line->>'unit_price')::numeric,
        'discount', coalesce(v_product.discount, 0),
        'description', coalesce(v_product.description, ''),
        'tags', coalesce(to_jsonb(v_product.tags), '[]'::jsonb),
        'rating', coalesce(v_product.rating, 0),
        'reviews', coalesce(v_product.reviews, 0),
        'stock', coalesce(v_product.stock, 0), 'status', v_product.status
      ),
      (v_line->>'quantity')::int,
      v_set
    );
  end loop;

  return jsonb_build_object(
    'order_id',        v_order_id,
    'subtotal',        (v_price->>'subtotal')::numeric,
    'vat',             (v_price->>'tax')::numeric,
    'shipping_fee',    (v_price->>'shipping_fee')::numeric,
    'total',           (v_price->>'total')::numeric,
    'tax_rate',        (v_price->>'tax_rate')::numeric,
    'tax_mode',        v_price->>'tax_mode',
    'tax_note_key',    v_price->>'tax_note_key',
    'incoterms',       v_price->>'incoterms',
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

-- ── 5. Backfill ───────────────────────────────────────────────────────────
-- Existing orders predate these columns. Country names are mapped to codes for
-- the eighteen labels the old checkout offered; anything else stays null rather
-- than being guessed, so reports can spot it.
update public.orders o set ship_to_country = m.code
  from (values
    ('Japan','JP'),('South Korea','KR'),('United States','US'),('China','CN'),
    ('Australia','AU'),('Canada','CA'),('United Kingdom','GB'),('Germany','DE'),
    ('France','FR'),('Singapore','SG'),('Hong Kong','HK'),('Taiwan','TW'),
    ('Vietnam','VN'),('Thailand','TH'),('Indonesia','ID'),('Malaysia','MY'),
    ('Philippines','PH')
  ) as m(name, code)
 where o.ship_to_country is null
   and o.shipping_address->>'country' = m.name;

-- Historical orders keep the 10% they were actually charged; only the mode is
-- labelled, so the books still reconcile with what buyers paid.
update public.orders set
  tax_rate = case when total > 0 and vat > 0 then round(vat::numeric / (total - vat), 4) else 0 end,
  tax_mode = case when vat > 0 then 'domestic_vat' else 'none' end,
  incoterms = coalesce(incoterms, 'DAP')
 where tax_mode is null;
