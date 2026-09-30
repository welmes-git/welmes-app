import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  queryCatalogLocally, facetsLocally, queryAdminLocally, searchTokens,
} from '../src/lib/catalogQuery.ts';
import { loadCached, peekCached, clearCatalogCache } from '../src/lib/catalogCache.ts';

const P = (id, over = {}) => ({
  id, name: `商品${id}`, nameEn: `Product ${id}`, brand: 'B', category: 'Skincare', tags: [], searchAliases: [],
  description: '', wholesalePrice: id * 100, originalPrice: id * 150, discount: 0, reviews: 0,
  createdAt: '2026-09-30T00:00:00Z', ...over,
});

// Bulk imports share a created_at, so id must break ties (newest first).
const catalogue = [
  P(1, { brand: '貝印', reviews: 5, discount: 10, createdAt: '2026-09-01T00:00:00Z' }),
  P(2, { brand: 'ビオレ', nameEn: 'Bioré UV Aqua Rich SPF50+', category: 'Sun Care', reviews: 5 }),
  P(3, { brand: 'ビオレ', name: 'ビオレ 洗顔', discount: 30 }),
  P(4, { brand: '貝印', status: 'inactive' }),
  P(5, { brand: 'ホーユー', wholesalePrice: 50 }),
];

test('default (popular) ranks by reviews, then newest created_at, then id', () => {
  const { total, items } = queryCatalogLocally(catalogue, {}, { canSeePrices: true });
  assert.equal(total, 5);
  assert.deepEqual(items.map((p) => p.id), [2, 1, 5, 4, 3]);
});

test('every sort breaks ties deterministically and paging never overlaps', () => {
  for (const sort of ['popular', 'price-low', 'price-high', 'newest', 'discount', 'recent']) {
    const all = queryCatalogLocally(catalogue, { sort, limit: 100 }, { canSeePrices: true }).items.map((p) => p.id);
    const paged = [0, 2, 4].flatMap((offset) =>
      queryCatalogLocally(catalogue, { sort, limit: 2, offset }, { canSeePrices: true }).items.map((p) => p.id));
    assert.deepEqual(paged, all, sort);
    assert.equal(new Set(all).size, 5, sort);
  }
});

test('inactive products stay listed (visibility policy unchanged)', () => {
  const ids = queryCatalogLocally(catalogue, { brands: ['貝印'] }, { canSeePrices: false }).items.map((p) => p.id);
  assert.deepEqual(ids.sort(), [1, 4]);
});

test('search uses the storefront normaliser and AND-matches tokens', () => {
  const q = (search) => queryCatalogLocally(catalogue, { search }, { canSeePrices: true }).items.map((p) => p.id).sort();
  assert.deepEqual(q('biore'), [2]);
  assert.deepEqual(q('ＢＩＯＲＥ spf50'), [2]);
  assert.deepEqual(q('ビオレ'), [2, 3]);
  assert.deepEqual(q('ビオレ 洗顔'), [3]);
  assert.deepEqual(q('   '), [1, 2, 3, 4, 5]);
  assert.equal(searchTokens('a b c d e f g h i j k l').length, 10);
});

test('price filter and price sorts are ignored for viewers without prices', () => {
  const opts = { priceMin: 150, priceMax: 350, sort: 'price-low' };
  assert.deepEqual(queryCatalogLocally(catalogue, opts, { canSeePrices: true }).items.map((p) => p.id), [2, 3]);
  const guest = queryCatalogLocally(catalogue, opts, { canSeePrices: false });
  assert.equal(guest.total, 5);
  assert.deepEqual(guest.items.map((p) => p.id), [5, 4, 3, 2, 1], 'falls back to recent');
});

test('limit is clamped to 1..100 and offset past the end is empty', () => {
  assert.equal(queryCatalogLocally(catalogue, { limit: 0 }, { canSeePrices: true }).items.length, 1);
  assert.equal(queryCatalogLocally(catalogue, { offset: 99 }, { canSeePrices: true }).items.length, 0);
});

test('facets count brands and hide price bounds from guests', () => {
  const f = facetsLocally(catalogue, { canSeePrices: true });
  assert.deepEqual(f.brands, [['ビオレ', 2], ['貝印', 2], ['ホーユー', 1]]);
  assert.deepEqual([f.total, f.priceMin, f.priceMax], [5, 50, 400]);
  const g = facetsLocally(catalogue, { canSeePrices: false });
  assert.deepEqual([g.priceMin, g.priceMax], [0, 0]);
});

test('admin query: id search, name status, id list, own stock', () => {
  const q = (query, extra) => queryAdminLocally(catalogue, query, extra).ids;
  assert.deepEqual(q({ search: '3' }), [3]);
  assert.deepEqual(q({ nameStatus: 'pending' }), [5, 4, 3, 2, 1], 'missing status counts as pending');
  assert.deepEqual(q({ ids: [] }), []);
  assert.deepEqual(q({ ids: [1, 3] }), [3, 1]);
  assert.deepEqual(q({ ownStockOnly: true }, { externalSupplyIds: new Set([2, 5]) }), [4, 3, 1]);
  const page = queryAdminLocally(catalogue, { limit: 2, offset: 2 });
  assert.equal(page.total, 5);
  assert.deepEqual(page.items.map((p) => p.id), [3, 2]);
});

test('catalogCache shares in-flight requests, serves hits synchronously, does not cache failures', async () => {
  clearCatalogCache();
  let calls = 0;
  const load = async () => { calls++; return 42; };
  const [a, b] = await Promise.all([loadCached('k', load), loadCached('k', load)]);
  assert.deepEqual([a, b, calls], [42, 42, 1]);
  assert.deepEqual(peekCached('k'), { hit: true, value: 42 });
  await assert.rejects(loadCached('bad', async () => { throw new Error('x'); }));
  assert.equal(peekCached('bad').hit, false);
  clearCatalogCache();
  assert.equal(peekCached('k').hit, false);
});

test('migration keeps visibility, price gating and privileges in place', () => {
  const sql = fs.readFileSync(new URL('../supabase/migrations/20261005_catalog_pagination.sql', import.meta.url), 'utf8');
  const listBody = sql.slice(sql.indexOf('create or replace function public.catalog_list'), sql.indexOf('-- ── 5.'));
  assert.doesNotMatch(listBody, /status\s*=\s*'active'/, 'storefront must not start hiding inactive products');
  assert.match(sql, /opt - 'sourcePrice'/, 'purchase price stripped from set options');
  assert.match(sql, /if not public\.is_admin\(\) then\s+raise exception 'admin only'/);
  for (const helper of ['catalog_card_json', 'catalog_detail_json', 'catalog_can_see_prices', 'catalog_strip_source_price']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${helper}\\([^)]*\\)\\s+from public, anon, authenticated`), helper);
  }
  assert.match(sql, /revoke all on function public\.admin_product_page\([^)]*\) from public, anon;/);
  assert.match(sql, /least\(greatest\(coalesce\(p_limit, 60\), 1\), 100\)/, 'page size capped');
});
