// Guards 20260929_wire_reconciliation.sql.
//
// Two things it has to get right. A wire almost never arrives at the invoiced
// amount — intermediary banks deduct in transit — so `mark_order_paid`'s exact
// match left admins with no way to settle one. And since `place_order` reserves
// stock, an order that is never paid holds sellable inventory indefinitely.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260929_wire_reconciliation.sql', import.meta.url), 'utf8');
const record = sql.match(/create or replace function public\.record_wire_payment[\s\S]*?\n\$\$;/)?.[0] || '';
const expire = sql.match(/create or replace function public\.expire_unpaid_orders[\s\S]*?\n\$\$;/)?.[0] || '';
const placeOrder = sql.match(/create or replace function public\.place_order[\s\S]*?\n\$\$;/)?.[0] || '';

test('the deadline column exists and old unpaid wires get one', () => {
  assert.match(sql, /add column if not exists payment_due_at timestamptz/);
  assert.match(sql, /add column if not exists payment_shortfall numeric\(14,2\)/);
  // Rows created before this migration would otherwise never be swept
  assert.match(sql, /update public\.orders\s*\n\s*set payment_due_at = \(date \+ interval '7 days'\)/);
  assert.match(sql, /create index if not exists orders_unpaid_due_idx/);
});

test('place_order dates wires seven days out and leaves PayPal alone', () => {
  assert.match(placeOrder, /c_wire_terms\s+constant interval := interval '7 days'/);
  assert.match(placeOrder, /v_due_at := case when p_payment_method = 'bank_transfer' then now\(\) \+ c_wire_terms end/);
  assert.match(placeOrder, /payment_due_at\s*\n?\s*\) values/);
  assert.match(placeOrder, /'payment_due_at',\s*v_due_at/);
});

test('recording a wire is admin-only', () => {
  assert.ok(record, 'record_wire_payment must exist');
  assert.match(record, /if not public\.is_admin\(\) then\s*\n\s*raise exception 'FORBIDDEN'/);
  assert.match(record, /where id = p_order_id for update/);
  assert.match(record, /NOT_A_WIRE_ORDER/);
  assert.match(record, /CURRENCY_MISMATCH/);
});

test('tolerance is the larger of a percentage and an absolute floor', () => {
  // The floor covers small orders where a flat bank fee dominates; the percentage
  // covers large ones where multiple correspondents each take a cut.
  assert.match(record, /p_tolerance_pct numeric default 0\.02/);
  assert.match(record, /p_tolerance_jpy numeric default 3000/);
  assert.match(record, /v_tolerance := greatest\(/);
  // The floor is quoted in JPY, so it must be converted with the rate frozen on
  // the order rather than a live one.
  assert.match(record, /round\(p_tolerance_jpy \* coalesce\(v_order\.fx_rate, 1\), v_decimals\)/);
});

test('a shortfall inside tolerance settles the order but stays visible', () => {
  assert.match(record, /payment_status\s*=\s*'paid'/);
  assert.match(record, /payment_shortfall = nullif\(v_shortfall, 0\)/);
  assert.match(record, /status\s*=\s*case when status = 'pending' then 'processing' else status end/);
});

test('a shortfall beyond tolerance is recorded, not cancelled', () => {
  // Goods may already be packed; invoicing the difference, carrying it forward or
  // absorbing it is a commercial decision.
  assert.match(record, /if v_shortfall > v_tolerance then/);
  const branch = record.slice(record.indexOf('if v_shortfall > v_tolerance then'), record.indexOf("'accepted',  false"));
  assert.doesNotMatch(branch, /payment_status\s*=\s*'paid'/, 'must not mark an underpaid order as paid');
  assert.doesNotMatch(branch, /status\s*=\s*'cancelled'/, 'must not cancel over a shortfall');
  assert.match(branch, /UNDERPAID/);
});

test('expiry releases the reservation and is service-role only', () => {
  assert.ok(expire, 'expire_unpaid_orders must exist');
  assert.match(expire, /payment_method = 'bank_transfer'/);
  assert.match(expire, /payment_status = 'unpaid'/);
  assert.match(expire, /payment_due_at < now\(\)/);
  assert.match(expire, /set stock = stock \+ v_units/);
  assert.match(expire, /status\s*=\s*'cancelled'/);
  assert.match(sql, /revoke all on function public\.expire_unpaid_orders\(int\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.expire_unpaid_orders\(int\) to service_role/);
});

test('expiry only touches orders still awaiting payment', () => {
  // `status = 'pending'` keeps the sweep away from anything an admin has already
  // moved on, and `for update skip locked` keeps two sweeps from double-restoring.
  assert.match(expire, /and status = 'pending'/);
  assert.match(expire, /for update skip locked/);
});

test('the sweep is scheduled when pg_cron is available', () => {
  assert.match(sql, /if exists \(select 1 from pg_extension where extname = 'pg_cron'\)/);
  assert.match(sql, /cron\.schedule\(\s*\n\s*'welmes-expire-unpaid-orders'/);
  assert.match(sql, /raise notice 'pg_cron not installed/);
});
