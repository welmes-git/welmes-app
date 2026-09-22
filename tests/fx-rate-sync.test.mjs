// The browser used to supply `fx_rate`, and src/lib/currency.ts silently swapped
// in rates hardcoded months earlier whenever the upstream feed was down — either
// one turned into a real charge. These tests pin the replacement behaviour.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  syncFxRates,
  FX_REFRESH_AFTER_MS,
  TRACKED_CURRENCIES,
  FALLBACK_RATES,
} from '../server/payments.mjs';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-09-22T12:00:00Z').getTime();
const now = () => NOW;

/** Every tracked currency, all fetched `ageHours` ago. */
const rowsAged = (ageHours) =>
  TRACKED_CURRENCIES.map((currency) => ({
    currency,
    rate_jpy: FALLBACK_RATES[currency],
    source: 'frankfurter',
    fetched_at: new Date(NOW - ageHours * HOUR).toISOString(),
  }));

function store(rows, { readError, writeError } = {}) {
  const writes = [];
  return {
    writes,
    readRates: async () => ({ rows, error: readError }),
    writeRates: async (rates) => { writes.push(rates); return { error: writeError }; },
  };
}

const liveFeed = (rates) => async () => ({ ok: true, json: async () => ({ rates }) });
const deadFeed = async () => ({ ok: false, status: 503, json: async () => ({}) });

test('fresh rates are left alone', async () => {
  const s = store(rowsAged(1));
  const result = await syncFxRates(s, { fetchImpl: liveFeed({ USD: 0.007 }), now });
  assert.equal(result.refreshed, false);
  assert.equal(result.reason, 'fresh');
  assert.equal(s.writes.length, 0, 'no write for fresh rates');
});

test('rates older than the refresh window are updated', async () => {
  const s = store(rowsAged(FX_REFRESH_AFTER_MS / HOUR + 1));
  const result = await syncFxRates(s, { fetchImpl: liveFeed({ USD: 0.0071, EUR: 0.0063 }), now });
  assert.equal(result.refreshed, true);
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].USD, 0.0071);
  assert.equal(s.writes[0].JPY, 1, 'JPY base must always be written');
});

test('an empty table is refreshed', async () => {
  const s = store([]);
  const result = await syncFxRates(s, { fetchImpl: liveFeed({ USD: 0.0067 }), now });
  assert.equal(result.refreshed, true);
  assert.equal(s.writes.length, 1);
});

test('a missing currency triggers a refresh even when the rest is fresh', async () => {
  const s = store(rowsAged(1).filter((r) => r.currency !== 'SGD'));
  const result = await syncFxRates(s, { fetchImpl: liveFeed({ SGD: 0.0092 }), now });
  assert.equal(result.refreshed, true, 'SGD was absent, so the table is incomplete');
});

test('an upstream outage never writes fallback rates into the table', async () => {
  // This is the whole point: persisting FALLBACK_RATES would convert a temporary
  // outage into a permanent wrong price that looks perfectly normal.
  const s = store(rowsAged(999));
  const result = await syncFxRates(s, { fetchImpl: deadFeed, now });
  assert.equal(result.refreshed, false);
  assert.equal(result.reason, 'upstream unavailable');
  assert.equal(s.writes.length, 0, 'nothing may be written from a failed fetch');
});

test('read and write failures are reported, not thrown', async () => {
  const readFail = await syncFxRates(store([], { readError: 'permission denied' }), { fetchImpl: liveFeed({}), now });
  assert.equal(readFail.refreshed, false);
  assert.match(readFail.reason, /read failed/);

  const writeFail = await syncFxRates(
    store(rowsAged(999), { writeError: 'permission denied' }),
    { fetchImpl: liveFeed({ USD: 0.007 }), now },
  );
  assert.equal(writeFail.refreshed, false);
  assert.match(writeFail.reason, /write failed/);
});

test('only sane rates are written', async () => {
  const s = store([]);
  await syncFxRates(s, {
    fetchImpl: liveFeed({ USD: 0.007, EUR: 0, GBP: -1, SGD: Number.NaN }),
    now,
  });
  const written = s.writes[0];
  assert.equal(written.USD, 0.007);
  assert.equal('EUR' in written, false, 'zero rate dropped');
  assert.equal('GBP' in written, false, 'negative rate dropped');
  assert.equal('SGD' in written, false, 'NaN dropped');
});

test('the refresh window is shorter than the RPC hard limit', () => {
  // place_order refuses a rate older than 72h. Refreshing at 6h leaves plenty of
  // room for a temporary outage without blocking checkout.
  const HARD_LIMIT_MS = 72 * HOUR;
  assert.ok(FX_REFRESH_AFTER_MS < HARD_LIMIT_MS);
  assert.equal(FX_REFRESH_AFTER_MS, 6 * HOUR);
});
