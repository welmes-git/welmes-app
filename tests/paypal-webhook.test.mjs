// Before this existed, anything PayPal did after the capture never reached us: a
// dashboard refund, a reversed or denied capture, a dispute. Orders stayed `paid`
// and kept their place in the fulfilment queue.
//
// These tests pin the event reading, which is where the subtle mistakes live — the
// shapes differ per event family and a wrong field means a refund matches nothing.
import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretEvent, eventId, HANDLED_EVENTS } from '../server/webhook.mjs';

test('only the events we act on are handled', () => {
  assert.deepEqual(HANDLED_EVENTS, [
    'PAYMENT.CAPTURE.REFUNDED',
    'PAYMENT.CAPTURE.REVERSED',
    'PAYMENT.CAPTURE.DENIED',
    'CUSTOMER.DISPUTE.CREATED',
    'CUSTOMER.DISPUTE.UPDATED',
    'CUSTOMER.DISPUTE.RESOLVED',
  ]);
});

test('unrelated events are acknowledged, not acted on', () => {
  // PayPal sends plenty we do not care about; acting on an unknown shape would be
  // guessing, and a non-2xx would make them retry it forever.
  for (const type of ['PAYMENT.CAPTURE.COMPLETED', 'CHECKOUT.ORDER.APPROVED', 'BILLING.SUBSCRIPTION.CREATED']) {
    const r = interpretEvent({ event_type: type, resource: {} });
    assert.equal(r.action, 'ignore', `${type} must be ignored`);
    assert.match(r.reason, /UNHANDLED/);
  }
  assert.equal(interpretEvent({}).action, 'ignore');
  assert.equal(interpretEvent({}).reason, 'MISSING_EVENT_TYPE');
});

test('a refund resolves the capture from links[rel=up], not the refund id', () => {
  // On REFUNDED, `resource` is the refund — its own id is not the capture id we
  // stored in payment_reference, so matching on it would find nothing.
  const r = interpretEvent({
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: {
      id: 'REFUND-999',
      custom_id: 'ORD-20260923-AB12C',
      amount: { value: '509.00', currency_code: 'USD' },
      links: [
        { rel: 'self', href: 'https://api.paypal.com/v2/payments/refunds/REFUND-999' },
        { rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/CAPTURE-123' },
      ],
    },
  });
  assert.equal(r.action, 'refund');
  assert.equal(r.reference, 'CAPTURE-123');
  assert.equal(r.orderId, 'ORD-20260923-AB12C');
  assert.equal(r.amount, 509);
  assert.equal(r.currency, 'USD');
});

test('a refund with no up link falls back to the resource id', () => {
  const r = interpretEvent({
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    resource: { id: 'CAPTURE-123', amount: { value: '100', currency_code: 'JPY' } },
  });
  assert.equal(r.reference, 'CAPTURE-123');
});

test('reversed and denied captures use the resource id directly', () => {
  // Here `resource` IS the capture, so its id is what we matched on when paying.
  for (const [type, reason] of [
    ['PAYMENT.CAPTURE.REVERSED', /reversed/],
    ['PAYMENT.CAPTURE.DENIED', /denied/],
  ]) {
    const r = interpretEvent({
      event_type: type,
      resource: { id: 'CAPTURE-456', custom_id: 'ORD-X', amount: { value: '1', currency_code: 'JPY' } },
    });
    assert.equal(r.action, 'refund', `${type} must release the order`);
    assert.equal(r.reference, 'CAPTURE-456');
    assert.match(r.reason, reason);
  }
});

test('a dispute is read from disputed_transactions, not custom_id', () => {
  // Dispute events carry no custom_id at the top level; the only link back to the
  // order is the capture id inside the disputed transaction.
  const r = interpretEvent({
    event_type: 'CUSTOMER.DISPUTE.CREATED',
    resource: {
      dispute_id: 'PP-D-111',
      reason: 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED',
      disputed_transactions: [{ seller_transaction_id: 'CAPTURE-789' }],
    },
  });
  assert.equal(r.action, 'dispute');
  assert.equal(r.reference, 'CAPTURE-789');
  assert.equal(r.disputeStatus, 'open');
  assert.equal(r.disputeId, 'PP-D-111');
  assert.match(r.reason, /NOT_RECEIVED/);
});

test('a resolved dispute is only "won" when the outcome says so', () => {
  // Treating every resolution as a win would quietly clear disputes we lost.
  const seller = interpretEvent({
    event_type: 'CUSTOMER.DISPUTE.RESOLVED',
    resource: { dispute_outcome: { outcome_code: 'RESOLVED_SELLER_FAVOUR' }, disputed_transactions: [{ seller_transaction_id: 'C1' }] },
  });
  assert.equal(seller.disputeStatus, 'won');

  const buyer = interpretEvent({
    event_type: 'CUSTOMER.DISPUTE.RESOLVED',
    resource: { dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR' }, disputed_transactions: [{ seller_transaction_id: 'C1' }] },
  });
  assert.equal(buyer.disputeStatus, 'lost');

  const unclear = interpretEvent({
    event_type: 'CUSTOMER.DISPUTE.RESOLVED',
    resource: { disputed_transactions: [{ seller_transaction_id: 'C1' }] },
  });
  assert.equal(unclear.disputeStatus, 'resolved', 'no outcome code must not imply a win');
});

test('an updated dispute stays open until the lifecycle finishes', () => {
  const open = interpretEvent({
    event_type: 'CUSTOMER.DISPUTE.UPDATED',
    resource: { status: 'UNDER_REVIEW', disputed_transactions: [{ seller_transaction_id: 'C1' }] },
  });
  assert.equal(open.disputeStatus, 'open');

  const lost = interpretEvent({
    event_type: 'CUSTOMER.DISPUTE.UPDATED',
    resource: { status: 'RESOLVED', dispute_outcome: { outcome_code: 'RESOLVED_BUYER_FAVOUR' }, disputed_transactions: [{ seller_transaction_id: 'C1' }] },
  });
  assert.equal(lost.disputeStatus, 'lost');
});

test('a dispute never triggers a refund action', () => {
  // The money is only provisionally held and the outcome is unknown, so stock must
  // not be released on the strength of a dispute being opened.
  for (const type of ['CUSTOMER.DISPUTE.CREATED', 'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED']) {
    const r = interpretEvent({ event_type: type, resource: { disputed_transactions: [{ seller_transaction_id: 'C1' }] } });
    assert.equal(r.action, 'dispute', `${type} must not be a refund`);
  }
});

test('event ids are required, because PayPal retries every delivery', () => {
  assert.equal(eventId({ id: 'WH-1' }), 'WH-1');
  assert.equal(eventId({}), null);
  assert.equal(eventId({ id: '' }), null);
  assert.equal(eventId({ id: 42 }), null, 'a non-string id cannot key the dedupe table');
});
