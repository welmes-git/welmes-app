#!/usr/bin/env node
/**
 * backfill-product-names.mjs — Task 8
 *
 * Safely convert existing products whose `name_en` still contains Japanese (or
 * that have no English-name workflow status yet) to the AI naming pipeline,
 * without any storefront downtime.
 *
 * Design:
 *   - Idempotent: only untreated / Japanese / failed rows are targeted;
 *     human-approved names are never touched, already-clean rows are skipped so
 *     re-running is safe.
 *   - Active products are processed first (validate on live inventory), then the
 *     rest, in stable id order so a resume cursor works.
 *   - --dry-run prints the target count and an estimated cost, mutating nothing.
 *   - Reuses the Task 5 worker RPCs (enqueue → claim → complete/fail) so the
 *     confidence rules and human-approval protection are identical.
 *
 * Usage:
 *   npm run backfill:names -- --dry-run --limit=10
 *   npm run backfill:names -- --limit=10 --active-only
 *   npm run backfill:names -- --ids=12,34
 *   npm run backfill:names -- --after=1200          # resume cursor (exclusive)
 *
 * Flags:
 *   --dry-run       select + estimate cost only; no DB writes
 *   --limit=N       max products this run (default 25, 1..500)
 *   --ids=1,2       restrict to these product ids
 *   --after=ID      resume: skip ids <= ID (exclusive cursor)
 *   --active-only   only active products (default processes active first, then all)
 *   --provider=...  gemini|openai|anthropic|qwen|deepseek (default gemini)
 *   --model=...     pin an exact model id
 *   --no-grounding  disable official-domain grounding
 */
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadLocalEnv, getProviderConfig } from './lib/product-name-providers.mjs';
import {
  loadOfficialSources,
} from './lib/sd-core.mjs';
import {
  estimateBackfillCost,
  nextBackfillCursor,
  selectBackfillTargets,
} from './lib/product-name-enrichment.mjs';
import {
  enqueueProducts,
  processClaimedRun,
  claimRuns,
  failRun,
} from './enrich-product-names.mjs';

export function parseBackfillArgs(argv) {
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
  const limit = Number(values.limit || 25);
  const afterId = Number(values.after || 0);
  const batchSize = Number(values['batch-size'] || 50);
  const maxBatches = Number(values['max-batches'] || 100);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('--limit must be an integer between 1 and 500');
  if (!Number.isInteger(afterId) || afterId < 0) throw new Error('--after must be a non-negative product id');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) throw new Error('--batch-size must be an integer between 1 and 50');
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 1000) throw new Error('--max-batches must be an integer between 1 and 1000');
  if (values.ids && ids.length === 0) throw new Error('--ids did not contain a valid positive product ID');
  const leaseSeconds = Number(values.lease || 300);
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) throw new Error('--lease must be between 30 and 1800 seconds');
  return {
    provider: values.provider || 'gemini',
    model: values.model || '',
    ids,
    limit,
    afterId,
    batchSize,
    maxBatches,
    afterInactive: flags.has('after-inactive'),
    activeOnly: flags.has('active-only'),
    dryRun: flags.has('dry-run'),
    grounding: !flags.has('no-grounding'),
    priority: 0,
    maxAttempts: 3,
    force: true, // backfill always re-enqueues its own targets
    workerId: values['worker-id'] || `backfill:${os.hostname()}:${process.pid}`,
    leaseSeconds,
  };
}

async function createAdminClient(env) {
  const { createClient } = await import('@supabase/supabase-js');
  const timedFetch = (url, options) => fetch(url, { ...options, signal: options?.signal || AbortSignal.timeout(45_000) });
  const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { global: { fetch: timedFetch } });
  const { error } = await client.auth.signInWithPassword({
    email: env.WELMES_ADMIN_EMAIL, password: env.WELMES_ADMIN_PASSWORD,
  });
  if (error) throw new Error(`WELMES admin login failed: ${error.message}`);
  return client;
}

async function fetchAllProducts(supabase, activeOnly) {
  let query = supabase.from('products_admin')
    .select('id,name,name_en,brand,category,description,jan,sd_product_id,status,name_en_status')
    .order('id', { ascending: true });
  if (activeOnly) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) throw new Error(`Cannot load products: ${error.message}`);
  return data || [];
}

