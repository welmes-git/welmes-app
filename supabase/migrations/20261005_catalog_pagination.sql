-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Server-side catalogue pagination
--
-- The storefront and the admin used to download the WHOLE products table on
-- every visit (7.7 MB for an anonymous visitor, 13.6 MB for an admin, measured
-- at 5,968 products) and then search, filter, sort and paginate in the
-- browser. These RPCs do that work in the database and return one page.
--
-- Visibility is deliberately UNCHANGED: like products_public, the storefront
-- functions do not filter on `status` (inactive products stay listed as
-- "coming soon"). Only the data volume changes, not what a visitor may see.
--
-- Price gating mirrors product_prices_approved: prices and set options are
-- returned only to admins and approved members, and `sourcePrice` (our
-- purchase price) is stripped from set_options. For everyone else the price
-- filter and price sorts are ignored, so they cannot be used as an oracle.
--
-- Search mirrors src/lib/productSearch.ts (matchesSearch): the same fields are
-- normalised the same way (NFKD, accents stripped, lower-case, anything that is
-- not a letter or digit becomes a space) and every query token must appear as
-- a substring. The normalised text is stored in a generated column so a search
-- does not re-normalise every row.
--
-- Apply once in the Supabase SQL Editor. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Search normalisation ───────────────────────────────────────────────
-- Letter/digit ranges are listed explicitly instead of [[:alnum:]]: under a C
-- collation Postgres classifies every non-ASCII character as non-alphanumeric,
-- which would blank out all Japanese text.
create or replace function public.catalog_normalize(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select btrim(regexp_replace(
    regexp_replace(
      lower(regexp_replace(normalize(coalesce(p_value, ''), NFKD), '[\u0300-\u036f]', '', 'g')),
      '[^0-9a-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u1100-\u11ff\u3005-\u3007\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u3131-\u318e\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]+',
      ' ', 'g'),
    '\s+', ' ', 'g'))
$$;

-- Same fields and order as searchableText(): nameEn (falls back to name),
-- name, brand, category, subcategory, tags, searchAliases, first 200 chars of
-- the description. Declared immutable so it can back a generated column
-- (array_to_string is only STABLE because of generic element output, but for
-- text[] the result is deterministic).
create or replace function public.product_search_text(
  p_name_en text, p_name text, p_brand text, p_category text, p_subcategory text,
  p_tags text[], p_aliases text[], p_description text
)
returns text
language sql
immutable
parallel safe
as $$
  select public.catalog_normalize(concat_ws(' ',
    coalesce(nullif(p_name_en, ''), p_name, ''),
    coalesce(p_name, ''),
    coalesce(p_brand, ''),
    coalesce(p_category, ''),
    coalesce(p_subcategory, ''),
    coalesce(array_to_string(p_tags, ' '), ''),
    coalesce(array_to_string(p_aliases, ' '), ''),
    left(coalesce(p_description, ''), 200)
  ))
$$;

alter table public.products
  add column if not exists search_text text
  generated always as (public.product_search_text(
    name_en, name, brand, category, subcategory, tags, search_aliases, description
  )) stored;

-- ── 2. Indexes for the list orderings and filters ─────────────────────────
create index if not exists products_created_at_id_idx on public.products (created_at desc, id desc);
create index if not exists products_category_idx     on public.products (category);
create index if not exists products_brand_idx        on public.products (brand);

-- ── 3. Projection helpers (internal) ──────────────────────────────────────
create or replace function public.catalog_strip_source_price(p_set_options jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when p_set_options is null then null
    when jsonb_typeof(p_set_options) <> 'array' then p_set_options
    else coalesce(
      (select jsonb_agg(opt - 'sourcePrice' order by ord)
         from jsonb_array_elements(p_set_options) with ordinality as t(opt, ord)),
      '[]'::jsonb)
  end
$$;

create or replace function public.catalog_can_see_prices()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (select 1 from public.members m where m.auth_id = auth.uid() and m.status = 'approved')
$$;

-- Card fields: what a product tile needs. Prices only when p_prices.
create or replace function public.catalog_card_json(p public.products, p_prices boolean)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
      'id', p.id, 'name', p.name, 'name_en', p.name_en, 'name_i18n', p.name_i18n,
      'brand', p.brand, 'category', p.category, 'subcategory', p.subcategory,
      'image', p.image, 'discount', p.discount, 'tags', p.tags,
      'rating', p.rating, 'reviews', p.reviews, 'stock', p.stock, 'status', p.status,
      'created_at', p.created_at, 'updated_at', p.updated_at,
      'seo_slug', p.seo_slug, 'name_en_status', p.name_en_status)
    || case when p_prices then jsonb_build_object(
      'original_price', p.original_price,
      'wholesale_price', p.wholesale_price,
      'set_options', public.catalog_strip_source_price(p.set_options))
    else '{}'::jsonb end
$$;

-- Detail fields: card + everything products_public exposes.
create or replace function public.catalog_detail_json(p public.products, p_prices boolean)
returns jsonb
language sql
stable
as $$
  select public.catalog_card_json(p, p_prices) || jsonb_build_object(
    'images', p.images, 'description', p.description, 'description_i18n', p.description_i18n,
    'seo_title', p.seo_title, 'seo_description', p.seo_description,
    'search_aliases', p.search_aliases, 'jan', p.jan)
$$;

create or replace function public.catalog_search_tokens(p_search text)
returns text[]
language sql
immutable
as $$
  select case
    when public.catalog_normalize(left(p_search, 200)) = '' then null
    else (string_to_array(public.catalog_normalize(left(p_search, 200)), ' '))[1:10]
  end
$$;

-- ── 4. Storefront: one page of products ───────────────────────────────────
-- p_sort: popular | price-low | price-high | newest | discount | recent
-- Ties always fall back to created_at desc, id desc — the order the old
-- client-side list started from — so pages never overlap or skip rows.
create or replace function public.catalog_list(
  p_search    text    default null,
  p_category  text    default null,
  p_brands    text[]  default null,
  p_price_min integer default null,
  p_price_max integer default null,
  p_sort      text    default 'popular',
  p_limit     integer default 60,
  p_offset    integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_prices boolean := public.catalog_can_see_prices();
  v_tokens text[]  := public.catalog_search_tokens(p_search);
  v_limit  integer := least(greatest(coalesce(p_limit, 60), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_sort   text    := coalesce(p_sort, 'popular');
  v_total  bigint;
  v_items  jsonb;
begin
  if not v_prices then
    p_price_min := null;
    p_price_max := null;
    if v_sort in ('price-low', 'price-high') then v_sort := 'recent'; end if;
  end if;

  with f as (
    select p
      from public.products p
     where (v_tokens is null
            or not exists (select 1 from unnest(v_tokens) t where strpos(p.search_text, t) = 0))
       and (p_category is null or p.category = p_category)
       and (p_brands is null or cardinality(p_brands) = 0 or p.brand = any (p_brands))
       and (p_price_min is null or p.wholesale_price >= p_price_min)
       and (p_price_max is null or p.wholesale_price <= p_price_max)
  ), page as (
    select public.catalog_card_json(f.p, v_prices) as j,
           row_number() over w as rn
      from f
    window w as (order by
      case when v_sort = 'price-low'  then (f.p).wholesale_price end asc  nulls last,
      case when v_sort = 'price-high' then (f.p).wholesale_price end desc nulls last,
      case when v_sort = 'discount'   then (f.p).discount end desc nulls last,
      case when v_sort = 'popular'    then coalesce((f.p).reviews, 0) end desc nulls last,
      case when v_sort = 'newest'     then (f.p).id end desc nulls last,
      (f.p).created_at desc, (f.p).id desc)
     order by rn
     limit v_limit offset v_offset
  )
  select (select count(*) from f),
         coalesce((select jsonb_agg(j order by rn) from page), '[]'::jsonb)
    into v_total, v_items;

  return jsonb_build_object('total', v_total, 'items', v_items);
end
$$;

-- ── 5. Storefront: facets (brand counts, price bounds) ────────────────────
create or replace function public.catalog_facets()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.products),
    'brands', coalesce((
      select jsonb_agg(jsonb_build_array(brand, n) order by n desc, brand collate "C")
        from (select brand, count(*) as n from public.products
               where coalesce(brand, '') <> '' group by brand) b), '[]'::jsonb),
    'price_min', case when public.catalog_can_see_prices()
                      then coalesce((select min(wholesale_price) from public.products), 0) else 0 end,
    'price_max', case when public.catalog_can_see_prices()
                      then coalesce((select max(wholesale_price) from public.products), 0) else 0 end)
$$;

-- ── 6. Storefront: specific products (detail page, wishlist, cart) ────────
create or replace function public.catalog_by_ids(p_ids bigint[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(public.catalog_detail_json(p, public.catalog_can_see_prices()) order by i.ord), '[]'::jsonb)
    from unnest((p_ids)[1:200]) with ordinality as i(id, ord)
    join public.products p on p.id = i.id
$$;

-- ── 7. Admin: one page of full rows ───────────────────────────────────────
-- p_name_status: null = any; 'pending' also matches a missing status.
-- p_ids: null = no filter; an empty array matches nothing (the "changed" filter
--        with no changes).
-- p_own_stock_only: hide products mapped to an external (non-internal) supplier.
-- p_ids_only: return every matching id instead of a page (bulk "select all").
create or replace function public.admin_product_page(
  p_search         text    default null,
  p_name_status    text    default null,
  p_ids            bigint[] default null,
  p_brand          text    default null,
  p_own_stock_only boolean default false,
  p_limit          integer default 50,
  p_offset         integer default 0,
  p_ids_only       boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tokens text[]  := public.catalog_search_tokens(p_search);
  v_id     bigint  := case when btrim(coalesce(p_search, '')) ~ '^\d{1,18}$' then btrim(p_search)::bigint end;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with hits as (
    select p.id, p.created_at
      from public.products p
     where (v_tokens is null
            or (v_id is not null and p.id = v_id)
            or not exists (select 1 from unnest(v_tokens) t where strpos(p.search_text, t) = 0))
       and (p_name_status is null or coalesce(p.name_en_status, 'pending') = p_name_status)
       and (p_ids is null or p.id = any (p_ids))
       and (p_brand is null or p.brand = p_brand)
       and (not coalesce(p_own_stock_only, false) or not exists (
            select 1 from public.product_supply s
              left join public.suppliers su on su.id = s.supplier_id
             where s.product_id = p.id and coalesce(su.is_internal, false) = false))
  ), page as (
    select h.id, row_number() over (order by h.created_at desc, h.id desc) as rn
      from hits h
     order by rn
     limit case when p_ids_only then null else v_limit end
    offset case when p_ids_only then 0 else v_offset end
  )
  select (select count(*) from hits),
         case when p_ids_only
              then (select coalesce(jsonb_agg(pg.id order by pg.rn), '[]'::jsonb) from page pg)
              else (select coalesce(jsonb_agg(to_jsonb(p) - 'search_text' order by pg.rn), '[]'::jsonb)
                      from page pg join public.products p on p.id = pg.id)
         end
    into v_total, v_result;

  if p_ids_only then
    return jsonb_build_object('total', v_total, 'ids', v_result);
  end if;
  return jsonb_build_object('total', v_total, 'items', v_result);
end
$$;

-- ── 8. Privileges ─────────────────────────────────────────────────────────
-- Supabase grants EXECUTE on new public functions to anon/authenticated by
-- default, so internal helpers are revoked explicitly.
revoke all on function public.catalog_card_json(public.products, boolean)   from public, anon, authenticated;
revoke all on function public.catalog_detail_json(public.products, boolean) from public, anon, authenticated;
revoke all on function public.catalog_can_see_prices()                      from public, anon, authenticated;
revoke all on function public.catalog_strip_source_price(jsonb)             from public, anon, authenticated;

revoke all on function public.catalog_list(text, text, text[], integer, integer, text, integer, integer) from public;
revoke all on function public.catalog_facets()           from public;
revoke all on function public.catalog_by_ids(bigint[])   from public;
grant execute on function public.catalog_list(text, text, text[], integer, integer, text, integer, integer) to anon, authenticated;
grant execute on function public.catalog_facets()         to anon, authenticated;
grant execute on function public.catalog_by_ids(bigint[]) to anon, authenticated;

revoke all on function public.admin_product_page(text, text, bigint[], text, boolean, integer, integer, boolean) from public, anon;
grant execute on function public.admin_product_page(text, text, bigint[], text, boolean, integer, integer, boolean) to authenticated;

-- ── 9. Verify, loudly ─────────────────────────────────────────────────────
do $$
declare
  v_missing int;
begin
  select count(*) into v_missing from public.products
   where search_text is null or (search_text = '' and coalesce(name, '') <> '');
  if v_missing > 0 then
    raise exception 'search_text not populated on % products', v_missing;
  end if;
  if public.catalog_normalize('ＡＱＵＡ Bioré-SPF50+ ビオレ') <> 'aqua biore spf50 ヒ オレ' then
    raise exception 'catalog_normalize does not match the client normaliser: %',
      public.catalog_normalize('ＡＱＵＡ Bioré-SPF50+ ビオレ');
  end if;
  if has_function_privilege('anon', 'public.admin_product_page(text, text, bigint[], text, boolean, integer, integer, boolean)', 'execute') then
    raise exception 'anon can execute admin_product_page';
  end if;
  if has_function_privilege('anon', 'public.catalog_card_json(public.products, boolean)', 'execute') then
    raise exception 'anon can execute catalog_card_json';
  end if;
  if not has_function_privilege('anon', 'public.catalog_list(text, text, text[], integer, integer, text, integer, integer)', 'execute') then
    raise exception 'anon cannot execute catalog_list';
  end if;
end $$;

notify pgrst, 'reload schema';
