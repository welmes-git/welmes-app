import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDescriptionBackfillTarget,
  selectDescriptionBackfillTargets,
  nextDescriptionBackfillCursor,
  DEFAULT_TARGET_LANGS,
} from '../scripts/lib/product-description-i18n.mjs';
import { parseBackfillArgs } from '../scripts/backfill-product-descriptions.mjs';

const products = [
  { id: 1, status: 'active', description_i18n_status: 'pending', description_i18n_manual_locked: false },        // fresh → eligible
  { id: 2, status: 'active', description_i18n_status: 'auto_approved', description_i18n_manual_locked: false },  // done → skip
  { id: 3, status: 'inactive', description_i18n_status: 'failed', description_i18n_manual_locked: false },       // failed → retry
  { id: 4, status: 'inactive', description_i18n_status: 'review_required', description_i18n_manual_locked: false }, // under review → skip
  { id: 5, status: 'active', description_i18n_status: 'pending', description_i18n_manual_locked: true },         // admin-locked → skip
  { id: 6, status: 'active', description_i18n_status: 'human_locked', description_i18n_manual_locked: false },   // human-locked → skip
];

test('isDescriptionBackfillTarget: only pending/failed and never locked', () => {
  assert.equal(isDescriptionBackfillTarget(products[0]), true);  // pending
  assert.equal(isDescriptionBackfillTarget(products[1]), false); // auto_approved
  assert.equal(isDescriptionBackfillTarget(products[2]), true);  // failed
  assert.equal(isDescriptionBackfillTarget(products[3]), false); // review_required
  assert.equal(isDescriptionBackfillTarget(products[4]), false); // manual_locked flag
  assert.equal(isDescriptionBackfillTarget(products[5]), false); // human_locked status
});

test('isDescriptionBackfillTarget defaults a missing status to pending', () => {
  assert.equal(isDescriptionBackfillTarget({ id: 99, status: 'active' }), true);
  // camelCase field variants are also honored
  assert.equal(isDescriptionBackfillTarget({ id: 99, descriptionI18nStatus: 'failed' }), true);
  assert.equal(isDescriptionBackfillTarget({ id: 99, descriptionI18nManualLocked: true }), false);
});

test('selectDescriptionBackfillTargets orders active first then by id', () => {
  const targets = selectDescriptionBackfillTargets(products);
  assert.deepEqual(targets.map((p) => p.id), [1, 3]); // active(1) before inactive(3); rest skipped
});

test('resume cursor (afterId) skips already-processed ids — idempotent re-run', () => {
  const remaining = selectDescriptionBackfillTargets(products, { afterId: 1 });
  assert.ok(remaining.every((p) => p.id > 1));
  assert.deepEqual(remaining.map((p) => p.id), [3]);
});

test('explicit --ids allowlist narrows the target set', () => {
  const targets = selectDescriptionBackfillTargets(products, { ids: [1, 2, 4] });
  assert.deepEqual(targets.map((p) => p.id), [1]); // 2 done, 4 under review
});

test('active-first cursor does not skip the inactive phase on resume', () => {
  const rows = [
    { id: 1, status: 'inactive', description_i18n_status: 'pending' },
    { id: 2, status: 'active', description_i18n_status: 'pending' },
    { id: 3, status: 'inactive', description_i18n_status: 'failed' },
    { id: 5, status: 'active', description_i18n_status: 'pending' },
  ];
  const first = selectDescriptionBackfillTargets(rows, { limit: 2 });
  assert.deepEqual(first.map((p) => p.id), [2, 5]); // active first
  const cursor1 = nextDescriptionBackfillCursor(first);
  const second = selectDescriptionBackfillTargets(rows, { cursor: cursor1, limit: 10 });
  assert.deepEqual(second.map((p) => p.id), [1, 3]); // inactive not skipped
  const cursor2 = nextDescriptionBackfillCursor(second);
  assert.deepEqual(selectDescriptionBackfillTargets(rows, { cursor: cursor2, limit: 10 }).map((p) => p.id), []);
});

test('nextDescriptionBackfillCursor encodes the active→inactive phase transition', () => {
  assert.deepEqual(nextDescriptionBackfillCursor([{ id: 9, status: 'active' }]), { activeDone: false, afterId: 9 });
  assert.deepEqual(nextDescriptionBackfillCursor([{ id: 4, status: 'inactive' }]), { activeDone: true, afterId: 4 });
  assert.equal(nextDescriptionBackfillCursor([], null), null);
});

test('limit slices after ordering', () => {
  const rows = [
    { id: 10, status: 'active', description_i18n_status: 'pending' },
    { id: 11, status: 'active', description_i18n_status: 'pending' },
    { id: 12, status: 'active', description_i18n_status: 'pending' },
  ];
  assert.deepEqual(selectDescriptionBackfillTargets(rows, { limit: 2 }).map((p) => p.id), [10, 11]);
});

test('parseBackfillArgs validates bounds and parses flags', () => {
  const parsed = parseBackfillArgs(['--dry-run', '--limit=10', '--ids=12,34,12', '--after=100', '--active-only', '--provider=openai', '--langs=en,ko']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.limit, 10);
  assert.deepEqual(parsed.ids, [12, 34]);
  assert.equal(parsed.afterId, 100);
  assert.equal(parsed.activeOnly, true);
  assert.equal(parsed.provider, 'openai');
  assert.deepEqual(parsed.langs, ['en', 'ko']);
  assert.equal(parsed.force, true);
  assert.throws(() => parseBackfillArgs(['--limit=0']), /limit/);
  assert.throws(() => parseBackfillArgs(['--limit=999']), /limit/);
  assert.throws(() => parseBackfillArgs(['--after=-1']), /after/);
  assert.throws(() => parseBackfillArgs(['--ids=abc']), /valid positive/);
});

test('parseBackfillArgs defaults langs to EN/ZH/KO and bounds batch/lease', () => {
  const parsed = parseBackfillArgs([]);
  assert.deepEqual(parsed.langs, DEFAULT_TARGET_LANGS);
  assert.equal(parsed.batchSize, 50);
  assert.equal(parsed.maxBatches, 100);
  assert.equal(parsed.leaseSeconds, 300);
  assert.throws(() => parseBackfillArgs(['--batch-size=51']), /batch-size/);
  assert.throws(() => parseBackfillArgs(['--lease=10']), /lease/);
});
