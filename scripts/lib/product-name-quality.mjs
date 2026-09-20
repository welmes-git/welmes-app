const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff]/u;

const COUNT_UNIT_RE = '(?:枚(?:入)?|個(?:入)?|本(?:入)?|粒|錠|包|組|セット|点|sheets?|pieces?|pcs?|tablets?|capsules?|packs?|sets?|count|ct|bottles?|wipes?)';
const COUNT_UNIT_NORMALIZERS = [
  [/枚|sheets?|wipes?/i, 'sheets'],
  [/粒|錠|tablets?|capsules?/i, 'tablets'],
  [/セット|組|sets?/i, 'sets'],
  [/個|本|点|pieces?|pcs?|packs?|count|ct|bottles?/i, 'count'],
];

const QUALIFIER_RULES = [
  { key: 'refill', source: /つめかえ用|詰替(?:え|用)?|リフィル|\brefill\b/i, candidate: /\brefill\b/i },
  { key: 'mini', source: /ミニ(?:サイズ)?|\bmini\b/i, candidate: /\bmini\b/i },
  { key: 'travel', source: /携帯用|トラベル|\b(?:travel|portable)\b/i, candidate: /\b(?:travel|portable)\b/i },
  { key: 'unscented', source: /無香(?:性|料)?|\b(?:unscented|fragrance[- ]free)\b/i, candidate: /\b(?:unscented|fragrance[- ]free)\b/i },
  { key: 'medicated', source: /医薬部外品|指定医薬部外品|薬用|\bmedicated\b/i, candidate: /\bmedicated\b/i },
  { key: 'limited', source: /限定|\blimited(?: edition)?\b/i, candidate: /\blimited(?: edition)?\b/i },
  { key: 'pump', source: /ポンプ|\bpump\b/i, candidate: /\bpump\b/i },
  { key: 'spray', source: /スプレー|ミスト|\b(?:spray|mist)\b/i, candidate: /\b(?:spray|mist)\b/i },
  { key: 'scent_lavender', source: /ラベンダー|\blavender\b/i, candidate: /\blavender\b/i },
  { key: 'scent_citrus', source: /シトラス|\bcitrus\b/i, candidate: /\bcitrus\b/i },
  { key: 'scent_mint', source: /ミント|\bmint\b/i, candidate: /\bmint\b/i },
  { key: 'scent_floral', source: /フローラル|\bfloral\b/i, candidate: /\bfloral\b/i },
  { key: 'scent_rose', source: /ローズ|\brose\b/i, candidate: /\brose\b/i },
  { key: 'scent_peach', source: /ピーチ|もも(?:の香り)?|\bpeach\b/i, candidate: /\bpeach\b/i },
  { key: 'scent_osmanthus', source: /金木犀|\bosmanthus\b/i, candidate: /\bosmanthus\b/i },
  { key: 'scent_fruit', source: /フルーツ(?:の香り)?|\bfruit(?:y)?\b/i, candidate: /\bfruit(?:y)?\b/i },
];

const CLAIM_RULES = [
  { key: 'clinically_proven', candidate: /\bclinically proven\b/i, source: /臨床|clinically proven/i },
  { key: 'dermatologist_tested', candidate: /\bdermatologist(?:ically)? tested\b/i, source: /皮膚科(?:医)?テスト|dermatologist(?:ically)? tested/i },
  { key: 'hypoallergenic', candidate: /\bhypoallergenic\b/i, source: /低アレルギー|アレルギーテスト|hypoallergenic/i },
  { key: 'organic', candidate: /\borganic\b/i, source: /オーガニック|有機|organic/i },
  { key: 'vegan', candidate: /\bvegan\b/i, source: /ヴィーガン|ビーガン|vegan/i },
  { key: 'cruelty_free', candidate: /\bcruelty[- ]free\b/i, source: /クルエルティフリー|cruelty[- ]free/i },
  { key: 'fda_approved', candidate: /\bfda approved\b/i, source: /FDA|fda approved/i },
  { key: 'brightening', candidate: /\b(?:whitening|brightening)\b/i, source: /美白|ブライトニング|whitening|brightening/i },
  { key: 'anti_aging', candidate: /\banti[- ]aging\b/i, source: /エイジングケア|年齢肌|anti[- ]aging/i },
  { key: 'waterproof', candidate: /\bwaterproof\b/i, source: /ウォータープルーフ|耐水|waterproof/i },
];

