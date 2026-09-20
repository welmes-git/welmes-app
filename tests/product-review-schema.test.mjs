import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260920_product_name_review.sql', import.meta.url), 'utf8');

test('approval RPC is admin guarded and rejects stale run/timestamp and Japanese names', () => {
  assert.match(sql, /function public\.approve_product_name_review/);
  assert.match(sql, /if not public\.is_admin\(\)/);
  assert.match(sql, /name_en_generated_at is distinct from p_expected_generated_at/);
  assert.match(sql, /v_latest_run_id is distinct from p_expected_run_id/);
  assert.match(sql, /public\.contains_japanese\(v_name\)/);
  assert.match(sql, /seo_slug = coalesce\(seo_slug/);
});

test('regeneration clones the reviewed immutable run into a real queued job atomically', () => {
  const fn = sql.match(/create or replace function public\.request_product_name_regeneration[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(fn, /returns uuid/);
  assert.match(fn, /status = 'skipped'/);
  assert.match(fn, /insert into public\.product_name_enrichment_runs/);
  assert.match(fn, /source_payload, 'queued'/);
  assert.match(fn, /return v_queued_run_id/);
  assert.match(fn, /name_en_status = 'pending'/);
});

test('human review writes a measurable pilot quality sample', () => {
  assert.match(sql, /create table if not exists public\.product_name_quality_samples/);
  assert.match(sql, /insert into public\.product_name_quality_samples/);
  assert.match(sql, /correct_without_edit/);
  assert.match(sql, /on conflict \(product_id, run_id\) do update/);
});
