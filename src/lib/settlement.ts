/**
 * Monthly supplier settlement — pure functions, no Supabase, so scripts/check-settlement.ts can run them.
 */
import type { PurchaseOrder, Supplier } from './supply';

export const CONSUMPTION_TAX_RATE = 0.1;

export interface SettlementRow {
  supplier: Supplier;
  poCount: number;
  subtotal: number;  // Σ qty_received × unit_cost, tax excluded
  tax: number;
  total: number;
}

/** Month is 'YYYY-MM'; a PO belongs to the month its goods were received (Japan time). */
export function buildSettlement(month: string, pos: PurchaseOrder[], suppliers: Supplier[]): SettlementRow[] {
  const inMonth = (iso: string | null) =>
    !!iso && new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7) === month;

  return suppliers
    .filter((s) => !s.isInternal)
    .map((supplier) => {
      const received = pos.filter((p) => p.supplierId === supplier.id && p.status === 'received' && inMonth(p.receivedAt));
      const subtotal = received.reduce(
        (sum, p) => sum + p.items.reduce((s, i) => s + (i.qtyReceived ?? 0) * i.unitCost, 0),
        0,
      );
      // Tax is rounded down once per invoice, per the インボイス rule
      const tax = Math.floor(subtotal * CONSUMPTION_TAX_RATE);
      return { supplier, poCount: received.length, subtotal: Math.round(subtotal), tax, total: Math.round(subtotal) + tax };
    })
    .filter((r) => r.poCount > 0);
}

/** CSV with a UTF-8 BOM so Excel opens Japanese/Korean text correctly. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
}
