import { useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store/useStore';
import type { Product } from '../store/useStore';
import * as db from '../lib/db';
import { loadCached, peekCached } from '../lib/catalogCache';
import type { AdminProductQuery, CatalogFacets, CatalogPage, CatalogQuery } from '../lib/catalogQuery';
import { SsrProductContext } from '../lib/ssrProductContext';

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: boolean;
}

/**
 * Who is asking — part of every cache key, because the same query returns
 * prices for approved members and none for guests.
 */
function useViewerKey(): string {
  const version = useStore((s) => s.catalogVersion);
  const viewer = useStore((s) => (s.currentUser ? `${s.currentUser.id}:${s.currentUser.status}:${s.isAdmin ? 'a' : ''}` : 'anon'));
  return `${version}|${viewer}`;
}

/**
 * Cached async read keyed by `key` (null = don't load). With `keepPrevious`,
 * the last resolved value stays visible while the next key loads, so paging
 * swaps content instead of flashing a skeleton.
 */
export function useCachedQuery<T>(key: string | null, load: () => Promise<T>, { keepPrevious = false } = {}): AsyncState<T> {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: boolean }>({ key: null });
  const [previous, setPrevious] = useState<T | undefined>(undefined);

  useEffect(() => {
    if (!key || peekCached(key).hit) return;
    let alive = true;
    loadCached(key, load).then(
      (data) => { if (alive) { setState({ key, data }); setPrevious(data); } },
      (error) => { console.error('[catalog]', error); if (alive) setState({ key, error: true }); },
    );
    return () => { alive = false; };
    // `load` is derived from `key`; re-running on its identity would refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!key) return { data: undefined, loading: false, error: false };
  const cached = peekCached<T>(key);
  if (cached.hit) return { data: cached.value, loading: false, error: false };
  if (state.key === key && state.error) return { data: keepPrevious ? previous : undefined, loading: false, error: true };
  return { data: keepPrevious ? previous : undefined, loading: true, error: false };
}

/** One storefront page. */
export function useCatalogPage(query: CatalogQuery | null, options?: { keepPrevious?: boolean }): AsyncState<CatalogPage> {
  const viewer = useViewerKey();
  const key = query ? `list|${viewer}|${JSON.stringify(query)}` : null;
  return useCachedQuery(key, () => db.fetchCatalogPage(query!), options);
}

export function useCatalogFacets(): AsyncState<CatalogFacets> {
  const viewer = useViewerKey();
  return useCachedQuery(`facets|${viewer}`, db.fetchCatalogFacets);
}

/** Specific products, in the order given. */
export function useProductsByIds(ids: number[], options?: { keepPrevious?: boolean }): AsyncState<Product[]> {
  const viewer = useViewerKey();
  const idKey = ids.join(',');
  const key = `ids|${viewer}|${idKey}`;
  return useCachedQuery(key, () => (ids.length ? db.fetchProductsByIds(ids) : Promise.resolve([])), options);
}

/**
 * One product for the detail page. The SSR payload (no prices, no set
 * options) is shown until the real row arrives, and must then give way to it.
 */
export function useProduct(id: number): AsyncState<Product> & { placeholder: boolean } {
  const ssrProduct = useContext(SsrProductContext);
  const valid = Number.isSafeInteger(id) && id > 0;
  const ids = useMemo(() => (valid ? [id] : []), [id, valid]);
  const { data, loading, error } = useProductsByIds(ids);
  const fetched = data?.[0];
  const placeholder = ssrProduct && ssrProduct.id === id ? ssrProduct : undefined;
  return {
    data: fetched ?? (data ? undefined : placeholder),
    loading: valid && loading,
    error,
    placeholder: !fetched && !!placeholder && !data,
  };
}

export function useAdminProductPage(query: AdminProductQuery | null, options?: { keepPrevious?: boolean }): AsyncState<CatalogPage> {
  const viewer = useViewerKey();
  const key = query ? `admin|${viewer}|${JSON.stringify(query)}` : null;
  return useCachedQuery(key, () => db.fetchAdminProductPage(query!), options);
}

export function useAdminProductCounts(): AsyncState<{ total: number; active: number }> {
  const viewer = useViewerKey();
  return useCachedQuery(`admin-counts|${viewer}`, db.fetchAdminProductCounts);
}

/** Debounced copy of a value (search boxes, price slider). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
