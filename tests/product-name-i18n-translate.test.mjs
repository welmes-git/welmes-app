import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasKana,
  normalizeSourceName,
  checkNameGuards,
  validateBatch,
  chunkForTranslation,
  isNameTranslationTarget,
  selectNameTargets,
  buildNameUpdatePatch,
  DEFAULT_TARGET_LANGS,
} from '../scripts/lib/product-name-i18n.mjs';
import { parseArgs, buildBatchPrompt } from '../scripts/translate-product-names.mjs';

test('hasKana detects untranslated Japanese but ignores shared kanji', () => {
  assert.equal(hasKana('ビオレ'), true);      // katakana
  assert.equal(hasKana('びおれ'), true);      // hiragana
  assert.equal(hasKana('花王'), false);       // kanji alone is shared with Chinese
  assert.equal(hasKana('Biore Guard'), false);
});

test('normalizeSourceName drops bracketed regulatory prefixes and width noise', () => {
  const n = normalizeSourceName('【指定医薬部外品】　ビオレガード　薬用消毒スプレーアルファ　本体 350 ml');
  assert.doesNotMatch(n, /指定医薬部外品/);
  assert.match(n, /ビオレガード/);
  assert.match(n, /350 ml/);
  assert.doesNotMatch(n, /\u3000/); // ideographic space collapsed
});

test('checkNameGuards preserves numbers and units (SKU identity)', () => {
  const src = 'ビオレガード 薬用消毒スプレーアルファ 本体 350 ml';
  assert.deepEqual(checkNameGuards(src, 'Biore Guard Medicated Disinfectant Spray Alpha 350 ml', 'en'), []);
  // wrong size is the dangerous failure
  assert.ok(checkNameGuards(src, 'Biore Guard Medicated Spray 200 ml', 'en').includes('number_mismatch'));
});

test('checkNameGuards rejects untranslated output', () => {
  const src = 'ビオレ ザフェイス 泡洗顔料 200ml';
  assert.ok(checkNameGuards(src, 'ビオレ ザフェイス 200ml', 'en').includes('kana_remaining'));
  // A Chinese name left in the English slot must be caught. Testing for the
  // presence of latin would not catch it, because "200ml" already has letters.
  assert.ok(checkNameGuards(src, '碧柔 洁面泡沫 200ml', 'en').includes('cjk_remaining'));
  assert.ok(checkNameGuards(src, 'Biore The Face 200ml', 'ko').includes('not_hangul'));
  assert.deepEqual(checkNameGuards(src, '비오레 더 페이스 폼 클렌저 200ml', 'ko'), []);
  assert.deepEqual(checkNameGuards(src, '碧柔 洁面泡沫 200ml', 'zh'), []);
  // Chinese is allowed to keep a latin brand (SK-II) — no ideograph requirement.
  assert.deepEqual(checkNameGuards('SK-II エッセンス 30ml', 'SK-II 精华露 30ml', 'zh'), []);
});

test('Japanese counters may be translated; only the numeral is protected', () => {
  // Regression: treating 枚/粒 as units rejected every sheet-mask and tablet
  // product, because "6枚" legitimately becomes "6 sheets".
  const mask = 'SK-II フェイシャル トリートメント マスク 6枚';
  assert.deepEqual(checkNameGuards(mask, 'SK-II Facial Treatment Mask 6 sheets', 'en'), []);
  assert.deepEqual(checkNameGuards(mask, 'SK-II 护肤面膜 6片', 'zh'), []);
  assert.deepEqual(checkNameGuards(mask, 'SK-II 페이셜 트리트먼트 마스크 6매', 'ko'), []);
  // but changing the count is still caught
  assert.ok(checkNameGuards(mask, 'SK-II Facial Treatment Mask 8 sheets', 'en').includes('number_mismatch'));

  const tabs = 'トーヤク クエン酸ピュアタブ 340粒';
  assert.deepEqual(checkNameGuards(tabs, 'Toyaku Citric Acid Pure Tab 340 tablets', 'en'), []);

  // physical units must still survive verbatim
  assert.ok(checkNameGuards('ビオレ 洗顔 200ml', 'Biore Facial Wash 200 milliliters', 'en').includes('unit_mismatch'));
});

test('checkNameGuards flags empty and absurd lengths', () => {
  assert.deepEqual(checkNameGuards('ビオレ 200ml', '', 'en'), ['empty']);
  const long = 'Biore '.repeat(40) + '200ml';
  assert.ok(checkNameGuards('ビオレ 200ml', long, 'en').includes('length_out_of_bounds'));
});

