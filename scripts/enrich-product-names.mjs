#!/usr/bin/env node
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadLocalEnv, getProviderConfig } from './lib/product-name-providers.mjs';
import {
  buildEnrichmentJob,
  enrichProductName,
  isRetryableError,
  retryDelaySeconds,
} from './lib/product-name-enrichment.mjs';

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
    ? [...new Set(values.ids.split(',').map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))]
    : [];
  const limit = Number(values.limit || 10);
  const leaseSeconds = Number(values.lease || 300);
  const maxAttempts = Number(values['max-attempts'] || 3);
  const priority = Number(values.priority || 0);
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
    workerId: values['worker-id'] || `${os.hostname()}:${process.pid}`,
    fixture: values.fixture || '',
    dryRun: flags.has('dry-run'),
    enqueueOnly: flags.has('enqueue-only'),
    force: flags.has('force'),
    grounding: !flags.has('no-grounding'),
  };
}

export function buildJobPayload(product, officialSources = [], { grounding = true, provider = 'gemini', model = '', env = process.env } = {}) {
  const job = buildEnrichmentJob(product, officialSources, { grounding, provider, model, env, force: true });
  return job.sourcePayload;
}

export function buildCompletionParams(run, result, workerId) {
  return {
    p_run_id: run.id,
    p_worker_id: workerId,
    p_candidate_name: result.candidateName,
    p_seo_slug: result.seoSlug,
    p_seo_title: result.seoTitle,
    p_seo_description: result.seoDescription,
    p_search_aliases: result.searchAliases,
    p_name_status: result.validation.status,
    p_confidence: result.validation.confidence,
    p_name_source: result.sourceType,
    p_result_payload: {
      candidateName: result.candidateName,
      seoSlug: result.seoSlug,
      seoTitle: result.seoTitle,
      seoDescription: result.seoDescription,
      searchAliases: result.searchAliases,
      sourceType: result.sourceType,
      evidence: result.evidence,
      warnings: result.warnings,
    },
    p_validation_payload: { ...result.validation, brand: result.input?.brand || null },
    p_input_tokens: result.usage.inputTokens,
    p_output_tokens: result.usage.outputTokens,
    p_estimated_cost_usd: result.usage.estimatedCostUsd,
    p_latency_ms: result.usage.latencyMs,
  };
}

function claimedRunProduct(run, fallbackSources = []) {
  const payload = run.source_payload || {};
  const product = payload.product || payload;
  if (!product.id) product.id = Number(run.product_id);
  return { product, officialSources: payload.officialSources || fallbackSources };
}

export async function processClaimedRun(run, {
  supabase = null,
  env = process.env,
  workerId,
  grounding = true,
  dryRun = false,
  fallbackSources = [],
  enrich = enrichProductName,
} = {}) {
  const snapshot = claimedRunProduct(run, fallbackSources);
  const snapshotGrounding = run.source_payload?.strategy?.grounding;
  const result = await enrich(snapshot.product, {
    provider: run.provider,
    model: run.model,
    env,
    officialSources: snapshot.officialSources,
    grounding: typeof snapshotGrounding === 'boolean' ? snapshotGrounding : grounding,
  });
  if (result.inputHash !== run.input_hash) {
    const error = new Error('Queued input hash does not match its immutable source snapshot');
    error.code = 'INPUT_HASH_MISMATCH';
    throw error;
  }
  if (dryRun) return { result, completionStatus: 'dry-run' };
  const { data, error } = await supabase.rpc('complete_product_name_enrichment', buildCompletionParams(run, result, workerId));
  if (error) throw new Error(`complete RPC failed: ${error.message}`);
  return { result, completionStatus: data };
}

function requireEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
}

async function createAdminClient(env) {
  const { createClient } = await import('@supabase/supabase-js');
  const timedFetch = (url, options) => fetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(45_000) });
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { global: { fetch: timedFetch } });
  const { error } = await client.auth.signInWithPassword({
    email: env.WELMES_ADMIN_EMAIL,
    password: env.WELMES_ADMIN_PASSWORD,
  });
  if (error) throw new Error(`WELMES admin login failed: ${error.message}`);
  return client;
}

async function loadOfficialSources(supabase) {
  const { data, error } = await supabase.from('brand_official_sources').select('*').eq('active', true);
  if (error) throw new Error(`Cannot load brand_official_sources; apply 20260920 migration first: ${error.message}`);
  return data || [];
}

