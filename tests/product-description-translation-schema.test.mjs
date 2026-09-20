import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(
  new URL('../supabase/migrations/20260924_product_description_translation.sql', import.meta.url),
  'utf8',
);

test('adds description_i18n columns with a bounded status check', () => {
  for (const col of ['description_i18n', 'description_i18n_status', 'description_i18n_generated_at', 'description_i18n_manual_locked']) {
    assert.match(sql, new RegExp(`add column if not exists ${col}\\b`), col);
  }
  assert.match(sql, /description_i18n jsonb not null default '\{\}'::jsonb/);
  assert.match(sql, /description_i18n_status in \('pending', 'auto_approved', 'review_required', 'failed', 'human_locked'\)/);
});

test('exposes description_i18n on the public catalogue view', () => {
  assert.match(sql, /drop view if exists public\.products_public/);
  assert.match(sql, /create view public\.products_public/);
  assert.match(sql, /description, description_i18n, stock/);
  assert.match(sql, /grant select on public\.products_public to anon, authenticated/);
});

test('recreates products_admin so SELECT * picks up the new columns', () => {
  assert.match(sql, /drop view if exists public\.products_admin/);
  assert.match(sql, /create view public\.products_admin\s+as\s+select \* from public\.products/s);
  assert.match(sql, /with local check option/);
  assert.match(sql, /grant select, insert, update, delete on public\.products_admin to authenticated/);
});

test('queue table mirrors the enrichment worker machinery', () => {
  assert.match(sql, /create table if not exists public\.product_description_translation_runs/);
  for (const col of ['target_langs', 'source_payload', 'result_payload', 'validation_payload', 'lease_owner', 'lease_expires_at', 'available_at', 'priority', 'max_attempts']) {
    assert.match(sql, new RegExp(`\\b${col}\\b`), col);
  }
  assert.match(sql, /max_attempts between 1 and 10/);
  assert.match(sql, /status.*in \('queued', 'running', 'succeeded', 'review_required', 'failed', 'skipped'\)/s);
  assert.match(sql, /product_description_translation_runs_active_job_key/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /pdtr_admin_all/);
});

test('claim RPC is admin-guarded and skips locked rows', () => {
  assert.match(sql, /function public\.claim_product_description_translations/);
  assert.match(sql, /if not public\.is_admin\(\)/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /r\.lease_expires_at < now\(\)/);
  assert.match(sql, /attempt = r\.attempt \+ 1/);
  assert.match(sql, /returning r\.\*/);
});

test('completion merges translations and respects the human lock', () => {
  assert.match(sql, /function public\.complete_product_description_translation/);
  // jsonb merge of clean languages
  assert.match(sql, /description_i18n = coalesce\(description_i18n, '\{\}'::jsonb\) \|\| coalesce\(p_translations, '\{\}'::jsonb\)/);
  assert.match(sql, /description_i18n_manual_locked = false/);
  assert.match(sql, /description_i18n_status <> 'human_locked'/);
  assert.match(sql, /when not v_applied then 'skipped'/);
});

test('failure RPC retries with a bounded delay and only fails pending products', () => {
  assert.match(sql, /function public\.fail_product_description_translation/);
  assert.match(sql, /v_run\.attempt >= v_run\.max_attempts/);
  assert.match(sql, /greatest\(1, least\(86400, p_retry_delay_seconds\)\)/);
  assert.match(sql, /and description_i18n_status = 'pending'/);
});

test('enqueue is idempotent and resets publish status unless locked', () => {
  assert.match(sql, /function public\.enqueue_product_description_translation/);
  assert.match(sql, /status in \('queued', 'running', 'succeeded', 'review_required'\)/);
  assert.match(sql, /set description_i18n_status = 'pending'/);
  assert.match(sql, /description_i18n_manual_locked = false/);
  assert.match(sql, /when unique_violation then/);
});

test('all translation RPCs revoke public and grant authenticated execution', () => {
  const functions = [
    'enqueue_product_description_translation',
    'claim_product_description_translations',
    'complete_product_description_translation',
    'fail_product_description_translation',
  ];
  for (const name of functions) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[^;]+ from public;`, 's'), name);
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[^;]+ to authenticated;`, 's'), name);
  }
});

test('translation queue never mutates name/price/storefront-status fields', () => {
  // The completion RPC's UPDATE on public.products must only touch description_i18n*.
  const start = sql.indexOf('-- Merge the clean languages');
  const updateBlock = sql.slice(start, sql.indexOf(';', sql.indexOf('description_i18n_status <> ', start)));
  assert.match(updateBlock, /update public\.products/);
  assert.doesNotMatch(updateBlock, /\bname_en\b/);
  assert.doesNotMatch(updateBlock, /\bwholesale_price\b|\boriginal_price\b/);
  // storefront status column (products.status) — must not be set here.
  assert.doesNotMatch(updateBlock, /\bset status\b|,\s*status\s*=/);
  assert.doesNotMatch(updateBlock, /\bstock\s*=/);
});
