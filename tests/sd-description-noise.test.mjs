import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductDescription, parseStoredDescription } from '../scripts/lib/sd-core.mjs';

// Regression: the manufacturer-renewal notice was wrapped in `-----` separator
// lines inside the overview. Those survived cleaning, and because the overview
// then still contained a blank line, serializing to `description` and re-parsing
// split it into a phantom unlabeled block (extras) that rendered on the product
// page and was sent to the translator.
const OVERVIEW_WITH_SEPARATORS = [
  '【商品説明】',
  'やさしく洗う派も。しっかり洗う派も。',
  '＊SPT:Skin Purifying Technology',
  '',
  '---------------------------------------------------------',
  'メーカーリニューアルに伴い、',
  'パッケージ・内容等予告なく変更する場合がございます。',
  '予めご了承ください。',
  '---------------------------------------------------------',
].join('\n');

const DETAIL_SECTIONS = [
  { label: 'サイズ・容量', value: '200ml' },
  { label: '規格', value: '■生産地：日本\n■素材・成分：水、グリセリン' },
  { label: '出荷', value: '3週間程度' },
];

test('hyphen separator lines and renewal boilerplate are stripped from the overview', () => {
  const { description, sections } = buildProductDescription(OVERVIEW_WITH_SEPARATORS, DETAIL_SECTIONS);
  assert.doesNotMatch(description, /-{3,}/, 'separator lines must not survive');
  assert.doesNotMatch(description, /メーカーリニューアル/);
  assert.doesNotMatch(description, /予めご了承/);
  // real product copy is preserved
  assert.match(description, /やさしく洗う派も/);
  assert.match(description, /SPT:Skin Purifying Technology/);
  const overview = sections.find((s) => s.key === 'overview');
  assert.ok(overview, 'overview section still exists');
  assert.doesNotMatch(overview.value, /-{3,}/);
});

test('no phantom extras survive a description round-trip', () => {
  const { description, sections } = buildProductDescription(OVERVIEW_WITH_SEPARATORS, DETAIL_SECTIONS);
  // build → serialize → re-parse must yield the same canonical key set and no
  // unlabeled (null-key) blocks.
  const reparsed = parseStoredDescription(description);
  const builtKeys = sections.filter((s) => s.key).map((s) => s.key);
  const reparsedKeys = reparsed.filter((s) => s.key).map((s) => s.key);
  assert.deepEqual(reparsedKeys, builtKeys, 'round-trip must preserve the section keys');
  assert.equal(reparsed.filter((s) => !s.key).length, 0, 'no phantom extras');
});

test('section values contain no blank lines (keeps the round-trip unambiguous)', () => {
  const { sections } = buildProductDescription(OVERVIEW_WITH_SEPARATORS, DETAIL_SECTIONS);
  for (const s of sections) {
    assert.doesNotMatch(s.value, /\n\s*\n/, `section ${s.key} must not contain blank lines`);
  }
});

test('multi-line spec content is preserved (collapsing must not lose data)', () => {
  const { sections } = buildProductDescription('本文', DETAIL_SECTIONS);
  const spec = sections.find((s) => s.key === 'spec');
  assert.match(spec.value, /生産地：日本/);
  assert.match(spec.value, /素材・成分：水、グリセリン/);
  assert.equal(spec.value.split('\n').length, 2, 'both spec lines survive');
});

test('genuinely unknown labels are still kept as extras (no data loss)', () => {
  const { sections } = buildProductDescription('本文', [
    ...DETAIL_SECTIONS,
    { label: '原産国', value: '日本' },
  ]);
  const extras = sections.filter((s) => !s.key);
  assert.equal(extras.length, 1);
  assert.equal(extras[0].label, '原産国');
  assert.equal(extras[0].value, '日本');
});

test('＝ separators remain filtered (existing behaviour preserved)', () => {
  const { description } = buildProductDescription('本文\n＝＝＝＝＝＝\nもっと本文', []);
  assert.doesNotMatch(description, /＝{3,}/);
  assert.match(description, /本文/);
  assert.match(description, /もっと本文/);
});
