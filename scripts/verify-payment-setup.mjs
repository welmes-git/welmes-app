#!/usr/bin/env node
// Verifies the checkout payment deployment against the LIVE project.
//
// Every probe is read-only. Nothing is inserted, updated or deleted: existence is
// established from error codes (a function that raises NOT_AUTHENTICATED exists;
// a column that does not exist makes PostgREST answer 400) and grants are
// established from `42501 permission denied`.
//
//   node scripts/verify-payment-setup.mjs
//
// Reads .env and .env.local. Optional extras unlock extra checks:
//   PAYPAL_CLIENT_SECRET       → validates the PayPal app and detects sandbox/live
//   SUPABASE_SERVICE_ROLE_KEY  → validates settlement access
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function loadEnv() {
  const env = { ...process.env };
  for (const file of ['.env', '.env.local']) {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) continue;
    for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!(key in env)) env[key] = trimmed.slice(eq + 1).trim();
    }
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const ANON_KEY = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const PAYPAL_ID = env.PAYPAL_CLIENT_ID || env.VITE_PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = env.PAYPAL_CLIENT_SECRET;

const results = [];
const record = (ok, label, detail) => {
  results.push({ ok, label, detail });
  const mark = ok === true ? '✔' : ok === null ? '·' : '✖';
  console.log(`${mark} ${label}${detail ? `\n    ${detail}` : ''}`);
};

const headers = (key) => ({ apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' });

async function rpc(name, body, key = ANON_KEY) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: headers(key), body: JSON.stringify(body),
  });
  let parsed = {};
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { status: res.status, message: parsed.message ?? parsed.raw ?? '', code: parsed.code ?? '' };
}

