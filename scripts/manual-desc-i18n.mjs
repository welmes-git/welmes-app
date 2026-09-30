/**
 * Hand-translated product descriptions, through the SAME validation and write
 * path as `translate-product-descriptions.mjs` — only the translator differs
 * (no AI API call).
 *
 * Descriptions are highly templated, so they are split into reusable segments
 * (category tags, brands, sellers, countries, ingredients, free-text lines) and
 * translated once into a translation memory (TM). A product is published only
 * when every one of its segments is in the TM and validateTranslations()
 * returns auto_approved; it is then written via the normal queue RPCs
 * (enqueue → claim → complete), so all guards and locks still apply.
 *
 *   node scripts/manual-desc-i18n.mjs export [--size=N]
 *       → scripts/.i18n/desc/{dict,seg}-NNN.src.tsv   ("segId<TAB>type<TAB>ja")
 *   node scripts/manual-desc-i18n.mjs import scripts/.i18n/desc/<file>.json
 *       file shape: { "<segId>": { "en": "...", "zh": "...", "ko": "..." } }
 *       per-segment guards run first; failing segments are reported, not stored.
 *   node scripts/manual-desc-i18n.mjs apply [--ids=1,2] [--limit=N] [--dry-run]
 *   node scripts/manual-desc-i18n.mjs status [--list=<file.tsv>]
 *       --list writes the still-untranslated products (read-only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadLocalEnv } from './lib/product-name-providers.mjs';
import { normalizeSourceName } from './lib/product-name-i18n.mjs';
import { parseStoredDescription } from './lib/sd-core.mjs';
import {
  buildTranslationJob, checkSectionGuards, isDescriptionBackfillTarget, validateTranslations, DEFAULT_TARGET_LANGS,
} from './lib/product-description-i18n.mjs';
import { fetchAllRows } from '../src/lib/fetchAllRows.ts';

const DIR = 'scripts/.i18n/desc';
const TM_FILE = path.join(DIR, 'tm.json');
const SEG_FILE = path.join(DIR, 'segments.json');
const LANGS = DEFAULT_TARGET_LANGS;
const PROVIDER = 'anthropic';
const MODEL = 'manual-kiro-v1';
const WORKER = 'manual-desc-i18n';

const [cmd, ...args] = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const m = args.find((a) => a.startsWith(`--${n}=`)); return m ? m.slice(n.length + 3) : d; };

const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
const segId = (type, ja) => `${type[0]}${createHash('sha1').update(`${type}\u0000${ja}`).digest('hex').slice(0, 9)}`;

// ── Fixed vocabulary (not worth a TM round-trip) ─────────────────────
const FIXED = {
  '容量': { en: 'Contents', zh: '容量', ko: '용량' },
  'ケースサイズ': { en: 'Case size', zh: '箱规尺寸', ko: '케이스 사이즈' },
  'ケース重量': { en: 'Case weight', zh: '箱重', ko: '케이스 중량' },
  'ケース入数': { en: 'Units per case', zh: '每箱入数', ko: '케이스 입수' },
  '販売元': { en: 'Distributor', zh: '销售商', ko: '판매원' },
  '生産地': { en: 'Country of origin', zh: '产地', ko: '생산지' },
  '商品札': { en: 'Product tag', zh: '商品吊牌', ko: '상품 택' },
  '素材・成分': { en: 'Materials/Ingredients', zh: '材质·成分', ko: '소재·성분' },
  '無し': { en: 'None', zh: '无', ko: '없음' },
  '関連ワード': { en: 'Related words', zh: '相关词', ko: '관련 키워드' },
  '商品一覧': { en: 'products', zh: '商品一览', ko: '상품 목록' },
  '商品': { en: 'Product', zh: '商品', ko: '상품' },
};
const SEP = {
  en: { '、': ', ', '，': ', ', ',': ',', '：': ': ' },
  zh: { '、': '、', '，': '，', ',': ',', '：': '：' },
  ko: { '、': ', ', '，': ', ', ',': ',', '：': ': ' },
};
// A value that is pure notation (numbers, units, dimensions) is copied verbatim.
const NOTATION = /^[\d０-９.,．×xX*＊~〜～\-−()（）\s/＋+]*(?:g|kg|mg|ml|mL|L|cm|mm|G|ML|ｍｌ|個|枚|本|袋|包|錠|粒|入|(?:\(mm\)))?[\d()（）×\s]*$/;

// ── Segmentation / rendering ─────────────────────────────────────────
// render(product, lang|null, need) → string per section, or collects needed
// segments when lang is null. Returns null if any segment is missing.
function makeRenderer(tm, need) {
  const get = (typeIn, ja, lang) => {
    let type = typeIn;
    const t = ja.trim();
    if (!t) return '';
    if (FIXED[t] && type !== 'text' && type !== 'ing') return FIXED[t][lang ?? 'en'];
    if (type === 'notation' || NOTATION.test(t)) return t;
    if (type === 'x') type = 'text';
    // "A・B・C" ingredient lists: translate each ingredient once and reuse it
    // across products (unless the whole list is already in the TM).
    if (type === 'ing' && !tm[segId(type, t)] && t.split('・').filter((x) => x.trim()).length >= 3) {
      return t.split('・').map((x) => (x.trim() ? get('ing', x, lang) : x)).join(lang === 'en' ? '/' : '·');
    }
    if (type === 'ing' && !tm[segId(type, t)] && t.split(/[ \u3000]+/).filter(Boolean).length >= 4) {
      return t.split(/[ \u3000]+/).filter(Boolean).map((x) => get('ing', x, lang)).join(lang === 'en' ? ' / ' : ' · ');
    }
    const id = segId(type, t);
    if (!lang) { need.set(id, { type, ja: t }); return ''; }
    const hit = tm[id]?.[lang];
    if (hit == null) throw new MissingSegment(id);
    return hit;
  };
  const sep = (ch, lang) => (lang ? SEP[lang][ch] ?? ch : ch);

  const title = (line, product, lang, withCat) => {
    const m = line.match(/^【([^】]+)】(.*?)(?:【([^】]+)】)?$/);
    const mid = m ? m[2] : '';
    const usable = m && product.name_i18n && normalizeSourceName(mid) === normalizeSourceName(product.name)
      && LANGS.every((l) => product.name_i18n[l] && !checkSectionGuards(null, `【${m[1]}】${mid}`, product.name_i18n[l]).length);
    if (usable) {
      const cat = withCat && m[3] ? get('cat', m[3], lang) : '';
      if (!lang) return '';
      const nameOut = product.name_i18n[lang];
      return cat ? `${nameOut} ${lang === 'en' ? `[${cat}]` : `【${cat}】`}` : nameOut;
    }
    return get('text', line, lang);
  };

  const ingredients = (value, lang) => value
    .split(/(\\n|[、,，：])/)
    // Keep a leading space from the source ("C14,　15)") so "14, 15" isn't
    // re-joined into the single number "14,15".
    .map((tok) => (/^(\\n|[、,，：])$/.test(tok) ? sep(tok, lang)
      : (tok.trim() ? `${lang && /^[\s\u3000]/.test(tok) ? ' ' : ''}${get('ing', tok, lang)}` : tok)))
    .join('');

  const line = (key, l, product, lang) => {
    if (key === 'overview') {
      if (/^【[^】]+】.*【[^】]+】$/.test(l)) return title(l, product, lang, true);
      let m = l.match(/^関連ワード[：:]\s*(.+)$/);
      if (m) return `${get('x', '関連ワード', lang)}${sep('：', lang)}${m[1].split(/\s+/).map((c) => get('cat', c, lang)).join(' ')}`;
      m = l.match(/^([^【】：:。]{1,40}?)[\s\u3000]+商品一覧$/);
      if (m) return lang === 'en' ? `${get('brand', m[1], lang)} ${FIXED['商品一覧'].en}` : `${get('brand', m[1], lang)} ${get('x', '商品一覧', lang)}`;
      return get('text', l, lang);
    }
    if (key === 'size') {
      const m = l.match(/^(容量|ケースサイズ|ケース入数|販売元|ケース重量)[：:](.*)$/);
      if (m) {
        const v = m[2].trim();
        const out = m[1] === '販売元' ? get('company', v, lang) : get(NOTATION.test(v) ? 'notation' : 'text', v, lang);
        return `${get('x', m[1], lang)}${sep('：', lang)}${out}`;
      }
      // The size block's title line follows numeric lines ("ケース入数：120"); a
      // label keeps "120\nLion…" from reading as the unit "120L" in the guard.
      if (/^【[^】]+】/.test(l)) return `${get('x', '商品', lang)}${sep('：', lang)}${title(l, product, lang, true)}`;
      return get('text', l, lang);
    }
    if (key === 'spec') {
      const m = l.match(/^■(生産地|商品札|素材・成分)[：:](.*)$/);
      if (m) {
        const v = m[2].trim();
        let out;
        if (m[1] === '生産地') out = get('country', v, lang);
        else if (m[1] === '商品札') out = get('x', v, lang);
        else out = ingredients(v, lang);
        return `■${get('x', m[1], lang)}${sep('：', lang)}${out}`;
      }
      return get('text', l, lang);
    }
    return get('text', l, lang);
  };

  return (product, lang) => {
    const sections = parseStoredDescription(product.description || '');
    const out = { extras: [] };
    for (const s of sections) {
      const v = s.value.split('\n').map((l) => (l.trim() ? line(s.key, l.trim(), product, lang) : '')).join('\n');
      if (s.key) out[s.key] = v; else out.extras.push(v);
    }
    if (!out.extras.length) delete out.extras;
    return out;
  };
}
class MissingSegment extends Error { constructor(id) { super(`missing segment ${id}`); this.id = id; } }

// ── DB ───────────────────────────────────────────────────────────────
async function db() {
  const env = loadLocalEnv();
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  const { error } = await sb.auth.signInWithPassword({ email: env.WELMES_ADMIN_EMAIL, password: env.WELMES_ADMIN_PASSWORD });
  if (error) throw new Error(`admin login failed: ${error.message}`);
  return sb;
}
const COLS = 'id,status,name,brand,name_i18n,description,description_i18n_status,description_i18n_manual_locked,sd_product_id';
async function loadTargets(sb) {
  const { data, error } = await fetchAllRows((f, t) => sb.from('products_admin')
    .select(COLS, { count: f === 0 ? 'exact' : undefined }).order('id').range(f, t));
  if (error) throw new Error(error.message);
  return data.filter(isDescriptionBackfillTarget);
}

// ── Commands ─────────────────────────────────────────────────────────
fs.mkdirSync(DIR, { recursive: true });
const tm = readJson(TM_FILE, {});

if (cmd === 'export') {
  const sb = await db();
  const targets = await loadTargets(sb);
  // Active products first, then ascending id — so translation completes whole
  // products in order instead of scattering effort across the catalogue.
  targets.sort((a, b) => ((a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)) || a.id - b.id);
  const rank = new Map(); const meta = readJson(SEG_FILE, {});
  targets.forEach((p, i) => {
    const need = new Map();
    makeRenderer(tm, need)(p, null);
    for (const [id, s] of need) { meta[id] = s; if (!rank.has(id)) rank.set(id, i); }
  });
  fs.writeFileSync(SEG_FILE, JSON.stringify(meta));
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.src.tsv')) fs.unlinkSync(path.join(DIR, f));
  const groups = {};
  for (const [id, r] of rank) {
    if (tm[id]) continue;
    const g = ['text', 'ing'].includes(meta[id].type) ? 'seg' : 'dict';
    (groups[g] ??= []).push([id, meta[id].type, meta[id].ja, r]);
  }
  const summary = {};
  for (const [g, rows] of Object.entries(groups)) {
    rows.sort((a, b) => a[3] - b[3] || a[1].localeCompare(b[1]));
    const budget = Number(opt('size', 0)) || 3000;
    let chunk = []; let chars = 0; let k = 0;
    const flush = () => { if (!chunk.length) return; fs.writeFileSync(path.join(DIR, `${g}-${String(++k).padStart(3, '0')}.src.tsv`), `${chunk.map((r) => r.slice(0, 3).join('\t')).join('\n')}\n`); chunk = []; chars = 0; };
    for (const r of rows) { if (chars + r[2].length > budget && chunk.length) flush(); chunk.push(r); chars += r[2].length; }
    flush();
    summary[g] = { segments: rows.length, chars: rows.reduce((a, r) => a + r[2].length, 0), files: k };
  }
  console.log(JSON.stringify({ targets: targets.length, tmSize: Object.keys(tm).length, todo: summary }));
} else if (cmd === 'import') {
  const file = args[0];
  const meta = readJson(SEG_FILE, {});
  const incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
  let ok = 0; const bad = [];
  for (const [id, t] of Object.entries(incoming)) {
    const s = meta[id];
    if (!s) { bad.push(`${id}: unknown segment id`); continue; }
    const v = {};
    for (const lang of LANGS) {
      const out = String(t?.[lang] ?? '').trim();
      // Dictionary entries (brand/seller/…) are short, so only text/ingredients get the length check.
      const g = checkSectionGuards(null, s.ja, out).filter((c) => c !== 'length_out_of_bounds' || s.type === 'text' || s.type === 'ing');
      if (s.type === 'ing' && (/[、,，：]/.test(out) || out.includes('\\n'))) g.push('delimiter_added');
      if (/[\u3040-\u309f\u30a0-\u30fa\u30fc-\u30ff]/.test(out)) g.push('kana_remaining');
      if (lang === 'ko' && !/[\uac00-\ud7a3]/.test(out) && /[\u3040-\u30fa\u30fc-\u30ff\u4e00-\u9fff]/.test(s.ja) && !['brand', 'company'].includes(s.type)) g.push('not_hangul');
      if (g.length) bad.push(`${id} ${lang} ${g.join('|')} :: ${s.ja} => ${out}`);
      else v[lang] = out;
    }
    if (Object.keys(v).length === LANGS.length) { tm[id] = v; ok++; }
  }
  fs.writeFileSync(TM_FILE, JSON.stringify(tm));
  console.log(JSON.stringify({ stored: ok, rejected: bad.length, tmSize: Object.keys(tm).length }));
  for (const b of bad) console.log(`  ⚠ ${b}`);
} else if (cmd === 'apply' || cmd === 'status') {
  const sb = await db();
  let targets = await loadTargets(sb);
  const ids = opt('ids', '') ? new Set(opt('ids').split(',').map(Number)) : null;
  if (ids) targets = targets.filter((p) => ids.has(p.id));
  const render = makeRenderer(tm, new Map());
  const ready = []; const missing = new Map(); const blockedRows = []; let blocked = 0;
  for (const p of targets) {
    try {
      const translations = Object.fromEntries(LANGS.map((l) => [l, render(p, l)]));
      ready.push({ p, translations });
    } catch (e) {
      if (!(e instanceof MissingSegment)) throw e;
      blocked++;
      missing.set(e.id, (missing.get(e.id) || 0) + 1);
      blockedRows.push([p.id, p.sd_product_id ?? '', p.status ?? '', p.description_i18n_status ?? '', p.brand ?? '', String(p.name ?? '').replace(/\s+/g, ' '), e.id]);
    }
  }
  const summary = { targets: targets.length, ready: ready.length, blocked, published: 0, reviewRequired: 0, skipped: 0, errors: 0 };
  if (cmd === 'status') {
    // --list=<file>: read-only TSV of products still waiting for translation (first missing segment per product).
    const listFile = opt('list', '');
    if (listFile) {
      const head = ['id', 'sd_product_id', 'status', 'description_i18n_status', 'brand', 'name', 'first_missing_segment'];
      fs.writeFileSync(listFile, `${[head, ...blockedRows].map((r) => r.join('\t')).join('\n')}\n`);
    }
    console.log(JSON.stringify(summary));
    process.exit(0);
  }
  if (flag('show')) for (const { p, translations } of ready.filter((r) => Object.keys(r.translations.en).length).slice(0, Number(opt('limit', 1)))) console.log(`#${p.id}`, JSON.stringify(translations, null, 1));
  if (flag('show')) process.exit(0);
  const limit = Number(opt('limit', Infinity));
  for (const { p, translations } of ready.slice(0, limit)) {
    const job = buildTranslationJob(
      { id: p.id, sd_product_id: p.sd_product_id, descriptionSections: parseStoredDescription(p.description || '') },
      { provider: PROVIDER, model: MODEL, targetLangs: LANGS, maxAttempts: 1 },
    );
    if (!job) { summary.skipped++; continue; }
    const v = validateTranslations(job.source, translations);
    if (v.status !== 'auto_approved') {
      summary.reviewRequired++;
      console.log(`  ⚠ #${p.id} ${JSON.stringify(v.violations)}`);
      continue;
    }
    if (flag('dry-run')) { summary.published++; continue; }
    try {
      const { data: runId, error: e1 } = await sb.rpc('enqueue_product_description_translation', job.rpcParams);
      if (e1) throw e1;
      const { data: claimed, error: e2 } = await sb.rpc('claim_product_description_translations', {
        p_worker_id: WORKER, p_limit: 5, p_lease_seconds: 120, p_product_ids: [p.id],
      });
      if (e2) throw e2;
      const run = (claimed || []).find((r) => r.id === runId);
      if (!run) throw new Error(`run ${runId} not claimed (${(claimed || []).length} other claimed)`);
      const { data: st, error: e3 } = await sb.rpc('complete_product_description_translation', {
        p_run_id: run.id, p_worker_id: WORKER, p_translations: v.i18n, p_status: v.status,
        p_result_payload: { model: MODEL, translations }, p_validation_payload: { status: v.status, violations: v.violations },
      });
      if (e3) throw e3;
      if (st === 'succeeded') summary.published++; else summary.skipped++;
    } catch (e) {
      summary.errors++;
      console.log(`  ✗ #${p.id} ${e.message}`);
    }
  }
  console.log(`${flag('dry-run') ? '(dry-run) ' : ''}${JSON.stringify(summary)}`);
} else {
  console.log('usage: export | import <file.json> | apply [--ids=] [--limit=] [--dry-run] | status [--list=<file>]');
}
