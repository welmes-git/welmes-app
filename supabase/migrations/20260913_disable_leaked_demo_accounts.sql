-- ================================================================
-- Disable the three demo accounts whose passwords were committed to the
-- public GitHub repo (src/pages/Login.tsx, removed 2026-09-13).
--
-- Run once in: Supabase Dashboard → SQL Editor → New query → Run
--
-- Nothing is deleted. The accounts are banned (sign-in and token refresh
-- fail) and the demo admin loses admin rights immediately, even for any
-- session that is already signed in, because RLS checks members.is_admin.
-- To undo: set banned_until = null / is_admin = true for that email.
-- ================================================================

-- Safety: refuse to run if the demo admin is the only admin, so nobody
-- gets locked out of the admin console.
do $$
begin
  if not exists (
    select 1 from public.members
    where is_admin
      and email not in ('admin@welmes.kr', 'beautyworld@naver.com', 'glamourshop@gmail.com')
  ) then
    raise exception 'No other admin account exists — aborting. Make your real account an admin first.';
  end if;
end $$;

update public.members
set is_admin = false
where email in ('admin@welmes.kr', 'beautyworld@naver.com', 'glamourshop@gmail.com');

update auth.users
set banned_until = 'infinity'
where email in ('admin@welmes.kr', 'beautyworld@naver.com', 'glamourshop@gmail.com');

-- Result: every row should show banned = true and is_admin = false.
-- Zero rows means the account never existed in this project — also fine.
select u.email,
       u.banned_until is not null as banned,
       coalesce(m.is_admin, false) as is_admin
from auth.users u
left join public.members m on m.auth_id = u.id
where u.email in ('admin@welmes.kr', 'beautyworld@naver.com', 'glamourshop@gmail.com');
