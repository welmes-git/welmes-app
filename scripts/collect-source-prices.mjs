#!/usr/bin/env node
// Collect the supplier wholesale price (卸単価, 税抜) for products already
// registered, by re-reading their Superdelivery page via `sd_product_id`.
//
// Why re-scrape instead of computing it: the importer only ever stored
// `round(卸単価 × MARGIN)`. Dividing that back out assumes nothing was hand-edited
// and cannot recover the rounding — of 229 products only 13 divide to a whole yen.
// The supplier page is the source of truth.
//
// Writes ONLY the cost fields: `sd_wholesale_price`, `sd_price_checked_at`, and
// `sourcePrice` inside each set option. Selling prices, stock, images, names and
// descriptions are left exactly as they are — this is a measurement pass, not a
// sync. sd-monitor remains the thing that reacts to changes.
//
//   npm run collect:cost                 # dry run, reports what it found
//   npm run collect:cost -- --apply
//   npm run collect:cost -- --apply --limit 20
//
// Session handling and parsing are shared with sd-import/sd-monitor.
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import {
  loadEnvFiles, createSupabase, createSdSession, parseProductPage,
  BASE, DELAY_MS,
} from './lib/sd-core.mjs';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
const ONLY_MISSING = !process.argv.includes('--all');

loadEnvFiles();
const supabase = createSupabase(createClient);

// `products_admin` gates on is_admin() and is granted to `authenticated`, so the
// anon client the other helpers share cannot read it. Same sign-in the backfill
// scripts use.
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'WELMES_ADMIN_EMAIL', 'WELMES_ADMIN_PASSWORD']) {
  if (!process.env[key]) { console.error(`${key} missing (.env / .env.local)`); process.exit(2); }
}
{
  const { error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.WELMES_ADMIN_EMAIL,
    password: process.env.WELMES_ADMIN_PASSWORD,
  });
  if (authErr) { console.error('admin sign-in failed:', authErr.message); process.exit(1); }
}

let query = supabase
  .from('products_admin')
  .select('id, name, wholesale_price, set_options, sd_product_id, sd_wholesale_price')
  .not('sd_product_id', 'is', null)
  .order('id');
if (ONLY_MISSING) query = query.is('sd_wholesale_price', null);

const { data: rows, error } = await query;
if (error) { console.error('fetch failed:', error.message); process.exit(1); }

const targets = rows.slice(0, Number.isFinite(LIMIT) ? LIMIT : undefined);
console.log(`${targets.length} products to check${ONLY_MISSING ? ' (missing cost only; --all to recheck everything)' : ''}`);
console.log(APPLY ? 'APPLY\n' : 'dry run — nothing will be written\n');
if (targets.length === 0) process.exit(0);

// Same session handling as sd-monitor: ensure() re-logs in and swaps the context,
// so the page handle has to be re-read afterwards.
const sd = await createSdSession(chromium);
await sd.ensure();
let page = sd.page();

let ok = 0, failed = 0, drift = 0;
const sample = [];

for (const row of targets) {
  const url = `${BASE}/p/r/pd_p/${row.sd_product_id}/`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // parseProductPage is enough: it already carries `sourcePrice` per set. Going
    // through buildProduct would add a dealer-brands page fetch we do not need and
    // throws on products with no purchasable set.
    const parsed = await parseProductPage(page, url);

    const sets = parsed.setOptions ?? [];
    if (sets.length === 0 || !sets[0].sourcePrice) {
      failed += 1;
      const why = parsed.error?.kind ?? 'no price visible';
      console.log(`✖ #${row.id} ${why} — ${row.name.slice(0, 40)}`);
      continue;
    }

    const source = sets[0].sourcePrice;
    // What the selling price implies about the margin actually in force. A value
    // far from 1.1 means the price was edited by hand, which is exactly the case
    // the divide-back approach would have got wrong.
    const implied = row.wholesale_price / source;
    if (Math.abs(implied - 1.1) > 0.02) {
      drift += 1;
      console.log(`⚠ #${row.id} implied margin ${implied.toFixed(3)} (sell ${row.wholesale_price}, cost ${source}) — ${row.name.slice(0, 36)}`);
    }
    if (sample.length < 8) sample.push({ id: row.id, cost: source, sell: row.wholesale_price, implied });

    if (APPLY) {
      // Merge sourcePrice into the stored options by id, keeping every other field
      // untouched so a set renamed upstream does not overwrite what buyers see.
      const stored = Array.isArray(row.set_options) ? row.set_options : [];
      const bySetId = new Map(sets.map((s) => [s.id, s.sourcePrice]));
      const merged = stored.map((s) => (
        bySetId.has(s.id) ? { ...s, sourcePrice: bySetId.get(s.id) } : s
      ));

      const { error: upErr } = await supabase
        .from('products_admin')
        .update({
          sd_wholesale_price: source,
          sd_price_checked_at: new Date().toISOString(),
          set_options: merged.length ? merged : stored,
        })
        .eq('id', row.id);
      if (upErr) { failed += 1; console.error(`✖ #${row.id} write failed: ${upErr.message}`); continue; }
    }

    ok += 1;
    if (ok % 25 === 0) console.log(`  … ${ok}/${targets.length}`);
  } catch (e) {
    failed += 1;
    console.log(`✖ #${row.id} ${String(e.message).slice(0, 80)}`);
    // A dropped session shows up as a navigation failure; re-establish and carry on.
    await sd.ensure().catch(() => {});
    page = sd.page();
  }
  await new Promise((r) => setTimeout(r, DELAY_MS));
}

await sd.close();

console.log(`\ncollected ${ok}, failed ${failed}, unexpected margin ${drift}`);
if (sample.length) {
  console.log('\nsample:');
  for (const s of sample) {
    console.log(`  #${String(s.id).padEnd(5)} cost ${String(s.cost).padStart(7)}  sell ${String(s.sell).padStart(7)}  ×${s.implied.toFixed(3)}`);
  }
}
if (!APPLY) console.log('\nRe-run with --apply to write the cost fields.');
process.exit(failed > 0 && ok === 0 ? 1 : 0);
