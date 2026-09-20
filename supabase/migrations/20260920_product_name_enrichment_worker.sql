-- WELMES — Task 5: official-source registry and resilient product-name queue worker.
-- Apply after 20260919_product_name_enrichment.sql.
alter table public.products
  add column if not exists jan text;

alter table public.products drop constraint if exists products_jan_format_check;
alter table public.products add constraint products_jan_format_check
  check (jan is null or jan ~ '^[0-9]{8,13}$');

create index if not exists products_jan_idx
  on public.products (jan)
  where jan is not null;


create table if not exists public.brand_official_sources (
  id                   uuid primary key default gen_random_uuid(),
  brand_name           text not null,
  canonical_brand_name text not null,
  official_domain      text not null,
  active               boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint brand_official_sources_domain_check check (
    official_domain = lower(official_domain)
    and official_domain ~ '^[a-z0-9.-]+$'
    and official_domain !~ '(^|\.)localhost$'
  ),
  constraint brand_official_sources_unique unique (brand_name, official_domain)
);

create index if not exists brand_official_sources_lookup_idx
  on public.brand_official_sources (lower(brand_name), active);

alter table public.brand_official_sources enable row level security;

drop policy if exists brand_official_sources_admin_select on public.brand_official_sources;
create policy brand_official_sources_admin_select on public.brand_official_sources
  for select using (public.is_admin());
drop policy if exists brand_official_sources_admin_insert on public.brand_official_sources;
create policy brand_official_sources_admin_insert on public.brand_official_sources
  for insert with check (public.is_admin());
drop policy if exists brand_official_sources_admin_update on public.brand_official_sources;
create policy brand_official_sources_admin_update on public.brand_official_sources
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists brand_official_sources_admin_delete on public.brand_official_sources;
create policy brand_official_sources_admin_delete on public.brand_official_sources
  for delete using (public.is_admin());

-- Conservative starter aliases for the current Biore pilot. Admins can extend
-- this registry without code changes. A matching domain alone is not enough:
-- the worker also checks page identifiers/title tokens before marking official.
insert into public.brand_official_sources (brand_name, canonical_brand_name, official_domain, notes)
values
  ('Biore', 'Biore', 'kao.com', 'Kao global corporate/product domain'),
  ('Biore', 'Biore', 'kao-kirei.com', 'Kao Japan consumer product domain'),
  ('ビオレ', 'Biore', 'kao.com', 'Japanese brand alias'),
  ('ビオレ', 'Biore', 'kao-kirei.com', 'Japanese brand alias'),
  ('Biore u', 'Biore u', 'kao.com', 'Kao global corporate/product domain'),
  ('ビオレu', 'Biore u', 'kao.com', 'Japanese brand alias'),
  ('Men''s Biore', 'Men''s Biore', 'kao.com', 'Kao global corporate/product domain'),
  ('メンズビオレ', 'Men''s Biore', 'kao.com', 'Japanese brand alias'),
  ('Biore Zero', 'Biore Zero', 'kao.com', 'Kao global corporate/product domain'),
  ('ビオレZero', 'Biore Zero', 'kao.com', 'Japanese brand alias'),
  ('Biore Guard', 'Biore Guard', 'kao.com', 'Kao global corporate/product domain'),
  ('ビオレガード', 'Biore Guard', 'kao.com', 'Japanese brand alias')
on conflict (brand_name, official_domain) do update
set canonical_brand_name = excluded.canonical_brand_name,
    notes = excluded.notes,
    updated_at = now();

alter table public.product_name_enrichment_runs
  add column if not exists priority smallint not null default 0,
  add column if not exists max_attempts smallint not null default 3,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.product_name_enrichment_runs
  drop constraint if exists product_name_enrichment_runs_max_attempts_check;
alter table public.product_name_enrichment_runs
  add constraint product_name_enrichment_runs_max_attempts_check
  check (max_attempts between 1 and 10);

alter table public.product_name_enrichment_runs
  drop constraint if exists product_name_enrichment_runs_status_check;
alter table public.product_name_enrichment_runs
  add constraint product_name_enrichment_runs_status_check
  check (status in ('queued', 'running', 'succeeded', 'review_required', 'failed', 'skipped'));

create index if not exists product_name_enrichment_runs_queue_idx
  on public.product_name_enrichment_runs (priority desc, available_at, created_at)
  where status in ('queued', 'running');

create unique index if not exists product_name_enrichment_runs_active_job_key
  on public.product_name_enrichment_runs (product_id, input_hash, provider, model)
  where product_id is not null and status in ('queued', 'running');

