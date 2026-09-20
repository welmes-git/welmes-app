import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEnrichmentJob,
  enqueueEnrichmentForProduct,
} from '../scripts/lib/product-name-enrichment.mjs';
import { insertProduct, buildEnrichmentOptions } from '../scripts/lib/sd-core.mjs';
import { PROMPT_VERSION } from '../scripts/lib/product-name-providers.mjs';

const OFFICIAL_SOURCES = [
  { brand_name: 'ビオレ', canonical_brand_name: 'Biore', official_domain: 'kao.com', active: true },
  { brand_name: 'Other', canonical_brand_name: 'Other', official_domain: 'other.example', active: true },
];

const BIORE_PRODUCT = {
  id: 501, name: 'ビオレ UV アクアリッチ 70g', brand: 'ビオレ', category: 'Sun Care',
  description: '日焼け止め SPF50+', sd_product_id: 'sd-501', jan: '4901301413246',
};

// ── buildEnrichmentJob (pure) ──────────────────────────────────────────
test('buildEnrichmentJob snapshots matched official sources and enables grounding', () => {
  const job = buildEnrichmentJob(BIORE_PRODUCT, OFFICIAL_SOURCES, { env: {} });
  assert.equal(job.provider, 'gemini');
  assert.equal(job.grounding, true); // gemini supports grounding + kao.com matched
  assert.deepEqual(job.sourcePayload.officialSources, [OFFICIAL_SOURCES[0]]);
  assert.equal(job.sourcePayload.product.sourcePayload.jan, '4901301413246');
  assert.equal(job.sourcePayload.strategy.grounding, true);
  assert.equal(job.rpcParams.p_product_id, 501);
  assert.equal(job.rpcParams.p_prompt_version, PROMPT_VERSION);
  assert.equal(job.rpcParams.p_input_hash, job.inputHash);
  assert.equal(job.rpcParams.p_force, false);
});

test('buildEnrichmentJob falls back to generated (no grounding) for unknown brands', () => {
  const job = buildEnrichmentJob({ ...BIORE_PRODUCT, brand: 'Unknown' }, OFFICIAL_SOURCES, { env: {} });
  assert.equal(job.grounding, false);
  assert.deepEqual(job.sourcePayload.officialSources, []);
  assert.equal(job.sourcePayload.strategy.grounding, false);
});

test('buildEnrichmentJob returns null for human-approved names without force', () => {
  assert.equal(buildEnrichmentJob({ ...BIORE_PRODUCT, name_en_status: 'human_approved' }, OFFICIAL_SOURCES, { env: {} }), null);
  const forced = buildEnrichmentJob({ ...BIORE_PRODUCT, name_en_status: 'human_approved' }, OFFICIAL_SOURCES, { env: {}, force: true });
  assert.equal(forced.rpcParams.p_force, true);
});

// ── enqueueEnrichmentForProduct (RPC wrapper) ──────────────────────────
test('enqueueEnrichmentForProduct returns run id on success', async () => {
  let calledParams;
  const supabase = { rpc: async (_fn, params) => { calledParams = params; return { data: 'run-abc', error: null }; } };
  const result = await enqueueEnrichmentForProduct(supabase, BIORE_PRODUCT, OFFICIAL_SOURCES, { env: {} });
  assert.equal(result.enqueued, true);
  assert.equal(result.runId, 'run-abc');
  assert.equal(calledParams.p_product_id, 501);
});

test('enqueueEnrichmentForProduct never throws on RPC error or exception', async () => {
  const rpcError = { rpc: async () => ({ data: null, error: { message: 'queue offline' } }) };
  const r1 = await enqueueEnrichmentForProduct(rpcError, BIORE_PRODUCT, OFFICIAL_SOURCES, { env: {} });
  assert.equal(r1.enqueued, false);
  assert.match(r1.error, /queue offline/);

  const throwing = { rpc: async () => { throw new Error('network down'); } };
  const r2 = await enqueueEnrichmentForProduct(throwing, BIORE_PRODUCT, OFFICIAL_SOURCES, { env: {} });
  assert.equal(r2.enqueued, false);
  assert.match(r2.error, /network down/);

  // 잘못된 provider명(getProviderConfig throw)도 등록 흐름을 깨지 않는다
  const badProvider = { rpc: async () => ({ data: 'x', error: null }) };
  const r3 = await enqueueEnrichmentForProduct(badProvider, BIORE_PRODUCT, OFFICIAL_SOURCES, { env: {}, provider: 'not-real' });
  assert.equal(r3.enqueued, false);
  assert.match(r3.error, /Unknown provider/);
});