test('validateBatch publishes passing languages and flags the rest', () => {
  const items = [
    { id: 1, source: 'ビオレ 洗顔 200ml' },
    { id: 2, source: 'キュレル ローション 150ml' },
  ];
  const result = {
    1: { en: 'Biore Facial Wash 200ml', zh: '碧柔 洗面奶 200ml', ko: '비오레 클렌징 폼 200ml' },
    2: { en: 'Curel Lotion 150ml', zh: '珂润 化妆水 150ml', ko: 'キュレル 로션 150ml' }, // ko leaks kana
  };
  const { updates } = validateBatch(items, result, DEFAULT_TARGET_LANGS);
  const first = updates.find((u) => u.id === 1);
  assert.equal(first.status, 'translated');
  assert.deepEqual(Object.keys(first.names).sort(), ['en', 'ko', 'zh']);

  const second = updates.find((u) => u.id === 2);
  assert.equal(second.status, 'review_required');
  assert.deepEqual(Object.keys(second.names).sort(), ['en', 'zh']); // good langs still publish
  assert.ok(second.violations.ko.includes('kana_remaining'));
});

test('validateBatch marks products the model omitted', () => {
  const { updates } = validateBatch([{ id: 9, source: 'ビオレ 100ml' }], {}, DEFAULT_TARGET_LANGS);
  assert.equal(updates[0].status, 'review_required');
  assert.deepEqual(updates[0].violations._all, ['missing_from_response']);
  assert.deepEqual(updates[0].names, {});
});

test('chunkForTranslation batches and clamps size', () => {
  const products = Array.from({ length: 45 }, (_, i) => ({ id: i + 1 }));
  assert.equal(chunkForTranslation(products, 20).length, 3);
  assert.equal(chunkForTranslation(products, 20)[0].length, 20);
  assert.equal(chunkForTranslation(products, 999)[0].length, 45); // clamped to 50
  assert.equal(chunkForTranslation(products, 0)[0].length, 20);    // 0 falls back to the default
});

test('isNameTranslationTarget respects admin locks', () => {
  assert.equal(isNameTranslationTarget({ name_i18n_status: 'pending' }), true);
  assert.equal(isNameTranslationTarget({ name_i18n_status: 'failed' }), true);
  assert.equal(isNameTranslationTarget({ name_i18n_status: 'translated' }), false);
  assert.equal(isNameTranslationTarget({ name_i18n_status: 'human_locked' }), false);
  assert.equal(isNameTranslationTarget({ name_i18n_status: 'pending', name_i18n_manual_locked: true }), false);
});

test('selectNameTargets skips empty names and honors cursor/limit', () => {
  const rows = [
    { id: 1, name: 'ビオレ 100ml', name_i18n_status: 'pending' },
    { id: 2, name: '', name_i18n_status: 'pending' },
    { id: 3, name: 'キュレル 150ml', name_i18n_status: 'pending' },
    { id: 4, name: '花王 200ml', name_i18n_status: 'translated' },
  ];
  assert.deepEqual(selectNameTargets(rows).map((p) => p.id), [1, 3]);
  assert.deepEqual(selectNameTargets(rows, { afterId: 1 }).map((p) => p.id), [3]);
  assert.deepEqual(selectNameTargets(rows, { limit: 1 }).map((p) => p.id), [1]);
});

test('buildNameUpdatePatch refuses to write an empty translation', () => {
  assert.equal(buildNameUpdatePatch({}, 'translated'), null);
  const patch = buildNameUpdatePatch({ en: 'Biore 100ml' }, 'translated');
  assert.deepEqual(patch.name_i18n, { en: 'Biore 100ml' });
  assert.equal(patch.name_i18n_status, 'translated');
  assert.ok(patch.name_i18n_generated_at);
});

test('buildBatchPrompt includes every id and pins brand conventions', () => {
  const prompt = buildBatchPrompt([{ id: 7, source: 'ビオレ 200ml' }, { id: 8, source: 'キュレル 150ml' }], ['en', 'zh', 'ko']);
  assert.match(prompt, /"id": "7"/);
  assert.match(prompt, /"id": "8"/);
  assert.match(prompt, /碧柔/);        // established Chinese brand name is taught
  assert.match(prompt, /Simplified Chinese/);
  assert.match(prompt, /numeral must stay identical/);
});

test('parseArgs validates bounds', () => {
  const p = parseArgs(['--dry-run', '--limit=60', '--batch-size=20', '--ids=222,233', '--after=10']);
  assert.equal(p.dryRun, true);
  assert.equal(p.limit, 60);
  assert.equal(p.batchSize, 20);
  assert.deepEqual(p.ids, [222, 233]);
  assert.equal(p.afterId, 10);
  assert.deepEqual(parseArgs([]).langs, DEFAULT_TARGET_LANGS);
  assert.throws(() => parseArgs(['--limit=0']), /limit/);
  assert.throws(() => parseArgs(['--batch-size=51']), /batch-size/);
  assert.throws(() => parseArgs(['--ids=abc']), /valid positive/);
});
