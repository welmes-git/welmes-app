-- Run only AFTER the frontend/SSR version that reads products_public,
-- product_prices_approved and products_admin has been deployed.


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
alter table public.products enable row level security;

drop policy if exists "products_select" on public.products;
drop policy if exists products_select_all on public.products;
drop policy if exists "products_insert" on public.products;
drop policy if exists "products_update" on public.products;
drop policy if exists "products_delete" on public.products;
drop policy if exists products_write_admin on public.products;
drop policy if exists products_admin_direct_access on public.products;

create policy products_admin_direct_access on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.products from anon, authenticated;
