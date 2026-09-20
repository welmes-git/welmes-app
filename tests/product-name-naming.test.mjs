import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  evaluateNameContract,
  hasAutoApproveBlockingWarning,
  validateEnglishProductName,
} from '../scripts/lib/product-name-quality.mjs';
import {
  assessOfficialEvidence,
  enrichProductName,
  isBackfillTarget,
  nextBackfillCursor,
  selectBackfillTargets,
  verifyOfficialEvidence,
} from '../scripts/lib/product-name-enrichment.mjs';
import { parseBackfillArgs } from '../scripts/backfill-product-names.mjs';

const fixtures = JSON.parse(fs.readFileSync(new URL('../scripts/fixtures/product-name-eval.json', import.meta.url), 'utf8'));

// ── Fixture exactTokens / allowedAlternatives contract ─────────────────
test('fixtures with a contract expose exactTokens and optional allowedAlternatives', () => {
  const withContract = fixtures.filter((item) => Array.isArray(item.exactTokens));
  assert.equal(withContract.length, fixtures.length, 'every fixture must define an exact-token contract');
  assert.ok(withContract.length >= 30, 'expected at least 30 contract fixtures');
  for (const item of withContract) {
    assert.ok(item.exactTokens.length > 0, item.id);
    if (item.allowedAlternatives) {
      assert.equal(typeof item.allowedAlternatives, 'object', item.id);
      for (const [token, alts] of Object.entries(item.allowedAlternatives)) {
        assert.ok(item.exactTokens.includes(token), `${item.id}: alt key ${token} must be an exact token`);
        assert.ok(Array.isArray(alts), `${item.id}: alternatives must be an array`);
      }
    }
  }
});

test('every contract reference name satisfies its own exactTokens contract', () => {
  for (const item of fixtures.filter((f) => Array.isArray(f.exactTokens))) {
    const result = evaluateNameContract(item.referenceName, item);
    assert.equal(result.ok, true, `${item.id}: missing ${JSON.stringify(result.missing)}`);
  }
});

test('allowedAlternatives satisfy an exact token via a substitute spelling', () => {
  const refill = fixtures.find((f) => f.id === 'biore-perfect-oil-refill');
  // Substituting the allowed alternative "Replacement" for "Refill" still passes.
  const alt = refill.referenceName.replace('Refill', 'Replacement');
  assert.equal(evaluateNameContract(alt, refill).ok, true);
  // A token with no alternative that is absent fails the contract.
  const dropped = refill.referenceName.replace('210ml', '');
  assert.equal(evaluateNameContract(dropped, refill).ok, false);
});

// ── Manufacturer ↔ brand confusion ─────────────────────────────────────
test('candidate that promotes a product to its manufacturer entity is rejected', () => {
  const result = validateEnglishProductName({
    sourceName: 'ビオレ UV アクアリッチ 70g',
    candidateName: 'Kao Corporation Biore UV Aqua Rich 70g',
    brand: 'Biore',
    sourceType: 'manual',
  });
  assert.ok(result.errors.some((e) => e.code === 'manufacturer_brand_confusion'));
  assert.equal(result.status, 'review_required');
});

test('manufacturer suffix is allowed when the brand itself is a manufacturer', () => {
  const result = validateEnglishProductName({
    sourceName: '小林製薬 熱さまシート 大人用 16枚',
    candidateName: 'Kobayashi Pharmaceutical Cooling Gel Sheets for Adults 16 Sheets',
    brand: 'Kobayashi Pharmaceutical',
    sourceType: 'manual',
  });
  assert.ok(!result.errors.some((e) => e.code === 'manufacturer_brand_confusion'));
});

// ── Provider/validation blocking warnings ──────────────────────────────
test('hasAutoApproveBlockingWarning flags uncertainty and self-official claims', () => {
  assert.equal(hasAutoApproveBlockingWarning(['The size was ambiguous.']), true);
  assert.equal(hasAutoApproveBlockingWarning(['I could not verify the model code.']), true);
  assert.equal(hasAutoApproveBlockingWarning(['This is the official manufacturer name.']), true);
  assert.equal(hasAutoApproveBlockingWarning([{ message: 'guessed the scent' }]), true);
  assert.equal(hasAutoApproveBlockingWarning(['Translated from Japanese source.']), false);
  assert.equal(hasAutoApproveBlockingWarning([]), false);
});

test('a blocking provider warning downgrades an otherwise-approvable official result', async () => {
  const product = {
    id: 501, name: 'ビオレ UV アクアリッチ 70g', brand: 'ビオレ', category: 'Sun Care',
    description: '日焼け止め SPF50+ PA++++', sourcePayload: { jan: '4901301413246' },
  };
  const sources = [{ brand_name: 'ビオレ', canonical_brand_name: 'Biore', official_domain: 'kao.com', active: true }];
  const providerResult = {
    provider: 'gemini', model: 'gemini-3.8-flash', promptVersion: 'product-name-v1',
    candidateName: 'Biore UV Aqua Rich SPF50+ PA++++ 70g',
    seoTitle: 'Biore UV Aqua Rich SPF50+ PA++++ 70g Wholesale | WELMES',
    seoDescription: 'Biore UV sunscreen 70g SPF50+ PA++++.',
    searchAliases: [], warnings: ['The exact variant name was ambiguous.'],
    evidenceUrls: ['https://redirect.example/a'], sourceType: 'grounded',
    inputTokens: 400, outputTokens: 90, estimatedCostUsd: 0.001, latencyMs: 700,
  };
  const result = await enrichProductName(product, {
    officialSources: sources,
    callProvider: async () => ({ ...providerResult }),
    inspectUrl: async () => ({
      resolvedUrl: 'https://www.kao.com/products/biore',
      title: providerResult.candidateName,
      body: `JAN ${product.sourcePayload.jan} ${providerResult.candidateName}`,
    }),
  });
  assert.equal(result.sourceType, 'official');
  assert.equal(result.validation.status, 'review_required');
  assert.ok(result.validation.errors.some((e) => e.code === 'blocking_warning'));
});

// ── JAN-required and model-required official evidence ──────────────────
test('when the source has a JAN, official evidence must reproduce the JAN', async () => {
  const base = {
    officialDomains: ['kao.com'],
    candidateName: 'Biore UV Aqua Rich 70g',
    sourceText: 'ビオレ UV アクアリッチ 70g',
    jan: '4901301413246',
  };
  const matched = await verifyOfficialEvidence({ ...base, evidenceUrls: ['https://a.example'] }, {
    inspectUrl: async () => ({
      resolvedUrl: 'https://www.kao.com/products/biore',
      title: 'Biore UV Aqua Rich 70g', body: 'JAN 4901301413246 Biore UV Aqua Rich 70g',
    }),
  });
  assert.equal(matched[0].verified, true);
  assert.equal(matched[0].janMatched, true);

  const missingJan = await verifyOfficialEvidence({ ...base, evidenceUrls: ['https://b.example'] }, {
    inspectUrl: async () => ({
      resolvedUrl: 'https://www.kao.com/products/biore',
      title: 'Biore UV Aqua Rich 70g', body: 'Biore UV Aqua Rich 70g high spf sunscreen watery',
    }),
  });
  assert.equal(missingJan[0].janMatched, false);
  assert.equal(missingJan[0].identityBlocked, true);
  assert.equal(missingJan[0].verified, false, 'title tokens alone cannot pass when a JAN is required');
});

test('when the source has a model code, official evidence must reproduce the model', async () => {
  const missingModel = await verifyOfficialEvidence({
    officialDomains: ['kao.com'],
    candidateName: 'Heroine Make Mascara ABC-123',
    sourceText: 'ヒロインメイク マスカラ 型番 ABC-123',
    evidenceUrls: ['https://c.example'],
  }, {
    inspectUrl: async () => ({
      resolvedUrl: 'https://www.kao.com/products/heroine',
      title: 'Heroine Make Mascara', body: 'Heroine Make Mascara long curl advanced film',
    }),
  });
  assert.equal(missingModel[0].modelMatched, false);
  assert.equal(missingModel[0].identityBlocked, true);
  assert.equal(missingModel[0].verified, false);
});

// ── Multiple-evidence disagreement ─────────────────────────────────────
test('assessOfficialEvidence blocks when official pages disagree on the JAN', () => {
  const evidence = [
    { officialDomain: 'kao.com', verified: true, janMatched: true, identityBlocked: false },
    { officialDomain: 'kao.com', verified: true, janMatched: false, identityBlocked: false },
  ];
  const result = assessOfficialEvidence(evidence, { requireJan: true });
  assert.equal(result.official, false);
  assert.ok(result.reasons.includes('evidence_jan_disagreement'));
});

test('assessOfficialEvidence flags a verified page that contradicts a required identity gate', () => {
  const evidence = [
    { officialDomain: 'kao.com', verified: true, janMatched: true, identityBlocked: false },
    { officialDomain: 'kao.com', verified: false, janMatched: false, identityBlocked: true },
  ];
  const result = assessOfficialEvidence(evidence, { requireJan: true });
  assert.equal(result.official, false);
  assert.ok(result.reasons.includes('evidence_identity_conflict'));
});

