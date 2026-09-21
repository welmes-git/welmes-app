#!/usr/bin/env node
/**
 * refresh-product-images.mjs
 *
 * Repair product images that were polluted by the old scraper bug: page-wide
 * `img` collection pulled the Super Delivery recommendation sections
 * (この企業の関連商品 / よく一緒にチェックされている商品 / 最近チェックした商品)
 * into products.images. uploadProductImages() caps at 8, which is why polluted
 * rows characteristically hold exactly 8 images while the product really has
 * only 1–3.
 *
 * The fix already lives in sd-core.normalizeProductImages() (recommend-img is
 * excluded by selector, plus a filename SD-ID filter; both unit-tested). This
 * script simply revisits each product's SD detail page, re-collects with the
 * fixed logic, and rewrites products.image/images.
 *
 * SAFETY
 *   - --dry-run (default posture for the first run) mutates nothing and prints a
 *     per-product before/after diff.
 *   - Before any write, the current image + images of every target are written
 *     to a timestamped backup JSON so the change can be reverted.
 *   - An empty scrape NEVER clears existing images (guard in classifyImageRefresh).
 *   - Old Supabase Storage objects are intentionally NOT deleted. Only the DB
 *     rows are repointed. Cleaning up orphaned Storage files is a separate,
 *     deliberate step once the storefront has been eyeballed.
 *   - Crawls sequentially with a delay to respect the supplier site.
 *
 * Usage:
 *   npm run refresh:images -- --dry-run --min-images=8
 *   npm run refresh:images -- --dry-run --limit=500
 *   npm run refresh:images -- --limit=25
 *   npm run refresh:images -- --ids=39,40,41
 *   npm run refresh:images -- --after=120 --limit=50      # resume
 *
 * Flags:
 *   --dry-run          re-scrape + report only; no uploads, no DB writes
 *   --limit=N          max products this run (default 25, 1..500)
 *   --ids=1,2          restrict to these product ids
 *   --after=ID         resume cursor (exclusive; ids <= ID are skipped)
 *   --min-images=N     only target rows holding >= N images (default 0 = all;
 *                      use 8 to target just the capped/suspicious rows)
 *   --delay=MS         delay between page visits (default 1500, 300..10000)
 *   --backup=PATH      override the backup file path
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import {
  BASE,
  createSdSession,
  parseProductPage,
  uploadProductImages,
  loadEnvFiles,
} from './lib/sd-core.mjs';
import {
  selectImageRefreshTargets,
  classifyImageRefresh,
  summarizeImageRefresh,
  nextImageRefreshCursor,
  buildImageUpdatePatch,
} from './lib/product-image-refresh.mjs';

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
  const minImages = Number(values['min-images'] || 0);
  const delayMs = Number(values.delay || 1500);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('--limit must be an integer between 1 and 500');
  if (!Number.isInteger(afterId) || afterId < 0) throw new Error('--after must be a non-negative product id');
  if (!Number.isInteger(minImages) || minImages < 0 || minImages > 8) throw new Error('--min-images must be an integer between 0 and 8');
  if (!Number.isInteger(delayMs) || delayMs < 300 || delayMs > 10_000) throw new Error('--delay must be between 300 and 10000 ms');
  if (values.ids && ids.length === 0) throw new Error('--ids did not contain a valid positive product ID');
  return {
    ids,
    limit,
    afterId,
    minImages,
    delayMs,
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
    .select('id,name,sd_product_id,image,images')
    .not('sd_product_id', 'is', null)
    .order('id', { ascending: true });
  if (error) throw new Error(`Cannot load products: ${error.message}`);
  return data || [];
}

/** Persist the pre-change image state so a bad run can be reverted. */
function writeBackup(targets, backupPath) {
  const file = backupPath || path.join('scripts', `.image-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const payload = targets.map((p) => ({
    id: Number(p.id),
    sd_product_id: p.sd_product_id,
    image: p.image ?? null,
    images: Array.isArray(p.images) ? p.images : [],
  }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
}

async function main() {
  console.log('🖼  WELMES product-image refresh (removes recommendation-section leakage)');
  const options = parseRefreshArgs(process.argv.slice(2));
  loadEnvFiles();
  const env = process.env;
  const missing = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'WELMES_ADMIN_EMAIL', 'WELMES_ADMIN_PASSWORD']
    .filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);

  const supabase = await createAdminClient(env);
  const all = await fetchProducts(supabase);
  const targets = selectImageRefreshTargets(all, {
    ids: options.ids.length ? options.ids : null,
    afterId: options.afterId,
    limit: options.limit,
    minImages: options.minImages,
  });
  console.log(`✓ admin login; ${all.length} products with sd_product_id, ${targets.length} selected (limit ${options.limit}${options.minImages ? `, min-images ${options.minImages}` : ''})`);
  if (!targets.length) {
    console.log('Nothing to refresh.');
    return;
  }

  // Always snapshot current state before touching anything (also useful as a
  // dry-run artifact/report input).
  const backupFile = writeBackup(targets, options.backupPath);
  console.log(`💾 backup of current image URLs: ${backupFile}`);
  if (options.dryRun) console.log('   (dry-run: no uploads, no DB writes)');

  const sd = await createSdSession(chromium);
  await sd.ensure();

  const results = [];
  const processed = [];
  let applied = 0;
  let failed = 0;
  let recovered = 0;

  /** Load a product page and re-collect its images with the fixed logic. */
  const scrape = async (product) => {
    const url = `${BASE}/p/r/pd_p/${product.sd_product_id}/`;
    const page = sd.page();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(800);
    return parseProductPage(page, url);
  };

  try {
    for (const product of targets) {
      try {
        let parsed = await scrape(product);

        // A silently expired session still renders a page (no exception) but the
        // product gallery is absent, so images come back empty. That is
        // indistinguishable from a genuinely image-less product until we
        // re-authenticate and retry once. Without this, a mid-run session drop
        // would mark every remaining product 'empty_scrape'.
        if (parsed.images.length === 0) {
          await sd.ensure();
          parsed = await scrape(product);
          if (parsed.images.length > 0) recovered++;
        }

        const verdict = classifyImageRefresh(product, parsed.images);
        results.push(verdict);
        processed.push(product);

        const mark = { contaminated: '⚠', unchanged: '=', more_found: '+', empty_scrape: '✗' }[verdict.verdict];
        console.log(`  ${mark} #${product.id} sd=${product.sd_product_id} stored=${verdict.storedCount} → scraped=${verdict.scrapedCount} [${verdict.verdict}] ${String(product.name || '').slice(0, 30)}`);

        if (!verdict.apply) continue;
        if (options.dryRun) continue;

        // Upload the freshly scraped (clean) images, then repoint the row. Old
        // Storage objects are deliberately left in place.
        const uploaded = await uploadProductImages(supabase, parsed.images);
        const patch = buildImageUpdatePatch(uploaded);
        if (!patch) {
          console.log('     ↷ upload produced no URLs; row left untouched');
          continue;
        }
        const { error } = await supabase.from('products_admin').update(patch).eq('id', product.id);
        if (error) throw new Error(error.message);
        applied++;
        console.log(`     ✓ updated → ${patch.images.length} image(s)`);
      } catch (error) {
        failed++;
        console.log(`  ✗ #${product.id} ${error.message}`);
        await sd.ensure().catch(() => {}); // recover an expired session and continue
      }
      await sd.page().waitForTimeout(options.delayMs).catch(() => {});
    }
  } finally {
    await sd.close().catch(() => {});
  }

  const summary = summarizeImageRefresh(results);
  console.log(`\n📊 ${JSON.stringify({ ...summary, applied, failed, sessionRecovered: recovered })}`);
  if (options.dryRun) {
    console.log(`Dry-run only — ${summary.willApply} product(s) would be rewritten, removing ${summary.imagesRemoved} leaked image(s).`);
    console.log('Re-run without --dry-run to apply. Old Storage files are kept either way.');
  } else {
    console.log('Old Supabase Storage objects were NOT deleted; clean them up separately after verifying the storefront.');
  }
  const cursor = nextImageRefreshCursor(processed, options.afterId);
  console.log(`Resume the next batch with --after=${cursor}.`);
  if (failed) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
