import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTranslationJob,
  enqueueTranslationForProduct,
} from '../scripts/lib/product-description-i18n.mjs';
import { insertProduct, buildTranslationOptions } from '../scripts/lib/sd-core.mjs';

const SECTIONS = [
  { key: 'overview', label: '商品説明', value: '素肌の美しさをひきだします。' },
  { key: 'size', label: 'サイズ・容量', value: '130g' },
  { key: 'spec', label: '規格', value: '成分：水、グリセリン、香料' },
];

test('buildTranslationJob builds RPC params with hash and target langs', () => {
  const job = buildTranslationJob({ id: 97, sd_product_id: 'sd-97', descriptionSections: SECTIONS }, { env: {}, targetLangs: ['en', 'ko'] });
  assert.equal(job.rpcParams.p_product_id, 97);
  assert.equal(job.rpcParams.p_provider, 'gemini');
  assert.deepEqual(job.rpcParams.p_target_langs, ['en', 'ko']);
  assert.equal(job.rpcParams.p_input_hash, job.inputHash);
  assert.equal(job.rpcParams.p_source_payload.sections.length, 3);
  assert.equal(job.rpcParams.p_force, false);
});

test('buildTranslationJob returns null when there is nothing to translate', () => {
  assert.equal(buildTranslationJob({ id: 1, descriptionSections: [] }, { env: {} }), null);
  assert.equal(buildTranslationJob({ id: 1, descriptionSections: [{ key: 'size', label: 'x', value: '  ' }] }, { env: {} }), null);
});

test('enqueueTranslationForProduct returns run id on success', async () => {
  let params;
  const supabase = { rpc: async (_fn, p) => { params = p; return { data: 'run-xyz', error: null }; } };
  const r = await enqueueTranslationForProduct(supabase, { id: 97, sd_product_id: 'sd-97', descriptionSections: SECTIONS }, { env: {} });
  assert.equal(r.queued, true);
  assert.equal(r.id, 'run-xyz');
  assert.equal(params.p_product_id, 97);
});

test('enqueueTranslationForProduct never throws on RPC error or exception', async () => {
  const rpcError = { rpc: async () => ({ data: null, error: { message: 'queue offline' } }) };
  const r1 = await enqueueTranslationForProduct(rpcError, { id: 97, descriptionSections: SECTIONS }, { env: {} });
  assert.equal(r1.queued, false);
  assert.match(r1.reason, /queue offline/);

  const throwing = { rpc: async () => { throw new Error('network down'); } };
  const r2 = await enqueueTranslationForProduct(throwing, { id: 97, descriptionSections: SECTIONS }, { env: {} });
  assert.equal(r2.queued, false);
  assert.match(r2.reason, /network down/);
});

test('enqueueTranslationForProduct reports no_translatable_sections', async () => {
  const supabase = { rpc: async () => ({ data: 'x', error: null }) };
  const r = await enqueueTranslationForProduct(supabase, { id: 1, descriptionSections: [] }, { env: {} });
  assert.equal(r.queued, false);
  assert.equal(r.reason, 'no_translatable_sections');
});

// ── insertProduct wiring ───────────────────────────────────────────────

function mockSupabase({ rpcSpy } = {}) {
  return {
    from(tableName) {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }), // no dup
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: 999 }, error: null }) }) }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    rpc: async (fn, params) => { rpcSpy?.(fn, params); return { data: `run-${fn}`, error: null }; },
  };
}

const PRODUCT = {
  sdId: 'sd-999', jan: null, name: 'テスト', nameEn: 'テスト', brand: 'Biore',
  category: 'Skincare', image: '', images: [], originalPrice: 100, wholesalePrice: 110,
  discount: 0, tags: [], description: '素肌の美しさ', descriptionSections: SECTIONS,
  stock: 50, status: 'inactive', setOptions: [], dealerId: null, dealerName: null,
};

test('insertProduct enqueues a translation job when translation option is enabled', async () => {
  const calls = [];
  const supabase = mockSupabase({ rpcSpy: (fn, params) => calls.push({ fn, params }) });
  const r = await insertProduct(supabase, PRODUCT, {
    translation: buildTranslationOptions({ enabled: true, env: {} }),
  });
  assert.equal(r.id, 999);
  assert.equal(r.translation.queued, true);
  const translateCall = calls.find((c) => c.fn === 'enqueue_product_description_translation');
  assert.ok(translateCall, 'translation enqueue RPC called');
  assert.equal(translateCall.params.p_product_id, 999);
  assert.equal(translateCall.params.p_source_payload.sections.length, 3);
});

test('insertProduct still succeeds when translation enqueue fails', async () => {
  const supabase = mockSupabase();
  supabase.rpc = async () => ({ data: null, error: { message: 'queue offline' } });
  const r = await insertProduct(supabase, PRODUCT, {
    translation: buildTranslationOptions({ enabled: true, env: {} }),
  });
  assert.equal(r.id, 999, 'registration succeeds despite queue failure');
  assert.equal(r.translation.queued, false);
  assert.match(r.translation.reason, /queue offline/);
});

test('insertProduct skips translation when option is disabled', async () => {
  const calls = [];
  const supabase = mockSupabase({ rpcSpy: (fn) => calls.push(fn) });
  const r = await insertProduct(supabase, PRODUCT, {}); // no translation option
  assert.equal(r.translation, null);
  assert.ok(!calls.includes('enqueue_product_description_translation'));
});
