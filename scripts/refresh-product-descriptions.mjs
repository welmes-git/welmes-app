#!/usr/bin/env node
/**
 * refresh-product-descriptions.mjs
 *
 * Restore the canonical description section template (商品説明 / 使用方法 /
 * サイズ・容量 / 規格 / 出荷) on products that were imported before
 * buildProductDescription() existed. Those rows hold one unlabeled Japanese
 * blob, so parseStoredDescription() yields only `overview` — which is why the
 * storefront shows no section headings and why translations only ever contained
 * an overview.
 *
 * Measured before this script: of 142 translated products, 142 had `overview`,
 * only 2 had `spec`, 1 had `size`, 0 had `usage`/`shipping`.
 *
 * Costs NOTHING in AI spend — this is pure re-scraping. Run it BEFORE
 * (re-)translating so the translator receives properly sectioned input.
 *
 * SAFETY
 *   - --dry-run reports the before/after section keys and writes nothing.
 *   - Before any write, description + description_i18n + status of every target
 *     are saved to a timestamped backup JSON.
 *   - An empty or structurally REGRESSED scrape is never written (a partial page
 *     load can therefore not degrade good data).
 *   - Admin-locked rows (human_locked / manual_locked) are skipped entirely.
 *   - Applying a new description CLEARS description_i18n and resets the status to
 *     'pending', because the old translation was derived from the old source text
 *     (its input_hash no longer matches). Re-run the translation backfill after.
 *   - Crawls sequentially with a delay, and re-authenticates if the SD session
 *     silently expires (an expired session renders a page with no content).
 *
 * Usage:
 *   npm run refresh:desc -- --dry-run --max-sections=1 --limit=10
 *   npm run refresh:desc -- --dry-run --limit=500
 *   npm run refresh:desc -- --limit=50
 *   npm run refresh:desc -- --ids=233
 *   npm run refresh:desc -- --after=120 --limit=50        # resume
 *
 * Flags:
 *   --dry-run           re-scrape + report only; no DB writes
 *   --limit=N           max products this run (default 25, 1..500)
 *   --ids=1,2           restrict to these product ids
 *   --after=ID          resume cursor (exclusive)
 *   --max-sections=N    only target rows whose current parsed section count is
 *                       <= N (use 1 for the un-structured legacy rows)
 *   --delay=MS          delay between page visits (default 1500, 300..10000)
 *   --backup=PATH       override the backup file path
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  BASE,
  createSdSession,
  parseProductPage,
  parseStoredDescription,
  loadEnvFiles,
} from './lib/sd-core.mjs';
import {
  selectDescriptionRefreshTargets,
  classifyDescriptionRefresh,
  summarizeDescriptionRefresh,
  nextDescriptionRefreshCursor,
  buildDescriptionUpdatePatch,
  sectionKeySet,
} from './lib/product-description-refresh.mjs';

export function parseRefreshArgs(argv) {
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
  const delayMs = Number(values.delay || 1500);
  const maxSections = values['max-sections'] === undefined ? Infinity : Number(values['max-sections']);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('--limit must be an integer between 1 and 500');
  if (!Number.isInteger(afterId) || afterId < 0) throw new Error('--after must be a non-negative product id');
  if (!Number.isInteger(delayMs) || delayMs < 300 || delayMs > 10_000) throw new Error('--delay must be between 300 and 10000 ms');
  if (maxSections !== Infinity && (!Number.isInteger(maxSections) || maxSections < 0 || maxSections > 10)) {
    throw new Error('--max-sections must be an integer between 0 and 10');
  }
  if (values.ids && ids.length === 0) throw new Error('--ids did not contain a valid positive product ID');
  return {
    ids, limit, afterId, delayMs, maxSections,
    dryRun: flags.has('dry-run'),
    backupPath: values.backup || '',
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

async function fetchProducts(supabase) {
  const { data, error } = await supabase.from('products_admin')
    .select('id,name,sd_product_id,description,description_i18n,description_i18n_status,description_i18n_manual_locked')
    .not('sd_product_id', 'is', null)
    .order('id', { ascending: true });
  if (error) throw new Error(`Cannot load products: ${error.message}`);
  return data || [];
}

/** Persist pre-change description + translation state so a bad run can be reverted. */
function writeBackup(targets, backupPath) {
  const file = backupPath || path.join('scripts', `.desc-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const payload = targets.map((p) => ({
    id: Number(p.id),
    sd_product_id: p.sd_product_id,
    description: p.description ?? null,
    description_i18n: p.description_i18n ?? {},
    description_i18n_status: p.description_i18n_status ?? null,
  }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
}

async function main() {
  console.log('📝 WELMES product-description refresh (restores the section template; no AI cost)');
  const options = parseRefreshArgs(process.argv.slice(2));
  loadEnvFiles();
  const env = process.env;
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'WELMES_ADMIN_EMAIL', 'WELMES_ADMIN_PASSWORD']
    .filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

  const supabase = await createAdminClient(env);
  const all = await fetchProducts(supabase);
  const storedCount = (p) => sectionKeySet(parseStoredDescription(p.description || '')).length;
  const targets = selectDescriptionRefreshTargets(all, {
    ids: options.ids.length ? options.ids : null,
    afterId: options.afterId,
    limit: options.limit,
    maxSections: options.maxSections,
  }, storedCount);

  console.log(`✓ admin login; ${all.length} products with sd_product_id, ${targets.length} selected (limit ${options.limit}${Number.isFinite(options.maxSections) ? `, max-sections ${options.maxSections}` : ''})`);
  if (!targets.length) {
    console.log('Nothing to refresh.');
    return;
  }

  const backupFile = writeBackup(targets, options.backupPath);
  console.log(`💾 backup of current descriptions + translations: ${backupFile}`);
  if (options.dryRun) console.log('   (dry-run: no DB writes)');

  const sd = await createSdSession(chromium);
  await sd.ensure();

  const scrape = async (product) => {
    const url = `${BASE}/p/r/pd_p/${product.sd_product_id}/`;
    const page = sd.page();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(800);
    return parseProductPage(page, url);
  };

  const results = [];
  const processed = [];
  let applied = 0;
  let failed = 0;
  let recovered = 0;
  try {
    for (const product of targets) {
      try {
        let parsed = await scrape(product);
        // A silently expired session renders a page with no product content, so
        // the description comes back empty. Re-authenticate and retry once
        // before concluding the product genuinely has no description.
        if (!String(parsed.description || '').trim()) {
          await sd.ensure();
          parsed = await scrape(product);
          if (String(parsed.description || '').trim()) recovered++;
        }

        const storedSections = parseStoredDescription(product.description || '');
        const verdict = classifyDescriptionRefresh(product, storedSections, parsed.description, parsed.descriptionSections || []);
        results.push(verdict);
        processed.push(product);

        const mark = { improved: '⬆', text_changed: '~', unchanged: '=', regressed: '⚠', empty_scrape: '✗' }[verdict.verdict];
        console.log(`  ${mark} #${product.id} sd=${product.sd_product_id} [${verdict.storedKeys.join('+') || 'none'}] → [${verdict.freshKeys.join('+') || 'none'}] ${verdict.verdict}${verdict.gained.length ? ` +${verdict.gained.join(',')}` : ''}`);

        if (!verdict.apply || options.dryRun) continue;

        const patch = buildDescriptionUpdatePatch(parsed.description);
        if (!patch) {
          console.log('     ↷ empty description; row left untouched');
          continue;
        }
        const { error } = await supabase.from('products_admin').update(patch).eq('id', product.id);
        if (error) throw new Error(error.message);
        applied++;
        console.log(`     ✓ updated → ${verdict.freshKeys.length} section(s); translation reset to pending`);
      } catch (error) {
        failed++;
        console.log(`  ✗ #${product.id} ${error.message}`);
        await sd.ensure().catch(() => {});
      }
      await sd.page().waitForTimeout(options.delayMs).catch(() => {});
    }
  } finally {
    await sd.close().catch(() => {});
  }

  const summary = summarizeDescriptionRefresh(results);
  console.log(`\n📊 ${JSON.stringify({ ...summary, applied, failed, sessionRecovered: recovered })}`);
  if (options.dryRun) {
    console.log(`Dry-run only — ${summary.willApply} product(s) would be rewritten, gaining ${summary.sectionsGained} section(s) in total.`);
    console.log('Re-run without --dry-run to apply, THEN re-run the translation backfill.');
  } else if (applied) {
    console.log(`${applied} description(s) rewritten and their translations invalidated (status → pending).`);
    console.log('Next: npm run backfill:desc -- --limit=N --lease=1800 --batch-size=10');
  }
  const cursor = nextDescriptionRefreshCursor(processed, options.afterId);
  console.log(`Resume the next batch with --after=${cursor}.`);
  if (failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
