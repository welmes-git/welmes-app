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
