#!/usr/bin/env node
// Bring every product onto the current MARGIN, computed from the supplier price we
// actually pay.
//
//     wholesale_price = round(sd_wholesale_price × MARGIN)
//
// The first version of this script inferred the cost by dividing the selling price
// by the previous margin. Collecting the real 卸単価 showed why that could not work:
// the catalogue was already split — 78 products sat at ×1.25 because sd-monitor had
// repriced them on its scheduled run while MARGIN was briefly 1.25, and 110 were
// still at ×1.1. Dividing a ×1.25 price by 1.1 would have inflated it another 13.6%.
//
// Products without a collected cost are skipped, not guessed. 33 have no
// `sd_product_id` at all (added outside the importer), so there is nothing to
// recompute from and their price is left alone.
//
//   npm run reprice                      # report only
//   npm run reprice -- --apply --backup
//
// Run `npm run collect:cost -- --apply` first, and stop the sd-monitor schedule
// while repricing: it writes `round(卸単価 × MARGIN)` too and would move rows
// underneath this pass.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFiles, createSupabase, MARGIN } from './lib/sd-core.mjs';

const APPLY = process.argv.includes('--apply');
const BACKUP = process.argv.includes('--backup');
const TARGET = Number(process.env.TARGET_MARGIN ?? MARGIN);

loadEnvFiles();
for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'WELMES_ADMIN_EMAIL', 'WELMES_ADMIN_PASSWORD']) {
  if (!process.env[key]) { console.error(`${key} missing (.env / .env.local)`); process.exit(2); }
}
if (!Number.isFinite(TARGET) || TARGET <= 1) { console.error('TARGET_MARGIN must be > 1'); process.exit(2); }

const supabase = createSupabase(createClient);
const { error: authErr } = await supabase.auth.signInWithPassword({
  email: process.env.WELMES_ADMIN_EMAIL,
  password: process.env.WELMES_ADMIN_PASSWORD,
});
if (authErr) { console.error('admin sign-in failed:', authErr.message); process.exit(1); }

const { data: products, error } = await supabase
  .from('products_admin')
  .select('id, name, wholesale_price, set_options, sd_wholesale_price')
  .order('id');
if (error) { console.error('fetch failed:', error.message); process.exit(1); }

console.log(`target margin ×${TARGET}  (${APPLY ? 'APPLY' : 'dry run'})`);
console.log(`${products.length} products\n`);

if (BACKUP && APPLY) {
  const file = path.join('scripts', `.price-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(products, null, 2));
  console.log(`backup → ${file}\n`);
}

let changed = 0, already = 0, skipped = 0, failed = 0, deltaSum = 0;
const shown = [];

for (const p of products) {
  const cost = Number(p.sd_wholesale_price) || 0;
  if (cost <= 0) { skipped += 1; continue; }

  const oldPrice = Number(p.wholesale_price) || 0;
  const newPrice = Math.round(cost * TARGET);

  // Set options are priced per set, each from its own collected sourcePrice.
  const oldSets = Array.isArray(p.set_options) ? p.set_options : null;
  const newSets = oldSets?.map((s) => {
    const src = Number(s.sourcePrice) || 0;
    return src > 0 ? { ...s, wholesalePrice: Math.round(src * TARGET) } : s;
  }) ?? null;

  const priceMoved = newPrice !== oldPrice;
  const setsMoved = JSON.stringify(oldSets) !== JSON.stringify(newSets);
  if (!priceMoved && !setsMoved) { already += 1; continue; }

  changed += 1;
  deltaSum += newPrice - oldPrice;
  if (shown.length < 12) {
    shown.push(`#${String(p.id).padEnd(5)} cost ${String(cost).padStart(7)}  ${String(oldPrice).padStart(7)} → ${String(newPrice).padStart(7)}  (×${(oldPrice / cost).toFixed(2)} → ×${TARGET})  ${p.name.slice(0, 32)}`);
  }

  if (!APPLY) continue;
  const patch = { wholesale_price: newPrice };
  if (newSets) patch.set_options = newSets;
  const { error: upErr } = await supabase.from('products_admin').update(patch).eq('id', p.id);
  if (upErr) { failed += 1; console.error(`✖ #${p.id}: ${upErr.message}`); }
}

for (const line of shown) console.log(line);
if (changed > shown.length) console.log(`… and ${changed - shown.length} more`);

console.log(`\n${changed} to change, ${already} already on target, ${skipped} skipped (no collected cost), ${failed} failed`);
if (changed) console.log(`average move: ${Math.round(deltaSum / changed).toLocaleString()} JPY`);
if (skipped) console.log(`\n${skipped} products keep their current price: run collect:cost first, or accept that products without an sd_product_id cannot be recomputed.`);
if (!APPLY) console.log('\nNothing was written. Re-run with --apply --backup to commit.');
process.exit(failed > 0 ? 1 : 0);
