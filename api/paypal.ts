// WELMES — PayPal order creation and capture, server-side.
//
// Why this file exists: the checkout used to call `actions.order.create()` with
// a browser-computed `amount.value` and `actions.order.capture()` straight from
// the page. Nothing ever compared the captured money to the order, so editing
// the amount in DevTools bought goods for one yen. The client secret also can
// never reach the browser, so capture must happen here.
//
// Flow (order first, money second — deliberately):
//   POST /api/paypal?action=create
//     1. Verify the caller's Supabase session.
//     2. `place_order` RPC re-prices the cart, reserves stock and freezes the
//        charge currency/amount on the order row.
//     3. Create the PayPal order for exactly that frozen amount, with
//        custom_id = our order id.
//   POST /api/paypal?action=capture
//     4. Capture, then verify amount + currency + custom_id against the row.
//     5. Match  → mark_order_paid. Declined → cancel_unpaid_order (stock comes
//        back, buyer was never charged). Mismatch → refund + flag for review.
//
// Because the order (and its stock reservation) exists before the PayPal window
// opens, a sell-out mid-payment is now impossible — the old code captured money
// and only then discovered the stock was gone.
//
// Env: PAYPAL_CLIENT_ID (or VITE_PAYPAL_CLIENT_ID), PAYPAL_CLIENT_SECRET,
//      PAYPAL_ENV=sandbox|live, SUPABASE_URL (or VITE_SUPABASE_URL),
//      SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY), SUPABASE_SERVICE_ROLE_KEY.
import { createClient } from '@supabase/supabase-js';
import {
  parseOrderRequest,
  fetchRates,
  currencyDecimals,
  verifyCapture,
  classifyError,
} from '../server/payments.mjs';

const env = (...keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
};

const PAYPAL_BASE = () =>
  env('PAYPAL_ENV') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

type Json = Record<string, unknown>;

