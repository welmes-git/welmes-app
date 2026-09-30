/**
 * Catalogue query semantics, implemented in plain TypeScript.
 *
 * The database RPCs in supabase/migrations/20261005_catalog_pagination.sql
 * (catalog_list, catalog_facets, admin_product_page) are the primary path.
 * This module is the same contract run over an in-memory array, used when those
 * RPCs are not deployed yet (so the site keeps working between a frontend
 * deploy and the migration) and as the reference the SQL is checked against.
 *
 * Keep the two in step: same filters, same ordering, same tie-breakers.
 */
import { matchesSearch, normalizeSearch } from './productSearch.ts';
import type { Product } from '../store/useStore';

export type CatalogSort = 'popular' | 'price-low' | 'price-high' | 'newest' | 'discount' | 'recent';

export interface CatalogQuery {
  search?: string;
  category?: string | null;
  brands?: string[] | null;
  priceMin?: number | null;
  priceMax?: number | null;
  sort?: CatalogSort;
  limit?: number;
  offset?: number;
}

export interface CatalogPage<T = Product> {
  total: number;
  items: T[];
}

export interface CatalogFacets {
  total: number;
  /** [brand, product count], most products first, then brand (code-unit order). */
  brands: [string, number][];
  priceMin: number;
  priceMax: number;
}

export interface AdminProductQuery {
  search?: string;
  /** 'pending' also matches products with no status yet. */
  nameStatus?: string | null;
  /** null/undefined = no filter; an empty array matches nothing. */
  ids?: number[] | null;
  brand?: string | null;
  /** Hide products mapped to an external supplier (AdminSupply "WELMES stock only"). */
  ownStockOnly?: boolean;
  limit?: number;
  offset?: number;
}

export const STORE_PAGE_SIZE = 60;
export const ADMIN_PAGE_SIZE = 50;

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  Math.min(Math.max(Number.isFinite(value) ? Math.trunc(value as number) : fallback, min), max);

const timeOf = (p: Pick<Product, 'createdAt'>) => Date.parse(p.createdAt ?? '') || 0;

/** created_at desc, id desc — the base order every sort falls back to. */
function compareRecent(a: Product, b: Product) {
  return timeOf(b) - timeOf(a) || b.id - a.id;
}

/** Up to 10 normalised tokens, or null for an empty query (mirrors catalog_search_tokens). */
export function searchTokens(search: string | undefined | null): string[] | null {
  const normalized = normalizeSearch((search ?? '').slice(0, 200));
  return normalized ? normalized.split(' ').slice(0, 10) : null;
}

/** Sort + slice with the same tie-breakers as the SQL window. Does not mutate. */
function orderRows(rows: Product[], sort: CatalogSort) {
  const primary: Record<CatalogSort, ((a: Product, b: Product) => number) | null> = {
    'price-low':  (a, b) => a.wholesalePrice - b.wholesalePrice,
    'price-high': (a, b) => b.wholesalePrice - a.wholesalePrice,
    discount:     (a, b) => b.discount - a.discount,
    popular:      (a, b) => (b.reviews || 0) - (a.reviews || 0),
    newest:       (a, b) => b.id - a.id,
    recent:       null,
  };
  const cmp = primary[sort];
  return [...rows].sort((a, b) => (cmp ? cmp(a, b) : 0) || compareRecent(a, b));
}

export function queryCatalogLocally(
  products: Product[],
  query: CatalogQuery,
  { canSeePrices }: { canSeePrices: boolean },
): CatalogPage {
  const limit = clamp(query.limit, STORE_PAGE_SIZE, 1, 100);
  const offset = clamp(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  let sort: CatalogSort = query.sort ?? 'popular';
  let { priceMin, priceMax } = query;
  if (!canSeePrices) {
    priceMin = null;
    priceMax = null;
    if (sort === 'price-low' || sort === 'price-high') sort = 'recent';
  }
  const tokens = searchTokens(query.search);
  const brands = query.brands?.length ? query.brands : null;

  const rows = products.filter((p) =>
    (!tokens || matchesSearch(p, tokens.join(' ')))
    && (!query.category || p.category === query.category)
    && (!brands || brands.includes(p.brand))
    && (priceMin == null || p.wholesalePrice >= priceMin)
    && (priceMax == null || p.wholesalePrice <= priceMax));

  return { total: rows.length, items: orderRows(rows, sort).slice(offset, offset + limit) };
}

export function facetsLocally(products: Product[], { canSeePrices }: { canSeePrices: boolean }): CatalogFacets {
  const counts = new Map<string, number>();
  for (const p of products) if (p.brand) counts.set(p.brand, (counts.get(p.brand) ?? 0) + 1);
  const brands = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const prices = products.map((p) => p.wholesalePrice);
  return {
    total: products.length,
    brands,
    priceMin: canSeePrices && prices.length ? Math.min(...prices) : 0,
    priceMax: canSeePrices && prices.length ? Math.max(...prices) : 0,
  };
}

export function queryAdminLocally(
  products: Product[],
  query: AdminProductQuery,
  { externalSupplyIds }: { externalSupplyIds?: Set<number> } = {},
): CatalogPage & { ids: number[] } {
  const limit = clamp(query.limit, ADMIN_PAGE_SIZE, 1, 200);
  const offset = clamp(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const tokens = searchTokens(query.search);
  const trimmed = (query.search ?? '').trim();
  const idMatch = /^\d{1,18}$/.test(trimmed) ? Number(trimmed) : null;
  const idSet = query.ids ? new Set(query.ids) : null;

  const rows = products.filter((p) =>
    (!tokens || (idMatch !== null && p.id === idMatch) || matchesSearch(p, tokens.join(' ')))
    && (!query.nameStatus || (p.nameEnStatus ?? 'pending') === query.nameStatus)
    && (!idSet || idSet.has(p.id))
    && (!query.brand || p.brand === query.brand)
    && (!query.ownStockOnly || !externalSupplyIds?.has(p.id)));

  const ordered = orderRows(rows, 'recent');
  return { total: ordered.length, items: ordered.slice(offset, offset + limit), ids: ordered.map((p) => p.id) };
}
