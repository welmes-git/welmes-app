-- WELMES product naming + review + security + SEO full installation
-- Generated from the five verified migrations below.
-- Paste this entire file into Supabase SQL Editor and run once.

begin;


-- ============================================================================
-- SOURCE: supabase/migrations/20260919_product_name_enrichment.sql
-- ============================================================================

-- WELMES — AI English product naming, SEO metadata, and review history.
-- Apply after the existing products/members schema migrations.

alter table public.products
  add column if not exists name_en text,
  add column if not exists seo_slug text,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists search_aliases text[] not null default '{}',
  add column if not exists name_en_status text not null default 'pending',
  add column if not exists name_en_confidence numeric(4,3),
  add column if not exists name_en_source text,
  add column if not exists name_en_generated_at timestamptz,
  add column if not exists name_en_approved_at timestamptz,
  add column if not exists name_en_approved_by uuid references public.members (id) on delete set null;

alter table public.products drop constraint if exists products_name_en_status_check;
alter table public.products add constraint products_name_en_status_check
  check (name_en_status in ('pending', 'auto_approved', 'review_required', 'human_approved', 'failed'));

alter table public.products drop constraint if exists products_name_en_confidence_check;
alter table public.products add constraint products_name_en_confidence_check
  check (name_en_confidence is null or (name_en_confidence >= 0 and name_en_confidence <= 1));

alter table public.products drop constraint if exists products_name_en_source_check;
alter table public.products add constraint products_name_en_source_check
  check (name_en_source is null or name_en_source in ('official', 'grounded', 'generated', 'manual'));

create unique index if not exists products_seo_slug_key
  on public.products (seo_slug)
  where seo_slug is not null;
create index if not exists products_name_en_status_idx
  on public.products (name_en_status, created_at desc);

