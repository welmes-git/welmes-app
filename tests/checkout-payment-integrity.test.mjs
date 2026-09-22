// Regression tests for the checks that did not exist when the browser owned the
// payment flow: nothing verified the captured amount, the currency, or that the
// capture belonged to the order being fulfilled.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAYPAL_CURRENCIES,
  FALLBACK_RATES,
  currencyDecimals,
  resolveChargeCurrency,
  fetchRates,
  computeCharge,
  parseOrderRequest,
  verifyCapture,
  classifyError,
} from '../server/payments.mjs';

const captureBody = ({ amount, currency = 'USD', status = 'COMPLETED', customId = 'ORD-20260922-AB12C' }) => ({
  id: 'PAYPAL-ORDER-1',
  purchase_units: [{
    custom_id: customId,
    payments: { captures: [{ id: 'CAP-1', status, amount: { value: String(amount), currency_code: currency } }] },
  }],
});

const expected = { amount: 123.45, currency: 'USD', orderId: 'ORD-20260922-AB12C' };

test('currency support matches what PayPal can settle', () => {
  assert.deepEqual(PAYPAL_CURRENCIES, ['JPY', 'USD', 'EUR', 'GBP', 'SGD', 'AUD']);
  // KRW/CNY have rates for display but PayPal cannot charge them
  assert.equal(resolveChargeCurrency('KRW'), 'JPY');
  assert.equal(resolveChargeCurrency('CNY'), 'JPY');
  assert.equal(resolveChargeCurrency('usd'), 'USD');
  assert.equal(resolveChargeCurrency(undefined), 'JPY');
  assert.equal(currencyDecimals('JPY'), 0);
  assert.equal(currencyDecimals('USD'), 2);
});

test('charge amount is rounded to the currency precision PayPal accepts', () => {
  const usd = computeCharge(100000, 'USD', { USD: 0.0067 });
  assert.equal(usd.value, '670.00');
  assert.equal(usd.currency, 'USD');
  assert.equal(usd.rate, 0.0067);

  // JPY is zero-decimal: "670.00" is rejected by PayPal
  const jpy = computeCharge(100000, 'JPY', { JPY: 1 });
  assert.equal(jpy.value, '100000');
  assert.equal(jpy.decimals, 0);
});

test('a non-positive total or rate can never become a charge', () => {
  assert.throws(() => computeCharge(0, 'USD', { USD: 0.0067 }), /INVALID_TOTAL/);
  assert.throws(() => computeCharge(-10, 'USD', { USD: 0.0067 }), /INVALID_TOTAL/);
  assert.throws(() => computeCharge(1000, 'USD', { USD: 0 }), /INVALID_FX_RATE/);
  assert.throws(() => computeCharge(1000, 'USD', { USD: -1 }), /INVALID_FX_RATE/);
});

test('fx fallback is reported as stale instead of silently charging an old rate', async () => {
  const failing = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const stale = await fetchRates(failing);
  assert.equal(stale.stale, true);
  assert.deepEqual(stale.rates, FALLBACK_RATES);

  const live = await fetchRates(async () => ({ ok: true, json: async () => ({ rates: { USD: 0.007 } }) }));
  assert.equal(live.stale, false);
  assert.equal(live.rates.USD, 0.007);
  assert.equal(live.rates.JPY, 1, 'JPY base must always be present');
});

test('order requests carry ids and quantities only — never prices', () => {
  const parsed = parseOrderRequest({
    items: [{ product_id: 7, quantity: 2, set_option_id: 'SET-A', wholesalePrice: 1 }],
    shipping: {
      company: 'ACME', recipient: 'Kim', phone: '+82-10-0000-0000',
      addressLine1: '1 Teheran-ro', city: 'Seoul', zipCode: '06236', country: 'South Korea',
    },
    subtotal: 1, vat: 0, total: 1, // forged money fields must be dropped
  });
  assert.deepEqual(parsed.items, [{ product_id: 7, quantity: 2, set_option_id: 'SET-A' }]);
  assert.equal('subtotal' in parsed, false);
  assert.equal('total' in parsed, false);
});

