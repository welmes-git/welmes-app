import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBackfillTarget,
  nextBackfillCursor,
  selectBackfillTargets,
  estimateBackfillCost,
} from '../scripts/lib/product-name-enrichment.mjs';
import { parseBackfillArgs } from '../scripts/backfill-product-names.mjs';

const products = [
  { id: 1, name: 'ビオレ UV 70g', name_en: 'ビオレ UV 70g', status: 'active', name_en_status: null },          // legacy, Japanese
  { id: 2, name: 'ビオレ 洗顔 120g', name_en: 'Biore Facial Wash 120g', status: 'active', name_en_status: 'human_approved' }, // curated — protected
  { id: 3, name: 'メラノCC 20ml', name_en: 'Melano CC Essence 20ml', status: 'inactive', name_en_status: 'auto_approved' },   // done, clean
  { id: 4, name: 'キュレル 40g', name_en: 'キュレル 40g', status: 'inactive', name_en_status: 'auto_approved' },              // done but Japanese leaked → redo
  { id: 5, name: 'アネッサ 60ml', name_en: 'アネッサ 60ml', status: 'active', name_en_status: 'failed' },                     // failed → retry
  { id: 6, name: 'DHC 200ml', name_en: 'DHC Cleansing Oil 200ml', status: 'inactive', name_en_status: 'review_required' },    // done, clean
];

test('isBackfillTarget protects human-approved and skips clean processed rows', () => {
  assert.equal(isBackfillTarget(products[0]), true);  // legacy Japanese
  assert.equal(isBackfillTarget(products[1]), false); // human-approved protected
  assert.equal(isBackfillTarget(products[2]), false); // clean auto-approved
  assert.equal(isBackfillTarget(products[3]), true);  // Japanese leaked into processed row
  assert.equal(isBackfillTarget(products[4]), true);  // failed retryable
  assert.equal(isBackfillTarget(products[5]), false); // clean review_required
});

test('selectBackfillTargets orders active first then by id', () => {
  const targets = selectBackfillTargets(products);
  assert.deepEqual(targets.map((p) => p.id), [1, 5, 4]); // active(1,5) before inactive(4)
});

test('resume cursor (afterId) skips already-processed ids — idempotent re-run', () => {
  const first = selectBackfillTargets(products, { limit: 2 });
  assert.deepEqual(first.map((p) => p.id), [1, 5]);
  const lastId = Math.max(...first.map((p) => p.id));
  // Second run resumes after the highest id processed; never reprocesses 1 or 5.
  const second = selectBackfillTargets(products, { afterId: lastId });
  assert.deepEqual(second.map((p) => p.id), []); // only id 4 remains but 4 < lastId(5)
  const remaining = selectBackfillTargets(products, { afterId: 3 });
  assert.ok(remaining.every((p) => p.id > 3));
});

test('explicit --ids allowlist narrows the target set', () => {
  const targets = selectBackfillTargets(products, { ids: [1, 2, 3] });
  assert.deepEqual(targets.map((p) => p.id), [1]); // 2 protected, 3 clean
});

test('cost estimate scales with count and reports provider currency', () => {
  const zero = estimateBackfillCost(0, { provider: 'gemini', env: {} });
  assert.equal(zero.total, 0);
  const ten = estimateBackfillCost(10, { provider: 'gemini', env: {} });
  assert.equal(ten.count, 10);
  assert.equal(ten.currency, 'USD');
  assert.ok(ten.total > zero.total);
  // Qwen is priced in CNY; USD conversion is null unless a rate is provided.
  const qwen = estimateBackfillCost(5, { provider: 'qwen', env: {} });
  assert.equal(qwen.currency, 'CNY');
  assert.equal(qwen.totalUsd, null);
  const qwenUsd = estimateBackfillCost(5, { provider: 'qwen', env: { QWEN_CNY_TO_USD: '0.14' } });
  assert.ok(qwenUsd.totalUsd > 0);
});

test('parseBackfillArgs validates bounds and parses flags', () => {
  const parsed = parseBackfillArgs(['--dry-run', '--limit=10', '--ids=12,34,12', '--after=100', '--active-only', '--provider=openai']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.limit, 10);
  assert.deepEqual(parsed.ids, [12, 34]);
  assert.equal(parsed.afterId, 100);
  assert.equal(parsed.activeOnly, true);
  assert.equal(parsed.provider, 'openai');
  assert.equal(parsed.force, true);
  assert.throws(() => parseBackfillArgs(['--limit=0']), /limit/);
  assert.throws(() => parseBackfillArgs(['--limit=999']), /limit/);
  assert.throws(() => parseBackfillArgs(['--after=-1']), /after/);
  assert.throws(() => parseBackfillArgs(['--ids=abc']), /valid positive/);
});

test('active-first cursor does not skip the inactive phase on resume', () => {
  // id order is intentionally NOT aligned with active/inactive ordering so the
  // old max-id cursor bug would have skipped the low-id inactive rows.
  const rows = [
    { id: 1, name: 'a 日本語', name_en: 'a 日本語', status: 'inactive', name_en_status: null },
    { id: 2, name: 'b 日本語', name_en: 'b 日本語', status: 'active', name_en_status: null },
    { id: 3, name: 'c 日本語', name_en: 'c 日本語', status: 'inactive', name_en_status: null },
    { id: 5, name: 'e 日本語', name_en: 'e 日本語', status: 'active', name_en_status: null },
  ];
  const first = selectBackfillTargets(rows, { limit: 2 });
  assert.deepEqual(first.map((p) => p.id), [2, 5]); // active first
  const cursor1 = nextBackfillCursor(first);
  const second = selectBackfillTargets(rows, { cursor: cursor1, limit: 10 });
  assert.deepEqual(second.map((p) => p.id), [1, 3]); // inactive not skipped
  const cursor2 = nextBackfillCursor(second);
  assert.deepEqual(selectBackfillTargets(rows, { cursor: cursor2, limit: 10 }).map((p) => p.id), []);
});

test('nextBackfillCursor encodes the active→inactive phase transition', () => {
  const active = [{ id: 9, status: 'active' }];
  assert.deepEqual(nextBackfillCursor(active), { activeDone: false, afterId: 9 });
  const inactive = [{ id: 4, status: 'inactive' }];
  assert.deepEqual(nextBackfillCursor(inactive), { activeDone: true, afterId: 4 });
  assert.equal(nextBackfillCursor([], null), null);
});

test('backfill batch-size is bounded to the DB claim ceiling of 50', () => {
  const parsed = parseBackfillArgs(['--batch-size=50', '--max-batches=3']);
  assert.equal(parsed.batchSize, 50);
  assert.equal(parsed.maxBatches, 3);
  assert.throws(() => parseBackfillArgs(['--batch-size=51']), /batch-size/);
});