create or replace function public.enqueue_product_name_enrichment(
  p_product_id bigint,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_input_hash text,
  p_source_payload jsonb,
  p_priority smallint default 0,
  p_max_attempts smallint default 3,
  p_force boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_provider not in ('gemini', 'openai', 'anthropic', 'qwen', 'deepseek') then
    raise exception 'unsupported provider: %', p_provider using errcode = '22023';
  end if;
  if nullif(trim(p_model), '') is null or nullif(trim(p_input_hash), '') is null then
    raise exception 'model and input_hash are required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'product not found: %', p_product_id using errcode = 'P0002';
  end if;

  if p_force then
    update public.product_name_enrichment_runs
       set status = 'skipped',
           error_message = 'superseded by forced re-enqueue',
           lease_owner = null,
           lease_expires_at = null,
           completed_at = now(),
           updated_at = now()
     where product_id = p_product_id
       and provider = p_provider
       and model = p_model
       and status in ('queued', 'running');
  else
    select id into v_id
      from public.product_name_enrichment_runs
     where product_id = p_product_id
       and input_hash = p_input_hash
       and provider = p_provider
       and model = p_model
       and status in ('queued', 'running', 'succeeded', 'review_required')
     order by created_at desc
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  update public.products
     set name_en_status = 'pending'
   where id = p_product_id
     and name_en_status <> 'human_approved';

  begin
    insert into public.product_name_enrichment_runs (
      product_id, sd_product_id, provider, model, prompt_version, input_hash,
      source_payload, status, priority, max_attempts, available_at
    )
    select p.id, p.sd_product_id, p_provider, p_model, p_prompt_version, p_input_hash,
           coalesce(p_source_payload, '{}'::jsonb), 'queued', p_priority,
           greatest(1, least(10, p_max_attempts)), now()
      from public.products p
     where p.id = p_product_id
    returning id into v_id;
  exception when unique_violation then
    select id into v_id
      from public.product_name_enrichment_runs
     where product_id = p_product_id
       and input_hash = p_input_hash
       and provider = p_provider
       and model = p_model
       and status in ('queued', 'running')
     order by created_at desc
     limit 1;
  end;
  return v_id;
end;
$$;

create or replace function public.claim_product_name_enrichments(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 300,
  p_product_ids bigint[] default null
) returns setof public.product_name_enrichment_runs
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if nullif(trim(p_worker_id), '') is null then
    raise exception 'worker_id is required' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select r.id
      from public.product_name_enrichment_runs r
     where r.product_id is not null
       and (p_product_ids is null or r.product_id = any(p_product_ids))
       and r.attempt < r.max_attempts
       and (
         (r.status = 'queued' and r.available_at <= now())
         or (r.status = 'running' and r.lease_expires_at < now())
       )
     order by r.priority desc, r.available_at, r.created_at
     for update skip locked
     limit greatest(1, least(50, p_limit))
  )
  update public.product_name_enrichment_runs r
     set status = 'running',
         attempt = r.attempt + 1,
         lease_owner = p_worker_id,
         lease_expires_at = now() + make_interval(secs => greatest(30, least(1800, p_lease_seconds))),
         started_at = now(),
         completed_at = null,
         error_message = null,
         updated_at = now()
    from candidates c
   where r.id = c.id
  returning r.*;
end;
$$;

