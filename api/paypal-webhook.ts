// WELMES — PayPal webhook receiver.
//
// The capture is synchronous, so payment itself was covered. What happens after it
// was not: a refund issued from the PayPal dashboard, a capture reversed or denied
// once settled, or a buyer opening a dispute all occur on PayPal's side and never
// ran any of our code. Orders stayed `paid` and kept their place in the fulfilment
// queue, so goods could ship for money we no longer held.
//
// Two things make this endpoint safe to expose:
//
//   1. SIGNATURE VERIFICATION. This URL is public and unauthenticated by
//      necessity. Without verification anyone could POST
//      {"event_type":"PAYMENT.CAPTURE.REFUNDED", ...} and cancel orders or restore
//      stock at will. Every request is checked against
//      /v1/notifications/verify-webhook-signature before it is read, and a request
//      that fails is answered 401 without touching the database.
//
//   2. IDEMPOTENCY. PayPal retries a delivery until it receives a 2xx, so repeats
//      are normal rather than exceptional. `claim_webhook_event` inserts the event
//      id as a primary key and reports whether this delivery is the first; a replay
//      returns 200 and does nothing. Replaying a refund would otherwise restore
//      stock twice.
//
// Env: PAYPAL_WEBHOOK_ID (from the PayPal dashboard where the webhook is
//      registered), plus the PayPal and service-role credentials used elsewhere.
import { createClient } from '@supabase/supabase-js';
import { interpretEvent, eventId } from '../server/webhook.mjs';

const env = (...keys: string[]): string => {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return '';
};

const PAYPAL_BASE = () =>
  env('PAYPAL_ENV') === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

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
  if (!res.ok) throw new Error(`PAYPAL_AUTH_FAILED:${res.status}`);
  return (body as { access_token: string }).access_token;
}

function admin() {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('SERVICE_ROLE_NOT_CONFIGURED');
  return createClient(env('SUPABASE_URL', 'VITE_SUPABASE_URL'), key, { auth: { persistSession: false } });
}

/**
 * Ask PayPal whether they sent this. The raw body must be passed through
 * unmodified — verification is over the exact bytes, so re-serialising a parsed
 * object changes key order or spacing and the signature stops matching.
 */
