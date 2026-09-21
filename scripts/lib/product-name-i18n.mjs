// WELMES — Per-language product names: pure helpers shared by the translation
// script and tests. No network/DB/browser dependencies.
//
// Product names are short, so unlike descriptions they are translated in
// BATCHES: one request carries many products, which amortizes the prompt and
// reasoning overhead. Measured on this catalogue, names average ~30 characters,
// and 68% of their characters are katakana/hiragana — unreadable to Chinese and
// Korean buyers — which is the whole reason this exists.

export const NAME_PROMPT_VERSION = 'product-name-i18n-v1';
export const DEFAULT_TARGET_LANGS = ['en', 'zh', 'ko'];
export const SOURCE_LANG = 'ja';

/** Default products per request. Small enough to keep each response reliable. */
export const DEFAULT_BATCH_SIZE = 20;

// Bracketed Japanese regulatory/category prefixes that carry no brand meaning
// and bloat every name (【指定医薬部外品】, 【リップクリーム】 …). They are
// stripped from the *source sent to the model* so the model spends its output on
// the actual product name; the regulatory fact still lives in description.spec.
const BRACKET_PREFIX = /[【［\[][^】］\]]{0,20}[】］\]]/g;

/** Characters that prove a string is still Japanese (kana are decisive). */
const KANA = /[\u3040-\u30ff]/;

/** Does this text still contain Japanese kana? Kanji alone is not decisive (shared with Chinese). */
export function hasKana(text) {
  return KANA.test(String(text || ''));
}

/** Normalize a source name for the model: collapse width/space noise, drop bracket prefixes. */
export function normalizeSourceName(name) {
  return String(name || '')
    .replace(BRACKET_PREFIX, ' ')
    .replace(/[\u3000\s]+/g, ' ')
    .trim();
}

// ── Guards ───────────────────────────────────────────────────────────

const NUMBER_TOKENS = /\d+(?:[.,]\d+)?/g;
// Physical measurement units are notation, not language: "200ml" must survive
// verbatim in every locale.
//
// Japanese counters (枚/粒/個/本/袋/包/錠 …) are deliberately EXCLUDED. They are
// words and are supposed to be translated — "6枚" becomes "6 sheets" / "6片" /
// "6매". Treating them as units rejected every sheet-mask and tablet product
// (measured: 45 of 229 names were held for review purely for this reason). The
// numeral itself is still protected by the number check above, so "6枚" -> "8
// sheets" is still caught.
const UNIT_TOKENS = /(\d+(?:[.,]\d+)?\s*(?:kg|mg|ml|mL|L|cm|mm|g|%))/gi;

function tokens(text, re) {
  const out = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m;
  while ((m = rx.exec(String(text || ''))) !== null) out.push(m[0].replace(/\s+/g, '').toLowerCase());
  return out.sort();
}

function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * Validate one translated name against its source.
 * Returns an array of violation codes (empty = acceptable).
 *
 * @param {string} sourceName original Japanese name (normalized)
 * @param {string} translated candidate translation
 * @param {string} lang target language
 */
export function checkNameGuards(sourceName, translated, lang) {
  const violations = [];
  const src = String(sourceName || '').trim();
  const out = String(translated || '').trim();

  if (!out) return ['empty'];
  // Numbers and measurement units identify the SKU (200ml vs 350ml) and must survive.
  if (!sameMultiset(tokens(src, NUMBER_TOKENS), tokens(out, NUMBER_TOKENS))) violations.push('number_mismatch');
  if (!sameMultiset(tokens(src, UNIT_TOKENS), tokens(out, UNIT_TOKENS))) violations.push('unit_mismatch');
  // Untranslated output: kana must not survive into any target language.
  if (hasKana(out)) violations.push('kana_remaining');
  // English and Korean names must not carry CJK ideographs. Testing for the
  // PRESENCE of latin instead would be useless: a unit suffix like "200ml"
  // already contains latin letters, so an untranslated Chinese name would pass.
  if ((lang === 'en' || lang === 'ko') && /[\u4e00-\u9faf]/.test(out)) violations.push('cjk_remaining');
  // Korean must actually contain hangul (latin-only output means untranslated).
  if (lang === 'ko' && !/[\uac00-\ud7af]/.test(out)) violations.push('not_hangul');
  // Length sanity: a name should not balloon or collapse.
  const ratio = out.length / Math.max(1, src.length);
  if (ratio < 0.2 || ratio > 5) violations.push('length_out_of_bounds');
  return violations;
}

/**
 * Validate a batch result.
 *
 * @param {{id:number, source:string}[]} items what we asked for
 * @param {Record<string, Record<string,string>>} result model output: { "<id>": { en, zh, ko } }
 * @param {string[]} targetLangs
 * @returns {{ updates: {id:number, names:Record<string,string>, status:string, violations:Record<string,string[]>}[] }}
 */
export function validateBatch(items, result = {}, targetLangs = DEFAULT_TARGET_LANGS) {
  const updates = [];
  for (const item of items) {
    const block = result[String(item.id)] || result[item.id] || null;
    const names = {};
    const violations = {};
    if (!block || typeof block !== 'object') {
      updates.push({ id: item.id, names: {}, status: 'review_required', violations: { _all: ['missing_from_response'] } });
      continue;
    }
    for (const lang of targetLangs) {
      const candidate = block[lang];
      const v = checkNameGuards(item.source, candidate, lang);
      if (v.length) violations[lang] = v;
      else names[lang] = String(candidate).trim();
    }
    // Publish the languages that passed; flag the product when any language failed.
    updates.push({
      id: item.id,
      names,
      status: Object.keys(violations).length ? 'review_required' : 'translated',
      violations,
    });
  }
  return { updates };
}

/** Split products into request-sized batches. */
export function chunkForTranslation(products = [], batchSize = DEFAULT_BATCH_SIZE) {
  const size = Math.max(1, Math.min(50, Number(batchSize) || DEFAULT_BATCH_SIZE));
  const out = [];
  for (let i = 0; i < products.length; i += size) out.push(products.slice(i, i + size));
  return out;
}

/**
 * Which products still need a name translation?
 * Admin-locked rows are never touched; 'pending' and 'failed' are eligible.
 */
export function isNameTranslationTarget(product = {}) {
  if (product.name_i18n_manual_locked) return false;
  const status = product.name_i18n_status ?? 'pending';
  if (status === 'human_locked') return false;
  return status === 'pending' || status === 'failed';
}

/** Select and order targets (ascending id so an --after cursor is stable). */
export function selectNameTargets(products = [], { ids = null, afterId = 0, limit = Infinity } = {}) {
  const allow = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  const filtered = products.filter((p) => {
    if (allow && !allow.has(Number(p.id))) return false;
    if (!isNameTranslationTarget(p)) return false;
    if (Number(p.id) <= Number(afterId)) return false;
    return Boolean(normalizeSourceName(p.name));
  });
  filtered.sort((a, b) => Number(a.id) - Number(b.id));
  return Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;
}

/** Row patch for an applied translation. Never clears an existing translation. */
export function buildNameUpdatePatch(names, status) {
  if (!names || !Object.keys(names).length) return null;
  return {
    name_i18n: names,
    name_i18n_status: status,
    name_i18n_generated_at: new Date().toISOString(),
  };
}