create or replace function public.complete_product_name_enrichment(
  p_run_id uuid,
  p_worker_id text,
  p_candidate_name text,
  p_seo_slug text,
  p_seo_title text,
  p_seo_description text,
  p_search_aliases text[],
  p_name_status text,
  p_confidence numeric,
  p_name_source text,
  p_result_payload jsonb,
  p_validation_payload jsonb,
  p_input_tokens integer default null,
  p_output_tokens integer default null,
  p_estimated_cost_usd numeric default null,
  p_latency_ms integer default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.product_name_enrichment_runs%rowtype;
  v_applied boolean := false;
  v_run_status text;
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_name_status not in ('auto_approved', 'review_required') then
    raise exception 'invalid name status: %', p_name_status using errcode = '22023';
  end if;
  if p_name_source not in ('official', 'grounded', 'generated') then
    raise exception 'invalid name source: %', p_name_source using errcode = '22023';
  end if;
  if p_confidence < 0 or p_confidence > 1 then
    raise exception 'confidence must be between 0 and 1' using errcode = '22023';
  end if;

  select * into v_run
    from public.product_name_enrichment_runs
   where id = p_run_id
   for update;
  if not found then raise exception 'run not found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' or v_run.lease_owner is distinct from p_worker_id
     or v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'run lease is not owned by worker or has expired' using errcode = '55000';
  end if;
  if nullif(trim(p_candidate_name), '') is null or length(p_candidate_name) > 120 then
    raise exception 'candidate name must be 1..120 characters' using errcode = '22023';
  end if;
  if length(coalesce(p_seo_title, '')) > 160 or length(coalesce(p_seo_description, '')) > 300 then
    raise exception 'SEO metadata exceeds allowed length' using errcode = '22023';
  end if;

  update public.products
     set name_en = case when p_name_status = 'auto_approved' then p_candidate_name else name_en end,
         seo_slug = case when p_name_status = 'auto_approved' then coalesce(seo_slug, nullif(p_seo_slug, '')) else seo_slug end,
         seo_title = case when p_name_status = 'auto_approved' then nullif(p_seo_title, '') else seo_title end,
         seo_description = case when p_name_status = 'auto_approved' then nullif(p_seo_description, '') else seo_description end,
         search_aliases = case when p_name_status = 'auto_approved' then coalesce(p_search_aliases, '{}') else search_aliases end,
         name_en_status = p_name_status,
         name_en_confidence = p_confidence,
         name_en_source = p_name_source,
         name_en_generated_at = now(),
         name_en_approved_at = case when p_name_status = 'auto_approved' then now() else null end
   where id = v_run.product_id
     and name_en_status <> 'human_approved';
  v_applied := found;
  v_run_status := case
    when not v_applied then 'skipped'
    when p_name_status = 'auto_approved' then 'succeeded'
    else 'review_required'
  end;

  update public.product_name_enrichment_runs
     set status = v_run_status,
         result_payload = coalesce(p_result_payload, '{}'::jsonb),
         validation_payload = coalesce(p_validation_payload, '{}'::jsonb),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         estimated_cost_usd = p_estimated_cost_usd,
         latency_ms = p_latency_ms,
         error_message = case when v_applied then null else 'product already human-approved' end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where id = p_run_id;
  return v_run_status;
end;
$$;

create or replace function public.fail_product_name_enrichment(
  p_run_id uuid,
  p_worker_id text,
  p_error_message text,
  p_retry_delay_seconds integer default 60,
  p_terminal boolean default false
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.product_name_enrichment_runs%rowtype;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  select * into v_run
    from public.product_name_enrichment_runs
   where id = p_run_id
   for update;
  if not found then raise exception 'run not found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' or v_run.lease_owner is distinct from p_worker_id
     or v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'run lease is not owned by worker or has expired' using errcode = '55000';
  end if;

  v_status := case when p_terminal or v_run.attempt >= v_run.max_attempts then 'failed' else 'queued' end;
  update public.product_name_enrichment_runs
     set status = v_status,
         error_message = left(coalesce(p_error_message, 'unknown error'), 2000),
         available_at = case when v_status = 'queued'
           then now() + make_interval(secs => greatest(1, least(86400, p_retry_delay_seconds)))
           else available_at end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = case when v_status = 'failed' then now() else null end,
         updated_at = now()
   where id = p_run_id;

  if v_status = 'failed' then
    update public.products
       set name_en_status = 'failed'
     where id = v_run.product_id
       and name_en_status = 'pending';
  end if;
  return v_status;
end;
$$;

revoke all on function public.enqueue_product_name_enrichment(bigint, text, text, text, text, jsonb, smallint, smallint, boolean) from public;
revoke all on function public.claim_product_name_enrichments(text, integer, integer, bigint[]) from public;
revoke all on function public.complete_product_name_enrichment(uuid, text, text, text, text, text, text[], text, numeric, text, jsonb, jsonb, integer, integer, numeric, integer) from public;
revoke all on function public.fail_product_name_enrichment(uuid, text, text, integer, boolean) from public;
grant execute on function public.enqueue_product_name_enrichment(bigint, text, text, text, text, jsonb, smallint, smallint, boolean) to authenticated;
grant execute on function public.claim_product_name_enrichments(text, integer, integer, bigint[]) to authenticated;
grant execute on function public.complete_product_name_enrichment(uuid, text, text, text, text, text, text[], text, numeric, text, jsonb, jsonb, integer, integer, numeric, integer) to authenticated;
grant execute on function public.fail_product_name_enrichment(uuid, text, text, integer, boolean) to authenticated;

comment on table public.brand_official_sources is
  'Admin-managed brand aliases and official domains used to verify AI grounding evidence.';
comment on function public.claim_product_name_enrichments is
  'Atomically leases queued or expired product-name jobs with FOR UPDATE SKIP LOCKED.';
