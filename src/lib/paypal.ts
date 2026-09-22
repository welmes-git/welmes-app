// WELMES — browser side of the PayPal flow.
//
// The browser no longer creates or captures PayPal orders itself. It asks
// /api/paypal to do both, because only the server can (a) hold the client
// secret, (b) price the cart from the database, and (c) compare the captured
// money against the order. Everything here is transport: ids in, ids out, no
// amounts sent.
import { supabase } from './supabase';
import type { CartItem, ShippingAddress } from '../store/useStore';
import { toOrderLines } from './db';

export interface PayPalCreateResult {
  paypalOrderId: string;
  orderId: string;
  subtotal: number;
  vat: number;
  total: number;
  chargeCurrency: string;
  chargeAmount: number;
  /** True when the server had to fall back to hardcoded FX rates. */
  fxStale?: boolean;
}

export interface PayPalCaptureResult {
  orderId: string;
  captureId?: string;
  subtotal: number;
  vat: number;
  total: number;
  chargeCurrency: string;
  chargeAmount: number;
  alreadyPaid: boolean;
}

/** Carries the server's machine-readable `code` so the UI can pick an i18n key. */
export class PaymentError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'PaymentError';
    this.code = code;
    this.status = status;
  }
}

async function call<T>(action: 'create' | 'capture', body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new PaymentError('NOT_AUTHENTICATED', 401);

  const res = await fetch(`/api/paypal?action=${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { /* non-JSON error page */ }

  if (!res.ok) {
    throw new PaymentError(
      String(payload.code || 'PAYMENT_ENDPOINT_UNAVAILABLE'),
      res.status,
      String(payload.detail ?? payload.reason ?? text.slice(0, 200)),
    );
  }
  return payload as T;
}

/**
 * Reserves stock, writes the order with server-computed totals, and returns the
 * PayPal order id to hand to the SDK. The order exists before the PayPal window
 * opens, so a sell-out mid-payment can no longer take money for nothing.
 */
export function createPayPalOrder(input: {
  items: CartItem[];
  shipping: ShippingAddress;
  poNumber?: string;
  notes?: string;
  displayCurrency: string;
  idempotencyKey: string;
}): Promise<PayPalCreateResult> {
  return call<PayPalCreateResult>('create', {
    items: toOrderLines(input.items),
    shipping: input.shipping,
    poNumber: input.poNumber ?? null,
    notes: input.notes ?? null,
    displayCurrency: input.displayCurrency,
    idempotencyKey: input.idempotencyKey,
  });
}

/** Captures and verifies. On any failure the server releases the reservation. */
export function capturePayPalOrder(paypalOrderId: string, orderId: string): Promise<PayPalCaptureResult> {
  return call<PayPalCaptureResult>('capture', { paypalOrderId, orderId });
}

/** Maps a server error code onto a translation key in `checkout.*`. */
export function paymentErrorKey(error: unknown): string {
  const code = error instanceof PaymentError ? error.code : '';
  switch (code) {
    case 'INSUFFICIENT_STOCK':
      return 'checkout.insufficientStock';
    case 'MEMBER_NOT_APPROVED':
      return 'checkout.memberNotApproved';
    case 'NOT_AUTHENTICATED':
      return 'checkout.loginRequired';
    case 'INVALID_SHIPPING':
      return 'checkout.orderFailed';
    case 'PAYMENT_VERIFICATION_FAILED':
      return 'checkout.paymentVerificationFailed';
    case 'CAPTURE_FAILED':
      return 'checkout.paypalFailed';
    case 'FX_UNAVAILABLE':
    case 'PAYPAL_UNAVAILABLE':
    case 'SERVER_ERROR':
    case 'PAYMENT_ENDPOINT_UNAVAILABLE':
      return 'checkout.paymentUnavailable';
    default:
      return 'checkout.orderFailed';
  }
}
