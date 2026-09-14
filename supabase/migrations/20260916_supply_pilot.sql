-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Brand supply pilot (order-then-purchase / 受注後仕入)
-- WELMES sells to buyers; when an order comes in it buys those units from the
-- brand (supplier), receives them at the Japan warehouse, and pays each supplier
-- by bank transfer at month end.
-- Run in the Supabase SQL Editor. Every table here is admin-only: purchase
-- prices and bank details must never reach buyers (products is publicly
-- readable, so cost lives in product_supply, not on products).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Suppliers ───────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  -- The row for goods WELMES already holds; lines from it never become POs
  is_internal     boolean not null default false,
  status          text not null default 'pilot' check (status in ('pilot', 'active', 'paused')),
  contact_name    text,
  email           text,
  phone           text,
  invoice_no      text,           -- 適格請求書発行事業者 登録番号 (T + 13 digits)
  bank_name       text,
  bank_branch     text,
  account_type    text check (account_type in ('普通', '当座')),
  account_number  text,
  account_holder  text,           -- 口座名義 (カナ)
  payment_terms   text not null default '月末締め翌月末払い',
  notes           text,
  created_at      timestamptz not null default now()
);

insert into public.suppliers (name, is_internal, status)
select 'WELMES 재고', true, 'active'
where not exists (select 1 from public.suppliers where is_internal);

-- ── 2. Which supplier each product comes from, at what purchase price ──────
create table if not exists public.product_supply (
  product_id  bigint primary key references public.products (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id),
  cost_price  numeric(12, 2) not null check (cost_price >= 0),  -- per piece, tax excluded
  updated_at  timestamptz not null default now()
);
create index if not exists product_supply_supplier_idx on public.product_supply (supplier_id);

-- ── 3. Purchase orders: one per (sales order, supplier) ────────────────────
create table if not exists public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  order_id     text not null references public.orders (id) on delete cascade,
  supplier_id  uuid not null references public.suppliers (id),
  status       text not null default 'draft'
               check (status in ('draft', 'sent', 'accepted', 'received', 'cancelled')),
  sent_at      timestamptz,
  received_at  timestamptz,
  tracking_no  text,
  note         text,
  created_at   timestamptz not null default now(),
  unique (order_id, supplier_id)
);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id, received_at);

create table if not exists public.purchase_order_items (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  product_id        bigint,
  product_name      text not null,
  set_label         text,
  qty               integer not null check (qty > 0),     -- pieces
  qty_received      integer check (qty_received >= 0),    -- set at warehouse check-in
  unit_cost         numeric(12, 2) not null               -- snapshot of cost_price at PO time
);
create index if not exists purchase_order_items_po_idx on public.purchase_order_items (purchase_order_id);

-- ── 4. Admin-only access ───────────────────────────────────────────────────
alter table public.suppliers            enable row level security;
alter table public.product_supply       enable row level security;
alter table public.purchase_orders      enable row level security;
alter table public.purchase_order_items enable row level security;

do $$
declare t text;
begin
  foreach t in array array['suppliers', 'product_supply', 'purchase_orders', 'purchase_order_items']
  loop
    execute format('drop policy if exists %1$s_admin_all on public.%1$s', t);
    execute format(
      'create policy %1$s_admin_all on public.%1$s for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ── 5. Split a sales order into supplier purchase orders ───────────────────
-- Groups the order's lines by supplier, snapshots today's cost, and skips
-- products with no supplier set and the internal WELMES-stock supplier.
-- Safe to call twice: existing (order, supplier) POs are left untouched.
-- Returns how many purchase orders were created.
create or replace function public.generate_purchase_orders(p_order_id text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  created integer := 0;
  sup     record;
  po_id   uuid;
begin
  if not public.is_admin() then
    raise exception 'ADMIN_ONLY';
  end if;

  for sup in
    select distinct ps.supplier_id
    from order_items oi
    join product_supply ps on ps.product_id = (oi.product_snapshot->>'id')::bigint
    join suppliers s on s.id = ps.supplier_id and not s.is_internal
    where oi.order_id = p_order_id
  loop
    insert into purchase_orders (order_id, supplier_id)
    values (p_order_id, sup.supplier_id)
    on conflict (order_id, supplier_id) do nothing
    returning id into po_id;

    if po_id is null then
      continue;
    end if;

    insert into purchase_order_items (purchase_order_id, product_id, product_name, set_label, qty, unit_cost)
    select po_id,
           (oi.product_snapshot->>'id')::bigint,
           coalesce(oi.product_snapshot->>'nameEn', oi.product_snapshot->>'name'),
           oi.set_option->>'description',
           oi.quantity * coalesce((oi.set_option->>'unitsPerSet')::int, 1),
           ps.cost_price
    from order_items oi
    join product_supply ps on ps.product_id = (oi.product_snapshot->>'id')::bigint
    where oi.order_id = p_order_id and ps.supplier_id = sup.supplier_id;

    created := created + 1;
  end loop;

  return created;
end;
$$;

grant execute on function public.generate_purchase_orders(text) to authenticated;
