#!/usr/bin/env node
// Reprice already-registered products after a MARGIN change.
//
// MARGIN only applies at import time, so changing the constant leaves every
// existing row at the old multiplier. This rescales `wholesale_price` and each
// set option's `wholesalePrice` from the old margin to the new one:
//
//     卸単価 = current_price / OLD_MARGIN
//     new    = round(卸単価 × NEW_MARGIN)
//
// Dry run by default — repricing the whole catalogue is not something to trigger
// by accident. Pass --apply to write, and --backup to keep a restorable snapshot.
//
//   node scripts/reprice-products.mjs                  # report only
//   node scripts/reprice-products.mjs --apply --backup
//
// Prices only; nothing else on the product is touched.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFiles, MARGIN } from './lib/sd-core.mjs';

const OLD_MARGIN = Number(process.env.OLD_MARGIN ?? 1.1);
const NEW_MARGIN = Number(process.env.NEW_MARGIN ?? MARGIN);
const APPLY = process.argv.includes('--apply');
const BACKUP = process.argv.includes('--backup');

loadEnvFiles();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const email = process.env.WELMES_ADMIN_EMAIL;
const password = process.env.WELMES_ADMIN_PASSWORD;

if (!url || !anon) { console.error('SUPABASE_URL / ANON_KEY missing'); process.exit(2); }
if (!Number.isFinite(OLD_MARGIN) || OLD_MARGIN <= 0) { console.error('OLD_MARGIN invalid'); process.exit(2); }
if (!Number.isFinite(NEW_MARGIN) || NEW_MARGIN <= 0) { console.error('NEW_MARGIN invalid'); process.exit(2); }

const rescale = (price) => Math.round((Number(price) / OLD_MARGIN) * NEW_MARGIN);

const supabase = createClient(url, anon, { auth: { persistSession: false } });

if (APPLY) {
  if (!email || !password) {
    console.error('WELMES_ADMIN_EMAIL / WELMES_ADMIN_PASSWORD needed to write (products are admin-only)');
    process.exit(2);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) { console.error('admin sign-in failed:', error.message); process.exit(1); }
}

const { data: products, error } = await supabase
  .from('products')
  .select('id, name, wholesale_price, set_options')
  .order('id');
if (error) { console.error('fetch failed:', error.message); process.exit(1); }

console.log(`${OLD_MARGIN} → ${NEW_MARGIN}  (${APPLY ? 'APPLY' : 'dry run'})`);
console.log(`${products.length} products\n`);

if (BACKUP && APPLY) {
  const file = path.join('scripts', `.price-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(products, null, 2));
  console.log(`backup → ${file}\n`);
}

let changed = 0, failed = 0, deltaSum = 0;
for (const p of products) {
  const oldPrice = Number(p.wholesale_price) || 0;
  const newPrice = rescale(oldPrice);

  const oldSets = Array.isArray(p.set_options) ? p.set_options : null;
  const newSets = oldSets?.map((s) => ({ ...s, wholesalePrice: rescale(s.wholesalePrice) })) ?? null;

  const priceMoved = newPrice !== oldPrice;
  const setsMoved = JSON.stringify(oldSets) !== JSON.stringify(newSets);
  if (!priceMoved && !setsMoved) continue;

  changed += 1;
  deltaSum += newPrice - oldPrice;
  if (changed <= 10) {
    console.log(`#${String(p.id).padEnd(5)} ${oldPrice.toLocaleString().padStart(9)} → ${newPrice.toLocaleString().padStart(9)}  ${p.name.slice(0, 40)}`);
  }

  if (!APPLY) continue;
  const patch = { wholesale_price: newPrice };
  if (newSets) patch.set_options = newSets;
  const { error: upErr } = await supabase.from('products').update(patch).eq('id', p.id);
  if (upErr) { failed += 1; console.error(`  ✖ #${p.id}: ${upErr.message}`); }
}

if (changed > 10) console.log(`… and ${changed - 10} more`);
console.log(`\n${changed} would change, ${failed} failed`);
console.log(`average price move: ${changed ? Math.round(deltaSum / changed).toLocaleString() : 0} JPY`);
if (!APPLY) console.log('\nNothing was written. Re-run with --apply --backup to commit.');
process.exit(failed > 0 ? 1 : 0);