test('assessOfficialEvidence passes with a single consistent verified official page', () => {
  const result = assessOfficialEvidence([
    { officialDomain: 'kao.com', verified: true, janMatched: true, identityBlocked: false },
  ], { requireJan: true });
  assert.equal(result.official, true);
  assert.deepEqual(result.reasons, []);
});

// ── Backfill active-first cursor ───────────────────────────────────────
const products = [
  { id: 10, name: 'A 日本語', name_en: 'A 日本語', status: 'inactive', name_en_status: null },
  { id: 20, name: 'B 日本語', name_en: 'B 日本語', status: 'active', name_en_status: null },
  { id: 30, name: 'C 日本語', name_en: 'C 日本語', status: 'inactive', name_en_status: null },
  { id: 40, name: 'D 日本語', name_en: 'D 日本語', status: 'active', name_en_status: null },
];

test('active-first ordering then id, cursor resumes without skipping the inactive phase', () => {
  const first = selectBackfillTargets(products, { limit: 2 });
  // active(20,40) before inactive(10,30)
  assert.deepEqual(first.map((p) => p.id), [20, 40]);

  const cursor1 = nextBackfillCursor(first);
  // Last processed (40) was active → still in active phase, high-water 40.
  assert.deepEqual(cursor1, { activeDone: false, afterId: 40 });

  // Resume: no active rows remain beyond 40, so the inactive phase begins and is
  // NOT skipped by the old max-id bug (10 and 30 < 40 would have been skipped).
  const second = selectBackfillTargets(products, { cursor: cursor1, limit: 10 });
  assert.deepEqual(second.map((p) => p.id), [10, 30]);

  const cursor2 = nextBackfillCursor(second);
  assert.deepEqual(cursor2, { activeDone: true, afterId: 30 });
  const third = selectBackfillTargets(products, { cursor: cursor2, limit: 10 });
  assert.deepEqual(third.map((p) => p.id), []);
});

test('legacy afterId cursor still filters by id when no phase cursor is used', () => {
  const targets = selectBackfillTargets(products, { afterId: 20, activeFirst: false });
  assert.ok(targets.every((p) => p.id > 20));
});

// ── Clean-pending manual-name protection ───────────────────────────────
test('a clean manual English name on a pending/legacy row is protected from backfill', () => {
  const manual = { id: 99, name: 'ビオレ 洗顔料 120g', name_en: 'Biore Facial Cleanser 120g', status: 'active', name_en_status: null };
  assert.equal(isBackfillTarget(manual), false, 'manual clean name must be protected');
  // Explicit allowlist can force reprocessing.
  assert.equal(isBackfillTarget(manual, { allowlisted: true }), true);
  // Via selectBackfillTargets, an --ids allowlist bypasses the protection.
  assert.deepEqual(selectBackfillTargets([manual]).map((p) => p.id), []);
  assert.deepEqual(selectBackfillTargets([manual], { ids: [99] }).map((p) => p.id), [99]);
});

test('a pending row that still equals its Japanese source name is eligible', () => {
  const untouched = { id: 100, name: 'ビオレ 洗顔料 120g', name_en: 'ビオレ 洗顔料 120g', status: 'active', name_en_status: 'pending' };
  assert.equal(isBackfillTarget(untouched), true);
});

// ── CLI bounds / operational guardrails ────────────────────────────────
test('parseBackfillArgs enforces batch-size and max-batches bounds', () => {
  const parsed = parseBackfillArgs(['--batch-size=50', '--max-batches=10', '--after=40', '--after-inactive']);
  assert.equal(parsed.batchSize, 50);
  assert.equal(parsed.maxBatches, 10);
  assert.equal(parsed.afterId, 40);
  assert.equal(parsed.afterInactive, true);
  assert.throws(() => parseBackfillArgs(['--batch-size=0']), /batch-size/);
  assert.throws(() => parseBackfillArgs(['--batch-size=51']), /batch-size/);
  assert.throws(() => parseBackfillArgs(['--max-batches=0']), /max-batches/);
  assert.throws(() => parseBackfillArgs(['--max-batches=1001']), /max-batches/);
  assert.throws(() => parseBackfillArgs(['--lease=10']), /lease/);
});

test('backfill default batch-size never exceeds the DB claim limit of 50', () => {
  const parsed = parseBackfillArgs([]);
  assert.ok(parsed.batchSize <= 50);
  assert.ok(parsed.maxBatches >= 1);
});
