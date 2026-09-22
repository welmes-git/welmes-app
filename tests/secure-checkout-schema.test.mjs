// Guards the invariants of 20260926_secure_checkout.sql. The migration exists
// because `orders_insert` RLS only checked ownership, so a signed-in buyer could
// INSERT any `total` they liked, and because nothing recorded how an order was
// paid.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260926_secure_checkout.sql', import.meta.url), 'utf8');
// The lockdown lives in its own migration so the additive half can be applied
// while the old frontend is still serving traffic.
const lockdown = fs.readFileSync(new URL('../supabase/migrations/20260927_secure_checkout_lockdown.sql', import.meta.url), 'utf8');
const placeOrder = sql.match(/create or replace function public\.place_order[\s\S]*?\n\$\$;/)?.[0] || '';
const markPaid = sql.match(/create or replace function public\.mark_order_paid[\s\S]*?\n\$\$;/)?.[0] || '';
const cancel = sql.match(/create or replace function public\.cancel_unpaid_order[\s\S]*?\n\$\$;/)?.[0] || '';

test('the additive migration does not break the currently deployed frontend', () => {
  // Deploy safety: step 1 must not revoke anything the live build still needs.
  assert.doesNotMatch(sql, /drop policy if exists "orders_insert"/);
  assert.doesNotMatch(sql, /revoke insert on public\.orders/);
  assert.doesNotMatch(sql, /revoke execute on function public\.decrement_product_stock/);
});

test('the browser can no longer write orders directly', () => {
  assert.match(lockdown, /drop policy if exists "orders_insert" on public\.orders/);
  assert.match(lockdown, /drop policy if exists "order_items_insert" on public\.order_items/);
  assert.match(lockdown, /revoke insert on public\.orders\s+from authenticated, anon/);
  assert.match(lockdown, /revoke insert on public\.order_items from authenticated, anon/);
});

test('stock can only be moved by place_order, not by the client', () => {
  // `public` must be revoked, not just anon/authenticated: PostgreSQL grants
  // EXECUTE on new functions to PUBLIC by default, and 20260708_stock_management
  // never revoked it. Production answered 204 to an anon
  // POST /rest/v1/rpc/decrement_product_stock because of exactly that.
  assert.match(lockdown, /revoke all on function public\.decrement_product_stock\(jsonb\) from public, anon, authenticated/);
  assert.match(lockdown, /revoke all on function public\.restore_product_stock\(jsonb\)\s+from public, anon, authenticated/);
});

test('place_order is not reachable with the public anon key', () => {
  assert.match(lockdown, /revoke all on function public\.place_order\([^)]*\) from public, anon/);
  assert.match(lockdown, /grant execute on function public\.place_order\([^)]*\) to authenticated/);
});

test('place_order prices from the catalogue and ignores client money', () => {
  assert.ok(placeOrder, 'place_order must exist');
  assert.match(placeOrder, /security definer/);
  // Prices are read from products / set_options, never from p_items
  assert.match(placeOrder, /v_unit_price\s*:=\s*\(v_set->>'wholesalePrice'\)::numeric/);
  assert.match(placeOrder, /v_unit_price\s*:=\s*v_product\.wholesale_price::numeric/);
  assert.match(placeOrder, /v_vat\s*:=\s*round\(v_subtotal \* c_vat_rate\)/);
  assert.match(placeOrder, /v_total\s*:=\s*v_subtotal \+ v_vat/);
  // p_items may only contribute ids/quantities
  assert.doesNotMatch(placeOrder, /v_item->>'(price|wholesalePrice|subtotal|total|vat)'/);
});

test('place_order authenticates, requires approval, and validates input', () => {
  assert.match(placeOrder, /where auth_id = auth\.uid\(\)/);
  assert.match(placeOrder, /raise exception 'NOT_AUTHENTICATED'/);
  assert.match(placeOrder, /v_member\.status <> 'approved'/);
  assert.match(placeOrder, /raise exception 'MEMBER_NOT_APPROVED'/);
  assert.match(placeOrder, /raise exception 'EMPTY_CART'/);
  assert.match(placeOrder, /raise exception 'INVALID_QUANTITY'/);
  assert.match(placeOrder, /raise exception 'INVALID_SHIPPING'/);
  assert.match(placeOrder, /v_product\.status <> 'active'/);
});

