import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import {
  callProductNameProvider,
  estimateProviderCost,
  getProviderConfig,
  PROMPT_VERSION,
} from './product-name-providers.mjs';
import {
  extractProductIdentifiers,
  hasAutoApproveBlockingWarning,
  hasJapanese,
  normalizeComparable,
  validateEnglishProductName,
} from './product-name-quality.mjs';

const MAX_EVIDENCE_URLS = 5;
const MAX_EVIDENCE_BYTES = 1_000_000;
const OFFICIAL_TITLE_MATCH_THRESHOLD = 0.60;
const TOKEN_STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'from', 'wholesale', 'welmes', 'sunscreen', 'facial', 'product']);
const TRUSTED_GROUNDING_REDIRECT_DOMAINS = new Set([
  'vertexaisearch.cloud.google.com',
  'grounding-api-redirect.googleapis.com',
]);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildEnrichmentInput(product, officialSources = []) {
  const matchedSources = matchOfficialSources(product.brand || '', officialSources);
  const sourcePayload = product.sourcePayload || {};
  return {
    productId: Number(product.id),
    sdProductId: product.sd_product_id || product.sdProductId || null,
    sourceName: product.name || '',
    sourceDescription: product.description || '',
    sourceBrand: product.brand || '',
    brand: matchedSources.canonicalBrand || product.brand || '',
    category: product.category || '',
    jan: sourcePayload.jan || product.jan || null,
    officialDomains: matchedSources.domains,
  };
}

export function hashEnrichmentInput(input, {
  provider = 'gemini', model = '', promptVersion = PROMPT_VERSION, grounding = true,
} = {}) {
  return crypto.createHash('sha256')
    .update(canonicalJson({ input, provider, model, promptVersion, grounding: Boolean(grounding) }))
    .digest('hex');
}

// Snapshot only the official-source rows that match this product's brand so the
// queued job carries an immutable copy of the domains the worker is allowed to
// treat as official. A later registry edit must not retroactively change a job.
function snapshotOfficialSources(product, officialSources, matched) {
  return officialSources.filter((source) => {
    const domain = normalizeDomain(source.official_domain ?? source.officialDomain ?? '');
    const canonical = source.canonical_brand_name ?? source.canonicalBrandName ?? product.brand;
    return matched.domains.includes(domain) && canonical === matched.canonicalBrand;
  });
}

/**
 * Pure builder that turns a product row + official-source registry into the
 * immutable job snapshot and the exact parameters for the
 * enqueue_product_name_enrichment RPC. Shared by the standalone worker CLI and
 * by the Super Delivery import/monitor auto-registration paths so every entry
 * point produces identical input hashes and grounding decisions.
 *
 * Returns null when the product is human-approved and force is not set, so the
 * caller can skip enqueueing without overwriting a curated name.
 */
export function buildEnrichmentJob(product, officialSources = [], {
  provider = 'gemini',
  model = '',
  env = process.env,
  grounding = true,
  priority = 0,
  maxAttempts = 3,
  force = false,
} = {}) {
  if (product.name_en_status === 'human_approved' && !force) return null;

  const config = getProviderConfig(provider, env);
  const selectedModel = model || config.model;
  const matched = matchOfficialSources(product.brand || '', officialSources);
  const sourceSnapshot = snapshotOfficialSources(product, officialSources, matched);

  const existingSourcePayload = product.sourcePayload || {};
  const jan = product.jan || existingSourcePayload.jan || null;
  const payloadProduct = {
    id: Number(product.id),
    name: product.name || '',
    brand: product.brand || '',
    category: product.category || '',
    description: product.description || '',
    sd_product_id: product.sd_product_id || product.sdProductId || null,
    sourcePayload: { ...existingSourcePayload, ...(jan ? { jan } : {}) },
  };

  const input = buildEnrichmentInput(payloadProduct, sourceSnapshot);
  const useOfficialGrounding = Boolean(grounding && config.supportsGrounding && input.officialDomains.length);
  const sourcePayload = {
    product: payloadProduct,
    officialSources: sourceSnapshot,
    strategy: { grounding: useOfficialGrounding },
    force: Boolean(force),
  };
  const inputHash = hashEnrichmentInput(input, {
    provider, model: selectedModel, promptVersion: PROMPT_VERSION, grounding: useOfficialGrounding,
  });

  return {
    provider,
    model: selectedModel,
    grounding: useOfficialGrounding,
    inputHash,
    sourcePayload,
    rpcParams: {
      p_product_id: payloadProduct.id,
      p_provider: provider,
      p_model: selectedModel,
      p_prompt_version: PROMPT_VERSION,
      p_input_hash: inputHash,
      p_source_payload: sourcePayload,
      p_priority: priority,
      p_max_attempts: maxAttempts,
      p_force: force,
    },
  };
}

