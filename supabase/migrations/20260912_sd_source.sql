-- Source tracking for products imported from Superdelivery (スーパーデリバリー).
-- sd_product_id is the numeric id in the supplier's product detail URL
-- (/p/do/.../{sd_product_id}/), used to skip duplicates on re-import.
alter table public.products
  add column if not exists sd_product_id text;

create unique index if not exists products_sd_product_id_key
  on public.products (sd_product_id);