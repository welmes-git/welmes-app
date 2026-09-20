import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCompletionParams,
  buildJobPayload,
  claimRuns,
  enqueueProducts,
  failRun,
  parseWorkerArgs,
  processClaimedRun,
} from '../scripts/enrich-product-names.mjs';
import { buildEnrichmentInput, hashEnrichmentInput } from '../scripts/lib/product-name-enrichment.mjs';
import { PROMPT_VERSION } from '../scripts/lib/product-name-providers.mjs';
import { insertProduct } from '../scripts/lib/sd-core.mjs';

const sourceRows = [
  { brand_name: 'ビオレ', canonical_brand_name: 'Biore', official_domain: 'kao.com', active: true },
  { brand_name: 'Other', canonical_brand_name: 'Other', official_domain: 'other.example', active: true },
];
const product = {
  id: 7, name: 'ビオレ 洗顔料 120g', brand: 'ビオレ', category: 'Cleansing',
  description: '洗顔料', sd_product_id: '123', sourcePayload: { jan: '4901301234567' },
};

function resultFor(inputHash) {
  return {
    inputHash,
    candidateName: 'Biore Facial Cleanser 120g',
    seoSlug: 'biore-facial-cleanser-120g-7',
    seoTitle: 'Biore Facial Cleanser 120g Wholesale | WELMES',
    seoDescription: 'Biore facial cleanser in a 120g format for wholesale buyers.',
    searchAliases: ['Biore Face Wash'],
    sourceType: 'official',
    evidence: [{ verified: true, resolvedUrl: 'https://www.kao.com/product' }],
    warnings: [],
    validation: { status: 'auto_approved', confidence: 1, errors: [], warnings: [] },
    usage: { inputTokens: 100, outputTokens: 30, estimatedCostUsd: 0.001, latencyMs: 500 },
  };
}

test('worker args parse bounded queue and safety options', () => {
  const parsed = parseWorkerArgs([
    '--provider=gemini', '--model=gemini-fixed', '--ids=7,8,7,bad', '--limit=2', '--lease=120',
    '--max-attempts=4', '--priority=5', '--worker-id=test-worker', '--dry-run', '--force', '--no-grounding',
  ]);
  assert.deepEqual(parsed.ids, [7, 8]);
  assert.equal(parsed.limit, 2);
  assert.equal(parsed.leaseSeconds, 120);
  assert.equal(parsed.maxAttempts, 4);
  assert.equal(parsed.workerId, 'test-worker');
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.grounding, false);
  assert.throws(() => parseWorkerArgs(['--limit=0']), /limit/);
  assert.throws(() => parseWorkerArgs(['--lease=10']), /lease/);
  assert.throws(() => parseWorkerArgs(['--max-attempts=20']), /max-attempts/);
  assert.throws(() => parseWorkerArgs(['--enqueue-only']), /requires --ids/);
});

test('job payload snapshots only matching official brand sources', () => {
  const payload = buildJobPayload(product, sourceRows);
  assert.equal(payload.product.id, 7);
  assert.equal(payload.product.sourcePayload.jan, '4901301234567');
  assert.deepEqual(payload.strategy, { grounding: true });
  assert.deepEqual(payload.officialSources, [sourceRows[0]]);
});

test('completion RPC payload contains only explicit name and audit fields', () => {
  const params = buildCompletionParams({ id: 'run-1' }, resultFor('hash'), 'worker-1');
  assert.equal(params.p_candidate_name, 'Biore Facial Cleanser 120g');
  assert.equal(params.p_name_status, 'auto_approved');
  assert.equal(params.p_worker_id, 'worker-1');
  assert.equal(params.p_result_payload.sourceType, 'official');
  assert.equal('status' in params, false);
  assert.equal('wholesale_price' in params, false);
});

test('dry-run processes immutable snapshot without any Supabase mutation', async () => {
  const payload = buildJobPayload(product, sourceRows);
  const input = buildEnrichmentInput(payload.product, payload.officialSources);
  const inputHash = hashEnrichmentInput(input, { provider: 'gemini', model: 'gemini-fixed', promptVersion: PROMPT_VERSION });
  const run = {
    id: 'run-1', product_id: 7, provider: 'gemini', model: 'gemini-fixed', input_hash: inputHash,
    source_payload: payload,
  };
  let receivedOptions;
  const processed = await processClaimedRun(run, {
    dryRun: true, workerId: 'worker-1', grounding: false,
    enrich: async (_product, options) => { receivedOptions = options; return resultFor(inputHash); },
  });
  assert.equal(processed.completionStatus, 'dry-run');
  assert.equal(receivedOptions.model, 'gemini-fixed');
  assert.equal(receivedOptions.grounding, true);
});

test('normal processing completes through the atomic RPC', async () => {
  const payload = buildJobPayload(product, sourceRows);
  const input = buildEnrichmentInput(payload.product, payload.officialSources);
  const inputHash = hashEnrichmentInput(input, { provider: 'gemini', model: 'gemini-fixed', promptVersion: PROMPT_VERSION });
  const run = {
    id: 'run-2', product_id: 7, provider: 'gemini', model: 'gemini-fixed', input_hash: inputHash,
    source_payload: payload,
  };
  let rpcCall;
  const supabase = {
    rpc: async (name, params) => {
      rpcCall = { name, params };
      return { data: 'succeeded', error: null };
    },
  };
  const processed = await processClaimedRun(run, {
    supabase, workerId: 'worker-1',
    enrich: async () => resultFor(inputHash),
  });
  assert.equal(processed.completionStatus, 'succeeded');
  assert.equal(rpcCall.name, 'complete_product_name_enrichment');
  assert.equal(rpcCall.params.p_run_id, 'run-2');
});

