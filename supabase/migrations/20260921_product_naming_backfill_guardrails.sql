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
as
  select
    r.status,
    count(*)                                    as run_count,
    count(*) filter (where r.status = 'running'
      and r.lease_expires_at < now())           as expired_leases,
    min(r.available_at) filter (where r.status = 'queued') as oldest_available_at,
    max(r.attempt)                              as max_attempt
  from public.product_name_enrichment_runs r
  where public.is_admin()
  group by r.status;

revoke all on public.product_name_queue_health from public;
grant select on public.product_name_queue_health to authenticated;

comment on view public.product_name_queue_health is
  'Admin-only operational summary of the product-name enrichment queue: run counts, expired leases, and oldest queued job age.';

comment on function public.claim_product_name_enrichments is
  'Atomically leases queued or expired product-name jobs (active products first) with FOR UPDATE SKIP LOCKED, bounded to 50 rows per call.';
