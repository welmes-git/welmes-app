// WELMES — payment math and verification, kept free of I/O so it is testable
// and so api/paypal.ts contains nothing but transport.
//
// Everything money-related that used to live in the browser lives here:
// choosing the charge currency, converting the JPY total, and deciding whether
// a PayPal capture actually paid for the order we created.

/** PayPal cannot settle KRW/CNY; those buyers are charged in JPY. */
export const PAYPAL_CURRENCIES = ['JPY', 'USD', 'EUR', 'GBP', 'SGD', 'AUD'];

/** Zero-decimal currencies — PayPal rejects "100.00" for JPY. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'CNY']);

/** Mirrors FALLBACK_RATES in src/lib/currency.ts (JPY base). */
export const FALLBACK_RATES = {
  JPY: 1,
  USD: 0.0067,
  EUR: 0.0062,
  GBP: 0.0053,
  CNY: 0.049,
  KRW: 9.05,
  SGD: 0.0091,
  AUD: 0.0104,
};

export const currencyDecimals = (code) => (ZERO_DECIMAL.has(String(code).toUpperCase()) ? 0 : 2);

/** Falls back to JPY for anything PayPal will not settle. */
export function resolveChargeCurrency(requested) {
  const code = String(requested || '').toUpperCase();
  return PAYPAL_CURRENCIES.includes(code) ? code : 'JPY';
}

/**
 * Fetch ECB rates (JPY base). Unlike the browser path this never silently
 * charges on a stale rate: `stale: true` is reported so the caller can decide.
 */
