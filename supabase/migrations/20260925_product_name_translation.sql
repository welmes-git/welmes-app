-- WELMES — Per-language product names (name_i18n).
-- Apply AFTER 20260924_product_description_translation.sql.
--
-- Why: products.name holds the Japanese supplier name and products.name_en was
-- only ever populated by the grounded naming pipeline, which gates almost every
-- row behind `review_required` (measured: 229/229 pending, 228 still containing
-- Japanese). The storefront renders name_en everywhere, so every customer —
-- including Chinese buyers, for whom 68% of the characters in these names are
-- unreadable katakana/hiragana — sees raw Japanese.
--
-- This is deliberately lighter than the description pipeline: product names are
-- short enough to translate many per request, so there is no queue table, no
-- lease machinery and no confidence gate. Guards still protect numbers/units,
-- and an admin lock still wins.

alter table public.products
  add column if not exists name_i18n jsonb not null default '{}'::jsonb,
  add column if not exists name_i18n_status text not null default 'pending',
  add column if not exists name_i18n_generated_at timestamptz,
  add column if not exists name_i18n_manual_locked boolean not null default false;

alter table public.products drop constraint if exists products_name_i18n_status_check;
alter table public.products add constraint products_name_i18n_status_check
  check (name_i18n_status in ('pending', 'translated', 'review_required', 'failed', 'human_locked'));

create index if not exists products_name_i18n_status_idx
  on public.products (name_i18n_status, id);

-- Expose the translations on the public catalogue. A view's column list is
-- frozen at creation time, so it must be dropped and recreated to add a column.
drop view if exists public.products_public;
create view public.products_public
as
select
  id, name, name_en, name_i18n, brand, category, subcategory, image, images, discount,
  tags, rating, reviews, description, description_i18n, stock, status,
  created_at, updated_at, seo_slug, seo_title, seo_description,
  search_aliases, name_en_status, jan
from public.products;

revoke all on public.products_public from public;
grant select on public.products_public to anon, authenticated;

comment on view public.products_public is
  'Public catalogue projection with no prices, set pricing, supplier metadata or AI audit details. Includes name_i18n and description_i18n translations.';

-- products_admin is a `select *` view, whose column list is likewise frozen at
-- creation time, so recreate it to surface the new name_i18n* columns.
drop view if exists public.products_admin;
create view public.products_admin
as
select * from public.products
where public.is_admin()
with local check option;

revoke all on public.products_admin from public;
grant select, insert, update, delete on public.products_admin to authenticated;

comment on view public.products_admin is
  'Owner-rights admin projection used by authenticated administration and ingestion scripts.';

comment on column public.products.name_i18n is
  'Per-language product names keyed by language code, e.g. {"en":"Biore Guard …","zh":"碧柔 …","ko":"비오레 가드 …"}. Japanese stays in products.name.';
comment on column public.products.name_i18n_manual_locked is
  'When true the translation job never overwrites name_i18n (admin curation wins).';