const REFERENCE_STOP_WORDS = new Set(['the', 'a', 'an', 'for', 'with', 'and', 'of', 'n']);

// Corporate/manufacturer suffixes. A candidate that carries the parent company
// suffix while the source data does not is a manufacturer↔brand confusion: the
// naming pipeline must never promote a consumer product to a corporate entity
// name (e.g. "Kao Corporation" instead of "Biore"). Kept English + Japanese.
const MANUFACTURER_SUFFIX_RE = /\b(?:corporation|corp|incorporated|inc|company|co(?:\.,)?\s*ltd|co\.?\s*,?\s*ltd|ltd|llc|gmbh|kabushiki\s*kaisha|k\.k\.|holdings|pharmaceutical|pharmaceuticals|industries|manufacturing|mfg)\b/i;
const MANUFACTURER_SUFFIX_JP_RE = /(?:株式会社|有限会社|製薬(?:株式会社)?|工業|ホールディングス|製造)/;

// Provider- or validation-emitted warning phrases that unconditionally block
// automatic approval. These signal a self-declared uncertainty (guessing,
// ambiguity, unverifiable claims, self-asserted "official" status) that a human
// must review even when the deterministic fact checks pass.
const AUTO_APPROVE_BLOCKING_WARNING_PATTERNS = [
  /ambig/i,
  /uncertain/i,
  /not\s+sure/i,
  /\bguess/i,
  /\bassum/i,
  /could\s*n'?o?t?\s+verify/i,
  /unverif/i,
  /\bmight\s+be\b/i,
  /\bpossibly\b/i,
  /\bunclear\b/i,
  /\bofficial\b/i, // provider must never self-declare a source official
  /\bhallucinat/i,
];

/**
 * True when any provider/validation warning text should block auto-approval and
 * force human review, regardless of whether the deterministic checks passed.
 */
export function hasAutoApproveBlockingWarning(warnings = []) {
  const list = Array.isArray(warnings) ? warnings : [warnings];
  return list.some((warning) => {
    const text = String(warning?.message ?? warning ?? '');
    return AUTO_APPROVE_BLOCKING_WARNING_PATTERNS.some((pattern) => pattern.test(text));
  });
}

export function hasJapanese(value = '') {
  return JAPANESE_RE.test(String(value));
}

export function normalizeComparable(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff#+.\-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : String(value);
}

function normalizeCountUnit(unit) {
  for (const [pattern, normalized] of COUNT_UNIT_NORMALIZERS) {
    if (pattern.test(unit)) return normalized;
  }
  return 'count';
}