/**
 * Enqueue an enrichment job for a freshly registered product via the
 * enqueue_product_name_enrichment RPC. Registration success is authoritative:
 * failures here are reported but never thrown so a queue outage cannot roll
 * back a completed product insert (success criterion: API 장애가 수집에 영향 0건).
 */
export async function enqueueEnrichmentForProduct(supabase, product, officialSources = [], options = {}) {
  try {
    const job = buildEnrichmentJob(product, officialSources, options);
    if (!job) return { enqueued: false, skipped: true, reason: 'human_approved' };
    const { data, error } = await supabase.rpc('enqueue_product_name_enrichment', job.rpcParams);
    if (error) return { enqueued: false, error: error.message, inputHash: job.inputHash };
    return { enqueued: true, runId: data, inputHash: job.inputHash, grounding: job.grounding };
  } catch (error) {
    return { enqueued: false, error: error.message };
  }
}

// ── Backfill selection (Task 8) ────────────────────────────────────────
// Products already curated by a human must never be re-processed. Everything
// else is eligible only if its stored English name still contains Japanese, or
// it has no workflow status yet (legacy rows imported before Task 2).
const BACKFILL_TERMINAL_STATUSES = new Set(['human_approved']);

/**
 * Decide whether one product row is a backfill target.
 * Idempotent: `auto_approved`/`review_required` rows with a clean English name
 * are considered done and skipped, so re-running never reprocesses them.
 *
 * Manual-name protection: a `pending`/legacy row that already carries a clean
 * (non-empty, non-Japanese) English name distinct from its Japanese source name
 * is treated as a human-curated entry and skipped, so the backfill never
 * clobbers a manually typed English name that has no workflow status yet. Pass
 * it through an explicit `--ids` allowlist to force reprocessing.
 */
export function isBackfillTarget(product = {}, { allowlisted = false } = {}) {
  const status = product.name_en_status ?? product.nameEnStatus ?? null;
  if (BACKFILL_TERMINAL_STATUSES.has(status)) return false;

  const nameEn = product.name_en ?? product.nameEn ?? '';
  const nameJp = product.name ?? '';
  const nameEnHasJapanese = hasJapanese(nameEn);
  const looksManuallyNamed = Boolean(nameEn)
    && !nameEnHasJapanese
    && normalizeComparable(nameEn) !== normalizeComparable(nameJp);

  if (!status || status === 'pending') {
    // No workflow status yet. Eligible unless it already has a clean, distinct
    // manual English name we must not overwrite (unless explicitly allowlisted).
    if (looksManuallyNamed && !allowlisted) return false;
    return true;
  }
  // Failed rows are retryable.
  if (status === 'failed') return true;
  // Already-processed rows are only re-done if Japanese still leaked through.
  return nameEnHasJapanese;
}

/**
 * Filter + order backfill candidates. Active products first (safer to validate
 * on live inventory), then by id for a stable, resumable order. Supports an
 * exclusive resume cursor and an explicit id allowlist.
 *
 * Cursor forms (both exclusive, both idempotent):
 *   - afterId: legacy single high-water mark on id. Safe only when activeFirst
 *     is false or a single status class is being scanned.
 *   - cursor: { activeDone, afterId } — active-first aware. Once the active
 *     phase is exhausted (`activeDone: true`) the cursor advances into the
 *     inactive phase without the max-id skip bug where a high-id active row
 *     would otherwise hide low-id inactive rows on resume.
 */
