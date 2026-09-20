import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260920_product_name_enrichment_worker.sql', import.meta.url), 'utf8');

test('official source registry is admin-only and domain constrained', () => {
  assert.match(sql, /create table if not exists public\.brand_official_sources/);
  assert.match(sql, /official_domain = lower\(official_domain\)/);
  assert.match(sql, /enable row level security/);
  for (const operation of ['select', 'insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`brand_official_sources_admin_${operation}`));
  }
  assert.match(sql, /'ビオレ', 'Biore', 'kao\.com'/);
});

test('queue adds bounded attempts, availability and lease fields', () => {
  for (const column of ['priority', 'max_attempts', 'available_at', 'lease_owner', 'lease_expires_at', 'updated_at']) {
    assert.match(sql, new RegExp(`add column if not exists ${column}\\b`), column);
  }
  assert.match(sql, /max_attempts between 1 and 10/);
  assert.match(sql, /status in \('queued', 'running', 'succeeded', 'review_required', 'failed', 'skipped'\)/);
  assert.match(sql, /product_name_enrichment_runs_active_job_key/);
});

test('claim RPC is admin-guarded and atomically skips locked rows', () => {
  assert.match(sql, /function public\.claim_product_name_enrichments/);
  assert.match(sql, /if not public\.is_admin\(\)/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /r\.lease_expires_at < now\(\)/);
  assert.match(sql, /attempt = r\.attempt \+ 1/);
  assert.match(sql, /returning r\.\*/);
});

test('completion RPC protects human-approved names and updates explicit fields only', () => {
  assert.match(sql, /function public\.complete_product_name_enrichment/);
  assert.match(sql, /and name_en_status <> 'human_approved'/);
  assert.match(sql, /when not v_applied then 'skipped'/);
  for (const field of ['name_en', 'seo_slug', 'seo_title', 'seo_description', 'search_aliases', 'name_en_status']) {
    assert.match(sql, new RegExp(`${field} =`), field);
  }
  assert.doesNotMatch(sql, /jsonb_populate_record/);
});

test('failure RPC retries with a bounded delay and only marks pending products failed', () => {
  assert.match(sql, /function public\.fail_product_name_enrichment/);
  assert.match(sql, /v_run\.attempt >= v_run\.max_attempts/);
  assert.match(sql, /greatest\(1, least\(86400, p_retry_delay_seconds\)\)/);
  assert.match(sql, /and name_en_status = 'pending'/);
});

test('all worker RPCs revoke public and grant authenticated execution', () => {
  const functions = [
    'enqueue_product_name_enrichment',
    'claim_product_name_enrichments',
    'complete_product_name_enrichment',
    'fail_product_name_enrichment',
  ];
  for (const name of functions) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${name}[^;]+ from public;`, 's'), name);
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}[^;]+ to authenticated;`, 's'), name);
  }
});


test('targeted claims, review-only candidates, and terminal errors are enforced', () => {
  assert.match(sql, /p_product_ids bigint\[\] default null/);
  assert.match(sql, /p_product_ids is null or r\.product_id = any\(p_product_ids\)/);
  assert.match(sql, /name_en = case when p_name_status = 'auto_approved' then p_candidate_name else name_en end/);
  assert.match(sql, /when p_terminal or v_run\.attempt >= v_run\.max_attempts then 'failed'/);
});


test('JAN is persisted for grounding and completed identical inputs are idempotent', () => {
  assert.match(sql, /add column if not exists jan text/);
  assert.match(sql, /products_jan_format_check/);
  assert.match(sql, /jan ~ '\^\[0-9\]\{8,13\}\$'/);
  assert.match(sql, /status in \('queued', 'running', 'succeeded', 'review_required'\)/);
});