test('malformed carts and addresses are rejected before reaching the database', () => {
  const shipping = {
    company: 'ACME', recipient: 'Kim', phone: '+82', addressLine1: 'a',
    city: 'Seoul', zipCode: '06236', country: 'South Korea',
  };
  assert.throws(() => parseOrderRequest({ items: [], shipping }), /EMPTY_CART/);
  assert.throws(() => parseOrderRequest({ items: [{ product_id: 1, quantity: 0 }], shipping }), /INVALID_QUANTITY/);
  assert.throws(() => parseOrderRequest({ items: [{ product_id: 1, quantity: 10001 }], shipping }), /INVALID_QUANTITY/);
  assert.throws(() => parseOrderRequest({ items: [{ product_id: 1.5, quantity: 1 }], shipping }), /INVALID_PRODUCT_ID/);
  assert.throws(() => parseOrderRequest({ items: [{ product_id: 1, quantity: 1 }] }), /INVALID_SHIPPING/);
  assert.throws(
    () => parseOrderRequest({ items: [{ product_id: 1, quantity: 1 }], shipping: { ...shipping, city: ' ' } }),
    /INVALID_SHIPPING/,
  );
  assert.throws(
    () => parseOrderRequest({ items: Array.from({ length: 201 }, () => ({ product_id: 1, quantity: 1 })), shipping }),
    /TOO_MANY_LINES/,
  );
});

test('a capture for the full quoted amount in the quoted currency passes', () => {
  const result = verifyCapture(captureBody({ amount: '123.45' }), expected);
  assert.equal(result.ok, true);
  assert.equal(result.captureId, 'CAP-1');
  assert.equal(result.paidAmount, 123.45);
  assert.equal(result.paidCurrency, 'USD');
});

test('underpayment is a failed payment, not a discount', () => {
  // This is the exact attack the old client-side flow allowed: edit the amount
  // in the browser, pay one cent, receive the goods.
  const underpaid = verifyCapture(captureBody({ amount: '0.01' }), expected);
  assert.equal(underpaid.ok, false);
  assert.match(underpaid.reason, /AMOUNT_MISMATCH/);

  const short = verifyCapture(captureBody({ amount: '123.44' }), expected);
  assert.equal(short.ok, false, 'a one-cent shortfall must still fail');
  assert.match(short.reason, /AMOUNT_MISMATCH/);
});

test('overpayment and wrong currency are rejected too', () => {
  const over = verifyCapture(captureBody({ amount: '200.00' }), expected);
  assert.equal(over.ok, false);
  assert.match(over.reason, /AMOUNT_MISMATCH/);

  // 123.45 JPY is worth far less than 123.45 USD
  const wrongCurrency = verifyCapture(captureBody({ amount: '123.45', currency: 'JPY' }), expected);
  assert.equal(wrongCurrency.ok, false);
  assert.match(wrongCurrency.reason, /CURRENCY_MISMATCH/);
});

test('a capture belonging to another order cannot be replayed onto this one', () => {
  const foreign = verifyCapture(captureBody({ amount: '123.45', customId: 'ORD-20260922-ZZZZZ' }), expected);
  assert.equal(foreign.ok, false);
  assert.match(foreign.reason, /ORDER_MISMATCH/);
});

test('only COMPLETED captures count as paid', () => {
  for (const status of ['PENDING', 'DECLINED', 'FAILED']) {
    const result = verifyCapture(captureBody({ amount: '123.45', status }), expected);
    assert.equal(result.ok, false, `${status} must not be treated as paid`);
    assert.match(result.reason, /CAPTURE_NOT_COMPLETED/);
  }
  const empty = verifyCapture({ purchase_units: [{}] }, expected);
  assert.equal(empty.ok, false);
  assert.equal(empty.reason, 'NO_CAPTURE_IN_RESPONSE');
});

test('JPY captures are compared without decimals', () => {
  const jpyExpected = { amount: 110000, currency: 'JPY', orderId: 'ORD-20260922-AB12C' };
  assert.equal(verifyCapture(captureBody({ amount: '110000', currency: 'JPY' }), jpyExpected).ok, true);
  assert.equal(verifyCapture(captureBody({ amount: '109999', currency: 'JPY' }), jpyExpected).ok, false);
});

test('errors map to buyer-facing codes with sane HTTP statuses', () => {
  assert.deepEqual(classifyError('INSUFFICIENT_STOCK:42'), { status: 409, code: 'INSUFFICIENT_STOCK' });
  assert.deepEqual(classifyError('PRODUCT_INACTIVE:9'), { status: 409, code: 'INSUFFICIENT_STOCK' });
  assert.deepEqual(classifyError('MEMBER_NOT_APPROVED'), { status: 403, code: 'MEMBER_NOT_APPROVED' });
  assert.deepEqual(classifyError('NOT_AUTHENTICATED'), { status: 401, code: 'NOT_AUTHENTICATED' });
  assert.deepEqual(classifyError('AMOUNT_MISMATCH:1!=2'), { status: 409, code: 'PAYMENT_VERIFICATION_FAILED' });
  assert.deepEqual(classifyError('something odd'), { status: 500, code: 'ORDER_FAILED' });
});
