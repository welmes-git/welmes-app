-- WELMES — Multilingual product-description translation queue and columns.
-- Apply AFTER 20260923_products_access_cutover.sql.
-- Mirrors the product-name enrichment worker pattern (lease-based claim,
-- bounded retry/backoff, admin-only security-definer RPCs) but as a SEPARATE
-- queue that only ever touches the description_i18n fields.
-- Contract: docs/product-description-i18n-contract.md

-- ── Columns on products ──────────────────────────────────────────────
alter table public.products
  add column if not exists description_i18n jsonb not null default '{}'::jsonb,
  add column if not exists description_i18n_status text not null default 'pending',
  add column if not exists description_i18n_generated_at timestamptz,
  add column if not exists description_i18n_manual_locked boolean not null default false;

alter table public.products drop constraint if exists products_description_i18n_status_check;
alter table public.products add constraint products_description_i18n_status_check
  check (description_i18n_status in ('pending', 'auto_approved', 'review_required', 'failed', 'human_locked'));

create index if not exists products_description_i18n_status_idx
  on public.products (description_i18n_status, created_at desc);

-- Expose translations on the public catalogue (safe: no prices/supplier data).
-- CREATE OR REPLACE VIEW cannot insert a column in the middle of an existing
-- view (only append at the end), so drop and recreate. No other view depends on
-- products_public, so a plain DROP is safe.
drop view if exists public.products_public;
create view public.products_public
as
select
  id, name, name_en, brand, category, subcategory, image, images, discount,
  tags, rating, reviews, description, description_i18n, stock, status,
  created_at, updated_at, seo_slug, seo_title, seo_description,
  search_aliases, name_en_status, jan
from public.products;

revoke all on public.products_public from public;
grant select on public.products_public to anon, authenticated;

comment on view public.products_public is
  'Public catalogue projection with no prices, set pricing, supplier metadata or AI audit details. Includes description_i18n translations.';

-- products_admin is a `select *` view, but a SELECT * view freezes its column
-- list at creation time and does NOT pick up columns added to products later.
-- Recreate it so the new description_i18n* columns become visible to scripts
-- and the admin UI. CREATE OR REPLACE re-expands `*` to the full current table.
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

-- products_admin is `select *`, so description_i18n columns are already visible.