async function main() {
  console.log('🚀 WELMES English-name backfill (Task 8)');
  const options = parseBackfillArgs(process.argv.slice(2));
  const env = loadLocalEnv();
  getProviderConfig(options.provider, env); // validate provider before any DB work

  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'WELMES_ADMIN_EMAIL', 'WELMES_ADMIN_PASSWORD']
    .filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

  const supabase = await createAdminClient(env);
  const officialSources = await loadOfficialSources(supabase);
  const allProducts = await fetchAllProducts(supabase, options.activeOnly);

  const targets = selectBackfillTargets(allProducts, {
    ids: options.ids.length ? options.ids : null,
    afterId: options.afterId,
    cursor: options.afterId ? { activeDone: options.afterInactive, afterId: options.afterId } : null,
    activeFirst: !options.activeOnly, // active-only already filtered; otherwise prioritize active
    limit: options.limit,
  });

  const cost = estimateBackfillCost(targets.length, { provider: options.provider, env });
  console.log(`✓ admin login; ${allProducts.length} products scanned, ${targets.length} eligible (limit ${options.limit})`);
  console.log(`💴 estimated cost: ${cost.total ?? '?'} ${cost.currency}${cost.totalUsd != null ? ` (~$${cost.totalUsd})` : ''} for ${targets.length} products via ${options.provider}`);

  if (!targets.length) {
    console.log('Nothing to backfill — all scanned products are clean or human-approved.');
    return;
  }

  if (options.dryRun) {
    for (const p of targets) {
      console.log(`  ◇ #${p.id} [${p.status}/${p.name_en_status ?? 'none'}] ${String(p.name_en || p.name).slice(0, 50)}`);
    }
    const cursor = nextBackfillCursor(targets);
    console.log(`Dry-run only. Resume the next batch with --after=${cursor.afterId}${cursor.activeDone ? ' --after-inactive' : ''}.`);
    return;
  }

  // Enqueue eligible targets (force=true supersedes any stale queued job).
  const jobs = await enqueueProducts(supabase, targets, officialSources, options, env);
  console.log(`Enqueued ${jobs.length} job(s); processing as ${options.workerId}`);

  // Process the queue we just filled, scoped to the target ids for safety.
  // Repeatedly claim in bounded batches (<=50) until every enqueued target has
  // been drained or the operational --max-batches cap is hit. A single claim
  // RPC is limited to 50 by the database, so a limit>50 must loop.
  const runIds = targets.map((t) => Number(t.id));
  const remaining = new Set(runIds);
  const summary = {
    succeeded: 0, reviewRequired: 0, skipped: 0, requeued: 0, failed: 0, batches: 0,
  };
  const processedOrder = [];
  for (let batch = 0; batch < options.maxBatches && remaining.size; batch++) {
    const runs = await claimRuns(supabase, {
      ...options,
      ids: [...remaining],
      limit: Math.min(options.batchSize, 50),
      dryRun: false,
    });
    if (!runs.length) break; // nothing claimable right now (leased elsewhere / done)
    summary.batches++;
    for (const run of runs) {
      remaining.delete(Number(run.product_id));
      try {
        const { result, completionStatus } = await processClaimedRun(run, {
          supabase, env, workerId: options.workerId, grounding: options.grounding, fallbackSources: officialSources,
        });
        console.log(`  ✓ #${run.product_id} ${result.candidateName} [${result.sourceType}/${result.validation.status}] -> ${completionStatus}`);
        if (completionStatus === 'succeeded') summary.succeeded++;
        else if (completionStatus === 'review_required') summary.reviewRequired++;
        else summary.skipped++;
        const product = allProducts.find((p) => Number(p.id) === Number(run.product_id));
        if (product) processedOrder.push(product);
      } catch (error) {
        try {
          const failure = await failRun(supabase, run, options.workerId, error);
          summary[failure.status === 'queued' ? 'requeued' : 'failed']++;
          console.log(`  ✗ #${run.product_id} ${error.message} -> ${failure.status}`);
        } catch (failureError) {
          summary.failed++;
          console.log(`  ✗ #${run.product_id} ${failureError.message}`);
        }
      }
    }
  }
  // Resume cursor is derived from the processed order (active-first aware), never
  // the raw max id, so a resumed run neither reprocesses nor skips a phase.
  const cursor = nextBackfillCursor(
    processedOrder.length ? processedOrder : targets,
    options.afterId ? { activeDone: options.afterInactive, afterId: options.afterId } : null,
  );
  console.log(`Done: ${JSON.stringify(summary)}`);
  console.log(`Resume the next batch with --after=${cursor.afterId}${cursor.activeDone ? ' --after-inactive' : ''}.`);
  if (summary.failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
