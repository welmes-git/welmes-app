import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductDescription } from '../scripts/lib/sd-core.mjs';

// The frontend parser lives in TypeScript (src/lib/productDescription.ts). These
// tests exercise the same contract against the backend serializer so the two
// implementations cannot drift: whatever buildProductDescription() writes into
// products.description must be parseable back into template sections by the UI.
//
// A JS port of the frontend parser is inlined here deliberately — importing the
// .ts module would require a TS loader in the plain `node --test` runner.

const JA_LABEL_TO_KEY = {
  商品説明: 'overview', '【商品説明】': 'overview', 商品詳細: 'overview', 商品情報: 'overview',
  使用方法: 'usage', ご使用方法: 'usage', お手入れ方法: 'usage', 使い方: 'usage',
  ご使用上の注意: 'usage', '用法・用量': 'usage',
  'サイズ・容量': 'size', サイズ: 'size', 容量: 'size', 'サイズ/容量': 'size',
  内容量: 'size', '内容量・サイズ': 'size',
  規格: 'spec', 成分: 'spec', '素材・成分': 'spec', 仕様: 'spec',
  全成分: 'spec', 原材料: 'spec', 品質表示: 'spec',
  出荷: 'shipping', 納期: 'shipping', 発送: 'shipping', 出荷目安: 'shipping',
};
const SECTION_ORDER = { overview: 1, usage: 2, size: 3, spec: 4, shipping: 5 };

function sourceSections(description) {
  const text = String(description || '').trim();
  if (!text) return null;
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const byKey = new Map();
  const extras = [];
  blocks.forEach((block, i) => {
    const lines = block.split('\n');
    const firstLine = lines[0].trim().replace(/\s+/g, '');
    const key = JA_LABEL_TO_KEY[firstLine];
    if (key) {
      const value = lines.slice(1).join('\n').trim();
      if (value) byKey.set(key, byKey.has(key) ? `${byKey.get(key)}\n${value}` : value);
    } else if (i === 0) {
      byKey.set('overview', byKey.has('overview') ? `${byKey.get('overview')}\n${block}` : block);
    } else {
      extras.push({ key: null, value: block });
    }
  });
  const out = [...byKey.entries()]
    .sort((a, b) => SECTION_ORDER[a[0]] - SECTION_ORDER[b[0]])
    .map(([key, value]) => ({ key, value }));
  out.push(...extras);
  return out.length ? out : null;
}

function localizedSections(descriptionI18n, language) {
  const b = descriptionI18n?.[language];
  if (!b) return null;
  const out = [];
  for (const key of ['overview', 'usage', 'size', 'spec', 'shipping']) {
    if (b[key] && String(b[key]).trim()) out.push({ key, value: String(b[key]).trim() });
  }
  for (const e of b.extras || []) if (e?.value?.trim()) out.push({ key: null, value: `${e.label}\n${e.value}`.trim() });
  return out.length ? out : null;
}

const displaySections = (i18n, lang, description) => localizedSections(i18n, lang) ?? sourceSections(description);

const SCRAPED = buildProductDescription(
  '【商品説明】\n発売元：花王\nエタノール79.7vol%配合。',
  [
    { label: '使用方法', value: '手の平から3cmくらい離してスプレー。' },
    { label: 'サイズ・容量', value: '350 ml' },
    { label: '規格', value: '■生産地：日本' },
    { label: '出荷', value: '3週間程度' },
  ],
);

test('a scraped description round-trips into template sections for the UI', () => {
  const sections = sourceSections(SCRAPED.description);
  assert.ok(sections, 'must parse');
  assert.deepEqual(sections.filter((s) => s.key).map((s) => s.key), ['overview', 'usage', 'size', 'spec', 'shipping']);
  assert.equal(sections.find((s) => s.key === 'size').value, '350 ml');
  assert.equal(sections.find((s) => s.key === 'shipping').value, '3週間程度');
});

test('Japanese UI gets the template even though description_i18n has no ja entry', () => {
  const i18n = { en: { overview: 'EN overview' }, ko: { overview: 'KO overview' } };
  // ja is deliberately absent from description_i18n
  const ja = displaySections(i18n, 'ja', SCRAPED.description);
  assert.ok(ja, 'Japanese must still render sections (this was the reported bug)');
  assert.deepEqual(ja.filter((s) => s.key).map((s) => s.key), ['overview', 'usage', 'size', 'spec', 'shipping']);
  assert.match(ja.find((s) => s.key === 'overview').value, /発売元：花王/);
});

test('a translated language uses the translation, not the source', () => {
  const i18n = { ko: { overview: '한국어 개요', size: '350 ml' } };
  const ko = displaySections(i18n, 'ko', SCRAPED.description);
  assert.deepEqual(ko.map((s) => s.key), ['overview', 'size']);
  assert.equal(ko[0].value, '한국어 개요');
});

test('a language with no translation falls back to the structured source', () => {
  const i18n = { en: { overview: 'EN' } };
  const de = displaySections(i18n, 'de', SCRAPED.description);
  assert.ok(de);
  assert.deepEqual(de.filter((s) => s.key).map((s) => s.key), ['overview', 'usage', 'size', 'spec', 'shipping']);
});

test('label variants map to canonical keys', () => {
  const desc = ['本文', '', 'ご使用方法', '使い方の説明', '', '内容量', '340個', '', '全成分', '水'].join('\n');
  const sections = sourceSections(desc);
  assert.deepEqual(sections.filter((s) => s.key).map((s) => s.key), ['overview', 'usage', 'size', 'spec']);
  assert.equal(sections.find((s) => s.key === 'size').value, '340個');
});

test('same-key blocks merge instead of duplicating', () => {
  const desc = ['本文', '', '使用方法', 'A', '', '使用方法', 'B'].join('\n');
  const sections = sourceSections(desc);
  const usage = sections.filter((s) => s.key === 'usage');
  assert.equal(usage.length, 1, 'must not emit duplicate usage sections');
  assert.equal(usage[0].value, 'A\nB');
});

test('empty description yields null so the caller can hide the block', () => {
  assert.equal(sourceSections(''), null);
  assert.equal(sourceSections(undefined), null);
  assert.equal(displaySections(undefined, 'ja', ''), null);
});
