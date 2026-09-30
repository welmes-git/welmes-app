import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideParseRetry, orderProductUrls, filterUnregisteredUrls, parseUrlListFile, sdIdFromUrl,
} from '../scripts/lib/sd-core.mjs';

const U = (id) => `https://www.superdelivery.com/p/r/pd_p/${id}/`;
const noSets = { error: { kind: 'no_sets', message: 'x' } };
const notTrading = { error: { kind: 'not_trading', message: 'x' } };

test('decideParseRetry: success or exhausted retries is final', () => {
  assert.equal(decideParseRetry({ error: null }, { loggedIn: true, attempt: 0, retries: 2 }), 'done');
  assert.equal(decideParseRetry(noSets, { loggedIn: false, attempt: 2, retries: 2 }), 'done');
  assert.equal(decideParseRetry(noSets, { loggedIn: true, attempt: 0, retries: 0 }), 'done');
});

test('decideParseRetry: logged-out page is re-logged-in regardless of error kind', () => {
  assert.equal(decideParseRetry(noSets, { loggedIn: false, attempt: 0, retries: 2 }), 'relogin');
  assert.equal(decideParseRetry(notTrading, { loggedIn: false, attempt: 1, retries: 2 }), 'relogin');
});

test('decideParseRetry: logged-in not_trading is final, no_sets waits and retries', () => {
  assert.equal(decideParseRetry(notTrading, { loggedIn: true, attempt: 0, retries: 2 }), 'done');
  assert.equal(decideParseRetry(noSets, { loggedIn: true, attempt: 0, retries: 2 }), 'retry');
});

test('orderProductUrls dedupes by SD id and reverses on request', () => {
  const urls = [U(3), U(2), `${U(2)}?ref=x`, U(1)];
  assert.deepEqual(orderProductUrls(urls), [U(3), U(2), U(1)]);
  assert.deepEqual(orderProductUrls(urls, { reverse: true }), [U(1), U(2), U(3)]);
  assert.deepEqual(urls.length, 4, 'input is not mutated');
});

test('filterUnregisteredUrls drops registered ids and keeps order', () => {
  assert.deepEqual(filterUnregisteredUrls([U(1), U(2), U(3)], new Set(['2'])), [U(1), U(3)]);
  assert.deepEqual(filterUnregisteredUrls([U(1), U(2)], [1]), [U(2)]);
});

test('parseUrlListFile accepts saved format and rejects foreign hosts / malformed data', () => {
  const saved = parseUrlListFile(JSON.stringify({ source: 's', collectedAt: 't', urls: [U(1)] }));
  assert.deepEqual(saved, { urls: [U(1)], source: 's', collectedAt: 't' });
  assert.deepEqual(parseUrlListFile(JSON.stringify([U(5)])).urls, [U(5)]);
  assert.throws(() => parseUrlListFile(JSON.stringify({ urls: ['https://evil.example/p/r/pd_p/1/'] })), /Superdelivery 외/);
  assert.throws(() => parseUrlListFile(JSON.stringify({ urls: ['https://www.superdelivery.com/p/do/dpsl/1/'] })), /형식 오류/);
  assert.throws(() => parseUrlListFile('{}'), /형식 오류/);
});

test('sdIdFromUrl extracts the product id', () => {
  assert.equal(sdIdFromUrl(U(17799960)), '17799960');
  assert.equal(sdIdFromUrl('https://www.superdelivery.com/p/do/dpsl/204961/'), null);
});
