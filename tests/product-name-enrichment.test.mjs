import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPublicHttpsUrl,
  assessOfficialEvidence,
  buildEnrichmentInput,
  enrichProductName,
  hashEnrichmentInput,
  inspectEvidenceUrl,
  isOfficialDomain,
  isPrivateIp,
  isRetryableError,
  matchOfficialSources,
  retryDelaySeconds,
  slugifyProductName,
  validateEnrichmentOutput,
  verifyOfficialEvidence,
} from '../scripts/lib/product-name-enrichment.mjs';

const product = {
  id: 167,
  name: 'ビオレ UV アクアリッチ ウォータリーエッセンス 70g',
  brand: 'ビオレ',
  category: 'Sun Care',
  description: '日焼け止め SPF50+ PA++++',
  sourcePayload: { jan: '4901301413246' },
};
const sources = [
  { brand_name: 'ビオレ', canonical_brand_name: 'Biore', official_domain: 'kao.com', active: true },
  { brand_name: 'Other', canonical_brand_name: 'Other', official_domain: 'other.example', active: true },
];
const providerResult = {
  provider: 'gemini', model: 'gemini-3.8-flash', promptVersion: 'product-name-v1',
  candidateName: 'Biore UV Aqua Rich Watery Essence SPF50+ PA++++ 70g',
  seoTitle: 'Biore UV Aqua Rich Watery Essence SPF50+ PA++++ 70g Wholesale | WELMES',
  seoDescription: 'Biore UV sunscreen in a 70g format with SPF50+ PA++++ for wholesale buyers.',
  searchAliases: ['Biore Aqua Rich Essence', 'ビオレ アクアリッチ'],
  warnings: [], evidenceUrls: ['https://grounding.example/redirect'], sourceType: 'grounded',
  inputTokens: 500, outputTokens: 100, estimatedCostUsd: 0.001, latencyMs: 1200,
};

test('official source aliases produce canonical brand and domains', () => {
  assert.deepEqual(matchOfficialSources('ビオレ', sources), { canonicalBrand: 'Biore', domains: ['kao.com'] });
  assert.deepEqual(matchOfficialSources('Unknown', sources), { canonicalBrand: 'Unknown', domains: [] });
  const input = buildEnrichmentInput(product, sources);
  assert.equal(input.brand, 'Biore');
  assert.deepEqual(input.officialDomains, ['kao.com']);
  assert.equal(input.jan, '4901301413246');
});

test('input hash is canonical, deterministic, model-sensitive, and strategy-sensitive', () => {
  const a = { brand: 'Biore', sourceName: 'Name', nested: { b: 2, a: 1 } };
  const b = { nested: { a: 1, b: 2 }, sourceName: 'Name', brand: 'Biore' };
  assert.equal(hashEnrichmentInput(a, { provider: 'gemini', model: 'one' }), hashEnrichmentInput(b, { provider: 'gemini', model: 'one' }));
  assert.notEqual(hashEnrichmentInput(a, { provider: 'gemini', model: 'one' }), hashEnrichmentInput(a, { provider: 'gemini', model: 'two' }));
  assert.notEqual(
    hashEnrichmentInput(a, { provider: 'gemini', model: 'one', grounding: true }),
    hashEnrichmentInput(a, { provider: 'gemini', model: 'one', grounding: false }),
  );
});

test('official domain matching accepts subdomains but not suffix attacks', () => {
  assert.equal(isOfficialDomain('https://www.kao.com/products/1', ['kao.com']), true);
  assert.equal(isOfficialDomain('https://shop.kao.com/products/1', ['kao.com']), true);
  assert.equal(isOfficialDomain('https://kao.com.attacker.example/products/1', ['kao.com']), false);
});

