import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260919_product_name_enrichment.sql', import.meta.url), 'utf8');
const store = fs.readFileSync(new URL('../src/store/useStore.ts', import.meta.url), 'utf8');
const db = fs.readFileSync(new URL('../src/lib/db.ts', import.meta.url), 'utf8');

test('migration adds public-safe English-name and SEO product fields', () => {
  for (const column of [
    'name_en', 'seo_slug', 'seo_title', 'seo_description', 'search_aliases',
    'name_en_status', 'name_en_confidence', 'name_en_source',
    'name_en_generated_at', 'name_en_approved_at', 'name_en_approved_by',
  ]) {
    assert.match(migration, new RegExp(`add column if not exists ${column}\\b`), column);
  }
  assert.match(migration, /products_seo_slug_key/);
  assert.match(migration, /where seo_slug is not null/);
});

test('workflow constraints enumerate supported statuses and sources', () => {
  for (const status of ['pending', 'auto_approved', 'review_required', 'human_approved', 'failed']) {
    assert.match(migration, new RegExp(`'${status}'`));
  }
  for (const source of ['official', 'grounded', 'generated', 'manual']) {
    assert.match(migration, new RegExp(`'${source}'`));
  }
  assert.match(migration, /name_en_confidence >= 0 and name_en_confidence <= 1/);
});

test('AI details stay in an admin-only audit table', () => {
  assert.match(migration, /create table if not exists public\.product_name_enrichment_runs/);
  for (const provider of ['gemini', 'openai', 'anthropic', 'qwen', 'deepseek']) {
    assert.match(migration, new RegExp(`'${provider}'`));
  }
  assert.match(migration, /alter table public\.product_name_enrichment_runs enable row level security/);
  assert.match(migration, /for select using \(public\.is_admin\(\)\)/);
  assert.match(migration, /for insert with check \(public\.is_admin\(\)\)/);
  assert.match(migration, /for update using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/);
  assert.match(migration, /for delete using \(public\.is_admin\(\)\)/);
});

test('Product type and Supabase converters map every new public field', () => {
  for (const field of [
    'nameEnStatus', 'nameEnConfidence', 'nameEnSource', 'nameEnGeneratedAt',
    'nameEnApprovedAt', 'nameEnApprovedBy', 'seoSlug', 'seoTitle',
    'seoDescription', 'searchAliases',
  ]) {
    assert.match(store, new RegExp(`${field}\\?`), `Product.${field}`);
    assert.match(db, new RegExp(`${field}:`), `rowToProduct ${field}`);
  }
  for (const column of [
    'name_en_status', 'name_en_confidence', 'name_en_source', 'name_en_generated_at',
    'name_en_approved_at', 'name_en_approved_by', 'seo_slug', 'seo_title',
    'seo_description', 'search_aliases',
  ]) {
    assert.match(db, new RegExp(`row\\.${column}`), `productToRow ${column}`);
  }
});
