-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Critical fixes C2 (server-backed notifications) & C5 (chat unread)
-- Run this in the Supabase SQL Editor (or via `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Notifications table ───────────────────────────────────────────────────
-- Notifications used to live only in each browser's localStorage, so an
-- admin's "approved" notification never reached the member. Store them here
-- keyed by the recipient member's id instead.

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members (id) on delete cascade,
  type            text not null check (type in (
                    'order_status', 'order_shipped', 'member_approved', 'member_rejected'
                  )),
  read            boolean not null default false,
  order_id        text,
  order_status    text,
  carrier         text,
  tracking_number text,
  created_at      timestamptz not null default now()
);

create index if not exists notifications_member_id_created_idx
  on public.notifications (member_id, created_at desc);

alter table public.notifications enable row level security;

-- Helper: is the current auth user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where auth_id = auth.uid() and is_admin = true
  );
$$;

-- A member can read their own notifications; admins can read all.
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
  for select using (
    public.is_admin()
    or member_id in (select id from public.members where auth_id = auth.uid())
  );

-- Any authenticated user can insert (admins create notifications for members;
-- the store also inserts for the current user). Tighten to is_admin() if you
-- only ever create notifications from admin actions.
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert with check (auth.uid() is not null);

-- A member can update/delete only their own notifications (mark read / clear).
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications
  for update using (
    member_id in (select id from public.members where auth_id = auth.uid())
  );

drop policy if exists notifications_delete on public.notifications;
create policy notifications_delete on public.notifications
  for delete using (
    member_id in (select id from public.members where auth_id = auth.uid())
  );

-- ── 2. Chat unread counter RPC ───────────────────────────────────────────────
-- db.ts previously tried to embed a query-builder object as an update value,
-- which silently no-op'd. Increment atomically via an RPC instead.

create or replace function public.increment_room_unread(room uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.support_rooms
  set unread_admin = coalesce(unread_admin, 0) + 1
  where id = room;
$$;

grant execute on function public.increment_room_unread(uuid) to authenticated, anon;

-- ── 3. Business-registration certificate storage (H4) ────────────────────────
-- Registration used to only fake the certificate upload. We now upload the
-- real file to a private bucket and store its path on the member record.

alter table public.members
  add column if not exists certificate_url text;

insert into storage.buckets (id, name, public)
values ('business-certificates', 'business-certificates', false)
on conflict (id) do nothing;

-- A user may upload into their own folder (path prefix = their auth uid).
drop policy if exists cert_insert on storage.objects;
create policy cert_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-certificates'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Owner can read their own file; admins can read any (to verify applications).
drop policy if exists cert_select on storage.objects;
create policy cert_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'business-certificates'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );
