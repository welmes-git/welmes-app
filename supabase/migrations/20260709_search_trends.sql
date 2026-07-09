-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Real trending searches (replaces the hardcoded fake list that
-- displayed a static term list next to a live clock, implying real-time data
-- that didn't exist).
-- Run this in the Supabase SQL Editor (or via `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.search_queries (
  id         uuid primary key default gen_random_uuid(),
  term       text not null,
  member_id  uuid references public.members (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists search_queries_created_at_idx
  on public.search_queries (created_at desc);

create index if not exists search_queries_term_idx
  on public.search_queries (term);

alter table public.search_queries enable row level security;

-- Anyone (including anonymous browsers) can log a search — search itself
-- works without logging in, and the payload is just a keyword.
drop policy if exists search_queries_insert on public.search_queries;
create policy search_queries_insert on public.search_queries
  for insert with check (true);

-- No direct SELECT policy: raw rows (which can carry member_id) are only
-- readable through the aggregated RPC below, not row-by-row.

-- Aggregated trending terms over a recent window, most-searched first.
create or replace function public.get_trending_searches(p_limit int default 10, p_hours int default 168)
returns table(term text, search_count bigint)
language sql
security definer
set search_path = public
as $$
  select term, count(*) as search_count
  from public.search_queries
  where created_at > now() - (p_hours || ' hours')::interval
  group by term
  order by search_count desc, max(created_at) desc
  limit p_limit;
$$;

grant execute on function public.get_trending_searches(int, int) to anon, authenticated;
