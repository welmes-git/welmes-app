// Guards 20260928_server_fx_rates.sql. 20260926 closed the forged-`total` hole
// but still let the caller supply `p_fx_rate`, and Checkout.tsx fed it straight
// from the browser — so a buyer could be quoted USD 1.00 for a ¥500,000 order and
// have an incoming wire of one dollar reconciled as full payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260928_server_fx_rates.sql', import.meta.url), 'utf8');
const placeOrder = sql.match(/create or replace function public\.place_order[\s\S]*?\n\$\$;/)?.[0] || '';
const upsert = sql.match(/create or replace function public\.upsert_fx_rates[\s\S]*?\n\$\$;/)?.[0] || '';

test('the rate table exists and only the service role may write it', () => {
  assert.match(sql, /create table if not exists public\.fx_rates/);
  assert.match(sql, /rate_jpy\s+numeric\(18,8\) not null check \(rate_jpy > 0\)/);
  assert.match(sql, /revoke insert, update, delete on public\.fx_rates from anon, authenticated/);
  assert.match(sql, /revoke all on function public\.upsert_fx_rates\(jsonb, text\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.upsert_fx_rates\(jsonb, text\) to service_role/);
});

test('place_order derives the rate itself and ignores the caller', () => {
  assert.ok(placeOrder, 'place_order must be redefined here');
  assert.match(placeOrder, /select \* into v_fx from public\.fx_rates where currency = v_currency/);
  assert.match(placeOrder, /v_charge_amount := round\(v_total \* v_rate, v_decimals\)/);
  // The deprecated parameter must survive for signature stability but never be read
  assert.match(placeOrder, /p_fx_rate\s+numeric default null/);
  assert.doesNotMatch(
    placeOrder.replace(/--[^\n]*\n/g, ''),
    /:=\s*p_fx_rate|\*\s*p_fx_rate|p_fx_rate\s*[<>]/,
    'p_fx_rate must not influence any computation',
  );
});

test('a stale or unknown rate refuses to price the order', () => {
  assert.match(placeOrder, /c_fx_max_age\s+constant interval := interval '72 hours'/);
  assert.match(placeOrder, /raise exception 'FX_STALE/);
  assert.match(placeOrder, /raise exception 'FX_UNSUPPORTED/);
});

test('JPY needs no rate, so an FX outage cannot block a JPY order', () => {
  assert.match(placeOrder, /if v_currency = 'JPY' then\s*\n\s*v_rate := 1;/);
});

test('the rate is resolved before stock is taken', () => {
  // Otherwise an FX failure would abort after reserving stock, and the raised
  // exception would have to unwind a reservation that never should have started.
  const fxAt = placeOrder.indexOf('FX_STALE');
  const stockAt = placeOrder.indexOf('set stock = stock - v_units');
  assert.ok(fxAt > 0 && stockAt > 0);
  assert.ok(fxAt < stockAt, 'FX resolution must precede the stock decrement');
});

test('seeded rates are backdated so the first real refresh wins', () => {
  assert.match(sql, /'seed', '2026-01-01'::timestamptz/);
  assert.match(sql, /on conflict \(currency\) do nothing/);
});

test('a manually pinned rate survives automatic refreshes', () => {
  assert.ok(upsert, 'upsert_fx_rates must exist');
  assert.match(upsert, /where public\.fx_rates\.source <> 'manual' or p_source = 'manual'/);
});

test('upsert rejects implausible rates', () => {
  assert.match(upsert, /if v_rate is null or v_rate <= 0 or v_rate > 100000 then\s*\n\s*continue;/);
});

test('place_order stays off-limits to the anon key', () => {
  assert.match(sql, /revoke all on function public\.place_order\([^)]*\) from public, anon/);
  assert.match(sql, /grant execute on function public\.place_order\([^)]*\) to authenticated/);
});