// ── insertProduct integration (shared by sd-import & sd-monitor) ───────
function mockSupabase({ dup = null, insertId = 90, rpc } = {}) {
  const calls = { rpc: [], deletedWatchlist: false };
  const supabase = {
    from: (table) => {
      if (table === 'products_admin') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: dup, error: null }) }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: insertId }, error: null }) }) }),
        };
      }
      // sd_watchlist delete
      return { delete: () => ({ eq: async () => { calls.deletedWatchlist = true; return { error: null }; } }) };
    },
    storage: { from: () => { throw new Error('no image upload expected'); } },
    rpc: async (fn, params) => { calls.rpc.push({ fn, params }); return rpc ? rpc(fn, params) : { data: 'run-1', error: null }; },
  };
  return { supabase, calls };
}

const PRODUCT_ROW = {
  sdId: 'sd-90', jan: '4901301413246', name: 'ビオレ UV アクアリッチ 70g', nameEn: 'ビオレ UV アクアリッチ 70g',
  brand: 'ビオレ', category: 'Sun Care', images: [], image: '', originalPrice: 1500, wholesalePrice: 900,
  discount: 40, tags: [], description: '日焼け止め SPF50+', stock: 10, status: 'inactive', setOptions: [],
  dealerId: null, dealerName: null,
};

test('new-collection registration enqueues one enrichment job and stays inactive', async () => {
  const { supabase, calls } = mockSupabase({ insertId: 90 });
  const r = await insertProduct(supabase, PRODUCT_ROW, {
    enrichment: buildEnrichmentOptions({ officialSources: OFFICIAL_SOURCES, env: {} }),
  });
  assert.equal(r.id, 90);
  assert.equal(r.enrichment.enqueued, true);
  assert.equal(r.enrichment.runId, 'run-1');
  assert.equal(calls.rpc.length, 1);
  assert.equal(calls.rpc[0].fn, 'enqueue_product_name_enrichment');
  assert.equal(calls.rpc[0].params.p_product_id, 90);
  // 초기 4주: 등록은 inactive, enqueue는 상품 상태를 바꾸지 않는다 (worker completion이 name_en_*만 갱신)
});

test('duplicate registration skips and never creates an enrichment job', async () => {
  const { supabase, calls } = mockSupabase({ dup: { id: 42 } });
  const r = await insertProduct(supabase, PRODUCT_ROW, {
    enrichment: buildEnrichmentOptions({ officialSources: OFFICIAL_SOURCES, env: {} }),
  });
  assert.equal(r.skipped, true);
  assert.equal(calls.rpc.length, 0);
});

test('restock auto-registration reuses the same pipeline (inactive + enqueued)', async () => {
  // sd-monitor calls insertProduct with status:'inactive' exactly like sd-import
  const { supabase, calls } = mockSupabase({ insertId: 91 });
  const r = await insertProduct(supabase, { ...PRODUCT_ROW, sdId: 'sd-91', status: 'inactive' }, {
    enrichment: buildEnrichmentOptions({ officialSources: OFFICIAL_SOURCES, env: {} }),
  });
  assert.equal(r.id, 91);
  assert.equal(r.enrichment.enqueued, true);
  assert.equal(calls.rpc[0].fn, 'enqueue_product_name_enrichment');
});

test('enrichment queue failure does not roll back a successful registration', async () => {
  const { supabase, calls } = mockSupabase({ insertId: 92, rpc: async () => ({ data: null, error: { message: 'queue offline' } }) });
  const r = await insertProduct(supabase, { ...PRODUCT_ROW, sdId: 'sd-92' }, {
    enrichment: buildEnrichmentOptions({ officialSources: OFFICIAL_SOURCES, env: {} }),
  });
  assert.equal(r.id, 92); // 등록은 성공
  assert.equal(r.enrichment.enqueued, false);
  assert.match(r.enrichment.error, /queue offline/);
  assert.equal(calls.deletedWatchlist, true); // 정상 등록 후처리도 수행됨
});

test('--no-enrich (disabled) keeps legacy behavior with zero RPC calls', async () => {
  const { supabase, calls } = mockSupabase({ insertId: 93 });
  const r = await insertProduct(supabase, { ...PRODUCT_ROW, sdId: 'sd-93' }, {
    enrichment: buildEnrichmentOptions({ enabled: false, officialSources: OFFICIAL_SOURCES, env: {} }),
  });
  assert.equal(r.id, 93);
  assert.equal(r.enrichment, null);
  assert.equal(calls.rpc.length, 0);
});

test('insertProduct without options preserves original signature (no enqueue)', async () => {
  const { supabase, calls } = mockSupabase({ insertId: 94 });
  const r = await insertProduct(supabase, { ...PRODUCT_ROW, sdId: 'sd-94' });
  assert.equal(r.id, 94);
  assert.equal(r.enrichment, null);
  assert.equal(calls.rpc.length, 0);
});
