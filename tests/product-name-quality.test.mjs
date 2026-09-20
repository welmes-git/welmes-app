import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractProductFacts,
  extractProductIdentifiers,
  hasJapanese,
  normalizeComparable,
  scoreReferenceSimilarity,
  validateEnglishProductName,
} from '../scripts/lib/product-name-quality.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/product-name-eval.json', import.meta.url), 'utf8'));

test('evaluation fixture has at least 30 diverse products', () => {
  assert.ok(fixtures.length >= 30);
  assert.ok(new Set(fixtures.map((item) => item.category)).size >= 8);
  for (const item of fixtures) {
    assert.ok(item.id && item.brand && item.sourceName && item.referenceName);
    assert.equal(hasJapanese(item.referenceName), false, item.id);
  }
});

test('normalization handles width, case, punctuation, and whitespace', () => {
  assert.equal(normalizeComparable(' Ｂｉｏｒｅ—UV  70ｍｌ '), 'biore-uv 70ml');
});

test('extracts measures, counts, SPF, PA, shade, and model identifiers', () => {
  const facts = extractProductFacts('UV ABC-123 No.16 70ｍｌ 20枚 SPF50+ PA++++');
  assert.deepEqual(facts.map(({ type, value }) => ({ type, value })), [
    { type: 'measure', value: '70ml' },
    { type: 'count', value: '20:sheets' },
    { type: 'spf', value: 'spf50+' },
    { type: 'pa', value: 'pa++++' },
    { type: 'shade', value: '16' },
    { type: 'model', value: 'abc-123' },
  ]);
});

