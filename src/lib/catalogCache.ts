/**
 * Small request cache for catalogue reads.
 *
 * Keys include the catalogue version (bumped after admin edits and on
 * sign-in/out, when price visibility changes), so stale entries are simply
 * never asked for again; `clearCatalogCache` also drops them from memory.
 * Resolved values are readable synchronously, so going back to a page renders
 * it immediately instead of flashing a skeleton.
 */
const MAX_ENTRIES = 200;

const values = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

export function peekCached<T>(key: string): { hit: boolean; value?: T } {
  return values.has(key) ? { hit: true, value: values.get(key) as T } : { hit: false };
}

/** Resolve `key` once; concurrent callers share the request. Failures are not cached. */
export function loadCached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (values.has(key)) return Promise.resolve(values.get(key) as T);
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = load().then(
    (value) => {
      inflight.delete(key);
      values.set(key, value);
      if (values.size > MAX_ENTRIES) values.delete(values.keys().next().value as string);
      return value;
    },
    (error) => {
      inflight.delete(key);
      throw error;
    },
  );
  inflight.set(key, promise);
  return promise;
}

export function clearCatalogCache() {
  values.clear();
  inflight.clear();
}
