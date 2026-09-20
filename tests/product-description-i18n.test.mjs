import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranslationSource,
  hashTranslationInput,
  checkSectionGuards,
  validateTranslations,
  SECTION_KEYS,
  DEFAULT_TARGET_LANGS,
} from '../scripts/lib/product-description-i18n.mjs';

const sections = [
  { key: 'overview', label: '商品説明', value: '洗うことで素肌の美しさをひきだします。' },
  { key: 'usage', label: '使用方法', value: '適量（2〜3cm程度）を泡立てて洗います。' },
  { key: 'size', label: 'サイズ・容量', value: '130g' },
  { key: 'spec', label: '規格', value: '成分：水、グリセリン、香料' },
  { key: 'shipping', label: '出荷', value: '3週間程度' },
];

test('buildTranslationSource drops empty sections and sets langs', () => {
  const src = buildTranslationSource([...sections, { key: 'spec', label: '規格', value: '  ' }]);
  assert.equal(src.sourceLang, 'ja');
  assert.deepEqual(src.targetLangs, DEFAULT_TARGET_LANGS);
  assert.equal(src.sections.length, 5); // the empty extra spec dropped
});

test('hashTranslationInput is deterministic and sensitive to content', () => {
  const a = buildTranslationSource(sections);
  const h1 = hashTranslationInput(a);
  const h2 = hashTranslationInput(buildTranslationSource(sections));
  assert.equal(h1, h2);
  const changed = buildTranslationSource(sections.map((s) => (s.key === 'size' ? { ...s, value: '150g' } : s)));
  assert.notEqual(h1, hashTranslationInput(changed));
});

test('guard: numbers must be preserved', () => {
  assert.deepEqual(checkSectionGuards('size', '130g', '130g'), []);
  assert.ok(checkSectionGuards('size', '130g', '150g').includes('number_mismatch'));
});

test('guard: units must be preserved', () => {
  assert.deepEqual(checkSectionGuards('size', '200ml', '200ml'), []);
  assert.ok(checkSectionGuards('size', '200ml', '200 grams').length > 0);
});

test('guard: SPF/PA preserved verbatim', () => {
  assert.deepEqual(checkSectionGuards('spec', 'SPF50+ PA++++', 'SPF50+ PA++++'), []);
  assert.ok(checkSectionGuards('spec', 'SPF50+ PA++++', 'SPF30 PA++').includes('spf_pa_mismatch'));
});

test('guard: empty translation of non-empty source flagged', () => {
  assert.ok(checkSectionGuards('overview', 'text', '').includes('empty_translation'));
});

test('guard: ingredient-count divergence for spec', () => {
  const src = '成分：水、グリセリン、香料、クエン酸、EDTA';
  // dropping most ingredients should trip the guard
  assert.ok(checkSectionGuards('spec', src, 'Ingredients: water').includes('ingredient_count_divergence'));
  // faithful translation with same count passes
  const ok = 'Ingredients: water, glycerin, fragrance, citric acid, EDTA';
  assert.ok(!checkSectionGuards('spec', src, ok).includes('ingredient_count_divergence'));
});

test('validateTranslations: all-clean → auto_approved with i18n populated', () => {
  const source = buildTranslationSource(sections);
  const translations = {
    en: { overview: 'Draws out bare-skin beauty by washing.', usage: 'Lather an appropriate amount (2–3cm) and wash.', size: '130g', spec: 'Ingredients: water, glycerin, fragrance', shipping: 'About 3 weeks' },
    zh: { overview: '洗净带出素肌之美。', usage: '取适量（2〜3cm）起泡清洗。', size: '130g', spec: '成分：水、甘油、香料', shipping: '约3周' },
    ko: { overview: '세안으로 맨살의 아름다움을 이끌어냅니다.', usage: '적당량(2〜3cm)을 거품 내어 씻습니다.', size: '130g', spec: '성분: 물, 글리세린, 향료', shipping: '약 3주' },
  };
  const { status, i18n, violations } = validateTranslations(source, translations);
  assert.equal(status, 'auto_approved');
  assert.deepEqual(Object.keys(violations), []);
  assert.equal(i18n.en.size, '130g');
  assert.equal(i18n.ko.shipping, '약 3주');
});

test('validateTranslations: a distorted language → review_required, that lang omitted', () => {
  const source = buildTranslationSource(sections);
  const clean = {
    zh: { overview: '洗净带出素肌之美。', usage: '取适量（2〜3cm）起泡清洗。', size: '130g', spec: '成分：水、甘油、香料', shipping: '约3周' },
    ko: { overview: '세안으로 맨살의 아름다움을 이끌어냅니다.', usage: '적당량(2〜3cm)을 거품 내어 씻습니다.', size: '130g', spec: '성분: 물, 글리세린, 향료', shipping: '약 3주' },
  };
  const translations = {
    // en size number wrong (130g → 999g)
    en: { overview: 'Draws out bare-skin beauty by washing.', usage: 'Lather an appropriate amount (2–3cm) and wash.', size: '999g', spec: 'Ingredients: water, glycerin, fragrance', shipping: 'About 3 weeks' },
    ...clean,
  };
  const { status, i18n, violations } = validateTranslations(source, translations);
  assert.equal(status, 'review_required');
  assert.ok(violations.en.some((v) => v.includes('number_mismatch')));
  assert.ok(!('en' in i18n), 'distorted language must not publish');
  assert.ok('zh' in i18n && 'ko' in i18n, 'clean languages still publish');
});

test('validateTranslations: missing language flagged', () => {
  const source = buildTranslationSource(sections);
  const { status, violations } = validateTranslations(source, { en: {}, zh: {}, ko: {} });
  assert.equal(status, 'review_required');
  // empty objects → each section empty_translation
  assert.ok(violations.en.length > 0);
});

test('SECTION_KEYS matches template order', () => {
  assert.deepEqual(SECTION_KEYS, ['overview', 'usage', 'size', 'spec', 'shipping']);
});
