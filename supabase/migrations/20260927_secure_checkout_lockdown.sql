-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Checkout lockdown (step 2 of 2)
--
-- Run this ONLY AFTER the build containing src/lib/db.ts `placeOrder` is live.
--
-- 20260926_secure_checkout.sql is additive: it adds `place_order` and the
-- payment ledger while leaving the old direct-INSERT path intact, so it is safe
-- to apply against a running site. This file closes that old path. Run it too
-- early and the deployed-but-old frontend loses checkout; run it not at all and
-- the forged-total hole stays open — a signed-in buyer can still
--   supabase.from('orders').insert({ ..., total: 0 })
-- because `orders_insert` only ever checked who they were, never what they owed.
--
-- Verify before running (should return the new function):
--   select proname from pg_proc where proname = 'place_order';
-- Verify after running (should return zero rows):
--   select polname from pg_policies
--    where tablename in ('orders','order_items') and cmd = 'INSERT';
-- ═══════════════════════════════════════════════════════════════════════════

-- Direct INSERT is what allowed a forged `total`; `place_order` is now the only
-- door, and it prices every line from the catalogue itself.
drop policy if exists "orders_insert" on public.orders;
drop policy if exists "order_items_insert" on public.order_items;

revoke insert on public.orders      from authenticated, anon;
revoke insert on public.order_items from authenticated, anon;

-- Buyers no longer touch stock directly — `place_order` takes it in the same
-- transaction that writes the order, so the old take-then-compensate pair is
-- both unnecessary and dangerous (it let stock be moved without an order).
--
-- `public` MUST be in this list. PostgreSQL grants EXECUTE on every new function
-- to PUBLIC by default, and 20260708_stock_management.sql only ever added
-- `grant ... to authenticated`. The result was reachable from the anon key that
-- ships inside the JS bundle — verified against production:
--   POST /rest/v1/rpc/decrement_product_stock  →  204
-- i.e. anyone on the internet could zero out (or inflate) any product's stock
-- without logging in. Revoking from `authenticated, anon` alone would leave that
-- PUBLIC grant in place.
revoke all on function public.decrement_product_stock(jsonb) from public, anon, authenticated;
revoke all on function public.restore_product_stock(jsonb)   from public, anon, authenticated;

-- Same default-PUBLIC trap for the new entry point: `place_order` refuses
-- anonymous callers itself (it raises NOT_AUTHENTICATED when auth.uid() has no
-- member row), but it should not be reachable by anon in the first place.
revoke all on function public.place_order(jsonb, jsonb, text, text, text, text, numeric, text) from public, anon;
grant execute on function public.place_order(jsonb, jsonb, text, text, text, text, numeric, text) to authenticated;

-- SELECT/UPDATE policies are untouched: buyers still read their own orders and
-- admins still change status, which is how fulfilment works.
