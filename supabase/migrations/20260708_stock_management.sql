-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Medium fix M4: stock validation & atomic decrement
-- Orders previously never checked or decremented stock, so an out-of-stock
-- product could be ordered without limit.
-- Run in the Supabase SQL Editor (or `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════════════

-- Atomically check + decrement stock for every line in the order.
-- `p_items` is [{ "product_id": 12, "units": 24 }, ...] where `units` is the
-- total pieces (quantity × unitsPerSet), because `products.stock` is in pieces.
-- Rolls back the whole call if any line is short (raises INSUFFICIENT_STOCK).
create or replace function public.decrement_product_stock(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it  jsonb;
  pid int;
  qty int;
  cur int;
begin
  for it in select * from jsonb_array_elements(p_items)
  loop
    pid := (it->>'product_id')::int;
    qty := (it->>'units')::int;
    if qty is null or qty <= 0 then
      continue;
    end if;

    -- Lock the row so two concurrent checkouts can't both pass the check
    select stock into cur from public.products where id = pid for update;

    if cur is null then
      raise exception 'PRODUCT_NOT_FOUND:%', pid;
    end if;
    if cur < qty then
      raise exception 'INSUFFICIENT_STOCK:%', pid;
    end if;

    update public.products set stock = stock - qty where id = pid;
  end loop;
end;
$$;

-- Compensating action: used to put stock back if the order insert fails after
-- we already decremented.
create or replace function public.restore_product_stock(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  it  jsonb;
  pid int;
  qty int;
begin
  for it in select * from jsonb_array_elements(p_items)
  loop
    pid := (it->>'product_id')::int;
    qty := (it->>'units')::int;
    if qty is null or qty <= 0 then
      continue;
    end if;
    update public.products set stock = stock + qty where id = pid;
  end loop;
end;
$$;

grant execute on function public.decrement_product_stock(jsonb) to authenticated;
grant execute on function public.restore_product_stock(jsonb)   to authenticated;
