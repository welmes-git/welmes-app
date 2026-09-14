// Self-check for monthly settlement math: node scripts/check-settlement.ts
import assert from 'node:assert/strict';
import { buildSettlement, toCsv } from '../src/lib/settlement.ts';

const supplier = (id: string, isInternal = false) => ({
  id, name: id, isInternal, status: 'pilot' as const, contactName: '', email: '', phone: '', invoiceNo: '',
  bankName: '', bankBranch: '', accountType: '' as const, accountNumber: '', accountHolder: '', paymentTerms: '', notes: '',
});
const po = (supplierId: string, status: string, receivedAt: string | null, items: [number | null, number][]) => ({
  id: Math.random().toString(), orderId: 'ORD', supplierId, status, sentAt: null, receivedAt, trackingNo: '', note: '', createdAt: '',
  items: items.map(([qtyReceived, unitCost]) => ({ id: '', productId: 1, productName: 'x', setLabel: null, qty: 10, qtyReceived, unitCost })),
});

const rows = buildSettlement(
  '2026-09',
  [
    po('A', 'received', '2026-09-10T03:00:00Z', [[10, 750], [3, 333.33]]),   // 7500 + 999.99
    po('A', 'received', '2026-08-31T16:00:00Z', [[2, 1000]]),                 // 2026-09-01 01:00 JST → counts
    po('A', 'received', '2026-09-30T15:30:00Z', [[5, 100]]),                  // 2026-10-01 00:30 JST → next month
    po('A', 'sent', null, [[null, 999]]),                                     // not received → excluded
    po('B', 'received', '2026-09-05T00:00:00Z', [[0, 500]]),                  // fully rejected at check-in
    po('W', 'received', '2026-09-05T00:00:00Z', [[4, 100]]),                  // internal stock → never paid
  ] as never,
  [supplier('A'), supplier('B'), supplier('W', true)],
);

assert.equal(rows.length, 2);
const a = rows.find((r) => r.supplier.id === 'A')!;
assert.equal(a.poCount, 2);
assert.equal(a.subtotal, 10500);        // 7500 + 999.99 + 2000 → 10499.99 rounds to 10500
assert.equal(a.tax, 1049);              // floor(10499.99 × 0.1)
assert.equal(a.total, 11549);
const b = rows.find((r) => r.supplier.id === 'B')!;
assert.deepEqual([b.subtotal, b.tax, b.total], [0, 0, 0]);

assert.equal(toCsv([['a,b', 'say "hi"', 3]]), '﻿"a,b","say ""hi""",3');
console.log('settlement checks passed');