create table if not exists public.product_name_enrichment_runs (
  id                 uuid primary key default gen_random_uuid(),
  product_id         bigint references public.products (id) on delete cascade,
  sd_product_id      text,
  provider           text not null check (provider in ('gemini', 'openai', 'anthropic', 'qwen', 'deepseek')),
  model              text not null,
  prompt_version     text not null,
  input_hash         text not null,
  source_payload     jsonb not null default '{}'::jsonb,
  result_payload     jsonb,
  validation_payload jsonb,
  status             text not null default 'queued'
                     check (status in ('queued', 'running', 'succeeded', 'review_required', 'failed')),
  attempt            integer not null default 0 check (attempt >= 0),
  error_message      text,
  input_tokens       integer check (input_tokens is null or input_tokens >= 0),
  output_tokens      integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost_usd numeric(12,6) check (estimated_cost_usd is null or estimated_cost_usd >= 0),
  latency_ms         integer check (latency_ms is null or latency_ms >= 0),
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists product_name_enrichment_runs_product_idx
  on public.product_name_enrichment_runs (product_id, created_at desc);
create index if not exists product_name_enrichment_runs_status_idx
  on public.product_name_enrichment_runs (status, created_at);
create index if not exists product_name_enrichment_runs_input_idx
  on public.product_name_enrichment_runs (input_hash, provider, model, created_at desc);

alter table public.product_name_enrichment_runs enable row level security;

drop policy if exists product_name_enrichment_runs_admin_select on public.product_name_enrichment_runs;
create policy product_name_enrichment_runs_admin_select on public.product_name_enrichment_runs
  for select using (public.is_admin());

drop policy if exists product_name_enrichment_runs_admin_insert on public.product_name_enrichment_runs;
create policy product_name_enrichment_runs_admin_insert on public.product_name_enrichment_runs
  for insert with check (public.is_admin());

drop policy if exists product_name_enrichment_runs_admin_update on public.product_name_enrichment_runs;
create policy product_name_enrichment_runs_admin_update on public.product_name_enrichment_runs
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists product_name_enrichment_runs_admin_delete on public.product_name_enrichment_runs;
create policy product_name_enrichment_runs_admin_delete on public.product_name_enrichment_runs
  for delete using (public.is_admin());

comment on column public.products.name_en_status is
  'English-name workflow status, independent from storefront active/inactive status.';
comment on table public.product_name_enrichment_runs is
  'Admin-only audit trail containing AI inputs, evidence, validation, usage, and errors; worker claiming is added in Task 5.';


-- ============================================================================
-- SOURCE: supabase/migrations/20260920_product_name_enrichment_worker.sql
-- ============================================================================

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


-- ============================================================================
-- SOURCE: supabase/migrations/20260920_product_name_review.sql
-- ============================================================================

-- WELMES — Task 7: admin English-name review RPCs.
-- Apply after 20260920_product_name_enrichment_worker.sql.
--
-- Two admin-guarded, transactional entry points that back the NameReviewPanel:
--
--   1. approve_product_name_review — human approval with latest-run based
--      optimistic concurrency. The reviewer approves against a specific latest
--      run id + generated timestamp; if the worker produced a newer run or the
--      name was regenerated between load and approve, the write is rejected
--      (errcode 40001) so a stale candidate is never stamped over fresh data.
--      Empty and Japanese-containing names are rejected server-side too, so the
--      UI check cannot be bypassed.
--
--   2. request_product_name_regeneration — atomic re-enqueue request. In one
--      transaction it supersedes any queued/running run for the product and
--      resets name_en_status back to 'pending' so the next enrichment worker
--      pass rebuilds a correct immutable job snapshot (the worker remains the
--      single source of truth for input_hash, per its INPUT_HASH_MISMATCH
--      guard). Guarded by the same optimistic-concurrency check so a stale panel
--      cannot regenerate a name the worker just refreshed.

-- Reject any string that still carries Japanese (kana / kanji) characters.
-- Postgres POSIX regex does not interpret \uXXXX escapes, so the character
-- ranges are supplied via a U& Unicode escape string literal (parsed into the
-- literal characters before the regex engine sees them):
--   \3040-\309F Hiragana, \30A0-\30FF Katakana, \31F0-\31FF Katakana ext.,
--   \FF66-\FF9F half-width Katakana, \3400-\4DBF & \4E00-\9FFF CJK ideographs.
create or replace function public.contains_japanese(p_text text)
returns boolean
language sql
immutable
as $$
  select p_text ~ U&'[\3040-\309F\30A0-\30FF\31F0-\31FF\FF66-\FF9F\3400-\4DBF\4E00-\9FFF]';
$$;

create table if not exists public.product_name_quality_samples (
  id uuid primary key default gen_random_uuid(),
  product_id bigint not null references public.products(id) on delete cascade,
  run_id uuid references public.product_name_enrichment_runs(id) on delete set null,
  reviewer_id uuid references public.members(id) on delete set null,
  correct_without_edit boolean not null,
  error_codes text[] not null default '{}',
  reviewed_at timestamptz not null default now(),
  unique(product_id, run_id)
);
alter table public.product_name_quality_samples enable row level security;
drop policy if exists product_name_quality_samples_admin_all on public.product_name_quality_samples;
create policy product_name_quality_samples_admin_all
  on public.product_name_quality_samples for all
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.approve_product_name_review(
  p_product_id bigint,
  p_reviewer_id uuid,
  p_name_en text,
  p_seo_slug text,
  p_seo_title text,
  p_seo_description text,
  p_search_aliases text[],
  p_name_source text,
  p_expected_run_id uuid,
  p_expected_generated_at timestamptz
) returns public.products
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_latest_run_id uuid;
  v_candidate_name text;
  v_error_codes text[] := '{}';
  v_name text := btrim(p_name_en);
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_name_source not in ('official', 'grounded', 'generated', 'manual') then
    raise exception 'invalid name source: %', p_name_source using errcode = '22023';
  end if;

  -- Server-side guards for empty / Japanese names (UI cannot bypass these).
  if nullif(v_name, '') is null then
    raise exception 'english name is required' using errcode = '22023';
  end if;
  if length(v_name) > 120 then
    raise exception 'english name must be 1..120 characters' using errcode = '22023';
  end if;
  if public.contains_japanese(v_name) then
    raise exception 'english name must not contain Japanese characters' using errcode = '22023';
  end if;
  if length(coalesce(p_seo_title, '')) > 160 or length(coalesce(p_seo_description, '')) > 300 then
    raise exception 'SEO metadata exceeds allowed length' using errcode = '22023';
  end if;

  -- Lock the product row for the duration of the concurrency check + write.
  select * into v_product
    from public.products
   where id = p_product_id
   for update;
  if not found then
    raise exception 'product not found: %', p_product_id using errcode = 'P0002';
  end if;

  -- Optimistic concurrency: the generated timestamp the reviewer saw must still
  -- be current (guards against a worker re-run between load and approve).
  if v_product.name_en_generated_at is distinct from p_expected_generated_at then
    raise exception 'product name was regenerated since it was loaded; reload the review'
      using errcode = '40001';
  end if;

  -- ...and the latest run must still be the one the reviewer reviewed. Capture
  -- its candidate and deterministic error codes for the four-week pilot sample.
  select r.id,
         r.result_payload ->> 'candidateName',
         coalesce(array(
           select error_item ->> 'code'
             from jsonb_array_elements(coalesce(r.validation_payload -> 'errors', '[]'::jsonb)) error_item
         ), '{}')
    into v_latest_run_id, v_candidate_name, v_error_codes
    from public.product_name_enrichment_runs r
   where r.product_id = p_product_id
   order by r.created_at desc
   limit 1;
  if v_latest_run_id is distinct from p_expected_run_id then
    raise exception 'a newer enrichment run exists; reload the review'
      using errcode = '40001';
  end if;

  update public.products
     set name_en = v_name,
         -- Stable-URL policy: assign a slug only once, never overwrite it.
         seo_slug = coalesce(seo_slug, nullif(p_seo_slug, '')),
         seo_title = nullif(p_seo_title, ''),
         seo_description = nullif(p_seo_description, ''),
         search_aliases = coalesce(p_search_aliases, '{}'),
         name_en_status = 'human_approved',
         name_en_source = p_name_source,
         name_en_approved_by = p_reviewer_id,
         name_en_approved_at = now()
   where id = p_product_id
  returning * into v_product;

  if p_expected_run_id is not null then
    insert into public.product_name_quality_samples (
      product_id, run_id, reviewer_id, correct_without_edit, error_codes, reviewed_at
    ) values (
      p_product_id, p_expected_run_id, p_reviewer_id,
      lower(v_name) = lower(btrim(coalesce(v_candidate_name, ''))),
      v_error_codes, now()
    )
    on conflict (product_id, run_id) do update
      set reviewer_id = excluded.reviewer_id,
          correct_without_edit = excluded.correct_without_edit,
          error_codes = excluded.error_codes,
          reviewed_at = excluded.reviewed_at;
  end if;

  return v_product;
end;
$$;

create or replace function public.request_product_name_regeneration(
  p_product_id bigint,
  p_expected_run_id uuid,
  p_expected_generated_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.products%rowtype;
  v_latest_run_id uuid;
  v_queued_run_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;

  select * into v_product
    from public.products
   where id = p_product_id
   for update;
  if not found then
    raise exception 'product not found: %', p_product_id using errcode = 'P0002';
  end if;

  -- Never clobber a curated human-approved name via regeneration.
  if v_product.name_en_status = 'human_approved' then
    raise exception 'product is human-approved; regeneration is disabled'
      using errcode = '42501';
  end if;

  -- Optimistic concurrency: reject if the worker refreshed the name meanwhile.
  if v_product.name_en_generated_at is distinct from p_expected_generated_at then
    raise exception 'product name was regenerated since it was loaded; reload the review'
      using errcode = '40001';
  end if;

  select id into v_latest_run_id
    from public.product_name_enrichment_runs
   where product_id = p_product_id
   order by created_at desc
   limit 1;
  if v_latest_run_id is distinct from p_expected_run_id then
    raise exception 'a newer enrichment run exists; reload the review'
      using errcode = '40001';
  end if;

  -- Atomically supersede any in-flight job so exactly one regeneration request
  -- is outstanding, then reset the workflow status so the next worker pass
  -- rebuilds a fresh, correctly-hashed job snapshot.
  update public.product_name_enrichment_runs
     set status = 'skipped',
         error_message = 'superseded by admin regeneration request',
         lease_owner = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where product_id = p_product_id
     and status in ('queued', 'running');
  -- Clone the immutable snapshot from the run the administrator reviewed.
  -- This creates a real queued job immediately; no follow-up --ids command is
  -- required and the worker will still verify the stored input hash.
  insert into public.product_name_enrichment_runs (
    product_id, sd_product_id, provider, model, prompt_version, input_hash,
    source_payload, status, attempt, priority, max_attempts, available_at
  )
  select product_id, sd_product_id, provider, model, prompt_version, input_hash,
         source_payload, 'queued', 0, priority, max_attempts, now()
    from public.product_name_enrichment_runs
   where id = p_expected_run_id
     and product_id = p_product_id
  returning id into v_queued_run_id;

  if v_queued_run_id is null then
    raise exception 'the reviewed enrichment run no longer exists; enqueue the product explicitly'
      using errcode = 'P0002';
  end if;

  update public.products
     set name_en_status = 'pending'
   where id = p_product_id
     and name_en_status <> 'human_approved';

  return v_queued_run_id;
end;
$$;

revoke all on function public.approve_product_name_review(
  bigint, uuid, text, text, text, text, text[], text, uuid, timestamptz) from public;
revoke all on function public.request_product_name_regeneration(bigint, uuid, timestamptz) from public;
grant execute on function public.approve_product_name_review(
  bigint, uuid, text, text, text, text, text[], text, uuid, timestamptz) to authenticated;
grant execute on function public.request_product_name_regeneration(bigint, uuid, timestamptz) to authenticated;

comment on function public.approve_product_name_review is
  'Admin human-approval of an English product name with latest-run + generated-timestamp optimistic concurrency and empty/Japanese rejection.';
comment on function public.request_product_name_regeneration is
  'Admin atomic re-enqueue request: supersedes in-flight runs and resets name_en_status to pending under an optimistic-concurrency guard.';


-- ============================================================================
-- SOURCE: supabase/migrations/20260921_product_naming_backfill_guardrails.sql
-- ============================================================================

-- WELMES — Product English-naming backfill/worker operational guardrails.
--
-- Apply AFTER 20260920_product_name_enrichment_worker.sql.
--
-- This migration hardens the naming pipeline at the database layer so that the
-- safety guarantees enforced in scripts/lib (isBackfillTarget manual-name
-- protection, active-first draining, bounded claims) also hold if a job is ever
-- completed through a different code path or a stale worker. It adds:
--   1. A per-product `name_en_manual_locked` flag + trigger so a human-typed,
--      clean (non-Japanese) English name on a pending/legacy row is protected
--      from being overwritten by an automatic completion.
--   2. Active-first draining support for claim_product_name_enrichments so the
--      backfill validates live inventory first, matching the CLI cursor.
--   3. A read-only queue-health view for operational monitoring.

-- ── 1. Clean pending manual-name protection ────────────────────────────
-- Legacy rows imported before the workflow existed may carry a hand-typed
-- English name with name_en_status = 'pending' (or null). The scripts skip them
-- via isBackfillTarget, but we also lock them at the DB so no completion path
-- can clobber a curated manual name. The flag is derived, not user-set.
alter table public.products
  add column if not exists name_en_manual_locked boolean not null default false;

comment on column public.products.name_en_manual_locked is
  'True when a clean, human-typed English name on a pending/legacy row must be protected from automatic overwrite (mirrors isBackfillTarget in scripts/lib).';

-- Backfill the flag for existing rows: a pending/legacy row whose name_en is a
-- non-empty, non-Japanese value distinct from the Japanese source name is
-- treated as manually curated. \u3040-\u30ff = kana, \u3400-\u9fff = CJK.
update public.products
   set name_en_manual_locked = true
 where coalesce(name_en_status, 'pending') in ('pending')
   and name_en is not null
   and length(btrim(name_en)) > 0
   and name_en !~ U&'[\3040-\309F\30A0-\30FF\31F0-\31FF\FF66-\FF9F\3400-\4DBF\4E00-\9FFF]'
   and lower(btrim(name_en)) is distinct from lower(btrim(coalesce(name, '')));

-- Keep the flag current on write. A human_approved status always clears the
-- transient lock (the workflow status is now authoritative). Any other manual
-- edit that leaves a clean pending name re-arms the lock.
create or replace function public.sync_product_name_manual_lock()
returns trigger
language plpgsql
as $$
begin
  if new.name_en_status = 'human_approved' then
    new.name_en_manual_locked := false;
  elsif coalesce(new.name_en_status, 'pending') = 'pending'
    and new.name_en is not null
    and length(btrim(new.name_en)) > 0
    and new.name_en !~ U&'[\3040-\309F\30A0-\30FF\31F0-\31FF\FF66-\FF9F\3400-\4DBF\4E00-\9FFF]'
    and lower(btrim(new.name_en)) is distinct from lower(btrim(coalesce(new.name, ''))) then
    new.name_en_manual_locked := true;
  else
    new.name_en_manual_locked := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_product_name_manual_lock on public.products;
create trigger trg_sync_product_name_manual_lock
  before insert or update of name_en, name, name_en_status on public.products
  for each row execute function public.sync_product_name_manual_lock();

-- Re-issue complete_product_name_enrichment so an automatic result never
-- overwrites a manual-locked row. The lock is bypassed only when a human
-- explicitly forces reprocessing via the --ids allowlist, which is represented
-- here by the enqueued run's source_payload carrying "force": true.
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
  v_force boolean := false;
  v_locked boolean := false;
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

  v_force := coalesce((v_run.source_payload -> 'rpcParams' ->> 'p_force')::boolean, false)
          or coalesce((v_run.source_payload ->> 'force')::boolean, false);

  select name_en_manual_locked into v_locked
    from public.products where id = v_run.product_id;
  v_locked := coalesce(v_locked, false) and not v_force;

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
     and name_en_status <> 'human_approved'
     and not v_locked;
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
         error_message = case
           when v_applied then null
           when v_locked then 'product English name is manual-locked; use --ids to force'
           else 'product already human-approved' end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where id = p_run_id;
  return v_run_status;
end;
$$;

-- ── 2. Active-first draining support ───────────────────────────────────
-- The backfill CLI processes active products first (validate on live
-- inventory). Give the claim query a matching partial index and re-issue the
-- claim RPC so a single claim RPC also prefers active products, keeping the
-- 50-row bound. Repeated bounded claims still drain the queue from the CLI.
create index if not exists product_name_enrichment_runs_active_first_idx
  on public.product_name_enrichment_runs (priority desc, available_at, created_at)
  where status in ('queued', 'running') and product_id is not null;

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
      join public.products p on p.id = r.product_id
     where r.product_id is not null
       and (p_product_ids is null or r.product_id = any(p_product_ids))
       and r.attempt < r.max_attempts
       and (
         (r.status = 'queued' and r.available_at <= now())
         or (r.status = 'running' and r.lease_expires_at < now())
       )
     -- Active products first (validate on live inventory), then priority/age.
     order by (case when p.status = 'active' then 0 else 1 end),
              r.priority desc, r.available_at, r.created_at
     for update of r skip locked
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

revoke all on function public.complete_product_name_enrichment(uuid, text, text, text, text, text, text[], text, numeric, text, jsonb, jsonb, integer, integer, numeric, integer) from public;
revoke all on function public.claim_product_name_enrichments(text, integer, integer, bigint[]) from public;
grant execute on function public.complete_product_name_enrichment(uuid, text, text, text, text, text, text[], text, numeric, text, jsonb, jsonb, integer, integer, numeric, integer) to authenticated;
grant execute on function public.claim_product_name_enrichments(text, integer, integer, bigint[]) to authenticated;

-- ── 3. Queue-health monitoring view ───────────────────────────────────
-- A bounded, admin-only operational view: counts by status and the oldest
-- queued/running age so an operator can spot a stalled backfill without a table
-- scan of the audit trail.
create or replace view public.product_name_queue_health
with (security_barrier = true, security_invoker = true)
as
  select
    r.status,
    count(*)                                    as run_count,
    count(*) filter (where r.status = 'running'
      and r.lease_expires_at < now())           as expired_leases,
    min(r.available_at) filter (where r.status = 'queued') as oldest_available_at,
    max(r.attempt)                              as max_attempt
  from public.product_name_enrichment_runs r
  group by r.status;

revoke all on public.product_name_queue_health from public;
grant select on public.product_name_queue_health to authenticated;

comment on view public.product_name_queue_health is
  'Admin-only operational summary of the product-name enrichment queue: run counts, expired leases, and oldest queued job age.';

comment on function public.claim_product_name_enrichments is
  'Atomically leases queued or expired product-name jobs (active products first) with FOR UPDATE SKIP LOCKED, bounded to 50 rows per call.';


-- ============================================================================
-- SOURCE: supabase/migrations/20260922_product_publication_seo.sql
-- ============================================================================

-- WELMES — public catalogue boundary, SEO publication gate and pilot metrics.
-- Apply after the product naming/review migrations.

alter table public.products
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
with (security_barrier = true, security_invoker = false)
as
select
  id, name, name_en, brand, category, subcategory, image, images, discount,
  tags, rating, reviews, description, stock, status, created_at, updated_at,
  seo_slug, seo_title, seo_description, search_aliases, name_en_status, jan
from public.products;

-- Approved buyers can retrieve price data only after membership approval.
create or replace view public.product_prices_approved
with (security_barrier = true, security_invoker = false)
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
with (security_barrier = true, security_invoker = false)
as
select * from public.products
where public.is_admin()
with local check option;

alter table public.products enable row level security;
drop policy if exists "products_select" on public.products;
drop policy if exists products_select_all on public.products;
drop policy if exists "products_insert" on public.products;
drop policy if exists "products_update" on public.products;
drop policy if exists "products_delete" on public.products;
drop policy if exists products_write_admin on public.products;
create policy products_admin_direct_access on public.products
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

revoke all on public.products from anon, authenticated;
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

-- Prevent publication before the English name is approved. This also makes the
-- Super Delivery --active escape hatch safe during the pilot.
create or replace function public.guard_product_publication()
returns trigger language plpgsql as $$
begin
  if new.status = 'active'
     and coalesce(new.name_en_status, 'pending') not in ('auto_approved', 'human_approved') then
    if tg_op = 'UPDATE' and old.status = 'active' then
      new.status := 'inactive';
    else
      raise exception 'product cannot be active before its English name is approved'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_product_publication on public.products;
create trigger trg_guard_product_publication
  before insert or update of status, name_en_status on public.products
  for each row execute function public.guard_product_publication();

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
with (security_barrier = true, security_invoker = true)
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
  coalesce((select percentile_cont(0.95) within group (order by latency_ms) from runs where latency_ms is not null), 0) as p95_latency_ms;
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


commit;
