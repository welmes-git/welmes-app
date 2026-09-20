/**
 * Pure, dependency-free helpers for the English-name review workflow (Task 7).
 * Kept free of Supabase/React imports so the invariants (slug stability,
 * approval provenance) can be unit-tested with Node's test runner.
 */
import type { Product, ProductNameSource } from '../store/useStore';

export interface NameApprovalInput {
  nameEn: string;
  seoTitle?: string;
  seoDescription?: string;
  searchAliases?: string[];
  seoSlug?: string;
  /** Provenance of the approved name; edited approvals become 'manual'. */
  source: ProductNameSource;
}

/**
 * Optimistic-concurrency guard for approvals: the reviewer approves against a
 * specific latest run + generated timestamp. If the worker produces a newer run
 * (or regenerates the name) between load and approve, the RPC rejects the write
 * so a stale candidate is never rubber-stamped over fresh data.
 */
export interface ApprovalConcurrency {
  /** Latest enrichment run id the reviewer saw (null when none existed). */
  expectedRunId: string | null;
  /** `products.name_en_generated_at` the reviewer saw (null when never generated). */
  expectedGeneratedAt: string | null;
}

// Matches Hiragana, Katakana (incl. half-width), CJK ideographs, and the
// Katakana-Hiragana prolonged sound mark. Used to reject an approval that still
// carries Japanese source text instead of a curated English name.
const JAPANESE_RE =
  /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f\u3400-\u4dbf\u4e00-\u9fff]/u;

/** True when the string contains any Japanese (kana/kanji) character. */
export function containsJapanese(value: string): boolean {
  return JAPANESE_RE.test(value);
}

/**
 * Validate an approval candidate before it reaches the DB. Rejects blank names
 * and any name that still contains Japanese characters. Returns a stable error
 * code so the UI and RPC can agree on messaging.
 */
export function validateApprovalName(
  nameEn: string,
): { ok: true } | { ok: false; code: 'empty' | 'japanese'; message: string } {
  const trimmed = nameEn.trim();
  if (!trimmed) {
    return { ok: false, code: 'empty', message: 'English name is required' };
  }
  if (containsJapanese(trimmed)) {
    return { ok: false, code: 'japanese', message: 'English name must not contain Japanese characters' };
  }
  return { ok: true };
}

/**
 * Stable slug derived once from the approved name. Mirrors the worker's
 * `slugifyProductName` so admin-assigned and worker-assigned slugs are identical.
 */
export function slugifyProductName(name: string, productId: number): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70)
    .replace(/-$/g, '');
  return `${base || 'product'}-${productId}`;
}

/** Edited candidate ⇒ provenance becomes 'manual'; otherwise keep prior source. */
export function resolveApprovalSource(
  editedName: string,
  candidateName: string | undefined,
  priorSource: ProductNameSource | undefined,
): ProductNameSource {
  const isEdited = editedName.trim() !== (candidateName ?? editedName).trim();
  return isEdited ? 'manual' : (priorSource ?? 'generated');
}

/**
 * Human-approval patch. Stable URL policy: assign a slug only once — never
 * overwrite an existing one so product URLs stay constant across edits.
 */
export function buildApprovalPatch(
  reviewerId: string,
  input: NameApprovalInput,
  currentSlug?: string,
  now: () => string = () => new Date().toISOString(),
): Partial<Product> {
  const patch: Partial<Product> = {
    nameEn: input.nameEn,
    nameEnStatus: 'human_approved',
    nameEnSource: input.source,
    nameEnApprovedBy: reviewerId,
    nameEnApprovedAt: now(),
    seoTitle: input.seoTitle,
    seoDescription: input.seoDescription,
    searchAliases: input.searchAliases ?? [],
  };
  if (!currentSlug && input.seoSlug) patch.seoSlug = input.seoSlug;
  return patch;
}
