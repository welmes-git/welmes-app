import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRows } from '../src/lib/fetchAllRows.ts';

// Simulates PostgREST: returns at most `cap` rows per request, optional exact count.
function fakeTable(total, { cap = 1000, withCount = true, failAt = null } = {}) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: total - i }));
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    if (failAt === from) return { data: null, error: { message: 'boom' } };
    const data = rows.slice(from, Math.min(to + 1, from + cap));
    return { data, error: null, count: withCount && from === 0 ? total : null };
  };
  return { rows, calls, fetchPage };
}

test('returns every row beyond the 1000-row cap (count known → parallel pages)', async () => {
  const t = fakeTable(6012);
  const { data, error } = await fetchAllRows(t.fetchPage, { keyOf: (r) => r.id });
  assert.equal(error, null);
  assert.equal(data.length, 6012);
  assert.deepEqual(data, t.rows, 'order preserved');
  assert.equal(t.calls.length, 7);
});

test('falls back to sequential paging without a count', async () => {
  const t = fakeTable(2500, { withCount: false });
  const { data } = await fetchAllRows(t.fetchPage);
  assert.equal(data.length, 2500);
  assert.deepEqual(t.calls.map((c) => c[0]), [0, 1000, 2000]);
});

test('exact multiple of page size stops after an empty page', async () => {
  const t = fakeTable(2000, { withCount: false });
  const { data } = await fetchAllRows(t.fetchPage);
  assert.equal(data.length, 2000);
  assert.deepEqual(t.calls.map((c) => c[0]), [0, 1000, 2000]);
});

test('small tables need one request', async () => {
  const t = fakeTable(12);
  const { data } = await fetchAllRows(t.fetchPage);
  assert.equal(data.length, 12);
  assert.equal(t.calls.length, 1);
});

test('any page error fails the whole fetch instead of returning a partial list', async () => {
  const t = fakeTable(3000, { failAt: 2000 });
  const { data, error } = await fetchAllRows(t.fetchPage);
  assert.equal(data, null);
  assert.equal(error.message, 'boom');
});

test('keyOf removes duplicates that shift across page boundaries', async () => {
  const pages = [
    Array.from({ length: 3 }, (_, i) => ({ id: 10 - i })),   // 10, 9, 8
    [{ id: 8 }, { id: 7 }],                                  // 8 shifted in
  ];
  const fetchPage = async (from) => ({ data: pages[from / 3] ?? [], error: null });
  const { data } = await fetchAllRows(fetchPage, { pageSize: 3, keyOf: (r) => r.id });
  assert.deepEqual(data.map((r) => r.id), [10, 9, 8, 7]);
});
