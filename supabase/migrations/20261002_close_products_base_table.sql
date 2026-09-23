-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Close the base products table, and let the admin view see the cost
--
-- 20261001 added `sd_wholesale_price` (what we pay Superdelivery). Two things were
-- wrong immediately afterwards, both verified against production:
--
--   1) `public.products` answered an anon request:
--          GET /rest/v1/products?select=id,sd_wholesale_price  →  200
--      20260923 revoked that, but the grant is back. The anon key ships inside the
--      JS bundle, so every buyer could read our purchase prices the moment the
--      collector filled them in. Nothing in src/ reads the base table — the
--      storefront uses `products_public` and admins use `products_admin` — so
--      restoring the revoke breaks nothing.
--
--   2) `products_admin` is a `select *` view, and such a view freezes its column
--      list when created. It therefore did not expose the new columns, and the
--      ingestion scripts writing through it failed with 42703. 20260924 hit the
--      same thing when it added description_i18n; recreating the view re-expands
--      the star.
--
-- Per-set costs stay inside `set_options`. `products_public` does not project that
-- column, so with the base table closed they are not reachable by buyers.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The base table is not an API surface ───────────────────────────────
revoke all on public.products from anon, authenticated;

-- Admins reach products through the view, which runs with owner rights and gates
-- on is_admin(); the direct-access policy stays for that path.

-- ── 2. Re-expand the admin projection over the current column list ────────
drop view if exists public.products_admin;
create view public.products_admin
as
select * from public.products
where public.is_admin()
with local check option;

revoke all on public.products_admin from public, anon;
grant select, insert, update, delete on public.products_admin to authenticated;

comment on view public.products_admin is
  'Owner-rights admin projection used by authenticated administration and ingestion scripts. Recreate (drop + create) after adding columns to products: a select * view does not pick them up.';

-- ── 3. Belt and braces on the cost columns ────────────────────────────────
-- Even if the base table is ever granted again by accident, these stay out of
-- reach. A purchase price leaking to buyers is a negotiating position lost.
revoke select (sd_wholesale_price, sd_price_checked_at) on public.products from anon, authenticated;

-- ── 4. Verify, loudly ─────────────────────────────────────────────────────
do $$
begin
  if has_table_privilege('anon', 'public.products', 'SELECT') then
    raise exception 'anon can still read public.products — the revoke did not take';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products_admin'
       and column_name = 'sd_wholesale_price'
  ) then
    raise exception 'products_admin is missing sd_wholesale_price — the view was not recreated';
  end if;
end $$;
