#!/usr/bin/env node
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadLocalEnv, getProviderConfig } from './lib/product-name-providers.mjs';
import { isRetryableError, retryDelaySeconds } from './lib/product-name-enrichment.mjs';
import {
  buildTranslationJob,
  buildTranslationSource,
  hashTranslationInput,
  validateTranslations,
  TRANSLATION_PROMPT_VERSION,
  DEFAULT_TARGET_LANGS,
} from './lib/product-description-i18n.mjs';
import { callTranslationProvider } from './lib/product-description-providers.mjs';
import { buildProductDescription, parseStoredDescription } from './lib/sd-core.mjs';

export function parseWorkerArgs(argv) {
  const values = {};
  const flags = new Set();
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    if (rest.length) values[key] = rest.join('=');
    else flags.add(key);
  }
  const ids = values.ids
    ? [...new Set(values.ids.split(',').map(Number).filter((v) => Number.isSafeInteger(v) && v > 0))]
    : [];
  const limit = Number(values.limit || 10);
  const leaseSeconds = Number(values.lease || 300);
  const maxAttempts = Number(values['max-attempts'] || 3);
  const priority = Number(values.priority || 0);
  const langs = values.langs ? values.langs.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_TARGET_LANGS;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('--limit must be an integer between 1 and 50');
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) throw new Error('--lease must be between 30 and 1800 seconds');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('--max-attempts must be between 1 and 10');
  if (!Number.isInteger(priority) || priority < -32768 || priority > 32767) throw new Error('--priority must fit a PostgreSQL smallint');
  if (values.ids && ids.length === 0) throw new Error('--ids did not contain a valid positive product ID');
  if (flags.has('enqueue-only') && ids.length === 0) throw new Error('--enqueue-only requires --ids');
  return {
    provider: values.provider || 'gemini',
    model: values.model || '',
    ids,
    limit,
    leaseSeconds,
    maxAttempts,
    priority,
    langs,
    workerId: values['worker-id'] || `${os.hostname()}:${process.pid}`,
    fixture: flags.has('fixture') || values.fixture === '' ? true : Boolean(values.fixture),
    dryRun: flags.has('dry-run'),
    enqueueOnly: flags.has('enqueue-only'),
    force: flags.has('force'),
  };
}

/** Validate a provider translation result against its source; build completion RPC params. */
export function buildCompletionParams(run, source, providerResult, workerId) {
  const { status, i18n, violations } = validateTranslations(source, providerResult.translations);
  return {
    rpcParams: {
      p_run_id: run.id,
      p_worker_id: workerId,
      p_translations: i18n,
      p_status: status,
      p_result_payload: { model: providerResult.model, translations: providerResult.translations },
      p_validation_payload: { status, violations },
      p_input_tokens: providerResult.inputTokens ?? null,
      p_output_tokens: providerResult.outputTokens ?? null,
      p_estimated_cost_usd: providerResult.estimatedCostUsd ?? null,
      p_latency_ms: providerResult.latencyMs ?? null,
    },
    status,
    violations,
    publishedLangs: Object.keys(i18n),
  };
}

/** Rebuild the immutable source from a claimed run's payload. */
function sourceFromRun(run) {
  const payload = run.source_payload || {};
  return {
    sections: payload.sections || [],
    sourceLang: payload.sourceLang || 'ja',
    targetLangs: run.target_langs || payload.targetLangs || DEFAULT_TARGET_LANGS,
  };
}

