import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { listIndexableProducts, loadPublicProduct, publicRowToProduct } from '../server/catalog.mjs';

const sql = fs.readFileSync(new URL('../supabase/migrations/20260922_product_publication_seo.sql', import.meta.url), 'utf8');
const cutoverSql = fs.readFileSync(new URL('../supabase/migrations/20260923_products_access_cutover.sql', import.meta.url), 'utf8');
const fullSql = `${sql}\n${cutoverSql}`;

test('public catalogue projection excludes prices, set pricing and supplier metadata', () => {
  const publicSelect = sql.match(/create or replace view public\.products_public[\s\S]*?from public\.products;/i)?.[0] || '';
  assert.ok(publicSelect);
  for (const forbidden of ['wholesale_price', 'original_price', 'set_options', 'sd_dealer_id', 'sd_product_id', 'name_en_confidence']) {
    assert.doesNotMatch(publicSelect, new RegExp(forbidden), forbidden);
  }
  assert.match(cutoverSql, /alter table public\.products enable row level security/);
  assert.match(cutoverSql, /drop policy if exists "products_select"/);
  assert.match(cutoverSql, /products_admin_direct_access/);
  assert.match(cutoverSql, /revoke all on public\.products from anon, authenticated/);
  assert.match(sql, /product_prices_approved/);
  assert.match(sql, /m\.status = 'approved'/);
});

test('publication requires approved English naming and automatic publication requires 28-day metrics', () => {
  assert.match(fullSql, /name_en_status[\s\S]*not in \('auto_approved', 'human_approved'\)/);
  assert.match(fullSql, /pilot_started_at \+ interval '28 days'/);
  assert.match(fullSql, /join runs r on r\.id = s\.run_id/);
  assert.match(fullSql, /r\.status = 'succeeded'/);
  assert.match(fullSql, /minimum_precision/);
  assert.match(fullSql, /maximum_edit_rate/);
  assert.match(fullSql, /maximum_review_rate/);
  assert.match(fullSql, /percentile_cont\(0\.95\)/);
});

test('server public product mapper never carries real prices or set pricing', () => {
  const product = publicRowToProduct({ id: 1, name: 'N', name_en: 'English', status: 'active', wholesale_price: 9999, original_price: 12000, set_options: [{ wholesalePrice: 1 }] });
  assert.equal(product.wholesalePrice, 0);
  assert.equal(product.originalPrice, 0);
  assert.deepEqual(product.setOptions, []);
});

test('server loader queries products_public with a positive id only', async () => {
  let requested = '';
  const fetchImpl = async (url) => {
    requested = String(url);
    return new Response(JSON.stringify([{ id: 7, name: 'N', name_en: 'Name', status: 'active' }]), { status: 200 });
  };
  const product = await loadPublicProduct(7, { env: { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon' }, fetchImpl });
  assert.equal(product.id, 7);
  assert.match(requested, /products_public/);
  assert.doesNotMatch(requested, /wholesale_price|original_price|set_options/);
  assert.equal(await loadPublicProduct(-1, { fetchImpl }), null);
});

test('sitemap catalogue loader paginates until the final partial page', async () => {
  const offsets = [];
  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const offset = Number(parsed.searchParams.get('offset'));
    offsets.push(offset);
    const size = offset === 0 ? 1000 : 2;
    const rows = Array.from({ length: size }, (_, index) => ({
      id: offset + index + 1, name: 'N', name_en: 'Name', seo_slug: `name-${offset + index + 1}`,
      name_en_status: 'auto_approved', status: 'active',
    }));
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  const rows = await listIndexableProducts({ env: { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon' }, fetchImpl });
  assert.equal(rows.length, 1002);
  assert.deepEqual(offsets, [0, 1000]);
});
