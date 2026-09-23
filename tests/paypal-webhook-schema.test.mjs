// Guards 20261004_paypal_webhooks.sql.
//
// `payment_status` has had a 'refunded' value since 20260926 and nothing could set
// it — a refund issued from the PayPal dashboard left the order `paid` and in the
// fulfilment queue.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20261004_paypal_webhooks.sql', import.meta.url), 'utf8');
const refund = sql.match(/create or replace function public\.refund_order[\s\S]*?\n\$\$;/)?.[0] || '';
const dispute = sql.match(/create or replace function public\.flag_order_dispute[\s\S]*?\n\$\$;/)?.[0] || '';
const claim = sql.match(/create or replace function public\.claim_webhook_event[\s\S]*?\n\$\$;/)?.[0] || '';

test('deliveries are de-duplicated by PayPal event id', () => {
  // PayPal retries until it gets a 2xx, so repeats are routine. Replaying a refund
  // would restore stock twice.
  assert.match(sql, /create table if not exists public\.paypal_webhook_events/);
  assert.match(sql, /event_id\s+text primary key/);
  assert.ok(claim, 'claim_webhook_event must exist');
  assert.match(claim, /exception when unique_violation then\s*\n\s*return false;/);
  assert.match(claim, /return true;/);
});

test('the event log is not reachable from a browser', () => {
  assert.match(sql, /alter table public\.paypal_webhook_events enable row level security/);
  assert.match(sql, /revoke all on public\.paypal_webhook_events from anon, authenticated/);
});

test('a refund is matched on the capture id we stored', () => {
  assert.ok(refund, 'refund_order must exist');
  assert.match(refund, /payment_reference = p_reference/);
  // The order id is preferred when the event carries it, since that match is exact
  assert.match(refund, /p_order_id is not null and id = p_order_id/);
  assert.match(refund, /for update/);
  assert.match(refund, /'matched', false/);
});

test('replaying a refund does not restore stock twice', () => {
  assert.match(refund, /if v_order\.payment_status = 'refunded' then/);
  assert.match(refund, /'already_refunded', true/);
});

test('stock comes back only while the goods are still with us', () => {
  // After dispatch the stock is genuinely gone; cancelling would also hide a parcel
  // that is physically in transit.
  assert.match(refund, /if v_order\.status in \('pending', 'processing'\) then/);
  assert.match(refund, /set stock = stock \+ v_units/);
  assert.match(refund, /status = case when status in \('pending', 'processing'\) then 'cancelled' else status end/);
});

test('a dispute is flagged but never releases stock', () => {
  assert.ok(dispute, 'flag_order_dispute must exist');
  assert.match(dispute, /dispute_status = p_status/);
  // The outcome is unknown and the money only provisionally held
  assert.doesNotMatch(dispute, /set stock = stock \+/);
  assert.doesNotMatch(dispute, /payment_status\s*=\s*'refunded'/);
  assert.match(dispute, /INVALID_DISPUTE_STATUS/);
});

test('dispute columns are constrained to the four states', () => {
  assert.match(sql, /add column if not exists dispute_status text/);
  assert.match(sql, /check \(dispute_status is null or dispute_status in \('open','resolved','lost','won'\)\)/);
  assert.match(sql, /create index if not exists orders_dispute_open_idx/);
});

test('every webhook function is service-role only', () => {
  // These move money state, exactly like mark_order_paid.
  for (const fn of [
    'claim_webhook_event\\(text, text, text, jsonb\\)',
    'record_webhook_outcome\\(text, text\\)',
    'refund_order\\(text, numeric, text, text\\)',
    'flag_order_dispute\\(text, text, text, text\\)',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\s+from public, anon, authenticated`), `${fn} not revoked`);
    assert.match(sql, new RegExp(`grant execute on function public\\.${fn}\\s+to service_role`), `${fn} not granted`);
  }
});
