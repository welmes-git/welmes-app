-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — React to what PayPal tells us after the capture
--
-- The capture is synchronous, so the moment of payment is handled. Everything
-- afterwards happens on PayPal's side and never reached us:
--
--   * a refund issued from the PayPal dashboard
--   * a capture reversed or denied after settling
--   * a buyer opening a dispute or chargeback
--
-- In every case the order stayed `paid` and kept its place in the fulfilment
-- queue — goods shipped for money we no longer hold. `payment_status` has had a
-- 'refunded' value since 20260926 and nothing could ever set it, because no code
-- path existed.
--
-- Sandbox does not surface this: disputes and chargebacks essentially do not occur
-- there. It only appears once real money moves.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Dispute tracking ───────────────────────────────────────────────────
alter table public.orders
  add column if not exists dispute_status text,
  add column if not exists dispute_reason text,
  add column if not exists disputed_at    timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_dispute_status_check') then
    alter table public.orders add constraint orders_dispute_status_check
      check (dispute_status is null or dispute_status in ('open','resolved','lost','won'));
  end if;
end $$;

comment on column public.orders.dispute_status is
  'Set from PayPal dispute webhooks. An open dispute must block fulfilment: the money is provisionally held by PayPal.';

create index if not exists orders_dispute_open_idx
  on public.orders (disputed_at)
  where dispute_status = 'open';

-- ── 2. Webhook idempotency ────────────────────────────────────────────────
-- PayPal retries a delivery until it gets a 2xx, and retries are expected rather
-- than exceptional. Replaying a refund would restore stock twice.
create table if not exists public.paypal_webhook_events (
  event_id     text primary key,
  event_type   text not null,
  order_id     text,
  received_at  timestamptz not null default now(),
  outcome      text,
  payload      jsonb
);

comment on table public.paypal_webhook_events is
  'One row per PayPal webhook delivery, keyed by their event id. Presence means "already handled" — PayPal retries until 2xx.';

create index if not exists paypal_webhook_events_order_idx
  on public.paypal_webhook_events (order_id, received_at desc);

alter table public.paypal_webhook_events enable row level security;
-- Service role only; there is no reason for a browser to read or write this.
revoke all on public.paypal_webhook_events from anon, authenticated;

/**
 * Claim an event id. Returns true when this is the first delivery, false when it
 * is a retry — the caller then answers 200 without touching the order again.
 */
create or replace function public.claim_webhook_event(
  p_event_id   text,
  p_event_type text,
  p_order_id   text default null,
  p_payload    jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.paypal_webhook_events (event_id, event_type, order_id, payload)
  values (p_event_id, p_event_type, p_order_id, p_payload);
  return true;
exception when unique_violation then
  return false;
end;
$$;

create or replace function public.record_webhook_outcome(
  p_event_id text,
  p_outcome  text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.paypal_webhook_events set outcome = left(p_outcome, 200) where event_id = p_event_id;
$$;

-- ── 3. Refund / reversal ──────────────────────────────────────────────────
-- Looked up by capture id, because that is what the webhook carries; our order id
-- is in custom_id but only on some event types.
create or replace function public.refund_order(
  p_reference text,
  p_amount    numeric default null,
  p_reason    text default null,
  p_order_id  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item  public.order_items%rowtype;
  v_units int;
begin
  select * into v_order from public.orders
   where (p_order_id is not null and id = p_order_id)
      or (p_reference is not null and payment_reference = p_reference)
   limit 1
   for update;

  if v_order.id is null then
    return jsonb_build_object('matched', false, 'reference', p_reference);
  end if;

  -- Idempotent: a replayed refund must not restore stock twice.
  if v_order.payment_status = 'refunded' then
    return jsonb_build_object('matched', true, 'order_id', v_order.id, 'already_refunded', true);
  end if;

  -- Give the reservation back unless the goods already went out. After dispatch
  -- the stock is genuinely gone and an admin has to settle it by hand.
  if v_order.status in ('pending', 'processing') then
    for v_item in select * from public.order_items where order_id = v_order.id
    loop
      v_units := v_item.quantity *
                 greatest(coalesce((v_item.set_option->>'unitsPerSet')::int, 1), 1);
      update public.products
        set stock = stock + v_units
        where id = (v_item.product_snapshot->>'id')::int;
    end loop;
  end if;

  update public.orders set
    payment_status = 'refunded',
    payment_error  = left(coalesce(p_reason, 'refunded via PayPal'), 500),
    -- Shipped orders keep their status: cancelling one would hide a parcel that is
    -- physically in transit.
    status = case when status in ('pending', 'processing') then 'cancelled' else status end
  where id = v_order.id;

  return jsonb_build_object(
    'matched', true,
    'order_id', v_order.id,
    'already_refunded', false,
    'stock_restored', v_order.status in ('pending', 'processing'),
    'was_status', v_order.status
  );
end;
$$;

-- ── 4. Dispute ────────────────────────────────────────────────────────────
-- Deliberately does NOT cancel or restore stock: the outcome is unknown and the
-- money is only provisionally held. It marks the order so fulfilment pauses.
create or replace function public.flag_order_dispute(
  p_reference text,
  p_status    text,
  p_reason    text default null,
  p_order_id  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_status not in ('open','resolved','lost','won') then
    raise exception 'INVALID_DISPUTE_STATUS:%', p_status;
  end if;

  select * into v_order from public.orders
   where (p_order_id is not null and id = p_order_id)
      or (p_reference is not null and payment_reference = p_reference)
   limit 1
   for update;

  if v_order.id is null then
    return jsonb_build_object('matched', false, 'reference', p_reference);
  end if;

  update public.orders set
    dispute_status = p_status,
    dispute_reason = left(coalesce(p_reason, ''), 500),
    disputed_at    = coalesce(disputed_at, now())
  where id = v_order.id;

  return jsonb_build_object('matched', true, 'order_id', v_order.id, 'dispute_status', p_status);
end;
$$;

-- ── 5. Grants ─────────────────────────────────────────────────────────────
-- All of these move money state, so they are service-role only, like
-- mark_order_paid. The webhook endpoint holds the service key.
revoke all on function public.claim_webhook_event(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.record_webhook_outcome(text, text)            from public, anon, authenticated;
revoke all on function public.refund_order(text, numeric, text, text)       from public, anon, authenticated;
revoke all on function public.flag_order_dispute(text, text, text, text)    from public, anon, authenticated;

grant execute on function public.claim_webhook_event(text, text, text, jsonb) to service_role;
grant execute on function public.record_webhook_outcome(text, text)           to service_role;
grant execute on function public.refund_order(text, numeric, text, text)      to service_role;
grant execute on function public.flag_order_dispute(text, text, text, text)   to service_role;
