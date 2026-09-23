-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Strip the purchase price out of the approved-member price view
--
-- 20261001 started storing each set's supplier cost as `sourcePrice` inside
-- `products.set_options`, so a MARGIN change could be recomputed instead of
-- inferred. The column-level revoke added in 20261002 covers
-- `sd_wholesale_price`, but it cannot reach a key nested inside a JSONB column —
-- and `product_prices_approved` projects `set_options` wholesale.
--
-- Verified against production: every approved member could read
--     set_options[0].sourcePrice = 29719   (wholesalePrice 37149)
-- i.e. our purchase price, and therefore our margin, on every product. For a
-- wholesale buyer that is a negotiating position handed over for free.
--
-- The view now maps over the array and drops the key. Admins are unaffected: they
-- read `products_admin`, and src/lib/db.ts only consults this view for
-- non-administrators (`!member.isAdmin`).
--
-- `with ordinality` keeps S1/S2/S3 in their original order — jsonb_agg over a
-- plain jsonb_array_elements has no defined ordering, and a reordered set list
-- would change which option a buyer sees first.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace view public.product_prices_approved
as
select
  p.id,
  p.original_price,
  p.wholesale_price,
  p.discount,
  case
    when p.set_options is null then null
    else coalesce(
      (
        select jsonb_agg(opt - 'sourcePrice' order by ord)
          from jsonb_array_elements(p.set_options) with ordinality as t(opt, ord)
      ),
      '[]'::jsonb
    )
  end as set_options
from public.products p
where public.is_admin()
   or exists (
     select 1 from public.members m
      where m.auth_id = auth.uid() and m.status = 'approved'
   );

comment on view public.product_prices_approved is
  'Wholesale prices for approved members. set_options has sourcePrice (our purchase price) removed — a column revoke cannot protect a key inside JSONB.';

-- ── Verify ────────────────────────────────────────────────────────────────
do $$
declare
  v_leaks int;
begin
  -- Runs as the migration author (admin), so the view returns rows here; if the
  -- key survived the projection this counts it.
  select count(*) into v_leaks
    from public.product_prices_approved
   where set_options::text like '%sourcePrice%';
  if v_leaks > 0 then
    raise exception 'product_prices_approved still exposes sourcePrice on % rows', v_leaks;
  end if;
end $$;