function uniqueFacts(facts) {
  const seen = new Set();
  return facts.filter((fact) => {
    const key = `${fact.type}:${fact.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractProductFacts(value = '') {
  const text = String(value).normalize('NFKC');
  const facts = [];

  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(ml|l|kg|g)\b/gi)) {
    facts.push({ type: 'measure', value: `${canonicalNumber(match[1])}${match[2].toLowerCase()}`, raw: match[0] });
  }
  for (const match of text.matchAll(new RegExp(`(\\d+)\\s*(${COUNT_UNIT_RE})`, 'giu'))) {
    facts.push({ type: 'count', value: `${canonicalNumber(match[1])}:${normalizeCountUnit(match[2])}`, raw: match[0] });
  }
  for (const match of text.matchAll(/\bSPF\s*(\d{1,3}\+?)(?!\w)/gi)) {
    facts.push({ type: 'spf', value: `spf${match[1].toLowerCase()}`, raw: match[0] });
  }
  for (const match of text.matchAll(/\bPA\s*(\+{1,4})(?!\w)/gi)) {
    facts.push({ type: 'pa', value: `pa${match[1]}`, raw: match[0] });
  }
  for (const match of text.matchAll(/(?:#|No\.?\s*|カラー\s*|色番\s*)([A-Z]?\d{1,3})\b/gi)) {
    facts.push({ type: 'shade', value: match[1].toLowerCase(), raw: match[0] });
  }
  for (const match of text.matchAll(/\b(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/gi)) {
    facts.push({ type: 'model', value: match[0].toLowerCase(), raw: match[0] });
  }
  return uniqueFacts(facts);
}

export function extractProductIdentifiers(value = '') {
  const text = String(value).normalize('NFKC');
  const jan = [...text.matchAll(/(?:JAN(?:コード)?\s*[：:]?\s*)(\d{8,13})/gi)].map((match) => match[1]);
  const models = extractProductFacts(text)
    .filter((fact) => fact.type === 'model')
    .map((fact) => fact.value);
  return { jan: [...new Set(jan)], models: [...new Set(models)] };
}

function candidateHasFact(candidateFacts, requiredFact) {
  if (requiredFact.type !== 'count') {
    return candidateFacts.some((fact) => fact.type === requiredFact.type && fact.value === requiredFact.value);
  }
  const [requiredNumber, requiredUnit] = requiredFact.value.split(':');
  return candidateFacts.some((fact) => {
    if (fact.type !== 'count') return false;
    const [number, unit] = fact.value.split(':');
    return number === requiredNumber && unit === requiredUnit;
  });
}

function sourceEvidenceScore(sourceType, evidenceUrls) {
  const hasEvidence = Array.isArray(evidenceUrls) && evidenceUrls.some((url) => /^https:\/\//i.test(url));
  if (sourceType === 'manual') return 0.35;
  if (sourceType === 'official') return hasEvidence ? 0.35 : 0.15;
  if (sourceType === 'grounded') return hasEvidence ? 0.25 : 0.10;
  return 0.08;
}

export function validateEnglishProductName({
  sourceName = '',
  sourceDescription = '',
  candidateName = '',
  brand = '',
  sourceType = 'generated',
  evidenceUrls = [],
  autoApproveThreshold = 0.85,
} = {}) {
  const errors = [];
  const warnings = [];
  const sourceText = `${sourceName}\n${sourceDescription}`;
  const candidate = String(candidateName).trim();
  const candidateNormalized = normalizeComparable(candidate);
  const brandNormalized = normalizeComparable(brand);

  if (!candidate) errors.push({ code: 'empty_name', message: 'English product name is empty.' });
  if (candidate && hasJapanese(candidate)) errors.push({ code: 'japanese_remaining', message: 'Japanese characters remain in the English name.' });

  const compactLatin = (value) => normalizeComparable(value).replace(/[^a-z0-9]/g, '');
  const brandCompact = compactLatin(brand);
  const candidateCompact = compactLatin(candidate);
  const brandPreserved = !brandNormalized
    || candidateNormalized.includes(brandNormalized)
    || (brandCompact.length >= 2 && candidateCompact.includes(brandCompact));
  if (!brandPreserved) errors.push({ code: 'brand_missing', message: `Brand "${brand}" is missing.`, value: brand });

  const sourceFacts = extractProductFacts(sourceText);
  const candidateFacts = extractProductFacts(candidate);
  const missingFacts = sourceFacts.filter((fact) => !candidateHasFact(candidateFacts, fact));
  const unexpectedFacts = candidateFacts.filter((fact) => !candidateHasFact(sourceFacts, fact));
  for (const fact of missingFacts) {
    errors.push({ code: `missing_${fact.type}`, message: `Required ${fact.type} "${fact.raw}" is missing.`, value: fact.value });
  }
  for (const fact of unexpectedFacts) {
    errors.push({ code: `unexpected_${fact.type}`, message: `Candidate added ${fact.type} "${fact.raw}" not found in source data.`, value: fact.value });
  }

  const requiredQualifiers = QUALIFIER_RULES.filter((rule) => rule.source.test(sourceText));
  const missingQualifiers = requiredQualifiers.filter((rule) => !rule.candidate.test(candidate));
  for (const rule of missingQualifiers) {
    errors.push({ code: `missing_qualifier_${rule.key}`, message: `Required qualifier "${rule.key}" is missing.`, value: rule.key });
  }

  const unsupportedClaims = CLAIM_RULES.filter((rule) => rule.candidate.test(candidate) && !rule.source.test(sourceText));
  for (const rule of unsupportedClaims) {
    errors.push({ code: `unsupported_claim_${rule.key}`, message: `Unsupported claim "${rule.key}" was added.`, value: rule.key });
  }

  // Manufacturer↔brand confusion: the candidate must not introduce a corporate
  // entity suffix (Corporation, Co., Ltd., 株式会社, 製薬 …) that the source
  // brand/name/description does not already carry. This stops the pipeline from
  // renaming a consumer product to its parent manufacturer.
  const brandHasManufacturer = MANUFACTURER_SUFFIX_RE.test(brand) || MANUFACTURER_SUFFIX_JP_RE.test(brand);
  const sourceHasManufacturer = MANUFACTURER_SUFFIX_RE.test(sourceText) || MANUFACTURER_SUFFIX_JP_RE.test(sourceText);
  const candidateHasManufacturer = MANUFACTURER_SUFFIX_RE.test(candidate);
  if (candidateHasManufacturer && !brandHasManufacturer && !sourceHasManufacturer) {
    errors.push({
      code: 'manufacturer_brand_confusion',
      message: 'Candidate added a manufacturer/corporate entity name not present in the source brand or data.',
    });
  }

  if (candidate.length > 120) warnings.push({ code: 'name_too_long', message: 'Name exceeds 120 characters.' });
  if (candidate && candidate === candidate.toUpperCase() && /[A-Z]/.test(candidate)) {
    warnings.push({ code: 'all_caps', message: 'Name is written in all caps.' });
  }

  const factRetention = sourceFacts.length === 0 ? 1 : (sourceFacts.length - missingFacts.length) / sourceFacts.length;
  const factPrecision = candidateFacts.length === 0 ? (sourceFacts.length === 0 ? 1 : 0) : (candidateFacts.length - unexpectedFacts.length) / candidateFacts.length;
  const qualifierRetention = requiredQualifiers.length === 0
    ? 1
    : (requiredQualifiers.length - missingQualifiers.length) / requiredQualifiers.length;
  const components = {
    evidence: sourceEvidenceScore(sourceType, evidenceUrls),
    brand: brandPreserved ? 0.20 : 0,
    facts: 0.20 * factRetention * factPrecision,
    qualifiers: 0.05 * qualifierRetention,
    english: candidate && !hasJapanese(candidate) ? 0.10 : 0,
    claims: unsupportedClaims.length === 0 ? 0.10 : 0,
  };
  const confidence = Number(Math.max(0, Math.min(1, Object.values(components).reduce((sum, value) => sum + value, 0))).toFixed(3));
  const status = errors.length === 0 && confidence >= autoApproveThreshold ? 'auto_approved' : 'review_required';

  return {
    status,
    confidence,
    components,
    errors,
    warnings,
    facts: { source: sourceFacts, candidate: candidateFacts, missing: missingFacts, unexpected: unexpectedFacts },
    qualifiers: {
      required: requiredQualifiers.map((rule) => rule.key),
      missing: missingQualifiers.map((rule) => rule.key),
    },
  };
}

function referenceTokens(value) {
  return new Set(normalizeComparable(value)
    .split(' ')
    .filter((token) => token && !REFERENCE_STOP_WORDS.has(token)));
}

export function scoreReferenceSimilarity(candidateName = '', referenceName = '') {
  const candidate = referenceTokens(candidateName);
  const reference = referenceTokens(referenceName);
  if (reference.size === 0) return candidate.size === 0 ? 1 : 0;
  let intersection = 0;
  for (const token of candidate) if (reference.has(token)) intersection++;
  const union = new Set([...candidate, ...reference]).size;
  return Number((union === 0 ? 1 : intersection / union).toFixed(3));
}

function contractTokens(value) {
  return normalizeComparable(value).split(' ').filter(Boolean);
}

/**
 * Evaluate a candidate name against an evaluation fixture's exactTokens /
 * allowedAlternatives contract.
 *
 * Contract semantics:
 *   - exactTokens: every token MUST appear (normalized) in the candidate, OR be
 *     satisfied by one of its allowedAlternatives entries. This pins the facts
 *     that must never drift (brand, size, SPF, model, refill, scent …).
 *   - allowedAlternatives: map of exact token → list of acceptable substitute
 *     spellings/translations. Presence of any alternative satisfies the token.
 *
 * Returns { ok, missing } where `missing` lists exactTokens that were neither
 * present nor covered by an allowed alternative.
 */
export function evaluateNameContract(candidateName = '', {
  exactTokens = [],
  allowedAlternatives = {},
} = {}) {
  const candidateNorm = ` ${contractTokens(candidateName).join(' ')} `;
  const has = (token) => {
    const norm = normalizeComparable(token);
    return norm ? candidateNorm.includes(` ${norm} `) : false;
  };
  const missing = [];
  for (const token of exactTokens) {
    if (has(token)) continue;
    const alternatives = allowedAlternatives[token] || [];
    if (alternatives.some((alt) => has(alt))) continue;
    missing.push(token);
  }
  return { ok: missing.length === 0, missing };
}