async function verifySignature(headers: Headers, rawBody: string): Promise<boolean> {
  const webhookId = env('PAYPAL_WEBHOOK_ID');
  if (!webhookId) throw new Error('WEBHOOK_ID_NOT_CONFIGURED');

  const required = {
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_time: headers.get('paypal-transmission-time'),
    cert_url: headers.get('paypal-cert-url'),
    auth_algo: headers.get('paypal-auth-algo'),
    transmission_sig: headers.get('paypal-transmission-sig'),
  };
  // A caller forging an event would not have these at all.
  if (Object.values(required).some((v) => !v)) return false;

  const res = await fetch(`${PAYPAL_BASE()}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await paypalToken()}`,
      'content-type': 'application/json',
    },
    body: `{"transmission_id":${JSON.stringify(required.transmission_id)},`
      + `"transmission_time":${JSON.stringify(required.transmission_time)},`
      + `"cert_url":${JSON.stringify(required.cert_url)},`
      + `"auth_algo":${JSON.stringify(required.auth_algo)},`
      + `"transmission_sig":${JSON.stringify(required.transmission_sig)},`
      + `"webhook_id":${JSON.stringify(webhookId)},`
      // Interpolated rather than assembled by JSON.stringify so the body PayPal
      // signed is the body PayPal re-hashes.
      + `"webhook_event":${rawBody}}`,
  });
  const body = await res.json().catch(() => ({}));
  return res.ok && String((body as { verification_status?: string }).verification_status) === 'SUCCESS';
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);

  const rawBody = await request.text();
  if (!rawBody) return json({ code: 'EMPTY_BODY' }, 400);

  let verified: boolean;
  try {
    verified = await verifySignature(request.headers, rawBody);
  } catch (error) {
    const message = (error as Error).message;
    // Misconfiguration, not a bad request. Answering non-2xx makes PayPal retry,
    // so the event is not lost once the variable is set.
    return json({ code: 'SERVER_ERROR', detail: message }, 503);
  }
  if (!verified) {
    // Nothing has been parsed or written at this point.
    return json({ code: 'INVALID_SIGNATURE' }, 401);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ code: 'INVALID_JSON' }, 400);
  }

  const id = eventId(event);
  // Without an id we cannot de-duplicate, and PayPal will retry: acting would risk
  // restoring stock repeatedly.
  if (!id) return json({ code: 'MISSING_EVENT_ID' }, 400);

  const decision = interpretEvent(event);
  const supabase = admin();

  const { data: claimed, error: claimError } = await supabase.rpc('claim_webhook_event', {
    p_event_id: id,
    p_event_type: String(event.event_type ?? ''),
    p_order_id: decision.orderId ?? null,
    p_payload: event,
  });
  if (claimError) return json({ code: 'SERVER_ERROR', detail: claimError.message }, 500);
  if (claimed === false) {
    // Already handled. 200 so PayPal stops retrying.
    return json({ ok: true, duplicate: true, eventId: id });
  }

  const finish = async (outcome: string, extra: Record<string, unknown> = {}) => {
    await supabase.rpc('record_webhook_outcome', { p_event_id: id, p_outcome: outcome });
    return json({ ok: true, eventId: id, outcome, ...extra });
  };

  try {
    if (decision.action === 'ignore') {
      return await finish(decision.reason ?? 'ignored');
    }

    if (decision.action === 'refund') {
      const { data, error } = await supabase.rpc('refund_order', {
        p_reference: decision.reference,
        p_amount: decision.amount,
        p_reason: decision.reason,
        p_order_id: decision.orderId,
      });
      if (error) return json({ code: 'SERVER_ERROR', detail: error.message }, 500);
      const row = (data ?? {}) as Record<string, unknown>;
      // An unmatched reference is recorded, not retried: PayPal would redeliver
      // forever, and the real fix is a human looking at why nothing matched.
      return await finish(
        row.matched ? (row.already_refunded ? 'already_refunded' : 'refunded') : 'no_matching_order',
        { orderId: row.order_id ?? null },
      );
    }

    if (decision.action === 'dispute') {
      const { data, error } = await supabase.rpc('flag_order_dispute', {
        p_reference: decision.reference,
        p_status: decision.disputeStatus,
        p_reason: decision.reason,
        p_order_id: decision.orderId,
      });
      if (error) return json({ code: 'SERVER_ERROR', detail: error.message }, 500);
      const row = (data ?? {}) as Record<string, unknown>;
      return await finish(
        row.matched ? `dispute_${decision.disputeStatus}` : 'no_matching_order',
        { orderId: row.order_id ?? null },
      );
    }

    return await finish('unknown_action');
  } catch (error) {
    return json({ code: 'SERVER_ERROR', detail: (error as Error).message }, 500);
  }
}

// Node-style (req, res) and Web-style (Request) invocations are both supported,
// for the same reason api/ssr.ts does it: Vercel may use either.
type NodeReq = { url?: string; method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown };
type NodeRes = { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void };

export default async function handler(a: Request | NodeReq, b?: NodeRes): Promise<Response | void> {
  if (b && typeof b.end === 'function') {
    const req = a as NodeReq;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value) && value[0]) headers.set(key, value[0]);
    }
    // Vercel may hand over an already-parsed body. Re-serialising changes the bytes
    // PayPal signed, so verification would fail — `bodyParser: false` in the config
    // below keeps it raw, and this is the fallback if that ever stops applying.
    const raw = typeof req.body === 'string'
      ? req.body
      : req.body === undefined || req.body === null ? '' : JSON.stringify(req.body);
    const request = new Request(`https://internal.invalid${req.url || '/api/paypal-webhook'}`, {
      method: (req.method || 'POST').toUpperCase(),
      headers,
      body: raw,
    });
    const response = await handle(request);
    b.statusCode = response.status;
    response.headers.forEach((value, key) => b.setHeader(key, value));
    b.end(await response.text());
    return;
  }
  return handle(a as Request);
}

// Signature verification hashes the exact bytes PayPal sent, so the body must not
// be parsed before we see it.
export const config = { api: { bodyParser: false } };