async function columnExists(column) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/orders?select=${column}&limit=1`, { headers: headers(ANON_KEY) });
  return res.status === 200;
}

const PLACE_ORDER_ARGS = {
  p_items: [], p_shipping: {}, p_payment_method: 'bank_transfer',
  p_po_number: null, p_notes: null, p_charge_currency: null,
  p_fx_rate: null, p_idempotency_key: null,
};

// ── Step 1: additive migration ─────────────────────────────────────────────
async function checkStep1() {
  console.log('\n── Step 1 — 20260926_secure_checkout.sql ──');

  const probe = await rpc('place_order', PLACE_ORDER_ARGS);
  // Reaching the function's own auth guard proves it exists with this exact
  // 8-argument signature, which is what src/lib/db.ts sends.
  record(
    probe.message === 'NOT_AUTHENTICATED',
    'place_order exists with the expected signature',
    probe.message === 'NOT_AUTHENTICATED' ? null : `got ${probe.status} ${probe.code} ${probe.message} — migration not applied?`,
  );

  for (const column of ['payment_method', 'payment_status', 'payment_reference', 'charge_currency', 'charge_amount', 'fx_rate', 'paid_at', 'idempotency_key']) {
    const ok = await columnExists(column);
    record(ok, `orders.${column} exists`, ok ? null : 'column missing — re-run step 1');
  }

  for (const fn of [
    ['mark_order_paid', { p_order_id: 'x', p_reference: 'x', p_amount: 1, p_currency: 'USD' }],
    ['fail_order_payment', { p_order_id: 'x', p_reason: 'x', p_reference: null }],
    ['cancel_unpaid_order', { p_order_id: 'x', p_reason: 'x' }],
  ]) {
    const res = await rpc(fn[0], fn[1]);
    const denied = res.code === '42501';
    record(denied, `${fn[0]} is NOT callable with the public anon key`, denied ? null : `got ${res.status} ${res.code} ${res.message} — buyers may be able to mark orders paid`);
  }
}

// ── Step 4: lockdown ───────────────────────────────────────────────────────
async function checkStep4() {
  console.log('\n── Step 4 — 20260927_secure_checkout_lockdown.sql ──');

  for (const fn of ['decrement_product_stock', 'restore_product_stock']) {
    const res = await rpc(fn, { p_items: [] });
    const denied = res.code === '42501';
    record(
      denied,
      `${fn} is NOT callable with the public anon key`,
      denied ? null : `got ${res.status} ${res.code || 'success'} — anyone holding the anon key can change stock without logging in. Apply the lockdown migration.`,
    );
  }

  const place = await rpc('place_order', PLACE_ORDER_ARGS);
  const denied = place.code === '42501';
  record(
    denied,
    'place_order is NOT callable with the public anon key',
    denied ? null : 'still reachable by anon; the function rejects it internally (NOT_AUTHENTICATED) so this is defence-in-depth, not a hole.',
  );
}

// ── PayPal credentials ─────────────────────────────────────────────────────
async function checkPayPal() {
  console.log('\n── PayPal credentials ──');
  if (!PAYPAL_ID) return record(false, 'PAYPAL_CLIENT_ID / VITE_PAYPAL_CLIENT_ID is set');
  record(true, 'client id is present');

  if (!PAYPAL_SECRET) {
    return record(null, 'PAYPAL_CLIENT_SECRET not available locally — skipped', 'set it in .env.local to let this script detect sandbox vs live for you');
  }

  const auth = Buffer.from(`${PAYPAL_ID}:${PAYPAL_SECRET}`).toString('base64');
  const working = [];
  for (const [label, base] of [['sandbox', 'https://api-m.sandbox.paypal.com'], ['live', 'https://api-m.paypal.com']]) {
    try {
      const res = await fetch(`${base}/v1/oauth2/token`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials',
      });
      if (res.ok) working.push(label);
    } catch { /* network — reported by the summary below */ }
  }

  if (working.length === 0) {
    return record(false, 'PayPal credentials rejected by both sandbox and live', 'the client id and secret must come from the same app');
  }
  record(true, `PayPal credentials valid on: ${working.join(', ')}`, `set PAYPAL_ENV=${working[0]}`);

  const configured = env.PAYPAL_ENV;
  if (configured) {
    const matches = working.includes(configured);
    record(matches, `PAYPAL_ENV=${configured} matches the credentials`, matches ? null : `credentials only work on ${working.join(', ')} — order creation will fail with PAYPAL_HTTP_401`);
  } else {
    record(null, 'PAYPAL_ENV not set locally', `use "${working[0]}" on Vercel`);
  }
}

// ── Service role ───────────────────────────────────────────────────────────
async function checkServiceRole() {
  console.log('\n── Supabase service role ──');
  if (!SERVICE_KEY) {
    return record(null, 'SUPABASE_SERVICE_ROLE_KEY not available locally — skipped', 'only needed on Vercel; set it here too if you want this check');
  }
  // Probing with an id that cannot exist proves the grant without writing.
  const res = await rpc('mark_order_paid', {
    p_order_id: '__verify_probe_does_not_exist__', p_reference: 'probe', p_amount: 1, p_currency: 'USD',
  }, SERVICE_KEY);
  const granted = res.message === 'ORDER_NOT_FOUND';
  record(granted, 'service role can call mark_order_paid', granted ? null : `got ${res.status} ${res.code} ${res.message}`);
}

// ── Run ────────────────────────────────────────────────────────────────────
if (!SUPABASE_URL || !ANON_KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — cannot probe the project.');
  process.exit(2);
}

console.log(`Project: ${SUPABASE_URL}`);
await checkStep1();
await checkStep4();
await checkPayPal();
await checkServiceRole();

const failed = results.filter((r) => r.ok === false);
const skipped = results.filter((r) => r.ok === null);
console.log(`\n${results.length - failed.length - skipped.length} passed, ${failed.length} failed, ${skipped.length} skipped`);
if (failed.length > 0) {
  console.log('\nFailed:');
  for (const f of failed) console.log(`  ✖ ${f.label}`);
}
process.exit(failed.length > 0 ? 1 : 0);
