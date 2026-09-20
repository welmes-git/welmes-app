import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductDescription, DESCRIPTION_SECTION_TEMPLATE } from '../scripts/lib/sd-core.mjs';

// 실제 13157333 페이지에서 관찰한 데이터 (使用方法이 商品説明 본문에 포함됨)
const overview = [
  '洗うことで 素肌の美しさをひきだします。',
  '洗い上がり、いい肌ざわり。化粧水のなじみがよくなる。',
  'ニキビを防ぎます（殺菌・消炎成分配合）',
  '',
  '使用方法',
  '●適量（2〜3cm程度）を水やお湯で泡立てて洗い、あとはよく流します。',
].join('\n');

// SD 페이지 순서: 出荷 → サイズ → 規格 (템플릿 순서와 다름)
const sections = [
  { label: '出荷', value: '3週間程度' },
  { label: 'サイズ・容量', value: '130g' },
  { label: '規格', value: '■素材・成分：イソプロピルメチルフェノール＊…\n■商品札：無し' },
  {
    label: '注意事項',
    value: '画像の使用について版元様の監修が必要です。\nまた、ドロップシッピングの方はご注意ください。',
  },
];

test('normalizes every product to the same template order', () => {
  const { sections: structured } = buildProductDescription(overview, sections);
  const keys = structured.map((s) => s.key);
  // 템플릿 순서: overview → usage → size → spec → shipping
  assert.deepEqual(keys, ['overview', 'usage', 'size', 'spec', 'shipping']);
});

test('splits 使用方法 out of the overview body into its own section', () => {
  const { sections: structured } = buildProductDescription(overview, sections);
  const overviewSec = structured.find((s) => s.key === 'overview');
  const usageSec = structured.find((s) => s.key === 'usage');
  assert.match(overviewSec.value, /素肌の美しさ/);
  assert.doesNotMatch(overviewSec.value, /使用方法/);
  assert.doesNotMatch(overviewSec.value, /適量/);
  assert.match(usageSec.value, /適量/);
});

test('excludes the 注意事項 (dealer-only) section entirely', () => {
  const { description, sections: structured } = buildProductDescription(overview, sections);
  assert.doesNotMatch(description, /ドロップシッピング/);
  assert.doesNotMatch(description, /版元様の監修/);
  assert.ok(!structured.some((s) => s.label === '注意事項'));
});

test('serialized description follows template order (overview, usage, size, spec, shipping)', () => {
  const { description } = buildProductDescription(overview, sections);
  const iOverview = description.indexOf('素肌の美しさ');
  const iUsage = description.indexOf('適量');
  const iSize = description.indexOf('130g');
  const iSpec = description.indexOf('素材・成分');
  const iShip = description.indexOf('3週間程度');
  assert.ok(iOverview < iUsage, 'overview before usage');
  assert.ok(iUsage < iSize, 'usage before size');
  assert.ok(iSize < iSpec, 'size before spec');
  assert.ok(iSpec < iShip, 'spec before shipping');
});

test('maps SD label variants to canonical keys', () => {
  const { sections } = buildProductDescription('', [
    { label: '容量', value: '200ml' },
    { label: '成分', value: '水、グリセリン' },
    { label: '納期', value: '1週間程度' },
  ]);
  const keys = sections.map((s) => s.key);
  assert.deepEqual(keys, ['size', 'spec', 'shipping']);
});

test('keeps unknown labels as extras after the template sections', () => {
  const { sections } = buildProductDescription(overview, [
    { label: 'サイズ・容量', value: '130g' },
    { label: '原産国', value: '日本' }, // 템플릿에 없는 라벨
  ]);
  const last = sections[sections.length - 1];
  assert.equal(last.key, null);
  assert.equal(last.label, '原産国');
  assert.equal(last.value, '日本');
});

test('every section carries a canonical key (or null) and value for translation', () => {
  const { sections } = buildProductDescription(overview, sections0());
  for (const s of sections) {
    assert.ok('key' in s && 'label' in s && 'value' in s);
    assert.ok(typeof s.value === 'string' && s.value.length > 0);
  }
});

function sections0() {
  return [
    { label: 'サイズ・容量', value: '130g' },
    { label: '規格', value: '成分表' },
  ];
}

test('template constant is stable and ordered', () => {
  const orders = DESCRIPTION_SECTION_TEMPLATE.map((t) => t.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
  assert.deepEqual(
    DESCRIPTION_SECTION_TEMPLATE.map((t) => t.key),
    ['overview', 'usage', 'size', 'spec', 'shipping'],
  );
});

test('respects maxLength', () => {
  const { description } = buildProductDescription('', [{ label: '規格', value: 'あ'.repeat(10000) }], { maxLength: 100 });
  assert.ok(description.length <= 100);
});

test('handles empty input gracefully', () => {
  const { description, sections } = buildProductDescription('', []);
  assert.equal(description, '');
  assert.deepEqual(sections, []);
});
