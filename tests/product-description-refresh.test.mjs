import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDescriptionRefreshTarget,
  selectDescriptionRefreshTargets,
  sectionKeySet,
  classifyDescriptionRefresh,
  summarizeDescriptionRefresh,
  nextDescriptionRefreshCursor,
  buildDescriptionUpdatePatch,
} from '../scripts/lib/product-description-refresh.mjs';
import { parseRefreshArgs } from '../scripts/refresh-product-descriptions.mjs';
import { estimateProviderCost } from '../scripts/lib/product-name-providers.mjs';
import { estimateTranslationCost } from '../scripts/lib/product-description-providers.mjs';

const sec = (key, value) => ({ key, label: key || '', value });

test('isDescriptionRefreshTarget needs an sd id and skips admin-locked rows', () => {
  assert.equal(isDescriptionRefreshTarget({ id: 1, sd_product_id: '123' }), true);
  assert.equal(isDescriptionRefreshTarget({ id: 1, sd_product_id: null }), false);
  assert.equal(isDescriptionRefreshTarget({ id: 1, sd_product_id: '1', description_i18n_manual_locked: true }), false);
  assert.equal(isDescriptionRefreshTarget({ id: 1, sd_product_id: '1', description_i18n_status: 'human_locked' }), false);
  // already-translated rows ARE re-scrapable (their source may still be legacy)
  assert.equal(isDescriptionRefreshTarget({ id: 1, sd_product_id: '1', description_i18n_status: 'auto_approved' }), true);
});

test('selectDescriptionRefreshTargets targets legacy rows via max-sections', () => {
  const rows = [
    { id: 1, sd_product_id: 'a' }, // 1 section (legacy)
    { id: 2, sd_product_id: 'b' }, // 4 sections (already good)
    { id: 3, sd_product_id: 'c' }, // 1 section
  ];
  const counts = { 1: 1, 2: 4, 3: 1 };
  const storedCount = (p) => counts[p.id];
  assert.deepEqual(selectDescriptionRefreshTargets(rows, { maxSections: 1 }, storedCount).map((p) => p.id), [1, 3]);
  assert.deepEqual(selectDescriptionRefreshTargets(rows, {}, storedCount).map((p) => p.id), [1, 2, 3]);
  assert.deepEqual(selectDescriptionRefreshTargets(rows, { afterId: 1, maxSections: 1 }, storedCount).map((p) => p.id), [3]);
  assert.deepEqual(selectDescriptionRefreshTargets(rows, { ids: [3] }, storedCount).map((p) => p.id), [3]);
});

test('sectionKeySet ignores extras (null keys) and dedupes', () => {
  assert.deepEqual(sectionKeySet([sec('overview', 'a'), sec(null, 'x'), sec('size', '1')]), ['overview', 'size']);
});

test('classifyDescriptionRefresh detects the real bug: overview-only → full template', () => {
  const product = { id: 233, sd_product_id: '10482291', description: '【商品説明】\nやさしく洗う派も。' };
  const stored = [sec('overview', '【商品説明】\nやさしく洗う派も。')];
  const freshText = '【商品説明】\nやさしく洗う派も。\n\nサイズ・容量\n200ml\n\n規格\n■生産地：日本\n\n出荷\n3週間程度';
  const fresh = [sec('overview', '...'), sec('size', '200ml'), sec('spec', '■生産地：日本'), sec('shipping', '3週間程度')];
  const r = classifyDescriptionRefresh(product, stored, freshText, fresh);
  assert.equal(r.verdict, 'improved');
  assert.deepEqual(r.gained, ['size', 'spec', 'shipping']);
  assert.equal(r.storedSectionCount, 1);
  assert.equal(r.freshSectionCount, 4);
  assert.equal(r.apply, true);
});

test('classifyDescriptionRefresh never overwrites on an empty scrape', () => {
  const product = { id: 1, description: 'existing text' };
  const r = classifyDescriptionRefresh(product, [sec('overview', 'existing text')], '', []);
  assert.equal(r.verdict, 'empty_scrape');
  assert.equal(r.apply, false);
});

test('classifyDescriptionRefresh refuses a structural regression', () => {
  // A partial page load returns fewer sections than we already have — do not write.
  const product = { id: 2, description: 'x\n\nサイズ・容量\n200ml' };
  const stored = [sec('overview', 'x'), sec('size', '200ml')];
  const r = classifyDescriptionRefresh(product, stored, 'x', [sec('overview', 'x')]);
  assert.equal(r.verdict, 'regressed');
  assert.deepEqual(r.lost, ['size']);
  assert.equal(r.apply, false);
});