export function selectBackfillTargets(products = [], {
  ids = null, afterId = 0, activeFirst = true, limit = Infinity, cursor = null,
} = {}) {
  const allow = Array.isArray(ids) && ids.length ? new Set(ids.map(Number)) : null;
  const isActive = (p) => (p.status ?? 'inactive') === 'active';
  const filtered = products.filter((p) => {
    if (allow && !allow.has(Number(p.id))) return false;
    if (!isBackfillTarget(p, { allowlisted: Boolean(allow) })) return false;
    if (cursor && activeFirst) {
      // Active phase then inactive phase; the cursor knows which phase we are in.
      const active = isActive(p);
      if (cursor.activeDone) {
        // We are past all active rows: only inactive rows beyond the inactive
        // high-water mark remain.
        if (active) return false;
        return Number(p.id) > Number(cursor.afterId || 0);
      }
      // Still in the active phase: active rows beyond the mark, plus all
      // inactive rows (they come later in the ordering, never skipped).
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
 * Derive the next resume cursor from the ordered batch that was just processed.
 * Encodes whether the active phase is finished and the id high-water mark for
 * the current phase, so the next invocation never re-processes and never skips.
 */
export function nextBackfillCursor(processedBatch = [], previous = null) {
  if (!processedBatch.length) return previous;
  const isActive = (p) => (p.status ?? 'inactive') === 'active';
  const last = processedBatch[processedBatch.length - 1];
  if (isActive(last)) {
    // Last row processed was active → still in the active phase.
    return { activeDone: false, afterId: Number(last.id) };
  }
  // Last row processed was inactive → the active phase is fully drained.
  return { activeDone: true, afterId: Number(last.id) };
}

/**
 * Rough per-run cost estimate for a batch, used by the backfill --dry-run
 * report. Token counts are conservative averages; real usage is recorded by the
 * worker per run. Returns provider currency plus a USD figure when convertible.
 */
export function estimateBackfillCost(count, {
  provider = 'gemini', env = process.env, avgInputTokens = 900, avgOutputTokens = 180,
} = {}) {
  const per = estimateProviderCost(provider, { inputTokens: avgInputTokens, outputTokens: avgOutputTokens }, env);
  const round = (n) => (n == null ? null : Number((n * count).toFixed(6)));
  return {
    count,
    provider,
    currency: per.currency,
    perProduct: per.amount,
    total: round(per.amount),
    totalUsd: per.estimatedCostUsd == null ? null : round(per.estimatedCostUsd),
  };
}


export function normalizeDomain(value = '') {
  const raw = String(value).trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/:\d+$/, '');
  return raw.replace(/^www\./, '').replace(/\.$/, '');
}

export function matchOfficialSources(brand, sources = []) {
  const normalizedBrand = normalizeComparable(brand);
  const compactBrand = normalizedBrand.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/gu, '');
  const matches = sources.filter((source) => {
    if (source.active === false) return false;
    const candidate = normalizeComparable(source.brand_name ?? source.brandName ?? '');
    const compactCandidate = candidate.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/gu, '');
    return candidate === normalizedBrand || (compactBrand && compactCandidate === compactBrand);
  });
  return {
    canonicalBrand: matches[0]?.canonical_brand_name ?? matches[0]?.canonicalBrandName ?? brand,
    domains: [...new Set(matches.map((source) => normalizeDomain(source.official_domain ?? source.officialDomain)).filter(Boolean))],
  };
}

export function isOfficialDomain(url, domains = []) {
  let hostname;
  try { hostname = normalizeDomain(new URL(url).hostname); } catch { return false; }
  return domains.some((domain) => hostname === normalizeDomain(domain) || hostname.endsWith(`.${normalizeDomain(domain)}`));
}

export function isAllowedEvidenceHop(url, officialDomains = []) {
  let hostname;
  try { hostname = normalizeDomain(new URL(url).hostname); } catch { return false; }
  return isOfficialDomain(url, officialDomains) || TRUSTED_GROUNDING_REDIRECT_DOMAINS.has(hostname);
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

export function isPrivateIp(address) {
  if (net.isIP(address) === 4) return isPrivateIpv4(address);
  if (net.isIP(address) === 6) {
    const value = address.toLowerCase();
    if (value.startsWith('::ffff:')) return isPrivateIp(value.slice(7));
    return value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd')
      || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb');
  }
  return true;
}

export async function assertPublicHttpsUrl(value, lookupImpl = dns.lookup) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) throw new Error('Only credential-free HTTPS evidence URLs are allowed');
  const hostname = normalizeDomain(url.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) throw new Error('Local evidence hosts are blocked');
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Private evidence IP is blocked');
    return url;
  }
  const addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || addresses.length === 0) throw new Error('Evidence host did not resolve');
  if (addresses.some(({ address }) => isPrivateIp(address))) throw new Error('Evidence host resolved to a private IP');
  return url;
}

