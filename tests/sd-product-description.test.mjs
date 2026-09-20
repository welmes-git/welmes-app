import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductDescription } from '../scripts/lib/sd-core.mjs';

// 실제 13157333 페이지에서 관찰한 데이터
const overview = [
  '【商品説明】',
  '洗うことで 素肌の美しさをひきだします。',
  '洗い上がり、いい肌ざわり。化粧水のなじみがよくなる。',
  'ニキビを防ぎます（殺菌・消炎成分配合）',
  '',
  '使用方法',
  '●適量（2〜3cm程度）を水やお湯で泡立てて洗い、あとはよく流します。',
].join('\n');

const sections = [
  { label: '出荷', value: '3週間程度' },
  { label: 'サイズ・容量', value: '130g' },
  { label: '規格', value: '■素材・成分：イソプロピルメチルフェノール＊、グリチルリチン酸ジカリウム＊…\n■商品札：無し' },
  {
    label: '注意事項',
    value: [
      '＝＝＝＝＝＝＝＝＝＝＝＝',
      '画像の使用についてですが、編集して使用される場合に版元様の監修が必要な場合があります。',
      '広告文責につきましては、店舗様の責務となりますので、',
      '【重要】在庫について 欠品のないようにしておりますが…',
      'また、ドロップシッピングの方はご注意の上、ご発注をお願いいたします。',
    ].join('\n'),
  },
];

test('excludes the 注意事項 (dealer-only) section entirely', () => {
  const { description, sections: structured } = buildProductDescription(overview, sections);
  assert.doesNotMatch(description, /注意事項/);
  assert.doesNotMatch(description, /ドロップシッピング/);
  assert.doesNotMatch(description, /版元様の監修/);
  assert.ok(!structured.some((s) => s.label === '注意事項'));
});

test('keeps buyer-useful sections (shipping, size, spec) with labels', () => {
  const { description, sections: structured } = buildProductDescription(overview, sections);
  assert.match(description, /出荷\n3週間程度/);
  assert.match(description, /サイズ・容量\n130g/);
  assert.match(description, /素材・成分/);
  const labels = structured.map((s) => s.label);
  assert.deepEqual(labels, ['商品説明', '出荷', 'サイズ・容量', '規格']);
});

test('keeps the product overview and 使用方法', () => {
  const { description } = buildProductDescription(overview, sections);
  assert.match(description, /素肌の美しさをひきだします/);
  assert.match(description, /使用方法/);
  assert.match(description, /適量/);
});

test('strips dealer-boilerplate lines that leak into the overview body', () => {
  const dirty = [
    '洗うことで 素肌の美しさをひきだします。',
    '＝＝＝＝＝＝＝＝＝＝＝＝',
    '画像の使用についてですが、版元様の監修が必要です。',
    'Amazon.co.jpでの販売はご遠慮ください。',
    'ドロップシッピングの方はご注意ください。',
    '上品ですがすがしいフローラルの香り',
  ].join('\n');
  const { description } = buildProductDescription(dirty, []);
  assert.match(description, /素肌の美しさ/);
  assert.match(description, /フローラルの香り/);
  assert.doesNotMatch(description, /画像の使用/);
  assert.doesNotMatch(description, /Amazon/i);
  assert.doesNotMatch(description, /ドロップシッピング/);
  assert.doesNotMatch(description, /＝＝＝/);
});

test('returns structured sections array for downstream translation', () => {
  const { sections: structured } = buildProductDescription(overview, sections);
  assert.equal(structured[0].label, '商品説明');
  assert.ok(structured[0].value.length > 0);
  // 각 섹션은 개별 번역 단위가 될 수 있다
  for (const s of structured) {
    assert.ok(typeof s.label === 'string' && typeof s.value === 'string');
  }
});

test('respects maxLength', () => {
  const long = { label: '規格', value: 'あ'.repeat(10000) };
  const { description } = buildProductDescription('', [long], { maxLength: 100 });
  assert.ok(description.length <= 100);
});

test('handles empty input gracefully', () => {
  const { description, sections } = buildProductDescription('', []);
  assert.equal(description, '');
  assert.deepEqual(sections, []);
});

test('drops empty sections and trims whitespace', () => {
  const { sections } = buildProductDescription('  overview  ', [
    { label: '出荷', value: '   ' },
    { label: '', value: 'orphan' },
    { label: 'サイズ・容量', value: ' 130g ' },
  ]);
  const labels = sections.map((s) => s.label);
  assert.deepEqual(labels, ['商品説明', 'サイズ・容量']);
  assert.equal(sections.find((s) => s.label === 'サイズ・容量').value, '130g');
});