test('classifyDescriptionRefresh reports unchanged vs text_changed', () => {
  const same = 'x\n\n規格\na';
  const stored = [sec('overview', 'x'), sec('spec', 'a')];
  const unchanged = classifyDescriptionRefresh({ id: 3, description: same }, stored, same, stored);
  assert.equal(unchanged.verdict, 'unchanged');
  assert.equal(unchanged.apply, false);

  const changed = classifyDescriptionRefresh({ id: 3, description: same }, stored, 'x\n\n規格\nb', stored);
  assert.equal(changed.verdict, 'text_changed');
  assert.equal(changed.apply, true); // supplier edited the page
});

test('buildDescriptionUpdatePatch invalidates the stale translation', () => {
  const patch = buildDescriptionUpdatePatch('new text');
  assert.equal(patch.description, 'new text');
  // critical: the old translation came from the OLD source, so it must be dropped
  assert.deepEqual(patch.description_i18n, {});
  assert.equal(patch.description_i18n_status, 'pending');
  assert.equal(patch.description_i18n_generated_at, null);
  assert.equal(buildDescriptionUpdatePatch('   '), null); // never clear a description
});

test('summarizeDescriptionRefresh aggregates verdicts', () => {
  const s = summarizeDescriptionRefresh([
    { verdict: 'improved', gained: ['size', 'spec'], apply: true },
    { verdict: 'improved', gained: ['usage'], apply: true },
    { verdict: 'unchanged', gained: [], apply: false },
    { verdict: 'regressed', gained: [], apply: false },
    { verdict: 'empty_scrape', gained: [], apply: false },
    { verdict: 'text_changed', gained: [], apply: true },
  ]);
  assert.equal(s.scanned, 6);
  assert.equal(s.improved, 2);
  assert.equal(s.textChanged, 1);
  assert.equal(s.regressed, 1);
  assert.equal(s.emptyScrape, 1);
  assert.equal(s.sectionsGained, 3);
  assert.equal(s.willApply, 3);
});

test('nextDescriptionRefreshCursor returns the highest processed id', () => {
  assert.equal(nextDescriptionRefreshCursor([{ id: 4 }, { id: 11 }], 0), 11);
  assert.equal(nextDescriptionRefreshCursor([], 9), 9);
});

test('parseRefreshArgs validates bounds', () => {
  const p = parseRefreshArgs(['--dry-run', '--limit=10', '--max-sections=1', '--ids=233', '--after=5', '--delay=900']);
  assert.equal(p.dryRun, true);
  assert.equal(p.limit, 10);
  assert.equal(p.maxSections, 1);
  assert.deepEqual(p.ids, [233]);
  assert.equal(p.afterId, 5);
  assert.equal(p.delayMs, 900);
  assert.equal(parseRefreshArgs([]).maxSections, Infinity);
  assert.throws(() => parseRefreshArgs(['--limit=0']), /limit/);
  assert.throws(() => parseRefreshArgs(['--max-sections=11']), /max-sections/);
  assert.throws(() => parseRefreshArgs(['--delay=1']), /delay/);
});

// ── Cost accounting regression: thinking tokens are billed ────────────
test('estimateProviderCost bills thinking tokens at the output rate', () => {
  // gemini: inputRate 0.75, outputRate 3.75 per 1M
  const without = estimateProviderCost('gemini', { inputTokens: 1000, outputTokens: 1000 }, {});
  const with_ = estimateProviderCost('gemini', { inputTokens: 1000, outputTokens: 1000, thinkingTokens: 1000 }, {});
  assert.ok(with_.amount > without.amount, 'thinking tokens must increase the estimate');
  // 1000*0.75 + 2000*3.75 = 750 + 7500 = 8250 / 1e6
  assert.equal(with_.amount, Number((8250 / 1e6).toFixed(8)));
});

test('estimateTranslationCost bills thinking tokens (observed 220 thought vs 27 output)', () => {
  const usage = { inputTokens: 10, outputTokens: 27, thinkingTokens: 220 };
  const cost = estimateTranslationCost('gemini', usage, {});
  // 10*0.75 + 247*3.75 = 7.5 + 926.25 = 933.75 / 1e6
  assert.equal(cost, Number((933.75 / 1e6).toFixed(8)));
  // and it must exceed the old (buggy) thinking-free calculation
  const buggy = (10 * 0.75 + 27 * 3.75) / 1e6;
  assert.ok(cost > buggy * 5, 'thinking tokens dominated real cost in the observed sample');
});
