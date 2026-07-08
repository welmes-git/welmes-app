-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — M8: Row Level Security review
--
-- ⚠️  DO NOT run this file blindly. It lives OUTSIDE supabase/migrations on
--     purpose so `supabase db push` never executes it.
--
-- Why this matters: the app reads whole tables in places (fetchAllMembers,
-- fetchOrders) and relies on RLS to scope the rows. Postgres combines multiple
-- PERMISSIVE policies with OR — so adding a strict policy does NOT secure a
-- table that already has a loose one. You must find and remove the loose one.
--
-- Empirically verified: anonymous (logged-out) reads of `members` and `orders`
-- already return []. The open question is whether a *logged-in buyer* can read
-- other members' rows.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── STEP 1: inspect what exists today ────────────────────────────────────────
-- Run this first and read the output before changing anything.

select
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual        as using_expression,
  with_check  as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename in ('members','orders','order_items','cart_items','reviews','products','notifications','support_rooms','support_messages')
order by tablename, cmd, policyname;

-- Confirm RLS is actually enabled on each table (rowsecurity must be true).
select relname as table_name, relrowsecurity as rls_enabled, relforcerowsecurity as rls_forced
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('members','orders','order_items','cart_items','reviews','products','notifications','support_rooms','support_messages')
order by relname;


-- ── STEP 2: the danger to look for ───────────────────────────────────────────
-- A policy whose using_expression is `true` (or just `(auth.uid() IS NOT NULL)`)
-- on `members` or `orders` means ANY logged-in buyer can read EVERY member's
-- personal data and every order. If you see one, drop it by name:
--
--   drop policy "<policyname>" on public.members;
--
-- Then apply the scoped policies in STEP 3.


-- ── STEP 3: recommended scoped policies ──────────────────────────────────────
-- Only run these AFTER removing any over-permissive policy found in STEP 2,
-- otherwise they add nothing (OR semantics).
--
-- Requires public.is_admin(), created in 20260707_notifications_and_chat_unread.sql
--
-- Uncomment to apply:

-- -- members: read your own row; admins read all
-- alter table public.members enable row level security;
-- drop policy if exists members_select_scoped on public.members;
-- create policy members_select_scoped on public.members
--   for select to authenticated
--   using (auth_id = auth.uid() or public.is_admin());
--
-- drop policy if exists members_update_scoped on public.members;
-- create policy members_update_scoped on public.members
--   for update to authenticated
--   using (auth_id = auth.uid() or public.is_admin());
--
-- -- Registration inserts the member row for the signing-up user
-- drop policy if exists members_insert_self on public.members;
-- create policy members_insert_self on public.members
--   for insert to authenticated
--   with check (auth_id = auth.uid());
--
--
-- -- orders: read your own; admins read all
-- alter table public.orders enable row level security;
-- drop policy if exists orders_select_scoped on public.orders;
-- create policy orders_select_scoped on public.orders
--   for select to authenticated
--   using (
--     public.is_admin()
--     or member_id in (select id from public.members where auth_id = auth.uid())
--   );
--
-- drop policy if exists orders_insert_own on public.orders;
-- create policy orders_insert_own on public.orders
--   for insert to authenticated
--   with check (member_id in (select id from public.members where auth_id = auth.uid()));
--
-- -- Only admins change order status / tracking
-- drop policy if exists orders_update_admin on public.orders;
-- create policy orders_update_admin on public.orders
--   for update to authenticated using (public.is_admin());
--
--
-- -- order_items: visible iff the parent order is visible
-- alter table public.order_items enable row level security;
-- drop policy if exists order_items_select_scoped on public.order_items;
-- create policy order_items_select_scoped on public.order_items
--   for select to authenticated
--   using (
--     exists (
--       select 1 from public.orders o
--       where o.id = order_id
--         and (public.is_admin()
--              or o.member_id in (select id from public.members where auth_id = auth.uid()))
--     )
--   );
--
-- drop policy if exists order_items_insert_own on public.order_items;
-- create policy order_items_insert_own on public.order_items
--   for insert to authenticated
--   with check (
--     exists (
--       select 1 from public.orders o
--       where o.id = order_id
--         and o.member_id in (select id from public.members where auth_id = auth.uid())
--     )
--   );
--
--
-- -- cart_items: strictly your own
-- alter table public.cart_items enable row level security;
-- drop policy if exists cart_items_own on public.cart_items;
-- create policy cart_items_own on public.cart_items
--   for all to authenticated
--   using (member_id in (select id from public.members where auth_id = auth.uid()))
--   with check (member_id in (select id from public.members where auth_id = auth.uid()));
--
--
-- -- products: world-readable catalogue, admin-only writes
-- alter table public.products enable row level security;
-- drop policy if exists products_select_all on public.products;
-- create policy products_select_all on public.products for select using (true);
-- drop policy if exists products_write_admin on public.products;
-- create policy products_write_admin on public.products
--   for all to authenticated using (public.is_admin()) with check (public.is_admin());
--
-- NOTE: stock is decremented by decrement_product_stock(), which is
-- SECURITY DEFINER, so buyers do not need UPDATE on products.
--
--
-- -- reviews: public read, author-only write
-- alter table public.reviews enable row level security;
-- drop policy if exists reviews_select_all on public.reviews;
-- create policy reviews_select_all on public.reviews for select using (true);
-- drop policy if exists reviews_insert_own on public.reviews;
-- create policy reviews_insert_own on public.reviews
--   for insert to authenticated
--   with check (member_id in (select id from public.members where auth_id = auth.uid()));


-- ── STEP 4: verify as a real buyer ───────────────────────────────────────────
-- Log into the site as a normal (non-admin) buyer, open the browser console and run:
--
--   const { data, error } = await window.__supabase.from('members').select('email');
--   console.log(data?.length, error);
--
-- A correctly scoped policy returns exactly 1 row (their own). If it returns
-- every member, STEP 2 still has work to do.
