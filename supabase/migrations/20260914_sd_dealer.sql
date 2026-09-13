-- Dealer (出展企業) source tracking for products imported from Superdelivery.
-- sd_dealer_id   : numeric id in the dealer page URL (/p/do/dpsl/{id}/)
-- sd_dealer_name : dealer company name taken from the product breadcrumb
-- Admin-only metadata (product edit modal) — never rendered on the storefront.
alter table public.products
  add column if not exists sd_dealer_id   text,
  add column if not exists sd_dealer_name text;
