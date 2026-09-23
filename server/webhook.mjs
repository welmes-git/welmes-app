// WELMES — reading PayPal webhook events, kept free of I/O so it is testable.
//
// api/paypal-webhook.ts does transport and signature verification; deciding what
// an event means happens here.
//
// The shapes differ per event family, which is the main reason this is separate:
// a capture event carries our order id in `resource.custom_id`, while a dispute
// event only references capture ids inside `disputed_transactions`. Getting that
// wrong means a refund silently matches nothing.

/** Events we act on. Anything else is acknowledged and ignored. */
export const HANDLED_EVENTS = [
  'PAYMENT.CAPTURE.REFUNDED',
  'PAYMENT.CAPTURE.REVERSED',
  'PAYMENT.CAPTURE.DENIED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
];

/**
 * What the endpoint should do about an event.
 *
 * `action`:
 *   'refund'  → refund_order (releases stock when not yet shipped)
 *   'dispute' → flag_order_dispute (never releases stock; outcome unknown)
 *   'ignore'  → acknowledge only
 */
export function interpretEvent(event) {
  const type = String(event?.event_type || '').toUpperCase();
  const resource = event?.resource ?? {};

  if (!type) return { action: 'ignore', reason: 'MISSING_EVENT_TYPE' };
  if (!HANDLED_EVENTS.includes(type)) return { action: 'ignore', reason: `UNHANDLED:${type}` };

  // ── Disputes ──
  if (type.startsWith('CUSTOMER.DISPUTE.')) {
    // A dispute references the captures it covers rather than carrying custom_id,
    // so the capture id is the only link back to the order.
    const txn = resource.disputed_transactions?.[0] ?? {};
    const reference = txn.seller_transaction_id
      || txn.buyer_transaction_id
      || resource.disputed_transactions?.[0]?.seller_transaction_id
      || null;

    return {
      action: 'dispute',
      reference,
      // custom_id occasionally rides along on the disputed transaction; use it when
      // present because matching on our own id is exact.
      orderId: txn.custom ?? txn.custom_id ?? null,
      disputeStatus: disputeStatusFor(type, resource),
      reason: resource.reason || resource.dispute_life_cycle_stage || type,
      disputeId: resource.dispute_id ?? null,
    };
  }

  // ── Capture refunded / reversed / denied ──
  const isRefund = type === 'PAYMENT.CAPTURE.REFUNDED';
  // On a REFUNDED event `resource` is the refund, and the capture it refunds is in
  // links[rel=up]; on REVERSED/DENIED `resource` is the capture itself.
  const reference = isRefund
    ? (captureIdFromLinks(resource) ?? resource.id ?? null)
    : (resource.id ?? null);

  return {
    action: 'refund',
    reference,
    orderId: resource.custom_id ?? resource.invoice_id ?? null,
    amount: Number(resource.amount?.value) || null,
    currency: String(resource.amount?.currency_code || '').toUpperCase() || null,
    reason: type === 'PAYMENT.CAPTURE.DENIED'
      ? 'capture denied by PayPal'
      : type === 'PAYMENT.CAPTURE.REVERSED'
        ? 'capture reversed by PayPal'
        : `refunded via PayPal${resource.note_to_payer ? `: ${resource.note_to_payer}` : ''}`,
  };
}

/** Which capture a refund belongs to; PayPal puts it in links[rel="up"]. */
function captureIdFromLinks(resource) {
  const up = (resource.links ?? []).find((l) => String(l.rel).toLowerCase() === 'up');
  if (!up?.href) return null;
  // .../v2/payments/captures/{id}
  const match = String(up.href).match(/\/captures\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/**
 * Map a dispute event onto our four states.
 *
 * RESOLVED does not mean "in our favour" — the outcome sits in
 * `dispute_outcome.outcome_code`, and treating every resolution as a win would
 * quietly clear disputes we actually lost.
 */
function disputeStatusFor(type, resource) {
  if (type === 'CUSTOMER.DISPUTE.CREATED') return 'open';

  const outcome = String(resource.dispute_outcome?.outcome_code || '').toUpperCase();
  if (type === 'CUSTOMER.DISPUTE.RESOLVED') {
    if (outcome.includes('SELLER')) return 'won';   // RESOLVED_SELLER_FAVOUR
    if (outcome.includes('BUYER')) return 'lost';   // RESOLVED_BUYER_FAVOUR
    return 'resolved';
  }

  // UPDATED: still live unless PayPal says the lifecycle finished.
  const stage = String(resource.status || '').toUpperCase();
  if (stage === 'RESOLVED') return outcome.includes('BUYER') ? 'lost' : 'resolved';
  return 'open';
}

/** An event with no id cannot be de-duplicated, and PayPal retries every delivery. */
export function eventId(event) {
  const id = event?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}
