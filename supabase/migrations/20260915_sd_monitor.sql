-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Superdelivery product monitoring (price / stock change detection)
-- Run this in the Supabase SQL Editor after 20260912_sd_source.sql + 20260914_sd_dealer.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Tracking column on products ──────────────────────────────────────────
-- Last time scripts/sd-monitor.mjs re-checked this product on Superdelivery.
alter table public.products
  add column if not exists sd_last_checked_at timestamptz;

-- ── 2. Change log (admin-only) ──────────────────────────────────────────────
-- One row per detected change. The monitor script applies price/stock changes
-- to `products` itself and records what moved here for review/acknowledgement.
create table if not exists public.sd_product_changes (
  id           uuid primary key default gen_random_uuid(),
  product_id   integer not null references public.products (id) on delete cascade,
  change_type  text not null check (change_type in (
                 'price_up', 'price_down', 'sold_out', 'restock', 'not_trading', 'missing'
               )),
  old_value    jsonb,   -- e.g. {"wholesale":627,"original":940,"stock":50}
  new_value    jsonb,   -- e.g. {"wholesale":595,"original":940,"stock":0}
  acknowledged boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists sd_product_changes_product_idx
  on public.sd_product_changes (product_id, created_at desc);
create index if not exists sd_product_changes_unack_idx
  on public.sd_product_changes (acknowledged, created_at desc);

alter table public.sd_product_changes enable row level security;

drop policy if exists sd_product_changes_admin_select on public.sd_product_changes;
create policy sd_product_changes_admin_select on public.sd_product_changes
  for select using (public.is_admin());

drop policy if exists sd_product_changes_admin_insert on public.sd_product_changes;
create policy sd_product_changes_admin_insert on public.sd_product_changes
  for insert with check (public.is_admin());

drop policy if exists sd_product_changes_admin_update on public.sd_product_changes;
create policy sd_product_changes_admin_update on public.sd_product_changes
  for update using (public.is_admin());

-- ── 3. Notifications: payload column + product alert types ─────────────────
-- The bell UI derives title/message from `type`; product alerts carry the
-- product name and before/after values in `payload` (jsonb).
alter table public.notifications
  add column if not exists payload jsonb;

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'order_status', 'order_shipped', 'member_approved', 'member_rejected',
    'product_price_change', 'product_sold_out', 'product_restock', 'product_missing'
  ));
