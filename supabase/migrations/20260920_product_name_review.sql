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
