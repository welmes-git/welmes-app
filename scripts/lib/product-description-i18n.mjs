// WELMES — Product description i18n: pure helpers shared by the translation
// worker and tests. No network/DB/browser dependencies.
//
// See docs/product-description-i18n-contract.md for the full contract.

import { createHash } from 'node:crypto';

export const TRANSLATION_PROMPT_VERSION = 'product-desc-i18n-v1';
export const DEFAULT_TARGET_LANGS = ['en', 'zh', 'ko'];
export const SOURCE_LANG = 'ja';
/** Canonical section keys in template order (mirror of DESCRIPTION_SECTION_TEMPLATE). */
export const SECTION_KEYS = ['overview', 'usage', 'size', 'spec', 'shipping'];

/**
 * Build the immutable source payload for a translation run from normalized
 * description sections (output of buildProductDescription().sections).
 *
 * @param {{key: string|null, label: string, value: string}[]} sections
 * @param {string[]} [targetLangs]
 * @returns {{ sections: {key: string|null, label: string, value: string}[], sourceLang: string, targetLangs: string[] }}
 */
export function buildTranslationSource(sections = [], targetLangs = DEFAULT_TARGET_LANGS) {
  const cleaned = (sections || [])
    .map((s) => ({ key: s.key ?? null, label: String(s.label || ''), value: String(s.value || '').trim() }))
    .filter((s) => s.value);
  return { sections: cleaned, sourceLang: SOURCE_LANG, targetLangs: [...targetLangs] };
}