async function readLimitedText(response, maxBytes = MAX_EVIDENCE_BYTES) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Evidence page is too large');
  if (!response.body?.getReader) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Evidence page exceeded size limit');
      chunks.push(value);
    }
  } finally {
    if (size > maxBytes) await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function decodeHtml(value = '') {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ');
}

function extractPageText(html = '') {
  const title = decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const ogTitle = decodeHtml(
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1]
    || '',
  ).trim();
  const body = decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
  return { title: ogTitle || title, body };
}

export async function inspectEvidenceUrl(value, {
  fetchImpl = fetch,
  lookupImpl = dns.lookup,
  timeoutMs = 10_000,
  maxRedirects = 5,
  maxBytes = MAX_EVIDENCE_BYTES,
  officialDomains = null,
} = {}) {
  const assertAllowedHop = (url) => {
    if (Array.isArray(officialDomains) && !isAllowedEvidenceHop(url, officialDomains)) {
      throw new Error('Evidence URL is not an official domain or trusted grounding redirect');
    }
  };
  let current = await assertPublicHttpsUrl(value, lookupImpl);
  assertAllowedHop(current);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetchImpl(current, {
      method: 'GET', redirect: 'manual',
      headers: { 'user-agent': 'WELMES-ProductNameVerifier/1.0', accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      if (hop === maxRedirects) throw new Error('Too many evidence redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Evidence redirect has no location');
      current = await assertPublicHttpsUrl(new URL(location, current).href, lookupImpl);
      assertAllowedHop(current);
      continue;
    }
    if (!response.ok) throw new Error(`Evidence HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
      throw new Error(`Unsupported evidence content type: ${contentType || 'unknown'}`);
    }
    const html = await readLimitedText(response, maxBytes);
    return { requestedUrl: value, resolvedUrl: current.href, ...extractPageText(html) };
  }
  throw new Error('Evidence resolution failed');
}

function significantTokens(value) {
  return [...new Set(normalizeComparable(value).split(' ')
    .map((token) => token.replace(/[^a-z0-9#+.-]/g, ''))
    .filter((token) => token.length >= 3 && !TOKEN_STOP_WORDS.has(token)))];
}

function tokenCoverage(needle, haystack) {
  const tokens = significantTokens(needle);
  if (!tokens.length) return 0;
  const normalizedHaystack = normalizeComparable(haystack);
  return tokens.filter((token) => normalizedHaystack.includes(token)).length / tokens.length;
}

export async function verifyOfficialEvidence({
  evidenceUrls = [], officialDomains = [], candidateName = '', sourceText = '', jan = null,
}, options = {}) {
  const inspectUrl = options.inspectUrl
    || ((url) => inspectEvidenceUrl(url, { ...options, officialDomains }));
  const identifiers = extractProductIdentifiers(`${sourceText}\nJAN: ${jan || ''}`);
  const requireJan = identifiers.jan.length > 0;
  const requireModel = identifiers.models.length > 0;
  const evidence = [];
  for (const citationUrl of [...new Set(evidenceUrls)].slice(0, MAX_EVIDENCE_URLS)) {
    try {
      const page = await inspectUrl(citationUrl);
      const officialDomain = officialDomains.find((domain) => isOfficialDomain(page.resolvedUrl, [domain])) || null;
      const pageText = `${page.title}\n${page.body}`;
      const janMatched = identifiers.jan.some((value) => pageText.includes(value));
      const modelMatched = identifiers.models.length > 0 && identifiers.models.every((value) => normalizeComparable(pageText).includes(value));
      const titleCoverage = tokenCoverage(candidateName, page.title);
      const bodyCoverage = tokenCoverage(candidateName, page.body);
      const matchedBy = [];
      if (janMatched) matchedBy.push('jan');
      if (modelMatched) matchedBy.push('model');
      if (titleCoverage >= OFFICIAL_TITLE_MATCH_THRESHOLD) matchedBy.push('title_tokens');
      if (bodyCoverage >= 0.80) matchedBy.push('body_tokens');
      // Identity gates: when the source carries a JAN or model code, an official
      // page must reproduce it. Token overlap alone is not enough to promote a
      // page to "official" — this prevents a look-alike product on the same
      // manufacturer domain from being accepted as evidence.
      const identityBlocked = (requireJan && !janMatched) || (requireModel && !modelMatched);
      evidence.push({
        citationUrl, resolvedUrl: page.resolvedUrl, title: page.title, officialDomain,
        janMatched, modelMatched,
        verified: Boolean(officialDomain && matchedBy.length && !identityBlocked),
        identityBlocked,
        matchedBy,
        titleCoverage: Number(titleCoverage.toFixed(3)), bodyCoverage: Number(bodyCoverage.toFixed(3)),
      });
    } catch (error) {
      evidence.push({ citationUrl, resolvedUrl: null, officialDomain: null, verified: false, matchedBy: [], error: error.message });
    }
  }
  return evidence;
}

/**
 * Decide whether a set of verified evidence rows agree enough to promote a
 * candidate to an official name. Requirements:
 *   - at least one verified official row;
 *   - JAN/model identity gates already enforced per-row in verifyOfficialEvidence;
 *   - no cross-evidence conflict: if two verified official pages resolve to the
 *     same official domain but one matched the JAN and another explicitly did
 *     not (identityBlocked), that disagreement blocks automatic approval.
 *
 * Returns { official, reasons } — `official` false means fall back to review.
 */
export function assessOfficialEvidence(evidence = [], { requireJan = false, requireModel = false } = {}) {
  const reasons = [];
  const verified = evidence.filter((item) => item.verified);
  if (!verified.length) {
    reasons.push('no_verified_official_evidence');
    return { official: false, reasons };
  }
  // A verified row that failed a required identity gate is contradictory.
  const contradicts = evidence.filter((item) => item.officialDomain && item.identityBlocked);
  if (contradicts.length) reasons.push('evidence_identity_conflict');
  // Multiple verified rows must not disagree on the JAN when a JAN is required.
  if (requireJan) {
    const janStates = new Set(verified.map((item) => Boolean(item.janMatched)));
    if (janStates.size > 1) reasons.push('evidence_jan_disagreement');
  }
  if (requireModel) {
    const modelStates = new Set(verified.map((item) => Boolean(item.modelMatched)));
    if (modelStates.size > 1) reasons.push('evidence_model_disagreement');
  }
  return { official: reasons.length === 0, reasons };
}

export function slugifyProductName(name, productId) {
  const base = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70).replace(/-$/g, '');
  return `${base || 'product'}-${Number(productId)}`;
}

export function retryDelaySeconds(attempt, { base = 30, max = 3600 } = {}) {
  return Math.min(max, base * (2 ** Math.max(0, Number(attempt || 1) - 1)));
}

export function isRetryableError(error) {
  const status = Number(error?.status || 0);
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || status === 408 || status === 409 || status === 429 || status >= 500;
}

export function validateEnrichmentOutput(input, providerResult, sourceType) {
  const evidenceUrls = providerResult.evidenceUrls || [];
  const threshold = sourceType === 'official' ? 0.85 : 0.95;
  const nameValidation = validateEnglishProductName({
    sourceName: input.sourceName,
    sourceDescription: input.sourceDescription,
    candidateName: providerResult.candidateName,
    brand: input.brand,
    sourceType,
    evidenceUrls,
    autoApproveThreshold: threshold,
  });
  const metadataValidation = validateEnglishProductName({
    sourceName: input.sourceName,
    sourceDescription: input.sourceDescription,
    candidateName: `${providerResult.candidateName} ${providerResult.seoDescription || ''}`,
    brand: input.brand,
    sourceType,
    evidenceUrls,
    autoApproveThreshold: threshold,
  });
  const metadataErrors = metadataValidation.errors.map((error) => ({ ...error, code: `metadata_${error.code}` }));
  if (hasJapanese(providerResult.seoTitle || '') || hasJapanese(providerResult.seoDescription || '')) {
    metadataErrors.push({ code: 'metadata_japanese_remaining', message: 'Japanese remains in SEO metadata.' });
  }
  if ((providerResult.seoTitle || '').length > 160) metadataErrors.push({ code: 'metadata_title_too_long', message: 'SEO title exceeds 160 characters.' });
  if ((providerResult.seoDescription || '').length > 300) metadataErrors.push({ code: 'metadata_description_too_long', message: 'SEO description exceeds 300 characters.' });
  if (!normalizeComparable(providerResult.seoTitle || '').includes(normalizeComparable(providerResult.candidateName))) {
    metadataErrors.push({ code: 'metadata_title_mismatch', message: 'SEO title does not contain the candidate name.' });
  }
  const errors = [...nameValidation.errors, ...metadataErrors];
  const confidence = errors.length ? Math.min(nameValidation.confidence, 0.84) : nameValidation.confidence;
  return {
    ...nameValidation,
    confidence,
    status: errors.length === 0 && confidence >= threshold ? 'auto_approved' : 'review_required',
    errors,
    metadataErrors,
  };
}

export async function enrichProductName(product, {
  provider = 'gemini', model = '', env = process.env, officialSources = [], grounding = true,
  callProvider = callProductNameProvider, inspectUrl,
} = {}) {
  const input = buildEnrichmentInput(product, officialSources);
  const config = getProviderConfig(provider, env);
  const selectedModel = model || config.model;
  const useOfficialGrounding = Boolean(grounding && config.supportsGrounding && input.officialDomains.length);
  const inputHash = hashEnrichmentInput(input, {
    provider, model: selectedModel, promptVersion: PROMPT_VERSION, grounding: useOfficialGrounding,
  });

  let discoveryResult = null;
  let providerResult;
  let evidence = [];
  let sourceType = 'generated';
  let evidenceAssessment = { official: false, reasons: [] };
  if (useOfficialGrounding) {
    discoveryResult = await callProvider(provider, input, { env, grounding: true, model: selectedModel });
    evidence = await verifyOfficialEvidence({
      evidenceUrls: discoveryResult.evidenceUrls,
      officialDomains: input.officialDomains,
      candidateName: discoveryResult.candidateName,
      sourceText: `${input.sourceName}\n${input.sourceDescription}`,
      jan: input.jan,
    }, { ...(inspectUrl ? { inspectUrl } : {}) });
    const identifiers = extractProductIdentifiers(`${input.sourceName}\n${input.sourceDescription}\nJAN: ${input.jan || ''}`);
    evidenceAssessment = assessOfficialEvidence(evidence, {
      requireJan: identifiers.jan.length > 0,
      requireModel: identifiers.models.length > 0,
    });
    if (evidenceAssessment.official) {
      providerResult = discoveryResult;
      sourceType = 'official';
    }
  }
  if (!providerResult) {
    providerResult = await callProvider(provider, input, { env, grounding: false, model: selectedModel });
  }

  const validation = validateEnrichmentOutput(input, providerResult, sourceType);
  // A provider- or validation-emitted uncertainty warning blocks auto-approval
  // even when the deterministic fact checks pass (success criterion:
  // "provider/validation 금지 warning 자동승인 차단").
  const providerWarnings = providerResult.warnings || [];
  if (validation.status === 'auto_approved'
    && (hasAutoApproveBlockingWarning(providerWarnings) || hasAutoApproveBlockingWarning(validation.warnings))) {
    validation.status = 'review_required';
    validation.confidence = Math.min(validation.confidence, 0.84);
    validation.errors = [...validation.errors, { code: 'blocking_warning', message: 'A provider/validation warning blocks automatic approval.' }];
  }
  const warnings = [...new Set([
    ...providerWarnings,
    ...(discoveryResult && sourceType !== 'official' ? discoveryResult.warnings || [] : []),
    ...(discoveryResult && sourceType !== 'official' ? ['No verified official English name was found; candidate was generated.'] : []),
    ...(evidenceAssessment.reasons.length ? [`Evidence assessment: ${evidenceAssessment.reasons.join(', ')}`] : []),
    ...validation.warnings.map((warning) => warning.message),
    ...evidence.filter((item) => item.error).map((item) => `Evidence unavailable: ${item.error}`),
  ])];
  const aliases = [...new Set((providerResult.searchAliases || [])
    .map((value) => String(value).trim()).filter((value) => value && !hasJapanese(value) && value !== providerResult.candidateName))].slice(0, 12);
  const usageResults = discoveryResult && discoveryResult !== providerResult
    ? [discoveryResult, providerResult]
    : [providerResult];
  const sumUsage = (field) => {
    const values = usageResults.map((result) => result[field]).filter((value) => value != null);
    return values.length ? values.reduce((sum, value) => sum + Number(value), 0) : null;
  };

  return {
    input,
    inputHash,
    provider,
    model: providerResult.model || selectedModel,
    promptVersion: providerResult.promptVersion || PROMPT_VERSION,
    candidateName: providerResult.candidateName,
    seoSlug: slugifyProductName(providerResult.candidateName, input.productId),
    seoTitle: providerResult.seoTitle,
    seoDescription: providerResult.seoDescription,
    searchAliases: aliases,
    sourceType,
    evidence,
    warnings,
    validation,
    usage: {
      inputTokens: sumUsage('inputTokens'),
      outputTokens: sumUsage('outputTokens'),
      estimatedCostUsd: sumUsage('estimatedCostUsd'),
      latencyMs: sumUsage('latencyMs'),
    },
  };
}
