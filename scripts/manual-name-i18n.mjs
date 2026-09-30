#!/usr/bin/env node
/**
 * Hand-translated product names, through the SAME rules and write path as
 * `npm run translate:names` — only the translator differs (no AI API call).
 *
 *   node scripts/manual-name-i18n.mjs export [--size=200]
 *     → scripts/.i18n/names-NNN.src.tsv   ("id<TAB>brand<TAB>normalized Japanese name")
 *   node scripts/manual-name-i18n.mjs apply scripts/.i18n/names-NNN.json [--dry-run]
 *     translation file shape (same as buildBatchPrompt's contract):
 *     { "<id>": { "en": "...", "zh": "...", "ko": "..." }, ... }
 *
 * apply re-reads each product and skips it unless it is still a translation
 * target (admin-locked / already translated rows are never overwritten), then
 * runs validateBatch() and buildNameUpdatePatch() exactly like translate:names.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadLocalEnv } from './lib/product-name-providers.mjs';
import {
  DEFAULT_TARGET_LANGS, normalizeSourceName, selectNameTargets, validateBatch, buildNameUpdatePatch,
  isNameTranslationTarget,
} from './lib/product-name-i18n.mjs';
import { fetchAllRows } from '../src/lib/fetchAllRows.ts';

const DIR = 'scripts/.i18n';
const [cmd, fileArg, ...rest] = process.argv.slice(2);
const flag = (n) => [fileArg, ...rest].includes(`--${n}`);
const opt = (n, d) => { const m = [fileArg, ...rest].find((a) => a?.startsWith(`--${n}=`)); return m ? m.split('=')[1] : d; };

const env = loadLocalEnv();
const { createClient } = await import('@supabase/supabase-js');
const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const { error: authErr } = await supabase.auth.signInWithPassword({ email: env.WELMES_ADMIN_EMAIL, password: env.WELMES_ADMIN_PASSWORD });
if (authErr) throw new Error(`admin login failed: ${authErr.message}`);

const COLS = 'id,name,brand,name_i18n,name_i18n_status,name_i18n_manual_locked';
async function loadAll() {
  const { data, error } = await fetchAllRows((f, t) => supabase.from('products_admin')
    .select(COLS, { count: f === 0 ? 'exact' : undefined }).order('id').range(f, t));
  if (error) throw new Error(error.message);
  return data;
}

if (cmd === 'export') {
  const size = Number(opt('size', 200));
  const targets = selectNameTargets(await loadAll());
  fs.mkdirSync(DIR, { recursive: true });
  let n = 0;
  for (let i = 0; i < targets.length; i += size) {
    // Brand is context only: normalizeSourceName strips 【ブランド】 prefixes.
    const lines = targets.slice(i, i + size).map((p) => `${p.id}\t${p.brand ?? ''}\t${normalizeSourceName(p.name)}`);
    fs.writeFileSync(path.join(DIR, `names-${String(++n).padStart(3, '0')}.src.tsv`), `${lines.join('\n')}\n`);
  }
  console.log(`exported ${targets.length} names into ${n} file(s) of ≤${size} in ${DIR}/`);
} else if (cmd === 'apply') {
  if (!fileArg || !fs.existsSync(fileArg)) throw new Error('usage: apply <translations.json> [--dry-run]');
  const result = JSON.parse(fs.readFileSync(fileArg, 'utf8'));
  const ids = Object.keys(result).map(Number).filter((v) => Number.isSafeInteger(v) && v > 0);
  const rows = [];
  for (let i = 0; i < ids.length; i += 300) {
    const { data, error } = await supabase.from('products_admin').select(COLS).in('id', ids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    rows.push(...data);
  }
  const live = rows.filter(isNameTranslationTarget);
  const items = live.map((p) => ({ id: Number(p.id), source: normalizeSourceName(p.name) }));
  const { updates } = validateBatch(items, result, DEFAULT_TARGET_LANGS);
  const summary = { translated: 0, reviewRequired: 0, skippedNotTarget: ids.length - live.length, writeErrors: 0 };
  for (const u of updates) {
    if (u.status === 'translated') summary.translated++;
    else { summary.reviewRequired++; console.log(`  ⚠ #${u.id} ${JSON.stringify(u.violations)}`); }
    if (flag('dry-run')) continue;
    const patch = buildNameUpdatePatch(u.names, u.status) ?? { name_i18n_status: 'review_required' };
    // Re-check the target condition in the UPDATE so a concurrent admin lock wins.
    const { error } = await supabase.from('products_admin').update(patch)
      .eq('id', u.id).eq('name_i18n_manual_locked', false).in('name_i18n_status', ['pending', 'failed']);
    if (error) { summary.writeErrors++; console.log(`  ✗ #${u.id} ${error.message}`); }
  }
  console.log(`${flag('dry-run') ? '(dry-run) ' : ''}${JSON.stringify(summary)}`);
  if (summary.writeErrors) process.exitCode = 1;
} else {
  console.log('usage: export [--size=N] | apply <file.json> [--dry-run]');
}