/** SHA-256 over the source payload + target langs + prompt version (idempotency key). */
export function hashTranslationInput(source, promptVersion = TRANSLATION_PROMPT_VERSION) {
  const canonical = JSON.stringify({
    sourceLang: source.sourceLang,
    targetLangs: source.targetLangs,
    promptVersion,
    sections: source.sections.map((s) => [s.key, s.value]),
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// ── Distortion guards ────────────────────────────────────────────────

// Physical measurement units that must survive translation verbatim (they are
// not natural-language words). Time words (週間/日/時間/주/일 …) are intentionally
// excluded because they are meant to be translated (e.g. 3週間 → 3 weeks).
const UNIT_TOKENS = /(\d+(?:[.,]\d+)?\s*(?:g|kg|mg|ml|mL|L|cm|mm|%|℃|°C|個|枚|本|袋|包|錠|粒))/gi;
const NUMBER_TOKENS = /\d+(?:[.,]\d+)?/g;
// SPF/PA are cosmetic-critical and must survive translation verbatim.
const SPF_PA_TOKENS = /(SPF\s*\d+\+?|PA\s*\++)/gi;

function extractTokens(text, re) {
  const out = [];
  const s = String(text || '');
  let m;
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = rx.exec(s)) !== null) out.push(m[0].replace(/\s+/g, '').toLowerCase());
  return out.sort();
}

function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Count ingredient list items in a spec value (split on 、 or , or ・-less commas). */
function ingredientCount(text) {
  const s = String(text || '');
  if (!s) return 0;
  return s.split(/[、,，]/).map((x) => x.trim()).filter(Boolean).length;
}

/**
 * Verify a single translated section against its source. Returns an array of
 * guard violation codes (empty = OK).
 *
 * @param {string} key canonical section key (or null for extras)
 * @param {string} sourceValue
 * @param {string} translatedValue
 */
export function checkSectionGuards(key, sourceValue, translatedValue) {
  const violations = [];
  const src = String(sourceValue || '').trim();
  const out = String(translatedValue || '').trim();

  if (src && !out) {
    violations.push('empty_translation');
    return violations; // nothing else meaningful to check
  }
  if (!src) return violations;

  // Numbers must be preserved everywhere.
  if (!multisetEqual(extractTokens(src, NUMBER_TOKENS), extractTokens(out, NUMBER_TOKENS))) {
    violations.push('number_mismatch');
  }
  // Units must be preserved everywhere.
  if (!multisetEqual(extractTokens(src, UNIT_TOKENS), extractTokens(out, UNIT_TOKENS))) {
    violations.push('unit_mismatch');
  }
  // SPF/PA must be preserved verbatim.
  if (!multisetEqual(extractTokens(src, SPF_PA_TOKENS), extractTokens(out, SPF_PA_TOKENS))) {
    violations.push('spf_pa_mismatch');
  }
  // Spec: ingredient-count parity within tolerance.
  if (key === 'spec') {
    const cs = ingredientCount(src);
    const co = ingredientCount(out);
    if (cs >= 3 && Math.abs(cs - co) > Math.max(2, Math.ceil(cs * 0.15))) {
      violations.push('ingredient_count_divergence');
    }
  }
  // Length sanity (very loose — only catches gross truncation/expansion).
  const ratio = out.length / Math.max(1, src.length);
  if (ratio < 0.2 || ratio > 6) violations.push('length_out_of_bounds');

  return violations;
}

/**
 * Validate a full provider translation result against the source sections.
 * Returns { status, i18n, violations } where status is 'auto_approved' when all
 * languages/sections pass guards, otherwise 'review_required'. The returned
 * `i18n` only contains languages that fully passed; failing languages are
 * omitted from publish and recorded in `violations`.
 *
 * @param {{sections:{key,label,value}[], targetLangs:string[]}} source
 * @param {Record<string, Record<string,string> & {extras?: string[]}>} translations
 */
export function validateTranslations(source, translations = {}) {
  const violations = {};
  const i18n = {};
  let anyReview = false;

  for (const lang of source.targetLangs) {
    const t = translations[lang];
    const langViolations = [];
    if (!t || typeof t !== 'object') {
      violations[lang] = ['missing_language'];
      anyReview = true;
      continue;
    }
    const langOut = {};
    for (const s of source.sections) {
      if (s.key) {
        const v = t[s.key];
        const sectionViolations = checkSectionGuards(s.key, s.value, v);
        if (sectionViolations.length) langViolations.push(`${s.key}:${sectionViolations.join('|')}`);
        else langOut[s.key] = String(v).trim();
      }
    }
    // extras aligned by index
    const srcExtras = source.sections.filter((s) => !s.key);
    if (srcExtras.length) {
      const outExtras = Array.isArray(t.extras) ? t.extras : [];
      const extras = [];
      srcExtras.forEach((s, i) => {
        const v = outExtras[i];
        const sectionViolations = checkSectionGuards(null, s.value, v);
        if (sectionViolations.length) langViolations.push(`extra[${i}]:${sectionViolations.join('|')}`);
        else extras.push({ label: s.label, value: String(v).trim() });
      });
      if (extras.length) langOut.extras = extras;
    }

    if (langViolations.length) {
      violations[lang] = langViolations;
      anyReview = true;
    } else {
      i18n[lang] = langOut;
    }
  }

  return { status: anyReview ? 'review_required' : 'auto_approved', i18n, violations };
}

// ── Job build + enqueue ──────────────────────────────────────────────

/**
 * Build a translation job from a product with normalized description sections.
 * Returns null when there is nothing to translate (no non-empty sections).
 *
 * @param {{id:number, sd_product_id?:string, descriptionSections:{key,label,value}[]}} product
 * @param {object} [opts] provider/model/env/targetLangs/priority/maxAttempts/force
 */
export function buildTranslationJob(product, opts = {}) {
  const provider = opts.provider || 'gemini';
  const model = opts.model || (opts.env && opts.env.GEMINI_MODEL) || 'gemini-3.8-flash';
  const targetLangs = opts.targetLangs || DEFAULT_TARGET_LANGS;
  const source = buildTranslationSource(product.descriptionSections || [], targetLangs);
  if (!source.sections.length) return null;
  const inputHash = hashTranslationInput(source, TRANSLATION_PROMPT_VERSION);
  return {
    provider,
    model,
    promptVersion: TRANSLATION_PROMPT_VERSION,
    inputHash,
    targetLangs,
    source,
    sourcePayload: { sections: source.sections, sourceLang: source.sourceLang, targetLangs },
    rpcParams: {
      p_product_id: Number(product.id),
      p_provider: provider,
      p_model: model,
      p_prompt_version: TRANSLATION_PROMPT_VERSION,
      p_input_hash: inputHash,
      p_target_langs: targetLangs,
      p_source_payload: { sections: source.sections, sourceLang: source.sourceLang, targetLangs },
      p_priority: opts.priority ?? 0,
      p_max_attempts: opts.maxAttempts ?? 3,
      p_force: Boolean(opts.force),
    },
  };
}

/**
 * Enqueue a translation job for a product. Never throws on queue/API failure —
 * registration must succeed even if translation cannot be queued (mirrors the
 * name-enrichment guarantee). Returns { queued, id?, reason? }.
 */
export async function enqueueTranslationForProduct(supabase, product, opts = {}) {
  try {
    const job = buildTranslationJob(product, opts);
    if (!job) return { queued: false, reason: 'no_translatable_sections' };
    const { data, error } = await supabase.rpc('enqueue_product_description_translation', job.rpcParams);
    if (error) return { queued: false, reason: error.message };
    return { queued: true, id: data };
  } catch (error) {
    return { queued: false, reason: error.message };
  }
}

// ── Backfill target selection ────────────────────────────────────────
// Pure helpers for the description-translation backfill (mirrors the
// name-enrichment backfill selection, but keyed on description_i18n_status).
// No network/DB deps so they are unit-testable.

/** Statuses that must never be re-enqueued by the backfill. */
export const DESCRIPTION_BACKFILL_TERMINAL_STATUSES = new Set(['auto_approved', 'review_required', 'human_locked']);

/**
 * Is this product eligible for a description-translation backfill?
 *
 * Rules (idempotent + safe to re-run):
 *   - Never touch admin-locked rows (description_i18n_manual_locked or
 *     description_i18n_status === 'human_locked').
 *   - Only 'pending' and 'failed' are eligible; already auto_approved/
 *     review_required rows are left alone (re-running is a no-op for them).
 *   - A product with no translatable description text is still "eligible" here;
 *     the worker's buildTranslationJob() will skip it (no_translatable_sections),
 *     so we do not need the raw text at selection time.
 *
 * @param {{description_i18n_status?:string, descriptionI18nStatus?:string,
 *          description_i18n_manual_locked?:boolean, descriptionI18nManualLocked?:boolean}} product
 */
export function isDescriptionBackfillTarget(product = {}) {
  const locked = product.description_i18n_manual_locked ?? product.descriptionI18nManualLocked ?? false;
  if (locked) return false;
  const status = product.description_i18n_status ?? product.descriptionI18nStatus ?? 'pending';
  if (DESCRIPTION_BACKFILL_TERMINAL_STATUSES.has(status)) return false;
  return status === 'pending' || status === 'failed';
}

/**
 * Select and order description-backfill targets.
 *
 * Ordering mirrors the name backfill: active products first (validate against
 * live inventory), then the rest, each phase in ascending id order so an
 * `--after` resume cursor is stable. Supports id allowlist, a resume cursor,
 * and a limit.
 *
 * @param {Array<object>} products
 * @param {{ids?:number[]|null, afterId?:number, activeFirst?:boolean, limit?:number,
 *          cursor?:{activeDone:boolean, afterId:number}|null}} [opts]
 */
export function selectDescriptionBackfillTargets(products = [], {
  ids = null, afterId = 0, activeFirst = true, limit = Infinity, cursor = null,
} = {}) {
  const allow = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  const isActive = (p) => (p.status ?? 'inactive') === 'active';

  const filtered = products.filter((p) => {
    if (allow && !allow.has(Number(p.id))) return false;
    if (!isDescriptionBackfillTarget(p)) return false;
    if (cursor && activeFirst) {
      const active = isActive(p);
      if (cursor.activeDone) {
        if (active) return false;
        return Number(p.id) > Number(cursor.afterId || 0);
      }
      if (active) return Number(p.id) > Number(cursor.afterId || 0);
      return true;
    }
    if (Number(p.id) <= Number(afterId)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (activeFirst) {
      const aActive = isActive(a) ? 0 : 1;
      const bActive = isActive(b) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
    }
    return Number(a.id) - Number(b.id);
  });

  return Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;
}

/**
 * Compute the resume cursor from the batch that was just processed. Active-phase
 * aware: while the last processed row is active we are still in the active
 * phase; once an inactive row is processed the active phase is fully drained.
 * (Same semantics as the name backfill's nextBackfillCursor.)
 */
export function nextDescriptionBackfillCursor(processedBatch = [], previous = null) {
  if (!processedBatch.length) return previous;
  const isActive = (p) => (p.status ?? 'inactive') === 'active';
  const last = processedBatch[processedBatch.length - 1];
  if (isActive(last)) return { activeDone: false, afterId: Number(last.id) };
  return { activeDone: true, afterId: Number(last.id) };
}