function json(body: Json, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ── PayPal REST ────────────────────────────────────────────────────────────
async function paypalToken(): Promise<string> {
  const id = env('PAYPAL_CLIENT_ID', 'VITE_PAYPAL_CLIENT_ID');
  const secret = env('PAYPAL_CLIENT_SECRET');
  if (!id || !secret) throw new Error('PAYPAL_NOT_CONFIGURED');
  const res = await fetch(`${PAYPAL_BASE()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PAYPAL_AUTH_FAILED:${res.status}:${JSON.stringify(body)}`);
  return (body as { access_token: string }).access_token;
}

async function paypalCall(token: string, path: string, init: RequestInit = {}): Promise<Json> {
  const res = await fetch(`${PAYPAL_BASE()}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const err = new Error(`PAYPAL_HTTP_${res.status}:${JSON.stringify(body)}`);
    (err as Error & { body?: Json }).body = body;
    throw err;
  }
  return body;
}

// ── Supabase ───────────────────────────────────────────────────────────────
/** Acts AS the buyer, so `auth.uid()` inside place_order resolves to them. */
function userClient(accessToken: string) {
  return createClient(
    env('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    env('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: `Bearer ${accessToken}` } }, auth: { persistSession: false } },
  );
}

/** Settlement functions are granted to service_role only. */
function adminClient() {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('SERVICE_ROLE_NOT_CONFIGURED');
  return createClient(env('SUPABASE_URL', 'VITE_SUPABASE_URL'), key, { auth: { persistSession: false } });
}

function bearer(req: Request): string {
  const header = req.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

// ── Actions ────────────────────────────────────────────────────────────────
async function createOrder(req: Request): Promise<Response> {
  const token = bearer(req);
  if (!token) return json({ code: 'NOT_AUTHENTICATED' }, 401);

  let payload;
  try {
    payload = parseOrderRequest(await req.json());
  } catch (error) {
    const { status, code } = classifyError((error as Error).message);
    return json({ code }, status === 500 ? 400 : status);
  }

  // The rate is fetched here, never accepted from the client, and is frozen on
  // the order so the amount cannot drift between quote and capture. The RPC
  // computes the actual amount from its own re-priced total.
  const { rates, stale } = await fetchRates();
  const chargeCurrency = payload.displayCurrency;
  const fxRate = Number(rates[chargeCurrency] ?? 0);
  if (!Number.isFinite(fxRate) || fxRate <= 0) {
    return json({ code: 'FX_UNAVAILABLE', detail: `no rate for ${chargeCurrency}` }, 503);
  }
  const supabase = userClient(token);

  const { data, error } = await supabase.rpc('place_order', {
    p_items: payload.items,
    p_shipping: payload.shipping,
    p_payment_method: 'paypal',
    p_po_number: payload.poNumber,
    p_notes: payload.notes,
    p_charge_currency: chargeCurrency,
    p_fx_rate: fxRate,
    p_idempotency_key: payload.idempotencyKey,
  });
  if (error) {
    const { status, code } = classifyError(error.message);
    return json({ code, detail: error.message }, status);
  }

  const order = data as {
    order_id: string;
    total: number;
    subtotal: number;
    vat: number;
    charge_currency: string;
    charge_amount: number;
    reused: boolean;
  };

  // Amount sent to PayPal comes from the DB row, not from the request body.
  const decimals = currencyDecimals(String(order.charge_currency));
  const value = Number(order.charge_amount).toFixed(decimals);

  try {
    const paypalOrder = await paypalCall(await paypalToken(), '/v2/checkout/orders', {
      method: 'POST',
      headers: { 'PayPal-Request-Id': order.order_id },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: order.order_id,
          custom_id: order.order_id,
          invoice_id: order.order_id,
          description: `WELMES order ${order.order_id}`,
          amount: { currency_code: order.charge_currency, value },
        }],
        application_context: { shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW' },
      }),
    });

    return json({
      paypalOrderId: paypalOrder.id,
      orderId: order.order_id,
      subtotal: Number(order.subtotal),
      vat: Number(order.vat),
      total: Number(order.total),
      chargeCurrency: order.charge_currency,
      chargeAmount: Number(order.charge_amount),
      fxStale: stale,
    });
  } catch (error) {
    // PayPal never got the order: release the stock we just reserved instead of
    // leaving a dead reservation behind.
    try {
      await adminClient().rpc('cancel_unpaid_order', {
        p_order_id: order.order_id,
        p_reason: `paypal create failed: ${(error as Error).message}`.slice(0, 480),
      });
    } catch { /* surfaced via the response below */ }
    return json({ code: 'PAYPAL_UNAVAILABLE', detail: (error as Error).message }, 502);
  }
}

async function captureOrder(req: Request): Promise<Response> {
  const token = bearer(req);
  if (!token) return json({ code: 'NOT_AUTHENTICATED' }, 401);

  const body = (await req.json().catch(() => ({}))) as { paypalOrderId?: string; orderId?: string };
  const paypalOrderId = String(body.paypalOrderId || '').trim();
  const orderId = String(body.orderId || '').trim();
  if (!paypalOrderId || !orderId) return json({ code: 'INVALID_REQUEST' }, 400);

  // Read the expected amount through the buyer's own client: RLS guarantees they
  // can only settle an order that belongs to them.
  const supabase = userClient(token);
  const { data: order, error: readErr } = await supabase
    .from('orders')
    .select('id, charge_amount, charge_currency, payment_status, total, subtotal, vat')
    .eq('id', orderId)
    .maybeSingle();
  if (readErr || !order) return json({ code: 'ORDER_NOT_FOUND' }, 404);
  if (order.payment_status === 'paid') {
    return json({ orderId: order.id, alreadyPaid: true, total: Number(order.total) });
  }

  const admin = adminClient();
  let capture: Json;
  try {
    capture = await paypalCall(await paypalToken(), `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: 'POST',
      headers: { 'PayPal-Request-Id': `cap-${orderId}` },
      body: '{}',
    });
  } catch (error) {
    // Declined / abandoned: no money moved, so give the stock back.
    await admin.rpc('fail_order_payment', { p_order_id: orderId, p_reason: (error as Error).message.slice(0, 480) });
    await admin.rpc('cancel_unpaid_order', { p_order_id: orderId, p_reason: 'paypal capture failed' });
    return json({ code: 'CAPTURE_FAILED', detail: (error as Error).message }, 402);
  }

  const result = verifyCapture(capture, {
    amount: Number(order.charge_amount),
    currency: order.charge_currency,
    orderId: order.id,
  });

  if (!result.ok) {
    // Money may have moved for the wrong amount. Never fulfil, never silently
    // keep it: attempt a refund and leave a flagged row for manual review.
    let refunded = false;
    if (result.captureId) {
      try {
        await paypalCall(await paypalToken(), `/v2/payments/captures/${encodeURIComponent(result.captureId)}/refund`, {
          method: 'POST',
          body: JSON.stringify({ note_to_payer: `WELMES order ${orderId} could not be verified` }),
        });
        refunded = true;
      } catch { /* reported below; the flagged row is the durable record */ }
    }
    await admin.rpc('fail_order_payment', {
      p_order_id: orderId,
      p_reason: `${result.reason}${refunded ? ' (refunded)' : ' (REFUND FAILED — manual review)'}`,
      p_reference: result.captureId ?? null,
    });
    if (refunded) {
      await admin.rpc('cancel_unpaid_order', { p_order_id: orderId, p_reason: result.reason });
    }
    return json({ code: 'PAYMENT_VERIFICATION_FAILED', reason: result.reason, refunded }, 409);
  }

  const { error: payErr } = await admin.rpc('mark_order_paid', {
    p_order_id: orderId,
    p_reference: result.captureId,
    p_amount: result.paidAmount,
    p_currency: result.paidCurrency,
  });
  if (payErr) {
    const { status, code } = classifyError(payErr.message);
    return json({ code, detail: payErr.message }, status);
  }

  return json({
    orderId: order.id,
    captureId: result.captureId,
    subtotal: Number(order.subtotal),
    vat: Number(order.vat),
    total: Number(order.total),
    chargeCurrency: order.charge_currency,
    chargeAmount: Number(order.charge_amount),
    alreadyPaid: false,
  });
}

