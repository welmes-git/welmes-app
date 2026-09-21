// WELMES — Product description re-collection (refresh): pure helpers.
//
// Context: products imported before buildProductDescription() existed stored
// their description as one unlabeled Japanese blob. parseStoredDescription()
// therefore yields a single `overview` section, so the canonical template
// (usage / size / spec / shipping) is absent — both on the storefront and as
// translation input. Measured on live data: of 142 translated products, 142 had
// `overview`, only 2 had `spec` and 1 had `size`.
//
// Re-scraping the SD detail page runs the description through
// buildProductDescription(), which emits labeled, template-ordered sections.
// This module holds the pure decision logic: which products to revisit, and
// whether a freshly scraped description is an improvement worth writing.
//
// No network/DB/browser dependencies so everything here is unit-testable.

/** Statuses an admin has deliberately frozen — never overwrite these. */
export const LOCKED_I18N_STATUSES = new Set(['human_locked']);

/**
 * Is this product safe to re-scrape and rewrite?
 * Admin-locked rows are excluded so manual curation is never clobbered.
 */
export function isDescriptionRefreshTarget(product = {}) {
  if (!product.sd_product_id) return false; // cannot build a detail URL
  const locked = product.description_i18n_manual_locked ?? product.descriptionI18nManualLocked ?? false;
  if (locked) return false;
  const status = product.description_i18n_status ?? product.descriptionI18nStatus ?? 'pending';
  if (LOCKED_I18N_STATUSES.has(status)) return false;
  return true;
}

/**
 * Select and order description-refresh targets (ascending id so `--after`
 * resume is stable).
 *
 * @param {Array<object>} products
 * @param {{ids?:number[]|null, afterId?:number, limit?:number, maxSections?:number}} [opts]
 *   maxSections: only consider rows whose CURRENT parsed section count is <=
 *   this (use 1 to target just the un-structured legacy rows).
 * @param {(product:object)=>number} storedSectionCount counts current sections
 */
export function selectDescriptionRefreshTargets(products = [], {
  ids = null, afterId = 0, limit = Infinity, maxSections = Infinity,
} = {}, storedSectionCount = () => Infinity) {
  const allow = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  const filtered = products.filter((p) => {
    if (allow && !allow.has(Number(p.id))) return false;
    if (!isDescriptionRefreshTarget(p)) return false;
    if (Number(p.id) <= Number(afterId)) return false;
    if (Number.isFinite(maxSections) && storedSectionCount(p) > Number(maxSections)) return false;
    return true;
  });
  filtered.sort((a, b) => Number(a.id) - Number(b.id));
  return Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;
}

/** Distinct canonical section keys present in a section array. */
export function sectionKeySet(sections = []) {
  return [...new Set((sections || []).filter((s) => s && s.key).map((s) => s.key))];
}

/**
 * Compare the stored description against a freshly scraped one.
 *
 * verdict:
 *   'improved'      — fresh has canonical sections the stored one lacks. Worth writing.
 *   'unchanged'     — same canonical key set AND same text; nothing to do.
 *   'text_changed'  — same key set but the text differs (supplier edited the page).
 *   'empty_scrape'  — scraper produced nothing; never overwrite.
 *   'regressed'     — fresh has FEWER canonical sections than stored; do not write
 *                     (protects against a partial page load silently degrading data).
 *
 * @param {{description?:string}} product
 * @param {{key:string|null,label:string,value:string}[]} storedSections parseStoredDescription(stored)
 * @param {string} freshDescription buildProductDescription().description
 * @param {{key:string|null,label:string,value:string}[]} freshSections buildProductDescription().sections
 */
export function classifyDescriptionRefresh(product, storedSections = [], freshDescription = '', freshSections = []) {
  const storedKeys = sectionKeySet(storedSections);
  const freshKeys = sectionKeySet(freshSections);
  const stored = String(product.description || '').trim();
  const fresh = String(freshDescription || '').trim();

  const gained = freshKeys.filter((k) => !storedKeys.includes(k));
  const lost = storedKeys.filter((k) => !freshKeys.includes(k));

  let verdict;
  if (!fresh || freshKeys.length === 0) verdict = 'empty_scrape';
  else if (gained.length) verdict = 'improved';
  else if (lost.length) verdict = 'regressed';
  else if (fresh !== stored) verdict = 'text_changed';
  else verdict = 'unchanged';

  return {
    id: Number(product.id),
    sdId: product.sd_product_id == null ? null : String(product.sd_product_id),
    storedKeys,
    freshKeys,
    gained,
    lost,
    storedSectionCount: storedKeys.length,
    freshSectionCount: freshKeys.length,
    verdict,
    // Only write when the structure genuinely improves, or the supplier text
    // changed while structure held. Never on empty/regressed scrapes.
    apply: verdict === 'improved' || verdict === 'text_changed',
  };
}

/**
 * Row patch for an applied description refresh.
 *
 * Rewriting `description` invalidates any existing translation, because
 * description_i18n was produced from the OLD source text (and its input_hash no
 * longer matches). We therefore clear the translations and reset the workflow to
 * 'pending' so the translation backfill regenerates them from the new,
 * properly-sectioned source. Locked rows are filtered out before this point.
 */
export function buildDescriptionUpdatePatch(freshDescription) {
  const text = String(freshDescription || '').trim();
  if (!text) return null; // never clear a description
  return {
    description: text,
    description_i18n: {},
    description_i18n_status: 'pending',
    description_i18n_generated_at: null,
  };
}

/** Aggregate classifications into a printable summary. */
export function summarizeDescriptionRefresh(results = []) {
  const summary = {
    scanned: results.length,
    improved: 0,
    textChanged: 0,
    unchanged: 0,
    regressed: 0,
    emptyScrape: 0,
    sectionsGained: 0,
    willApply: 0,
  };
  for (const r of results) {
    if (r.verdict === 'improved') summary.improved++;
    else if (r.verdict === 'text_changed') summary.textChanged++;
    else if (r.verdict === 'unchanged') summary.unchanged++;
    else if (r.verdict === 'regressed') summary.regressed++;
    else if (r.verdict === 'empty_scrape') summary.emptyScrape++;
    summary.sectionsGained += (r.gained || []).length;
    if (r.apply) summary.willApply++;
  }
  return summary;
}

/** Resume cursor: highest id processed (ascending id ordering). */
export function nextDescriptionRefreshCursor(processed = [], previous = 0) {
  if (!processed.length) return Number(previous || 0);
  return processed.reduce((max, p) => Math.max(max, Number(p.id)), Number(previous || 0));
}
