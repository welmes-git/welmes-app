-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Store the supplier's wholesale price we buy at
--
-- `products.wholesale_price` is a SELLING price: the importer writes
-- `round(卸単価 × MARGIN)` and throws the input away. Nothing anywhere keeps the
-- 卸単価 itself — `product_supply.cost_price` was built for it and is empty.
--
-- That makes three ordinary things impossible:
--
--   * Changing MARGIN. The reprice script has to infer the base by dividing by the
--     old multiplier, which only works if no price was ever edited by hand, and
--     which cannot recover the rounding lost at import: of 229 products, just 13
--     divide back to a whole yen.
--   * Knowing the margin on anything. Gross profit per order is unanswerable
--     without the cost side.
--   * Reconciling the consumption-tax refund, which is claimed against input tax
--     paid on these purchases.
--
-- Prices here are 税抜, matching how Superdelivery quotes 卸単価 (tax is added at
-- its checkout). Set options carry their own `sourcePrice` because each set is
-- priced separately.
--
-- Admin-only: a purchase price must never reach buyers. `products` is publicly
-- readable, so exposure is controlled by the column-restricted views rather than
-- by table RLS.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  -- 卸単価 (税抜) for the primary set option, as last seen on Superdelivery.
  add column if not exists sd_wholesale_price integer,
  add column if not exists sd_price_checked_at timestamptz;

comment on column public.products.sd_wholesale_price is
  'Supplier wholesale price (卸単価, tax-excluded) for the primary set. Cost side; never shown to buyers. wholesale_price = round(this × MARGIN).';
comment on column public.products.sd_price_checked_at is
  'When sd_wholesale_price was last confirmed against Superdelivery.';

create index if not exists products_sd_price_missing_idx
  on public.products (id)
  where sd_wholesale_price is null;

-- ── Keep the cost out of the public projection ────────────────────────────
-- 20260922/20260923 moved buyer-facing reads onto `products_public`. Rebuilding it
-- by column list here would silently drift from those migrations, so instead assert
-- that the new columns are not in it and fail loudly if the view ever selects *.
do $$
declare
  v_leaks text;
begin
  if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'products_public') then
    select string_agg(column_name, ', ') into v_leaks
      from information_schema.columns
     where table_schema = 'public' and table_name = 'products_public'
       and column_name in ('sd_wholesale_price', 'sd_price_checked_at');
    if v_leaks is not null then
      raise exception 'products_public exposes cost columns (%) — remove them before deploying', v_leaks;
    end if;
  end if;
end $$;