test('private IP detection covers local IPv4 and IPv6 ranges', () => {
  for (const value of ['127.0.0.1', '10.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPrivateIp(value), true, value);
  }
  assert.equal(isPrivateIp('93.184.216.34'), false);
  assert.equal(isPrivateIp('2606:2800:220:1:248:1893:25c8:1946'), false);
});

test('evidence fetch rejects non-HTTPS, localhost and private DNS answers', async () => {
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(() => assertPublicHttpsUrl('http://example.com', publicLookup), /HTTPS/);
  await assert.rejects(() => assertPublicHttpsUrl('https://localhost/page', publicLookup), /Local/);
  await assert.rejects(() => assertPublicHttpsUrl('https://safe.example/page', async () => [{ address: '10.0.0.2', family: 4 }]), /private IP/);
});

test('evidence inspector validates every redirect and extracts bounded HTML text', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location: 'https://www.kao.com/product' } });
    return new Response('<html><head><title>Biore Aqua Rich 70g</title></head><body>JAN 4901301413246</body></html>', {
      status: 200, headers: { 'content-type': 'text/html', 'content-length': '100' },
    });
  };
  const inspected = await inspectEvidenceUrl('https://redirect.example/start', {
    fetchImpl, lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  assert.equal(inspected.resolvedUrl, 'https://www.kao.com/product');
  assert.equal(inspected.title, 'Biore Aqua Rich 70g');
  assert.match(inspected.body, /4901301413246/);
  assert.equal(calls.length, 2);
});

test('official evidence requires both registered domain and identity match', async () => {
  const evidence = await verifyOfficialEvidence({
    evidenceUrls: ['https://redirect.example/a'], officialDomains: ['kao.com'],
    candidateName: providerResult.candidateName,
    sourceText: `${product.name}\n${product.description}`,
    jan: product.sourcePayload.jan,
  }, {
    inspectUrl: async () => ({
      resolvedUrl: 'https://www.kao.com/global/en/products/biore/aqua-rich',
      title: providerResult.candidateName,
      body: `Official product JAN ${product.sourcePayload.jan}`,
    }),
  });
  assert.equal(evidence[0].officialDomain, 'kao.com');
  assert.equal(evidence[0].verified, true);
  assert.ok(evidence[0].matchedBy.includes('jan'));

  const retailer = await verifyOfficialEvidence({
    evidenceUrls: ['https://retailer.example/a'], officialDomains: ['kao.com'],
    candidateName: providerResult.candidateName, sourceText: product.name,
  }, {
    inspectUrl: async () => ({ resolvedUrl: 'https://retailer.example/a', title: providerResult.candidateName, body: providerResult.candidateName }),
  });
  assert.equal(retailer[0].verified, false);
});

test('official evidence can auto-approve while unverified grounding falls back to generated review', async () => {
  const officialCalls = [];
  const callOfficialProvider = async (_provider, _input, options) => {
    officialCalls.push(options.grounding);
    return { ...providerResult };
  };
  const official = await enrichProductName(product, {
    officialSources: sources, callProvider: callOfficialProvider,
    inspectUrl: async () => ({
      resolvedUrl: 'https://www.kao.com/products/biore', title: providerResult.candidateName,
      body: `JAN ${product.sourcePayload.jan} ${providerResult.candidateName}`,
    }),
  });
  assert.equal(official.sourceType, 'official');
  assert.equal(official.validation.status, 'auto_approved');
  assert.equal(official.seoSlug, 'biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167');
  assert.deepEqual(official.searchAliases, ['Biore Aqua Rich Essence']);
  assert.deepEqual(officialCalls, [true]);

  const fallbackCalls = [];
  const callFallbackProvider = async (_provider, _input, options) => {
    fallbackCalls.push(options.grounding);
    return options.grounding
      ? { ...providerResult }
      : { ...providerResult, evidenceUrls: [], inputTokens: 300, outputTokens: 80, estimatedCostUsd: 0.0008, latencyMs: 600 };
  };
  const generated = await enrichProductName(product, {
    officialSources: sources, callProvider: callFallbackProvider,
    inspectUrl: async () => ({ resolvedUrl: 'https://retailer.example/item', title: providerResult.candidateName, body: providerResult.candidateName }),
  });
  assert.equal(generated.sourceType, 'generated');
  assert.equal(generated.validation.errors.length, 0);
  assert.equal(generated.validation.status, 'review_required');
  assert.ok(generated.validation.confidence < 0.95);
  assert.deepEqual(fallbackCalls, [true, false]);
  assert.equal(generated.usage.inputTokens, 800);
  assert.ok(generated.warnings.some((warning) => warning.includes('candidate was generated')));
});

