import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductDescription, parseStoredDescription } from '../scripts/lib/sd-core.mjs';
import { buildTranslationSource } from '../scripts/lib/product-description-i18n.mjs';
import { buildCompletionParams, processClaimedRun, parseWorkerArgs } from '../scripts/translate-product-descriptions.mjs';

test('parseStoredDescription round-trips buildProductDescription serialization', () => {
  const overview = '素肌の美しさをひきだします。\n使用方法\n適量を泡立てて洗います。';
  const built = buildProductDescription(overview, [
    { label: 'サイズ・容量', value: '130g' },
    { label: '規格', value: '成分：水、グリセリン、香料' },
    { label: '出荷', value: '3週間程度' },
  ]);
  const reparsed = parseStoredDescription(built.description);
  const keys = reparsed.map((s) => s.key);
  assert.deepEqual(keys, ['overview', 'usage', 'size', 'spec', 'shipping']);
  assert.match(reparsed.find((s) => s.key === 'size').value, /130g/);
  assert.match(reparsed.find((s) => s.key === 'spec').value, /グリセリン/);
});

test('parseStoredDescription treats a plain first block as overview', () => {
  const sections = parseStoredDescription('just some description text');
  assert.equal(sections.length, 1);
  assert.equal(sections[0].key, 'overview');
});

test('parseWorkerArgs parses langs and validates limits', () => {
  const a = parseWorkerArgs(['--ids=1,2', '--langs=en,ko', '--limit=5']);
  assert.deepEqual(a.ids, [1, 2]);
  assert.deepEqual(a.langs, ['en', 'ko']);
  assert.equal(a.limit, 5);
  assert.throws(() => parseWorkerArgs(['--limit=99']), /--limit/);
  assert.throws(() => parseWorkerArgs(['--enqueue-only']), /--enqueue-only requires --ids/);
});

const sections = [
  { key: 'overview', label: '商品説明', value: '素肌の美しさをひきだします。' },
  { key: 'size', label: 'サイズ・容量', value: '130g' },
  { key: 'spec', label: '規格', value: '成分：水、グリセリン、香料' },
  { key: 'shipping', label: '出荷', value: '3週間程度' },
];

function runFor(source) {
  return {
    id: 'run-1',
    product_id: 97,
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    prompt_version: 'product-desc-i18n-v1',
    input_hash: 'x',
    target_langs: source.targetLangs,
    source_payload: { sections: source.sections, sourceLang: 'ja', targetLangs: source.targetLangs },
  };
}

test('buildCompletionParams publishes clean langs and downgrades distorted ones', () => {
  const source = buildTranslationSource(sections, ['en', 'ko']);
  const providerResult = {
    model: 'gemini-3.8-flash', inputTokens: 100, outputTokens: 80, estimatedCostUsd: 0.001, latencyMs: 900,
    translations: {
      en: { overview: 'Draws out bare-skin beauty.', size: '999g', spec: 'Ingredients: water, glycerin, fragrance', shipping: 'About 3 weeks' }, // size wrong
      ko: { overview: '맨살의 아름다움을 이끌어냅니다.', size: '130g', spec: '성분: 물, 글리세린, 향료', shipping: '약 3주' },
    },
  };
  const { rpcParams, status, publishedLangs } = buildCompletionParams(runFor(source), source, providerResult, 'worker-1');
  assert.equal(status, 'review_required');
  assert.deepEqual(publishedLangs, ['ko']); // en dropped due to number_mismatch
  assert.equal(rpcParams.p_translations.ko.size, '130g');
  assert.ok(!('en' in rpcParams.p_translations));
  assert.equal(rpcParams.p_status, 'review_required');
});

test('processClaimedRun (dry-run) validates against source without DB calls', async () => {
  const source = buildTranslationSource(sections, ['en']);
  const fakeCall = async () => ({
    model: 'gemini-3.8-flash', inputTokens: 10, outputTokens: 10, estimatedCostUsd: 0.0001, latencyMs: 100,
    translations: { en: { overview: 'Draws out bare-skin beauty.', size: '130g', spec: 'Ingredients: water, glycerin, fragrance', shipping: 'About 3 weeks' } },
  });
  // input_hash omitted → hash check skipped
  const run = { ...runFor(source), input_hash: '' };
  const { completion, completionStatus } = await processClaimedRun(run, { workerId: 'w', dryRun: true, call: fakeCall });
  assert.equal(completionStatus, 'dry-run');
  assert.equal(completion.status, 'auto_approved');
  assert.deepEqual(completion.publishedLangs, ['en']);
});

test('processClaimedRun rejects a source that no longer matches the queued hash', async () => {
  const source = buildTranslationSource(sections, ['en']);
  const run = { ...runFor(source), input_hash: 'stale-hash-does-not-match' };
  await assert.rejects(
    () => processClaimedRun(run, { workerId: 'w', dryRun: true, call: async () => ({ translations: {} }) }),
    /input hash does not match/,
  );
});
