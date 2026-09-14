-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Superdelivery watchlist for sold-out / not-trading products
-- Run this in the Supabase SQL Editor after 20260915_sd_monitor.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Watchlist ────────────────────────────────────────────────────────────────
-- Products found on Superdelivery but NOT importable at collection time because
-- they are sold out (price info hidden) or the dealer is not trading
-- (卸単価 비공개). sd-monitor.mjs re-checks these; once price/set info appears
-- again (restock) the product is auto-registered and the row is removed.
create table if not exists public.sd_watchlist (
  id              uuid primary key default gen_random_uuid(),
  sd_product_id   text not null unique,
  name            text,
  created_at      timestamptz not null default now(),
  last_checked_at timestamptz
);

alter table public.sd_watchlist enable row level security;

drop policy if exists sd_watchlist_admin_select on public.sd_watchlist;
create policy sd_watchlist_admin_select on public.sd_watchlist
  for select using (public.is_admin());

drop policy if exists sd_watchlist_admin_insert on public.sd_watchlist;
create policy sd_watchlist_admin_insert on public.sd_watchlist
  for insert with check (public.is_admin());

drop policy if exists sd_watchlist_admin_delete on public.sd_watchlist;
create policy sd_watchlist_admin_delete on public.sd_watchlist
  for delete using (public.is_admin());

-- ── Notifications: add auto-registration alert type ─────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in (
    'order_status', 'order_shipped', 'member_approved', 'member_rejected',
    'product_price_change', 'product_sold_out', 'product_restock', 'product_missing',
    'product_registered'
  ));