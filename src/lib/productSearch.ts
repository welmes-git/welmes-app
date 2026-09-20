/**
 * Product search matching (Task 9).
 *
 * A single, testable predicate used by the storefront list and the header
 * search so results stay consistent. Matches are case- and hyphen-insensitive
 * and cover the English name, original name, brand, category (product type),
 * tags, search aliases, and the first slice of the description.
 */
import type { Product } from '../store/useStore';

/**
 * Normalize a query/haystack for matching:
 *  - NFKD decomposition so full-width / compatibility forms fold to ASCII
 *    (e.g. "ＡＱＵＡ" → "aqua", "ｅｓｓｅｎｃｅ" → "essence").
 *  - Strip combining accent marks so "Bioré" matches "biore".
 *  - Lowercase.
 *  - Treat hyphens, underscores and any common punctuation as spaces so
 *    "SPF50+", "PA++++", "aqua_rich" and "aqua-rich" all normalize cleanly.
 *  - Squeeze runs of whitespace.
 */
export function normalizeSearch(value = ''): string {
  return value
    .normalize('NFKD')
    // Drop combining diacritical marks (accents) left over from NFKD.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Hyphens/underscores and general punctuation collapse to spaces. This keeps
    // alphanumerics and whitespace only, so "spf50+ pa++++" → "spf50 pa".
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Fields a query is matched against, pre-normalized. */
export function searchableText(product: Pick<Product,
  'nameEn' | 'name' | 'brand' | 'category' | 'subcategory' | 'tags' | 'searchAliases' | 'description'>): string {
  const parts = [
    product.nameEn,
    product.name,
    product.brand,
    product.category,
    product.subcategory ?? '',
    ...(product.tags ?? []),
    ...(product.searchAliases ?? []),
    (product.description ?? '').slice(0, 200),
  ];
  return normalizeSearch(parts.join(' '));
}

/**
 * True when every whitespace-separated token in the query appears in the
 * product's searchable text. Multi-token queries are AND-matched so
 * "biore essence" narrows rather than widens.
 */
export function matchesSearch(product: Parameters<typeof searchableText>[0], query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const haystack = searchableText(product);
  return q.split(' ').every((token) => haystack.includes(token));
}