async function fetchProducts(supabase, ids) {
  const { data, error } = await supabase.from('products_admin')
    .select('id,name,brand,category,description,jan,sd_product_id,name_en_status')
    .in('id', ids);
  if (error) throw new Error(`Cannot load products: ${error.message}`);
  const byId = new Map((data || []).map((product) => [Number(product.id), product]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`Products not found: ${missing.join(', ')}`);
  return ids.map((id) => byId.get(id));
}

export async function enqueueProducts(supabase, products, officialSources, options, env) {
  const jobs = [];
  for (const product of products) {
    const job = buildEnrichmentJob(product, officialSources, {
      provider: options.provider,
      model: options.model,
      env,
      grounding: options.grounding,
      priority: options.priority,
      maxAttempts: options.maxAttempts,
      force: options.force,
    });
    if (!job) {
      console.log(`  ↷ #${product.id} human-approved; use --force to enqueue without overwriting the approved name`);
      continue;
    }
    if (options.dryRun) {
      jobs.push({ id: `dry-run-${product.id}`, product_id: product.id, provider: job.provider, model: job.model, input_hash: job.inputHash, source_payload: job.sourcePayload, attempt: 0, max_attempts: options.maxAttempts });
      console.log(`  ◇ #${product.id} would enqueue ${job.provider}/${job.model} ${job.inputHash.slice(0, 10)}`);
      continue;
    }
    const { data, error } = await supabase.rpc('enqueue_product_name_enrichment', job.rpcParams);
    if (error) throw new Error(`enqueue RPC failed for #${product.id}; apply Task 5 migrations first: ${error.message}`);
    jobs.push({ id: data, product_id: product.id });
    console.log(`  + #${product.id} queued as ${data}`);
  }
  return jobs;
}

export async function claimRuns(supabase, options) {
  if (options.dryRun) {
    let query = supabase.from('product_name_enrichment_runs').select('*').eq('status', 'queued')
      .lte('available_at', new Date().toISOString()).order('priority', { ascending: false }).order('created_at').limit(options.limit);
    if (options.ids.length) query = query.in('product_id', options.ids);
    const { data, error } = await query;
    if (error) throw new Error(`Cannot preview queue: ${error.message}`);
    return data || [];
  }
  const { data, error } = await supabase.rpc('claim_product_name_enrichments', {
    p_worker_id: options.workerId,
    p_limit: options.limit,
    p_lease_seconds: options.leaseSeconds,
    p_product_ids: options.ids.length ? options.ids : null,
  });
  if (error) throw new Error(`claim RPC failed; apply Task 5 migrations first: ${error.message}`);
  return data || [];
}

export async function failRun(supabase, run, workerId, error) {
  const retryable = isRetryableError(error);
  const delay = retryDelaySeconds(run.attempt || 1);
  const { data, error: rpcError } = await supabase.rpc('fail_product_name_enrichment', {
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
  const fixtures = JSON.parse(fs.readFileSync(new URL('./fixtures/product-name-eval.json', import.meta.url), 'utf8'));
  const fixture = fixtures.find((item) => item.id === options.fixture) || (options.fixture === 'first' ? fixtures[0] : null);
  if (!fixture) throw new Error(`Unknown fixture: ${options.fixture}. Use --fixture=first or an ID from scripts/fixtures/product-name-eval.json`);
  const fixtureProduct = {
    id: fixtures.indexOf(fixture) + 1,
    name: fixture.sourceName,
    brand: fixture.brand,
    category: fixture.category,
    description: fixture.sourceDescription,
    sourcePayload: {},
  };
  const officialSources = fixture.brand === 'Biore'
    ? [{ brand_name: 'Biore', canonical_brand_name: 'Biore', official_domain: 'kao.com', active: true }]
    : [];
  const result = await enrichProductName(fixtureProduct, {
    provider: options.provider,
    model: options.model,
    env,
    officialSources,
    grounding: options.grounding,
  });
  console.log(JSON.stringify({
    fixture: fixture.id,
    candidateName: result.candidateName,
    sourceType: result.sourceType,
    status: result.validation.status,
    confidence: result.validation.confidence,
    evidence: result.evidence,
    errors: result.validation.errors,
    usage: result.usage,
  }, null, 2));
}

async function main() {
  console.log('🚀 WELMES English product-name enrichment worker');
  const options = parseWorkerArgs(process.argv.slice(2));
  const env = loadLocalEnv();
  getProviderConfig(options.provider, env); // validates provider before any DB work
  if (options.fixture) {
    await runFixture(options, env);
    return;
  }

  requireEnv(env, ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'WELMES_ADMIN_EMAIL', 'WELMES_ADMIN_PASSWORD']);
  const supabase = await createAdminClient(env);
  const officialSources = await loadOfficialSources(supabase);
  console.log(`✓ admin login; official source rows=${officialSources.length}${options.dryRun ? ' (dry-run)' : ''}`);

  let dryRunJobs = [];
  if (options.ids.length) {
    const products = await fetchProducts(supabase, options.ids);
    dryRunJobs = await enqueueProducts(supabase, products, officialSources, options, env);
    if (options.enqueueOnly) return;
  }

  const runs = options.dryRun && options.ids.length ? dryRunJobs : await claimRuns(supabase, options);
  if (!runs.length) {
    console.log('No eligible enrichment jobs. Use --ids=1,2 to enqueue explicit products.');
    return;
  }
  console.log(`Processing ${runs.length} job(s) as ${options.workerId}`);

  const summary = { succeeded: 0, reviewRequired: 0, skipped: 0, requeued: 0, failed: 0 };
  for (const run of runs) {
    try {
      const { result, completionStatus } = await processClaimedRun(run, {
        supabase, env, workerId: options.workerId, grounding: options.grounding,
        dryRun: options.dryRun, fallbackSources: officialSources,
      });
      console.log(`  ✓ #${run.product_id} ${result.candidateName} [${result.sourceType}/${result.validation.status}/${result.validation.confidence}] -> ${completionStatus}`);
      if (options.dryRun) summary[result.validation.status === 'auto_approved' ? 'succeeded' : 'reviewRequired']++;
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