test('curated references preserve all deterministic facts', () => {
  for (const item of fixtures) {
    const result = validateEnglishProductName({
      sourceName: item.sourceName,
      sourceDescription: item.sourceDescription,
      candidateName: item.referenceName,
      brand: item.brand,
      sourceType: 'manual',
    });
    assert.equal(result.status, 'auto_approved', `${item.id}: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.length, 0, item.id);
  }
});

test('Japanese passthrough baseline is rejected for English naming', () => {
  const item = fixtures[0];
  const result = validateEnglishProductName({
    sourceName: item.sourceName,
    sourceDescription: item.sourceDescription,
    candidateName: item.sourceName,
    brand: item.brand,
    sourceType: 'generated',
  });
  assert.equal(result.status, 'review_required');
  assert.ok(result.errors.some((error) => error.code === 'japanese_remaining'));
  assert.ok(result.errors.some((error) => error.code === 'brand_missing'));
});

test('missing size, count, SPF and refill qualifier are hard errors', () => {
  const result = validateEnglishProductName({
    sourceName: 'ビオレ UV シート つめかえ用 20枚 70ml SPF50+',
    candidateName: 'Biore UV Sheets',
    brand: 'Biore',
    sourceType: 'official',
    evidenceUrls: ['https://www.kao.com/example'],
  });
  const codes = result.errors.map((error) => error.code);
  assert.ok(codes.includes('missing_measure'));
  assert.ok(codes.includes('missing_count'));
  assert.ok(codes.includes('missing_spf'));
  assert.ok(codes.includes('missing_qualifier_refill'));
});

test('unsupported marketing and medical claims prevent auto approval', () => {
  const result = validateEnglishProductName({
    sourceName: 'キュレル フェイスクリーム 40g',
    candidateName: 'Curel Clinically Proven Organic Anti-Aging Facial Cream 40g',
    brand: 'Curel',
    sourceType: 'official',
    evidenceUrls: ['https://www.kao.com/example'],
  });
  assert.ok(result.errors.some((error) => error.code === 'unsupported_claim_clinically_proven'));
  assert.ok(result.errors.some((error) => error.code === 'unsupported_claim_organic'));
  assert.ok(result.errors.some((error) => error.code === 'unsupported_claim_anti_aging'));
  assert.equal(result.status, 'review_required');
});

test('generated names without evidence cannot auto approve themselves', () => {
  const result = validateEnglishProductName({
    sourceName: 'ビオレ 洗顔料 120g',
    candidateName: 'Biore Facial Cleanser 120g',
    brand: 'Biore',
    sourceType: 'generated',
  });
  assert.equal(result.errors.length, 0);
  assert.ok(result.confidence < 0.85);
  assert.equal(result.status, 'review_required');
});

test('grounded exact facts can cross the automatic approval threshold', () => {
  const result = validateEnglishProductName({
    sourceName: 'ビオレ UV アクアリッチ 70g SPF50+ PA++++',
    candidateName: 'Biore UV Aqua Rich SPF50+ PA++++ 70g',
    brand: 'Biore',
    sourceType: 'grounded',
    evidenceUrls: ['https://www.kao.com/global/en/products/biore/'],
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.status, 'auto_approved');
  assert.ok(result.confidence >= 0.85);
});

test('reference similarity is deterministic and order independent', () => {
  assert.equal(scoreReferenceSimilarity('Biore Watery Essence 70g', 'Biore 70g Watery Essence'), 1);
  assert.ok(scoreReferenceSimilarity('Biore Gel 70g', 'Biore Watery Essence 70g') < 1);
});


test('fixture report aggregates completed and missing results', async () => {
  const { evaluateFixtureResults } = await import('../scripts/evaluate-name-fixtures.mjs');
  const results = fixtures.slice(0, 2).map((item) => ({
    id: item.id,
    candidateName: item.referenceName,
    sourceType: 'manual',
    latencyMs: 100,
    estimatedCostUsd: 0.001,
  }));
  const report = evaluateFixtureResults(fixtures, results);
  assert.equal(report.summary.completed, 2);
  assert.equal(report.summary.missing, fixtures.length - 2);
  assert.equal(report.summary.autoApproved, 2);
  assert.equal(report.summary.p95LatencyMs, 100);
  assert.equal(report.summary.totalEstimatedCostUsd, 0.002);
});


test('extracts JAN separately without requiring it in the public title', () => {
  assert.deepEqual(extractProductIdentifiers('JAN：4901301234567 型番 ABC-123'), {
    jan: ['4901301234567'],
    models: ['abc-123'],
  });
});

test('rejects hallucinated size or count not present in source data', () => {
  const result = validateEnglishProductName({
    sourceName: 'ビオレ 洗顔料 120g',
    candidateName: 'Biore Facial Cleanser 120g 3 Pack',
    brand: 'Biore',
    sourceType: 'grounded',
    evidenceUrls: ['https://www.kao.com/example'],
  });
  assert.ok(result.errors.some((error) => error.code === 'unexpected_count'));
  assert.equal(result.status, 'review_required');
});

test('preserves named scent and accepts punctuation-insensitive brand spelling', () => {
  const accepted = validateEnglishProductName({
    sourceName: 'メンズビオレ シート ラベンダーの香り 12枚',
    candidateName: 'Mens Biore Lavender Scent Body Sheets 12 Sheets',
    brand: "Men's Biore",
    sourceType: 'manual',
  });
  assert.equal(accepted.errors.length, 0);

  const rejected = validateEnglishProductName({
    sourceName: 'ビオレ ハンドソープ 金木犀の香り 240ml',
    candidateName: 'Biore Floral Hand Soap 240ml',
    brand: 'Biore',
    sourceType: 'manual',
  });
  assert.ok(rejected.errors.some((error) => error.code === 'missing_qualifier_scent_osmanthus'));
});


test('sheet counts cannot be weakened to a generic count unit', () => {
  const result = validateEnglishProductName({
    sourceName: 'ビオレ ボディシート 20枚',
    candidateName: 'Biore Body Sheets 20 Count',
    brand: 'Biore',
    sourceType: 'manual',
  });
  assert.ok(result.errors.some((error) => error.code === 'missing_count'));
  assert.ok(result.errors.some((error) => error.code === 'unexpected_count'));
  assert.equal(result.status, 'review_required');
});