export async function fetchRates(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('https://api.frankfurter.app/latest?from=JPY');
    if (!res.ok) throw new Error(`rates HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.rates || typeof data.rates !== 'object') throw new Error('rates payload');
    return { rates: { JPY: 1, ...data.rates }, stale: false };
  } catch {
    return { rates: { ...FALLBACK_RATES }, stale: true };
  }
}

/**
 * Convert a JPY total into the charge currency and round it the way PayPal
 * expects. The rate is returned so it can be frozen onto the order.
 */
export function computeCharge(totalJPY, currency, rates) {
  const code = resolveChargeCurrency(currency);
  const rate = Number(rates?.[code] ?? FALLBACK_RATES[code] ?? 1);
  if (!Number.isFinite(totalJPY) || totalJPY <= 0) throw new Error('INVALID_TOTAL');
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('INVALID_FX_RATE');
  const decimals = currencyDecimals(code);
  const factor = 10 ** decimals;
  const amount = Math.round(totalJPY * rate * factor) / factor;
  if (amount <= 0) throw new Error('INVALID_CHARGE_AMOUNT');
  return { currency: code, amount, rate, decimals, value: amount.toFixed(decimals) };
}

/** Reject junk before it reaches the RPC; money fields are deliberately ignored. */
export function parseOrderRequest(body) {
  const rawItems = Array.isArray(body?.items) ? body.items : null;
  if (!rawItems || rawItems.length === 0) throw new Error('EMPTY_CART');
  if (rawItems.length > 200) throw new Error('TOO_MANY_LINES');

  const items = rawItems.map((item) => {
    const productId = Number(item?.product_id ?? item?.productId);
    const quantity = Number(item?.quantity);
    if (!Number.isInteger(productId) || productId <= 0) throw new Error('INVALID_PRODUCT_ID');
    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 10000) throw new Error('INVALID_QUANTITY');
    const setOptionId = item?.set_option_id ?? item?.setOptionId ?? null;
    return {
      product_id: productId,
      quantity,
      set_option_id: setOptionId ? String(setOptionId).slice(0, 64) : null,
    };
  });

  const s = body?.shipping;
  if (!s || typeof s !== 'object') throw new Error('INVALID_SHIPPING');
  const text = (v, max = 200) => String(v ?? '').trim().slice(0, max);
  const shipping = {
    company: text(s.company),
    recipient: text(s.recipient),
    phone: text(s.phone, 40),
    addressLine1: text(s.addressLine1, 300),
    addressLine2: text(s.addressLine2, 300),
    city: text(s.city, 120),
    state: text(s.state, 120),
    zipCode: text(s.zipCode, 40),
    country: text(s.country, 120),
  };
  for (const field of ['company', 'recipient', 'phone', 'addressLine1', 'city', 'zipCode', 'country']) {
    if (!shipping[field]) throw new Error('INVALID_SHIPPING');
  }

  return {
    items,
    shipping,
    poNumber: text(body?.poNumber, 80) || null,
    notes: text(body?.notes, 2000) || null,
    displayCurrency: resolveChargeCurrency(body?.displayCurrency),
    idempotencyKey: text(body?.idempotencyKey, 80) || null,
  };
}

/**
 * The check that was missing entirely: does this capture pay for THIS order,
 * in full, in the currency we quoted?
 *
 * `expected` comes from the order row (charge_amount/charge_currency frozen at
 * order time), never from the request.
 */
export function verifyCapture(captureBody, expected) {
  const unit = captureBody?.purchase_units?.[0];
  const capture = unit?.payments?.captures?.[0];

  // Every branch returns the same shape so callers can read paidAmount/
  // paidCurrency without narrowing on `ok` first.
  const base = { ok: false, reason: null, captureId: null, paidAmount: 0, paidCurrency: '' };
  const fail = (reason, extra = {}) => ({ ...base, ...extra, ok: false, reason });

  if (!capture) return fail('NO_CAPTURE_IN_RESPONSE');

  const paidAmount = Number(capture.amount?.value);
  const paidCurrency = String(capture.amount?.currency_code || '').toUpperCase();
  const seen = {
    captureId: capture.id ?? null,
    paidAmount: Number.isFinite(paidAmount) ? paidAmount : 0,
    paidCurrency,
  };

  const status = String(capture.status || '').toUpperCase();
  if (status !== 'COMPLETED') return fail(`CAPTURE_NOT_COMPLETED:${status}`, seen);

  const expectedCurrency = String(expected?.currency || '').toUpperCase();
  const expectedAmount = Number(expected?.amount);

  // custom_id ties the PayPal order back to our order id, so a capture from a
  // different (cheaper) PayPal order cannot be replayed against this one.
  const customId = unit?.custom_id;
  if (expected?.orderId && customId && String(customId) !== String(expected.orderId)) {
    return fail(`ORDER_MISMATCH:${customId}`, seen);
  }
  if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
    return fail('INVALID_PAID_AMOUNT', seen);
  }
  if (paidCurrency !== expectedCurrency) {
    return fail(`CURRENCY_MISMATCH:${paidCurrency}!=${expectedCurrency}`, seen);
  }
  // Exact match after rounding to the currency's precision — an underpayment of
  // any size is a failed payment, not a discount.
  const decimals = currencyDecimals(expectedCurrency);
  const round = (n) => Number(n.toFixed(decimals));
  if (round(paidAmount) !== round(expectedAmount)) {
    return fail(`AMOUNT_MISMATCH:${paidAmount}!=${expectedAmount}`, seen);
  }
  return { ...base, ...seen, ok: true, reason: null };
}

/** Maps RPC/verification errors to a buyer-facing i18n key + HTTP status. */
export function classifyError(message) {
  const m = String(message || '');
  if (m.includes('INSUFFICIENT_STOCK') || m.includes('PRODUCT_NOT_FOUND') || m.includes('PRODUCT_INACTIVE')) {
    return { status: 409, code: 'INSUFFICIENT_STOCK' };
  }
  if (m.includes('MEMBER_NOT_APPROVED')) return { status: 403, code: 'MEMBER_NOT_APPROVED' };
  if (m.includes('NOT_AUTHENTICATED')) return { status: 401, code: 'NOT_AUTHENTICATED' };
  if (m.includes('EMPTY_CART')) return { status: 400, code: 'EMPTY_CART' };
  if (m.includes('INVALID_SHIPPING')) return { status: 400, code: 'INVALID_SHIPPING' };
  if (m.includes('AMOUNT_MISMATCH') || m.includes('CURRENCY_MISMATCH') || m.includes('ORDER_MISMATCH')) {
    return { status: 409, code: 'PAYMENT_VERIFICATION_FAILED' };
  }
  return { status: 500, code: 'ORDER_FAILED' };
}