test('hash mismatch aborts before completion RPC', async () => {
  let called = false;
  const supabase = { rpc: async () => { called = true; return { data: null, error: null }; } };
  await assert.rejects(() => processClaimedRun({
    id: 'run-3', product_id: 7, provider: 'gemini', model: 'gemini-fixed', input_hash: 'expected',
    source_payload: buildJobPayload(product, sourceRows),
  }, {
    supabase, workerId: 'worker-1', enrich: async () => resultFor('changed'),
  }), /immutable source snapshot/);
  assert.equal(called, false);
});


test('duplicate enqueue requests carry the same immutable hash and reuse the DB job id', async () => {
  const calls = [];
  const supabase = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: 'same-run-id', error: null };
    },
  };
  const options = {
    provider: 'gemini', model: 'gemini-fixed', grounding: true, dryRun: false,
    priority: 0, maxAttempts: 3, force: false,
  };
  const first = await enqueueProducts(supabase, [product], sourceRows, options, {});
  const second = await enqueueProducts(supabase, [product], sourceRows, options, {});
  assert.equal(first[0].id, 'same-run-id');
  assert.equal(second[0].id, 'same-run-id');
  assert.equal(calls[0].name, 'enqueue_product_name_enrichment');
  assert.equal(calls[0].params.p_input_hash, calls[1].params.p_input_hash);
  assert.deepEqual(calls[0].params.p_source_payload.strategy, { grounding: true });
});

test('claim requests allow an expired running job to be resumed by the database lease RPC', async () => {
  const expiredRun = { id: 'run-expired', status: 'running', lease_owner: 'dead-worker' };
  let call;
  const supabase = {
    rpc: async (name, params) => {
      call = { name, params };
      return { data: [expiredRun], error: null };
    },
  };
  const runs = await claimRuns(supabase, {
    dryRun: false, workerId: 'replacement-worker', limit: 4, leaseSeconds: 120, ids: [7],
  });
  assert.deepEqual(runs, [expiredRun]);
  assert.equal(call.name, 'claim_product_name_enrichments');
  assert.deepEqual(call.params.p_product_ids, [7]);
  assert.equal(call.params.p_lease_seconds, 120);
});

test('429 and 500 errors requeue with exponential delay while validation errors fail terminally', async () => {
  const calls = [];
  const supabase = {
    rpc: async (_name, params) => {
      calls.push(params);
      return { data: params.p_terminal ? 'failed' : 'queued', error: null };
    },
  };
  const throttled = Object.assign(new Error('rate limited'), { status: 429 });
  const serverError = Object.assign(new Error('provider unavailable'), { status: 500 });
  const badInput = Object.assign(new Error('invalid response'), { status: 400 });
  assert.deepEqual(await failRun(supabase, { id: 'r1', attempt: 1 }, 'worker', throttled), {
    status: 'queued', retryable: true, delay: 30,
  });
  assert.deepEqual(await failRun(supabase, { id: 'r2', attempt: 3 }, 'worker', serverError), {
    status: 'queued', retryable: true, delay: 120,
  });
  assert.deepEqual(await failRun(supabase, { id: 'r3', attempt: 1 }, 'worker', badInput), {
    status: 'failed', retryable: false, delay: 30,
  });
  assert.equal(calls[0].p_terminal, false);
  assert.equal(calls[1].p_retry_delay_seconds, 120);
  assert.equal(calls[2].p_terminal, true);
});

test('low-confidence candidates complete as review_required without public auto-approval', () => {
  const result = resultFor('hash');
  result.sourceType = 'generated';
  result.validation = {
    status: 'review_required', confidence: 0.72,
    errors: [{ code: 'missing_size', message: 'Size is missing.' }], warnings: [],
  };
  const params = buildCompletionParams({ id: 'run-low' }, result, 'worker');
  assert.equal(params.p_name_status, 'review_required');
  assert.equal(params.p_confidence, 0.72);
  assert.equal(params.p_name_source, 'generated');
  assert.equal(params.p_result_payload.candidateName, result.candidateName);
});


test('Super Delivery registration persists parsed JAN for later grounding', async () => {
  let inserted;
  const supabase = {
    from: (table) => {
      if (table === 'products_admin') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          insert: ([row]) => {
            inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 77 }, error: null }) }) };
          },
        };
      }
      return { delete: () => ({ eq: async () => ({ error: null }) }) };
    },
    storage: { from: () => { throw new Error('no image upload expected'); } },
  };
  await insertProduct(supabase, {
    sdId: 'sd-77', jan: '4901301234567', name: '商品', nameEn: '商品', brand: 'Brand', category: 'Cleansing',
    images: [], image: '', originalPrice: 1000, wholesalePrice: 700, discount: 30, tags: [],
    description: '説明', stock: 10, status: 'inactive', setOptions: [], dealerId: null, dealerName: null,
  });
  assert.equal(inserted.jan, '4901301234567');
  assert.equal(inserted.status, 'inactive');
});
