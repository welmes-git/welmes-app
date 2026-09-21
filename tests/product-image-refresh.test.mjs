import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isStorageUrl,
  sdIdFromImageUrl,
  selectImageRefreshTargets,
  classifyImageRefresh,
  summarizeImageRefresh,
  nextImageRefreshCursor,
  buildImageUpdatePatch,
} from '../scripts/lib/product-image-refresh.mjs';
import { parseRefreshArgs } from '../scripts/refresh-product-images.mjs';

const cdn = (sdId, n = 1000) => `https://c.superdelivery.com/ip/n/sa/600/600/www.superdelivery.com/product_image/013/178/322/${sdId}_${n}.jpg`;
const storage = (name) => `https://abc.supabase.co/storage/v1/object/public/product-images/products/${name}.jpg`;

test('isStorageUrl distinguishes Supabase Storage from SD CDN', () => {
  assert.equal(isStorageUrl(storage('1789369269799-j805lja56j')), true);
  assert.equal(isStorageUrl(cdn('13178322')), false);
  assert.equal(isStorageUrl(''), false);
});

test('sdIdFromImageUrl extracts the SD id from a CDN filename', () => {
  assert.equal(sdIdFromImageUrl(cdn('13178322')), '13178322');
  // Storage URLs carry no SD id — contamination is not judgeable from the URL
  assert.equal(sdIdFromImageUrl(storage('1789369269799-j805lja56j')), null);
  assert.equal(sdIdFromImageUrl(null), null);
});

test('selectImageRefreshTargets requires sd_product_id and orders by id', () => {
  const rows = [
    { id: 3, sd_product_id: '300', images: [1, 2] },
    { id: 1, sd_product_id: null, images: [1] },     // no SD id → cannot revisit
    { id: 2, sd_product_id: '200', images: [] },
  ];
  assert.deepEqual(selectImageRefreshTargets(rows).map((p) => p.id), [2, 3]);
});

test('selectImageRefreshTargets honors min-images, ids, after and limit', () => {
  const rows = [
    { id: 1, sd_product_id: 'a', images: new Array(8).fill('x') },
    { id: 2, sd_product_id: 'b', images: ['x'] },
    { id: 3, sd_product_id: 'c', images: new Array(8).fill('x') },
    { id: 4, sd_product_id: 'd', images: new Array(8).fill('x') },
  ];
  // only the capped/suspicious rows
  assert.deepEqual(selectImageRefreshTargets(rows, { minImages: 8 }).map((p) => p.id), [1, 3, 4]);
  // resume cursor is exclusive
  assert.deepEqual(selectImageRefreshTargets(rows, { minImages: 8, afterId: 1 }).map((p) => p.id), [3, 4]);
  // limit slices after ordering
  assert.deepEqual(selectImageRefreshTargets(rows, { minImages: 8, limit: 2 }).map((p) => p.id), [1, 3]);
  // allowlist
  assert.deepEqual(selectImageRefreshTargets(rows, { ids: [4] }).map((p) => p.id), [4]);
});

test('classifyImageRefresh flags the reported bug: 8 stored vs 1 scraped', () => {
  const product = { id: 39, sd_product_id: '13178322', images: new Array(8).fill(0).map((_, i) => storage(`f${i}`)) };
  const r = classifyImageRefresh(product, [cdn('13178322')]);
  assert.equal(r.verdict, 'contaminated');
  assert.equal(r.storedCount, 8);
  assert.equal(r.scrapedCount, 1);
  assert.equal(r.removedCount, 7);
  assert.equal(r.storedAllStorage, true);
  assert.equal(r.apply, true);
});

test('classifyImageRefresh never wipes images on an empty scrape', () => {
  const product = { id: 5, sd_product_id: '999', images: [cdn('999')] };
  const r = classifyImageRefresh(product, []);
  assert.equal(r.verdict, 'empty_scrape');
  assert.equal(r.apply, false); // critical: do not clear the storefront image
});