test('SEO metadata hallucinations force human review', () => {
  const input = buildEnrichmentInput(product, sources);
  const result = validateEnrichmentOutput(input, {
    ...providerResult,
    seoDescription: 'Biore clinically proven organic sunscreen in a 70g format with SPF50+ PA++++.',
  }, 'official');
  assert.equal(result.status, 'review_required');
  assert.ok(result.errors.some((error) => error.code === 'metadata_unsupported_claim_clinically_proven'));
});

test('brands without an official-domain cache entry use one generation-only call', async () => {
  const calls = [];
  const generated = await enrichProductName({ ...product, brand: 'Unknown' }, {
    officialSources: sources,
    callProvider: async (_provider, _input, options) => {
      calls.push(options.grounding);
      return { ...providerResult, evidenceUrls: [] };
    },
  });
  assert.deepEqual(calls, [false]);
  assert.equal(generated.sourceType, 'generated');
  assert.equal(generated.validation.status, 'review_required');
});

test('default evidence inspection refuses arbitrary public retailer hops', async () => {
  const evidence = await verifyOfficialEvidence({
    evidenceUrls: ['https://retailer.example/item'],
    officialDomains: ['kao.com'],
    candidateName: providerResult.candidateName,
    sourceText: product.name,
  }, {
    lookupImpl: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => { throw new Error('untrusted retailer must not be fetched'); },
  });
  assert.equal(evidence[0].verified, false);
  assert.match(evidence[0].error, /not an official domain or trusted grounding redirect/);
});

test('slug and retry policy are deterministic and bounded', () => {
  assert.equal(slugifyProductName('Curel Intensive Moisture Cream 40g', 42), 'curel-intensive-moisture-cream-40g-42');
  assert.equal(retryDelaySeconds(1), 30);
  assert.equal(retryDelaySeconds(4), 240);
  assert.equal(retryDelaySeconds(99), 3600);
  assert.equal(isRetryableError({ status: 429 }), true);
  assert.equal(isRetryableError({ status: 503 }), true);
  assert.equal(isRetryableError({ status: 400 }), false);
});

test('a source JAN blocks an official page that omits the JAN even with title match', async () => {
  const evidence = await verifyOfficialEvidence({
    evidenceUrls: ['https://a.example'], officialDomains: ['kao.com'],
    candidateName: providerResult.candidateName,
    sourceText: `${product.name}\n${product.description}`,
    jan: product.sourcePayload.jan,
  }, {
    inspectUrl: async () => ({
      resolvedUrl: 'https://www.kao.com/products/biore',
      title: providerResult.candidateName,
      body: 'Biore UV Aqua Rich Watery Essence high spf sunscreen for daily use', // no JAN
    }),
  });
  assert.equal(evidence[0].identityBlocked, true);
  assert.equal(evidence[0].verified, false);
  assert.equal(assessOfficialEvidence(evidence, { requireJan: true }).official, false);
});

test('a JAN mismatch across grounded evidence falls back to generated review', async () => {
  const callProvider = async (_provider, _input, options) => (options.grounding
    ? { ...providerResult, evidenceUrls: ['https://a.example', 'https://b.example'] }
    : { ...providerResult, evidenceUrls: [] });
  let hop = 0;
  const generated = await enrichProductName(product, {
    officialSources: sources, callProvider,
    inspectUrl: async () => {
      hop += 1;
      return hop === 1
        ? { resolvedUrl: 'https://www.kao.com/a', title: providerResult.candidateName, body: `JAN ${product.sourcePayload.jan}` }
        : { resolvedUrl: 'https://www.kao.com/b', title: providerResult.candidateName, body: 'Biore UV Aqua Rich Watery Essence' };
    },
  });
  // One page matched the JAN, one did not → disagreement → not official.
  assert.equal(generated.sourceType, 'generated');
  assert.equal(generated.validation.status, 'review_required');
});