// ── Entry point ────────────────────────────────────────────────────────────
// Node-style (req, res) and Web-style (Request) invocations are both supported,
// for the same reason api/ssr.ts does it: Vercel may use either.
type NodeReq = { url?: string; method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type NodeRes = { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void };

async function route(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
  const action = new URL(request.url).searchParams.get('action') || '';
  try {
    if (action === 'create') return await createOrder(request);
    if (action === 'capture') return await captureOrder(request);
    return json({ code: 'UNKNOWN_ACTION' }, 404);
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    const status = message.includes('NOT_CONFIGURED') ? 503 : 500;
    return json({ code: 'SERVER_ERROR', detail: message }, status);
  }
}

export default async function handler(a: Request | NodeReq, b?: NodeRes): Promise<Response | void> {
  if (b && typeof b.end === 'function') {
    const req = a as NodeReq;
    const res = b;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value) && value[0]) headers.set(key, value[0]);
    }
    // Node handlers may have already parsed the body; re-serialise it so the
    // Web-style code path can read it uniformly.
    const rawBody = req.body === undefined || req.body === null
      ? undefined
      : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const request = new Request(`https://internal.invalid${req.url || '/api/paypal'}`, {
      method: (req.method || 'POST').toUpperCase(),
      headers,
      body: ['GET', 'HEAD'].includes((req.method || 'POST').toUpperCase()) ? undefined : rawBody ?? '{}',
    });
    const response = await route(request);
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
    return;
  }
  return route(a as Request);
}