test('classifyImageRefresh treats equal counts as unchanged (idempotent re-run)', () => {
  const product = { id: 6, sd_product_id: '777', images: [cdn('777')] };
  const r = classifyImageRefresh(product, [cdn('777')]);
  assert.equal(r.verdict, 'unchanged');
  assert.equal(r.apply, false);
});

test('classifyImageRefresh reports more_found and still applies', () => {
  const product = { id: 7, sd_product_id: '555', images: [cdn('555', 1000)] };
  const r = classifyImageRefresh(product, [cdn('555', 1000), cdn('555', 1001)]);
  assert.equal(r.verdict, 'more_found');
  assert.equal(r.removedCount, 0);
  assert.equal(r.apply, true);
});

test('classifyImageRefresh counts stored CDN images belonging to other products', () => {
  const product = { id: 8, sd_product_id: '111', images: [cdn('111'), cdn('222'), cdn('333')] };
  const r = classifyImageRefresh(product, [cdn('111')]);
  assert.equal(r.mismatchedStored, 2); // 222 and 333 are leakage
  assert.equal(r.verdict, 'contaminated');
});

test('summarizeImageRefresh aggregates verdicts and removed totals', () => {
  const s = summarizeImageRefresh([
    { verdict: 'contaminated', removedCount: 7, apply: true },
    { verdict: 'contaminated', removedCount: 6, apply: true },
    { verdict: 'unchanged', removedCount: 0, apply: false },
    { verdict: 'empty_scrape', removedCount: 0, apply: false },
    { verdict: 'more_found', removedCount: 0, apply: true },
  ]);
  assert.equal(s.scanned, 5);
  assert.equal(s.contaminated, 2);
  assert.equal(s.unchanged, 1);
  assert.equal(s.emptyScrape, 1);
  assert.equal(s.moreFound, 1);
  assert.equal(s.imagesRemoved, 13);
  assert.equal(s.willApply, 3);
});

test('nextImageRefreshCursor returns the highest processed id', () => {
  assert.equal(nextImageRefreshCursor([{ id: 5 }, { id: 12 }, { id: 9 }], 0), 12);
  assert.equal(nextImageRefreshCursor([], 7), 7); // nothing processed → keep previous
});

test('buildImageUpdatePatch realigns the thumbnail and never clears images', () => {
  const patch = buildImageUpdatePatch([storage('a'), storage('b')]);
  assert.equal(patch.image, storage('a'));
  assert.deepEqual(patch.images, [storage('a'), storage('b')]);
  assert.equal(buildImageUpdatePatch([]), null); // refuse to empty the row
});

test('parseRefreshArgs parses flags and validates bounds', () => {
  const parsed = parseRefreshArgs(['--dry-run', '--limit=50', '--ids=39,40,39', '--after=10', '--min-images=8', '--delay=2000']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.limit, 50);
  assert.deepEqual(parsed.ids, [39, 40]);
  assert.equal(parsed.afterId, 10);
  assert.equal(parsed.minImages, 8);
  assert.equal(parsed.delayMs, 2000);
  assert.throws(() => parseRefreshArgs(['--limit=0']), /limit/);
  assert.throws(() => parseRefreshArgs(['--limit=501']), /limit/);
  assert.throws(() => parseRefreshArgs(['--after=-1']), /after/);
  assert.throws(() => parseRefreshArgs(['--min-images=9']), /min-images/);
  assert.throws(() => parseRefreshArgs(['--delay=100']), /delay/);
  assert.throws(() => parseRefreshArgs(['--ids=abc']), /valid positive/);
});

test('parseRefreshArgs defaults are conservative', () => {
  const parsed = parseRefreshArgs([]);
  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.limit, 25);
  assert.equal(parsed.minImages, 0);
  assert.equal(parsed.delayMs, 1500);
  assert.deepEqual(parsed.ids, []);
});