-- ── Queue table ──────────────────────────────────────────────────────
create table if not exists public.product_description_translation_runs (
  id                 uuid primary key default gen_random_uuid(),
  product_id         bigint references public.products (id) on delete cascade,
  sd_product_id      text,
  provider           text not null check (provider in ('gemini', 'openai', 'anthropic', 'qwen', 'deepseek')),
  model              text not null,
  prompt_version     text not null,
  input_hash         text not null,
  target_langs       text[] not null default '{}',
  source_payload     jsonb not null default '{}'::jsonb,
  result_payload     jsonb not null default '{}'::jsonb,
  validation_payload jsonb not null default '{}'::jsonb,
  status             text not null default 'queued'
                       check (status in ('queued', 'running', 'succeeded', 'review_required', 'failed', 'skipped')),
  attempt            smallint not null default 0,
  max_attempts       smallint not null default 3 check (max_attempts between 1 and 10),
  priority           smallint not null default 0,
  available_at       timestamptz not null default now(),
  lease_owner        text,
  lease_expires_at   timestamptz,
  input_tokens       integer,
  output_tokens      integer,
  estimated_cost_usd numeric,
  latency_ms         integer,
  error_message      text,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists product_description_translation_runs_queue_idx
  on public.product_description_translation_runs (priority desc, available_at, created_at)
  where status in ('queued', 'running');

create unique index if not exists product_description_translation_runs_active_job_key
  on public.product_description_translation_runs (product_id, input_hash, provider, model)
  where product_id is not null and status in ('queued', 'running');

alter table public.product_description_translation_runs enable row level security;

drop policy if exists pdtr_admin_all on public.product_description_translation_runs;
create policy pdtr_admin_all on public.product_description_translation_runs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── Enqueue ──────────────────────────────────────────────────────────
create or replace function public.enqueue_product_description_translation(
  p_product_id bigint,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_input_hash text,
  p_target_langs text[],
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
    update public.product_description_translation_runs
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
      from public.product_description_translation_runs
     where product_id = p_product_id
       and input_hash = p_input_hash
       and provider = p_provider
       and model = p_model
       and status in ('queued', 'running', 'succeeded', 'review_required')
     order by created_at desc
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  -- Reset publish status to pending unless an admin manually locked it.
  update public.products
     set description_i18n_status = 'pending'
   where id = p_product_id
     and description_i18n_manual_locked = false
     and description_i18n_status <> 'human_locked';

  begin
    insert into public.product_description_translation_runs (
      product_id, sd_product_id, provider, model, prompt_version, input_hash,
      target_langs, source_payload, status, priority, max_attempts, available_at
    )
    select p.id, p.sd_product_id, p_provider, p_model, p_prompt_version, p_input_hash,
           coalesce(p_target_langs, '{}'), coalesce(p_source_payload, '{}'::jsonb), 'queued',
           p_priority, greatest(1, least(10, p_max_attempts)), now()
      from public.products p
     where p.id = p_product_id
    returning id into v_id;
  exception when unique_violation then
    select id into v_id
      from public.product_description_translation_runs
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

-- ── Claim ────────────────────────────────────────────────────────────
create or replace function public.claim_product_description_translations(
  p_worker_id text,
  p_limit integer default 1,
  p_lease_seconds integer default 300,
  p_product_ids bigint[] default null
) returns setof public.product_description_translation_runs
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
      from public.product_description_translation_runs r
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
  update public.product_description_translation_runs r
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

-- ── Complete ─────────────────────────────────────────────────────────
-- p_translations: { "en": {overview,...,extras:[{label,value}]}, "zh": {...}, "ko": {...} }
-- Only the languages present are merged into products.description_i18n.
create or replace function public.complete_product_description_translation(
  p_run_id uuid,
  p_worker_id text,
  p_translations jsonb,
  p_status text,
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
  v_run public.product_description_translation_runs%rowtype;
  v_applied boolean := false;
  v_run_status text;
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_status not in ('auto_approved', 'review_required') then
    raise exception 'invalid status: %', p_status using errcode = '22023';
  end if;

  select * into v_run
    from public.product_description_translation_runs
   where id = p_run_id
   for update;
  if not found then raise exception 'run not found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' or v_run.lease_owner is distinct from p_worker_id
     or v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'run lease is not owned by worker or has expired' using errcode = '55000';
  end if;

  -- Merge the clean languages into description_i18n unless the product is locked.
  update public.products
     set description_i18n = coalesce(description_i18n, '{}'::jsonb) || coalesce(p_translations, '{}'::jsonb),
         description_i18n_status = p_status,
         description_i18n_generated_at = now()
   where id = v_run.product_id
     and description_i18n_manual_locked = false
     and description_i18n_status <> 'human_locked';
  v_applied := found;

  v_run_status := case
    when not v_applied then 'skipped'
    when p_status = 'auto_approved' then 'succeeded'
    else 'review_required'
  end;

  update public.product_description_translation_runs
     set status = v_run_status,
         result_payload = coalesce(p_result_payload, '{}'::jsonb),
         validation_payload = coalesce(p_validation_payload, '{}'::jsonb),
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         estimated_cost_usd = p_estimated_cost_usd,
         latency_ms = p_latency_ms,
         error_message = case when v_applied then null else 'product description is human-locked' end,
         lease_owner = null,
         lease_expires_at = null,
         completed_at = now(),
         updated_at = now()
   where id = p_run_id;
  return v_run_status;
end;
$$;

-- ── Fail ─────────────────────────────────────────────────────────────
create or replace function public.fail_product_description_translation(
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
  v_run public.product_description_translation_runs%rowtype;
  v_status text;
begin
  if not public.is_admin() then
    raise exception 'admin required' using errcode = '42501';
  end if;
  select * into v_run
    from public.product_description_translation_runs
   where id = p_run_id
   for update;
  if not found then raise exception 'run not found' using errcode = 'P0002'; end if;
  if v_run.status <> 'running' or v_run.lease_owner is distinct from p_worker_id
     or v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'run lease is not owned by worker or has expired' using errcode = '55000';
  end if;

  v_status := case when p_terminal or v_run.attempt >= v_run.max_attempts then 'failed' else 'queued' end;
  update public.product_description_translation_runs
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
       set description_i18n_status = 'failed'
     where id = v_run.product_id
       and description_i18n_status = 'pending';
  end if;
  return v_status;
end;
$$;

-- ── Grants ───────────────────────────────────────────────────────────
revoke all on function public.enqueue_product_description_translation(bigint, text, text, text, text, text[], jsonb, smallint, smallint, boolean) from public;
revoke all on function public.claim_product_description_translations(text, integer, integer, bigint[]) from public;
revoke all on function public.complete_product_description_translation(uuid, text, jsonb, text, jsonb, jsonb, integer, integer, numeric, integer) from public;
revoke all on function public.fail_product_description_translation(uuid, text, text, integer, boolean) from public;
grant execute on function public.enqueue_product_description_translation(bigint, text, text, text, text, text[], jsonb, smallint, smallint, boolean) to authenticated;
grant execute on function public.claim_product_description_translations(text, integer, integer, bigint[]) to authenticated;
grant execute on function public.complete_product_description_translation(uuid, text, jsonb, text, jsonb, jsonb, integer, integer, numeric, integer) to authenticated;
grant execute on function public.fail_product_description_translation(uuid, text, text, integer, boolean) to authenticated;

comment on table public.product_description_translation_runs is
  'Lease-based queue for multilingual product-description translation (EN/ZH/KO first). Separate from name enrichment; only touches description_i18n fields.';