export async function processClaimedRun(run, { supabase = null, env = process.env, workerId, dryRun = false, call = callTranslationProvider } = {}) {
  const source = sourceFromRun(run);
  // Verify the queued input hash still matches its immutable snapshot.
  const expectedHash = hashTranslationInput({ ...source }, run.prompt_version || TRANSLATION_PROMPT_VERSION);
  if (run.input_hash && expectedHash !== run.input_hash) {
    const error = new Error('Queued input hash does not match its immutable source snapshot');
    error.code = 'INPUT_HASH_MISMATCH';
    throw error;
  }
  const providerResult = await call(run.provider, source, { env, model: run.model });
  const completion = buildCompletionParams(run, source, providerResult, workerId);
  if (dryRun) return { completion, completionStatus: 'dry-run', usage: providerResult };
  const { data, error } = await supabase.rpc('complete_product_description_translation', completion.rpcParams);
  if (error) throw new Error(`complete RPC failed: ${error.message}`);
  return { completion, completionStatus: data, usage: providerResult };
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

async function createAdminClient(env) {
  const { createClient } = await import('@supabase/supabase-js');
  const timedFetch = (url, options) => fetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(45_000) });
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { global: { fetch: timedFetch } });
  const { error } = await client.auth.signInWithPassword({ email: env.WELMES_ADMIN_EMAIL, password: env.WELMES_ADMIN_PASSWORD });
  if (error) throw new Error(`WELMES admin login failed: ${error.message}`);
  return client;
}

