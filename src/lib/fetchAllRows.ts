// PostgREST (Supabase) caps every response at `max-rows` (1000 by default), so a
// plain `.select('*')` silently returns only the first 1000 rows. This helper
// pages through a query with `.range()` until the table is exhausted.

export const PAGE_SIZE = 1000;

export type PageResult<T> = {
  data: T[] | null;
  error: { message: string } | null;
  count?: number | null;
};

/** Fetches rows [from, to] (inclusive). Must apply a stable ORDER BY. */
export type PageFetcher<T> = (from: number, to: number) => PromiseLike<PageResult<T>>;

/**
 * Collect every row of a paged query.
 *
 * If the first page reports an exact `count`, the remaining pages are fetched in
 * parallel; otherwise (or if rows were inserted meanwhile and the last page came
 * back full) it continues page by page. `keyOf` de-duplicates rows that shift
 * across a page boundary when the table changes during the fetch.
 */
export async function fetchAllRows<T>(
  fetchPage: PageFetcher<T>,
  { pageSize = PAGE_SIZE, keyOf }: { pageSize?: number; keyOf?: (row: T) => unknown } = {},
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const rows: T[] = [];
  const first = await fetchPage(0, pageSize - 1);
  if (first.error || !first.data) return { data: null, error: first.error ?? { message: 'no data' } };
  rows.push(...first.data);
  let lastLength = first.data.length;
  let next = pageSize;

  if (lastLength === pageSize && typeof first.count === 'number' && first.count > pageSize) {
    const offsets: number[] = [];
    for (let from = pageSize; from < first.count; from += pageSize) offsets.push(from);
    const pages = await Promise.all(offsets.map((from) => fetchPage(from, from + pageSize - 1)));
    for (const page of pages) {
      if (page.error || !page.data) return { data: null, error: page.error ?? { message: 'no data' } };
      rows.push(...page.data);
      lastLength = page.data.length;
    }
    next = pageSize * (offsets.length + 1);
  }

  while (lastLength === pageSize) {
    const page = await fetchPage(next, next + pageSize - 1);
    if (page.error || !page.data) return { data: null, error: page.error ?? { message: 'no data' } };
    rows.push(...page.data);
    lastLength = page.data.length;
    next += pageSize;
  }

  if (!keyOf) return { data: rows, error: null };
  const seen = new Set<unknown>();
  return {
    data: rows.filter((row) => {
      const key = keyOf(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    error: null,
  };
}
