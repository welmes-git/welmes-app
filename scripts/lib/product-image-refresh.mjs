// WELMES — Product image re-collection (refresh): pure helpers.
//
// Context: an earlier scraper bug collected images from the whole page, so the
// Super Delivery recommendation sections (この企業の関連商品 /
// よく一緒にチェックされている商品 / 最近チェックした商品) leaked OTHER products'
// images into products.images. uploadProductImages() caps at 8, which is why
// contaminated rows characteristically hold exactly 8 images.
//
// normalizeProductImages() in sd-core.mjs is already fixed (selector excludes
// recommend-img, plus a filename SD-ID filter) and unit-tested. This module
// holds the pure decision logic for the refresh script: which products to
// revisit, and how to classify the before/after diff.
//
// No network/DB/browser dependencies so everything here is unit-testable.

/** Storage-hosted URLs carry no SD id, so contamination cannot be judged from the URL alone. */
export function isStorageUrl(url) {
  return /\/storage\/v1\/object\/public\//.test(String(url || ''));
}

/** Extract the SD product id embedded in a Super Delivery CDN image filename. */
export function sdIdFromImageUrl(url) {
  const m = String(url || '').match(/product_image\/[^\s"')]*?\/(\d+)[_.]/);
  return m ? m[1] : null;
}

/**
 * Select products eligible for an image refresh.
 *
 * Only rows with an sd_product_id can be revisited (the SD detail URL is
 * /p/r/pd_p/{sd_product_id}/). Ordering is ascending id so an --after resume
 * cursor is stable across runs.
 *
 * @param {Array<object>} products rows with { id, sd_product_id, images }
 * @param {{ids?:number[]|null, afterId?:number, limit?:number, minImages?:number}} [opts]
 *   minImages: only consider rows holding at least this many images (use 8 to
 *   target just the capped//suspicious rows; default 0 = all).
 */
export function selectImageRefreshTargets(products = [], {
  ids = null, afterId = 0, limit = Infinity, minImages = 0,
} = {}) {
  const allow = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  const filtered = products.filter((p) => {
    if (!p.sd_product_id) return false; // cannot build a detail URL
    if (allow && !allow.has(Number(p.id))) return false;
    if (Number(p.id) <= Number(afterId)) return false;
    const count = Array.isArray(p.images) ? p.images.length : 0;
    if (count < Number(minImages || 0)) return false;
    return true;
  });
  filtered.sort((a, b) => Number(a.id) - Number(b.id));
  return Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;
}

/**
 * Classify the refresh outcome for one product by comparing what is stored
 * against what the fixed scraper now returns.
 *
 * verdict:
 *   'contaminated' — fewer images now than stored: the surplus stored entries
 *                    were recommendation-section leakage. Safe to replace.
 *   'unchanged'    — same count (nothing to gain by rewriting).
 *   'more_found'   — scraper now finds MORE than stored (e.g. gallery grew, or
 *                    the old run hit a fetch failure). Still an improvement.
 *   'empty_scrape' — scraper returned nothing; do NOT wipe existing images.
 *
 * `apply` is false whenever rewriting would be pointless or destructive.
 *
 * @param {{id:number, sd_product_id:string, images?:string[], image?:string}} product
 * @param {string[]} scrapedImages output of normalizeProductImages()
 */
export function classifyImageRefresh(product, scrapedImages = []) {
  const stored = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  const scraped = (scrapedImages || []).filter(Boolean);
  const storedCount = stored.length;
  const scrapedCount = scraped.length;

  // Any stored CDN URL whose embedded SD id differs from this product proves
  // contamination outright (Storage URLs cannot be judged this way).
  const sd = product.sd_product_id == null ? null : String(product.sd_product_id);
  const mismatched = sd
    ? stored.filter((u) => {
      const found = sdIdFromImageUrl(u);
      return found != null && found !== sd;
    }).length
    : 0;

  let verdict;
  if (scrapedCount === 0) verdict = 'empty_scrape';
  else if (scrapedCount < storedCount) verdict = 'contaminated';
  else if (scrapedCount > storedCount) verdict = 'more_found';
  else verdict = 'unchanged';

  return {
    id: Number(product.id),
    sdId: sd,
    storedCount,
    scrapedCount,
    removedCount: Math.max(0, storedCount - scrapedCount),
    mismatchedStored: mismatched,
    storedAllStorage: storedCount > 0 && stored.every(isStorageUrl),
    verdict,
    // Never rewrite on an empty scrape (would wipe the storefront image), and
    // skip no-op rewrites so a re-run is cheap and idempotent.
    apply: verdict === 'contaminated' || verdict === 'more_found',
  };
}

/** Aggregate classifications into a printable summary. */
export function summarizeImageRefresh(results = []) {
  const summary = {
    scanned: results.length,
    contaminated: 0,
    unchanged: 0,
    moreFound: 0,
    emptyScrape: 0,
    imagesRemoved: 0,
    willApply: 0,
  };
  for (const r of results) {
    if (r.verdict === 'contaminated') summary.contaminated++;
    else if (r.verdict === 'unchanged') summary.unchanged++;
    else if (r.verdict === 'more_found') summary.moreFound++;
    else if (r.verdict === 'empty_scrape') summary.emptyScrape++;
    summary.imagesRemoved += r.removedCount || 0;
    if (r.apply) summary.willApply++;
  }
  return summary;
}

/** Resume cursor: highest id processed (ascending id ordering). */
export function nextImageRefreshCursor(processed = [], previous = 0) {
  if (!processed.length) return Number(previous || 0);
  return processed.reduce((max, p) => Math.max(max, Number(p.id)), Number(previous || 0));
}

/**
 * Build the products row patch for an applied refresh. `image` (the storefront
 * thumbnail) is realigned to the first freshly uploaded image so it can never
 * keep pointing at a recommendation-section leftover.
 */
export function buildImageUpdatePatch(uploadedUrls = []) {
  const urls = (uploadedUrls || []).filter(Boolean);
  if (!urls.length) return null; // never clear images
  return { image: urls[0], images: urls };
}
