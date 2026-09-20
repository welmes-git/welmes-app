-- WELMES — public catalogue boundary, SEO publication gate and pilot metrics.
-- Apply after the product naming/review migrations.

alter table public.products
  add column if not exists subcategory text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_product_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists trg_touch_product_updated_at on public.products;
create trigger trg_touch_product_updated_at
  before update on public.products
  for each row execute function public.touch_product_updated_at();

-- Public-safe catalogue. Deliberately excludes wholesale/original prices,
-- set_options (which embeds prices), supplier/dealer fields and AI audit data.
create or replace view public.products_public
as
select
  id, name, name_en, brand, category, subcategory, image, images, discount,
  tags, rating, reviews, description, stock, status, created_at, updated_at,
  seo_slug, seo_title, seo_description, search_aliases, name_en_status, jan
from public.products;

-- Approved buyers can retrieve price data only after membership approval.
create or replace view public.product_prices_approved
as
select id, original_price, wholesale_price, discount, set_options
from public.products
where public.is_admin()
   or exists (
     select 1 from public.members m
      where m.auth_id = auth.uid() and m.status = 'approved'
   );

-- All scripts and admin UI use this view. CHECK OPTION prevents a non-admin
-- from inserting through the owner-rights view.
create or replace view public.products_admin
as
select * from public.products
where public.is_admin()
with local check option;

revoke all on public.products_public from public;
revoke all on public.product_prices_approved from public;
revoke all on public.products_admin from public;
grant select on public.products_public to anon, authenticated;
grant select on public.product_prices_approved to authenticated;
grant select, insert, update, delete on public.products_admin to authenticated;

comment on view public.products_public is
  'Public catalogue projection with no prices, set pricing, supplier metadata or AI audit details.';
comment on view public.product_prices_approved is
  'Price projection visible only to approved members and administrators.';
comment on view public.products_admin is
  'Owner-rights admin projection used by authenticated administration and ingestion scripts.';

create table if not exists public.product_publication_settings (
  singleton boolean primary key default true check (singleton),
  pilot_started_at timestamptz not null default now(),
  auto_publish_enabled boolean not null default false,
  minimum_sample_size integer not null default 100 check (minimum_sample_size >= 30),
  minimum_precision numeric(5,4) not null default 0.9900,
  maximum_edit_rate numeric(5,4) not null default 0.0100,
  maximum_review_rate numeric(5,4) not null default 0.2000,
  updated_at timestamptz not null default now()
);
insert into public.product_publication_settings(singleton)
values (true) on conflict (singleton) do nothing;
alter table public.product_publication_settings enable row level security;
drop policy if exists product_publication_settings_admin_all on public.product_publication_settings;
create policy product_publication_settings_admin_all
  on public.product_publication_settings for all
  using (public.is_admin()) with check (public.is_admin());

create or replace view public.product_name_pilot_metrics
as
with runs as (
  select * from public.product_name_enrichment_runs
  where created_at >= now() - interval '28 days'
), samples as (
  select s.*
    from public.product_name_quality_samples s
    join runs r on r.id = s.run_id
   where s.reviewed_at >= now() - interval '28 days'
     and r.status = 'succeeded'
)
select
  (select count(*) from samples) as sample_size,
  coalesce((select avg(case when correct_without_edit then 1.0 else 0.0 end) from samples), 0) as auto_approval_precision,
  coalesce((select avg(case when correct_without_edit then 0.0 else 1.0 end) from samples), 0) as administrator_edit_rate,
  coalesce((select avg(case when status = 'review_required' then 1.0 else 0.0 end) from runs), 0) as review_required_rate,
  coalesce((select sum(estimated_cost_usd) from runs), 0) as estimated_cost_usd,
  coalesce((select percentile_cont(0.95) within group (order by latency_ms) from runs where latency_ms is not null), 0) as p95_latency_ms
where public.is_admin();
revoke all on public.product_name_pilot_metrics from public;
grant select on public.product_name_pilot_metrics to authenticated;

create or replace function public.auto_publish_eligible_products(p_limit integer default 50)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_settings public.product_publication_settings%rowtype;
  v_metrics record;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  select * into v_settings from public.product_publication_settings where singleton;
  select * into v_metrics from public.product_name_pilot_metrics;
  if not v_settings.auto_publish_enabled
     or now() < v_settings.pilot_started_at + interval '28 days'
     or v_metrics.sample_size < v_settings.minimum_sample_size
     or v_metrics.auto_approval_precision < v_settings.minimum_precision
     or v_metrics.administrator_edit_rate > v_settings.maximum_edit_rate
     or v_metrics.review_required_rate > v_settings.maximum_review_rate then
    return 0;
  end if;
  with eligible as (
    select id from public.products
     where status = 'inactive' and name_en_status = 'auto_approved'
     order by name_en_approved_at, id
     limit greatest(1, least(500, p_limit))
     for update skip locked
  )
  update public.products p set status = 'active'
   from eligible e where p.id = e.id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.auto_publish_eligible_products(integer) from public;
grant execute on function public.auto_publish_eligible_products(integer) to authenticated;