test('stock is locked, checked and taken inside the order transaction', () => {
  assert.match(placeOrder, /from public\.products\s*\n?\s*where id = \(v_item->>'product_id'\)::int for update/);
  assert.match(placeOrder, /v_units\s*:=\s*v_qty \* greatest\(v_units_per_set, 1\)/);
  assert.match(placeOrder, /raise exception 'INSUFFICIENT_STOCK:%'/);
  assert.match(placeOrder, /update public\.products set stock = stock - v_units/);
});

test('a retried submit resolves to the original order instead of a second one', () => {
  assert.match(placeOrder, /idempotency_key = p_idempotency_key/);
  assert.match(placeOrder, /'reused',\s*true/);
  assert.match(sql, /create unique index if not exists orders_idempotency_key_uniq/);
});

test('the charge currency and amount are frozen on the order', () => {
  assert.match(sql, /add column if not exists charge_currency\s+text/);
  assert.match(sql, /add column if not exists charge_amount\s+numeric\(14,2\)/);
  assert.match(sql, /add column if not exists fx_rate\s+numeric\(18,8\)/);
  assert.match(placeOrder, /charge_amount\s*=\s*v_charge_amount/);
  // zero-decimal currencies must not be quoted with cents
  assert.match(placeOrder, /upper\(p_charge_currency\) in \('JPY','KRW','CNY'\) then 0 else 2/);
});

test('item snapshots stay in the camelCase shape the client reads back', () => {
  assert.match(placeOrder, /'wholesalePrice',\s*v_unit_price/);
  assert.match(placeOrder, /'nameI18n'/);
  assert.match(placeOrder, /'originalPrice'/);
});

test('payment ledger columns exist and are constrained', () => {
  for (const column of [
    'payment_method', 'payment_status', 'payment_reference',
    'paid_amount', 'paid_currency', 'paid_at', 'payment_error',
  ]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`), `${column} missing`);
  }
  assert.match(sql, /check \(payment_method in \('bank_transfer','paypal'\)\)/);
  assert.match(sql, /check \(payment_status in \('unpaid','paid','failed','refunded'\)\)/);
});

test('mark_order_paid re-checks the money and is idempotent', () => {
  assert.ok(markPaid, 'mark_order_paid must exist');
  assert.match(markPaid, /where id = p_order_id for update/);
  assert.match(markPaid, /raise exception 'AMOUNT_MISMATCH/);
  assert.match(markPaid, /raise exception 'CURRENCY_MISMATCH/);
  assert.match(markPaid, /already_paid', true/);
  assert.match(markPaid, /ALREADY_PAID_WITH_DIFFERENT_REFERENCE/);
});

test('a capture id cannot be attached to two orders', () => {
  assert.match(sql, /create unique index if not exists orders_payment_reference_key\s*\n\s*on public\.orders \(payment_reference\)/);
});

test('buyers cannot mark their own orders paid', () => {
  assert.match(sql, /revoke all on function public\.mark_order_paid\(text, text, numeric, text\)\s+from authenticated, anon, public/);
  assert.match(sql, /grant execute on function public\.mark_order_paid\(text, text, numeric, text\) to service_role/);
  assert.doesNotMatch(sql, /grant execute on function public\.mark_order_paid[^\n]*to authenticated/);
  assert.match(sql, /grant execute on function public\.place_order\(jsonb, jsonb, text, text, text, text, numeric, text\) to authenticated/);
});

test('cancelling an unpaid order returns the stock exactly once', () => {
  assert.ok(cancel, 'cancel_unpaid_order must exist');
  assert.match(cancel, /CANNOT_CANCEL_PAID_ORDER/);
  assert.match(cancel, /if v_order\.status = 'cancelled' then\s*\n\s*return;/);
  assert.match(cancel, /update public\.products\s*\n?\s*set stock = stock \+ v_units/);
  assert.match(cancel, /status\s*=\s*'cancelled'/);
});