/** Fetch products and rebuild their normalized description sections from the stored description. */
async function fetchProducts(supabase, ids) {
  const { data, error } = await supabase.from('products_admin')
    .select('id,description,description_i18n_manual_locked,sd_product_id')
    .in('id', ids);
  if (error) throw new Error(`Cannot load products: ${error.message}`);
  const byId = new Map((data || []).map((p) => [Number(p.id), p]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`Products not found: ${missing.join(', ')}`);
  return ids.map((id) => byId.get(id));
}

/** Rebuild descriptionSections from the stored (already-cleaned) description text. */
function sectionsFromStoredDescription(description) {
  return parseStoredDescription(description || '');
}

export async function enqueueProducts(supabase, products, options, env) {
  const jobs = [];
  for (const product of products) {
    if (product.description_i18n_manual_locked) {
      console.log(`  ↷ #${product.id} manual-locked; skipping (use admin UI to edit)`);
      continue;
    }
    const sections = sectionsFromStoredDescription(product.description);
    const job = buildTranslationJob(
      { id: product.id, sd_product_id: product.sd_product_id, descriptionSections: sections },
      { provider: options.provider, model: options.model, env, targetLangs: options.langs, priority: options.priority, maxAttempts: options.maxAttempts, force: options.force },
    );
    if (!job) {
      console.log(`  ↷ #${product.id} no translatable sections`);
      continue;
    }
    if (options.dryRun) {
      jobs.push({ id: `dry-run-${product.id}`, product_id: product.id, provider: job.provider, model: job.model, input_hash: job.inputHash, source_payload: job.sourcePayload, target_langs: job.targetLangs, prompt_version: job.promptVersion, attempt: 0, max_attempts: options.maxAttempts });
      console.log(`  ◇ #${product.id} would enqueue ${job.provider}/${job.model} ${job.inputHash.slice(0, 10)} langs=${job.targetLangs.join(',')}`);
      continue;
    }
    const { data, error } = await supabase.rpc('enqueue_product_description_translation', job.rpcParams);
    if (error) throw new Error(`enqueue RPC failed for #${product.id}; apply the 20260924 migration first: ${error.message}`);
    jobs.push({ id: data, product_id: product.id });
    console.log(`  + #${product.id} queued as ${data}`);
  }
  return jobs;
}

export async function claimRuns(supabase, options) {
  if (options.dryRun) {
    let query = supabase.from('product_description_translation_runs').select('*').eq('status', 'queued')
      .lte('available_at', new Date().toISOString()).order('priority', { ascending: false }).order('created_at').limit(options.limit);
    if (options.ids.length) query = query.in('product_id', options.ids);
    const { data, error } = await query;
    if (error) throw new Error(`Cannot preview queue: ${error.message}`);
    return data || [];
  }
  const { data, error } = await supabase.rpc('claim_product_description_translations', {
    p_worker_id: options.workerId,
    p_limit: options.limit,
    p_lease_seconds: options.leaseSeconds,
    p_product_ids: options.ids.length ? options.ids : null,
  });
  if (error) throw new Error(`claim RPC failed; apply the 20260924 migration first: ${error.message}`);
  return data || [];
}

export async function failRun(supabase, run, workerId, error) {
  const retryable = isRetryableError(error);
  const delay = retryDelaySeconds(run.attempt || 1);
  const { data, error: rpcError } = await supabase.rpc('fail_product_description_translation', {
    p_run_id: run.id,
    p_worker_id: workerId,
    p_error_message: error.message,
    p_retry_delay_seconds: delay,
    p_terminal: !retryable,
  });
  if (rpcError) throw new Error(`failure RPC failed: ${rpcError.message}; original error: ${error.message}`);
  return { status: data, retryable, delay };
}

async function runFixture(options, env) {
  // No DB: translate the pilot Biore description end-to-end for a live smoke test.
  const overview = '洗うことで素肌の美しさをひきだします。\n使用方法\n適量（2〜3cm程度）を泡立てて洗います。';
  const sections = buildProductDescription(overview, [
    { label: 'サイズ・容量', value: '130g' },
    { label: '規格', value: '成分：水、グリセリン、香料' },
    { label: '出荷', value: '3週間程度' },
  ]).sections;
  const source = buildTranslationSource(sections, options.langs);
  const providerResult = await callTranslationProvider(options.provider, source, { env, model: options.model });
  const { status, i18n, violations } = validateTranslations(source, providerResult.translations);
  console.log(JSON.stringify({
    status, publishedLangs: Object.keys(i18n), violations,
    sampleEn: i18n.en || null,
    usage: { inputTokens: providerResult.inputTokens, outputTokens: providerResult.outputTokens, estimatedCostUsd: providerResult.estimatedCostUsd, latencyMs: providerResult.latencyMs },
  }, null, 2));
}

async function main() {
  console.log('🚀 WELMES product-description translation worker');
  const options = parseWorkerArgs(process.argv.slice(2));
  const env = loadLocalEnv();
  getProviderConfig(options.provider, env); // validate provider before any DB work
  if (options.fixture) {
    await runFixture(options, env);
    return;
  }

  requireEnv(env, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'WELMES_ADMIN_EMAIL', 'WELMES_ADMIN_PASSWORD']);
  const supabase = await createAdminClient(env);
  console.log(`✓ admin login${options.dryRun ? ' (dry-run)' : ''}`);

  let dryRunJobs = [];
  if (options.ids.length) {
    const products = await fetchProducts(supabase, options.ids);
    dryRunJobs = await enqueueProducts(supabase, products, options, env);
    if (options.enqueueOnly) return;
  }

  const runs = options.dryRun && options.ids.length ? dryRunJobs : await claimRuns(supabase, options);
  if (!runs.length) {
    console.log('No eligible translation jobs. Use --ids=1,2 to enqueue explicit products.');
    return;
  }
  console.log(`Processing ${runs.length} job(s) as ${options.workerId}`);

  const summary = { succeeded: 0, reviewRequired: 0, skipped: 0, requeued: 0, failed: 0 };
  for (const run of runs) {
    try {
      const { completion, completionStatus, usage } = await processClaimedRun(run, { supabase, env, workerId: options.workerId, dryRun: options.dryRun });
      console.log(`  ✓ #${run.product_id} [${completion.status}] published=${completion.publishedLangs.join(',') || 'none'} -> ${completionStatus} ($${usage.estimatedCostUsd ?? '?'}, ${usage.latencyMs}ms)`);
      if (options.dryRun) summary[completion.status === 'auto_approved' ? 'succeeded' : 'reviewRequired']++;
      else if (completionStatus === 'succeeded') summary.succeeded++;
      else if (completionStatus === 'review_required') summary.reviewRequired++;
      else summary.skipped++;
    } catch (error) {
      if (options.dryRun) {
        summary.failed++;
        console.log(`  ✗ #${run.product_id} ${error.message}`);
        continue;
      }
      try {
        const failure = await failRun(supabase, run, options.workerId, error);
        summary[failure.status === 'queued' ? 'requeued' : 'failed']++;
        console.log(`  ✗ #${run.product_id} ${error.message} -> ${failure.status}${failure.retryable ? ` in ${failure.delay}s` : ''}`);
      } catch (failureError) {
        summary.failed++;
        console.log(`  ✗ #${run.product_id} ${failureError.message}`);
      }
    }
  }
  console.log(`Done: ${JSON.stringify(summary)}`);
  if (summary.failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
