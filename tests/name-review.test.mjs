import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugifyProductName,
  resolveApprovalSource,
  buildApprovalPatch,
  containsJapanese,
  validateApprovalName,
} from '../src/lib/nameReview.ts';

// slug must match the worker's scripts/lib/product-name-enrichment.mjs output
test('admin slug matches the worker slugify rule', () => {
  assert.equal(slugifyProductName('Curel Intensive Moisture Cream 40g', 42), 'curel-intensive-moisture-cream-40g-42');
  assert.equal(slugifyProductName('Biore UV Aqua Rich Watery Essence SPF50+ PA++++ 70g', 167), 'biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167');
  assert.equal(slugifyProductName('   ', 9), 'product-9'); // empty base falls back
});

test('editing the candidate flips provenance to manual; unchanged keeps prior source', () => {
  assert.equal(resolveApprovalSource('Biore UV Gel 70ml', 'Biore UV Essence 70g', 'official'), 'manual');
  assert.equal(resolveApprovalSource('Biore UV Essence 70g', 'Biore UV Essence 70g', 'official'), 'official');
  assert.equal(resolveApprovalSource('Biore UV Essence 70g', 'Biore UV Essence 70g', undefined), 'generated');
  // whitespace-only differences are not edits
  assert.equal(resolveApprovalSource('  Biore UV Essence 70g  ', 'Biore UV Essence 70g', 'grounded'), 'grounded');
});

test('approval stamps reviewer + status and preserves an existing slug', () => {
  const patch = buildApprovalPatch(
    'reviewer-uuid',
    { nameEn: 'Biore UV Essence 70g', seoTitle: 'T', seoDescription: 'D', searchAliases: ['a'], seoSlug: 'new-slug-1', source: 'manual' },
    'existing-slug-1', // product already has a slug
    () => '2026-09-20T00:00:00.000Z',
  );
  assert.equal(patch.nameEnStatus, 'human_approved');
  assert.equal(patch.nameEnSource, 'manual');
  assert.equal(patch.nameEnApprovedBy, 'reviewer-uuid');
  assert.equal(patch.nameEnApprovedAt, '2026-09-20T00:00:00.000Z');
  assert.deepEqual(patch.searchAliases, ['a']);
  // stable-URL policy: existing slug is never overwritten
  assert.equal(patch.seoSlug, undefined);
});

test('approval assigns a slug only when the product has none yet', () => {
  const patch = buildApprovalPatch(
    'r',
    { nameEn: 'Name', seoSlug: 'name-5', source: 'generated' },
    undefined, // no current slug
  );
  assert.equal(patch.seoSlug, 'name-5');
});

test('approval defaults missing aliases to an empty array', () => {
  const patch = buildApprovalPatch('r', { nameEn: 'N', source: 'generated' });
  assert.deepEqual(patch.searchAliases, []);
});

// ── approval guards: reject empty and Japanese-containing names ────────────
test('containsJapanese detects kana and kanji, ignores pure ASCII', () => {
  assert.equal(containsJapanese('ビオレ UV エッセンス'), true); // katakana
  assert.equal(containsJapanese('あわ 洗顔'), true);            // hiragana + kanji
  assert.equal(containsJapanese('ｷｬﾉﾝ'), true);                 // half-width katakana
  assert.equal(containsJapanese('Biore UV Essence 70g'), false);
  assert.equal(containsJapanese('SPF50+ PA++++'), false);
});

test('validateApprovalName rejects empty/whitespace names', () => {
  assert.deepEqual(validateApprovalName(''), { ok: false, code: 'empty', message: 'English name is required' });
  assert.deepEqual(validateApprovalName('   '), { ok: false, code: 'empty', message: 'English name is required' });
});

test('validateApprovalName rejects Japanese and accepts clean English', () => {
  const jp = validateApprovalName('ビオレ UV Essence');
  assert.equal(jp.ok, false);
  assert.equal(jp.code, 'japanese');
  assert.deepEqual(validateApprovalName('  Biore UV Essence 70g  '), { ok: true });
});
