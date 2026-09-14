/**
 * Brand supply pilot — suppliers, purchase prices, purchase orders, monthly settlement.
 * Every table behind this file is admin-only (RLS); see supabase/migrations/20260916_supply_pilot.sql.
 */
import { supabase } from './supabase';

export interface Supplier {
  id: string;
  name: string;
  isInternal: boolean;
  status: 'pilot' | 'active' | 'paused';
  contactName: string;
  email: string;
  phone: string;
  invoiceNo: string;
  bankName: string;
  bankBranch: string;
  accountType: '普通' | '当座' | '';
  accountNumber: string;
  accountHolder: string;
  paymentTerms: string;
  notes: string;
}

export interface ProductSupply { productId: number; supplierId: string; costPrice: number }

export type PurchaseOrderStatus = 'draft' | 'sent' | 'accepted' | 'received' | 'cancelled';

export interface PurchaseOrderItem {
  id: string;
  productId: number | null;
  productName: string;
  setLabel: string | null;
  qty: number;
  qtyReceived: number | null;
  unitCost: number;
}

export interface PurchaseOrder {
  id: string;
  orderId: string;
  supplierId: string;
  status: PurchaseOrderStatus;
  sentAt: string | null;
  receivedAt: string | null;
  trackingNo: string;
  note: string;
  createdAt: string;
  items: PurchaseOrderItem[];
}

const text = (v: unknown) => (v as string | null) ?? '';

function rowToSupplier(r: Record<string, unknown>): Supplier {
  return {
    id: r.id as string,
    name: r.name as string,
    isInternal: Boolean(r.is_internal),
    status: r.status as Supplier['status'],
    contactName: text(r.contact_name),
    email: text(r.email),
    phone: text(r.phone),
    invoiceNo: text(r.invoice_no),
    bankName: text(r.bank_name),
    bankBranch: text(r.bank_branch),
    accountType: (r.account_type as Supplier['accountType']) ?? '',
    accountNumber: text(r.account_number),
    accountHolder: text(r.account_holder),
    paymentTerms: text(r.payment_terms),
    notes: text(r.notes),
  };
}

function supplierToRow(s: Omit<Supplier, 'id' | 'isInternal'>): Record<string, unknown> {
  const blank = (v: string) => v.trim() || null;
  return {
    name: s.name.trim(),
    status: s.status,
    contact_name: blank(s.contactName),
    email: blank(s.email),
    phone: blank(s.phone),
    invoice_no: blank(s.invoiceNo),
    bank_name: blank(s.bankName),
    bank_branch: blank(s.bankBranch),
    account_type: s.accountType || null,
    account_number: blank(s.accountNumber),
    account_holder: blank(s.accountHolder),
    payment_terms: s.paymentTerms.trim() || '月末締め翌月末払い',
    notes: blank(s.notes),
  };
}

// ── Suppliers ────────────────────────────────────────────────────

export async function fetchSuppliers(): Promise<Supplier[]> {
  const { data, error } = await supabase.from('suppliers').select('*').order('is_internal', { ascending: false }).order('name');
  if (error) { console.error('[fetchSuppliers]', error.message); return []; }
  return (data ?? []).map(rowToSupplier);
}

export async function saveSupplier(s: Omit<Supplier, 'isInternal'> | Omit<Supplier, 'id' | 'isInternal'>) {
  const row = supplierToRow(s);
  return 'id' in s && s.id
    ? supabase.from('suppliers').update(row).eq('id', s.id)
    : supabase.from('suppliers').insert([row]);
}

// ── Purchase prices ──────────────────────────────────────────────

export async function fetchProductSupply(): Promise<ProductSupply[]> {
  const { data, error } = await supabase.from('product_supply').select('product_id, supplier_id, cost_price');
  if (error) { console.error('[fetchProductSupply]', error.message); return []; }
  return (data ?? []).map((r) => ({ productId: Number(r.product_id), supplierId: r.supplier_id, costPrice: Number(r.cost_price) }));
}

export async function saveProductSupply(productIds: number[], supplierId: string, costPrice?: number) {
  const now = new Date().toISOString();
  if (costPrice === undefined) {
    // Reassign supplier only; keeps each product's existing cost
    return supabase.from('product_supply').update({ supplier_id: supplierId, updated_at: now }).in('product_id', productIds);
  }
  return supabase.from('product_supply').upsert(
    productIds.map((id) => ({ product_id: id, supplier_id: supplierId, cost_price: costPrice, updated_at: now })),
  );
}

export async function clearProductSupply(productIds: number[]) {
  return supabase.from('product_supply').delete().in('product_id', productIds);
}

// ── Purchase orders ──────────────────────────────────────────────

export async function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, purchase_order_items(*)')
    .order('created_at', { ascending: false });
  if (error) { console.error('[fetchPurchaseOrders]', error.message); return []; }
  return (data ?? []).map((r) => ({
    id: r.id,
    orderId: r.order_id,
    supplierId: r.supplier_id,
    status: r.status,
    sentAt: r.sent_at,
    receivedAt: r.received_at,
    trackingNo: text(r.tracking_no),
    note: text(r.note),
    createdAt: r.created_at,
    items: ((r.purchase_order_items ?? []) as Record<string, unknown>[]).map((i) => ({
      id: i.id as string,
      productId: i.product_id == null ? null : Number(i.product_id),
      productName: i.product_name as string,
      setLabel: (i.set_label as string | null) ?? null,
      qty: Number(i.qty),
      qtyReceived: i.qty_received == null ? null : Number(i.qty_received),
      unitCost: Number(i.unit_cost),
    })),
  }));
}

/** Splits a sales order into one purchase order per supplier; returns how many were created. */
export async function generatePurchaseOrders(orderId: string): Promise<{ created?: number; error?: string }> {
  const { data, error } = await supabase.rpc('generate_purchase_orders', { p_order_id: orderId });
  if (error) return { error: error.message };
  return { created: Number(data) };
}

export async function updatePurchaseOrder(
  id: string,
  fields: Partial<{ status: PurchaseOrderStatus; trackingNo: string; note: string }>,
) {
  const row: Record<string, unknown> = {};
  if (fields.status !== undefined) {
    row.status = fields.status;
    if (fields.status === 'sent') row.sent_at = new Date().toISOString();
  }
  if (fields.trackingNo !== undefined) row.tracking_no = fields.trackingNo || null;
  if (fields.note !== undefined) row.note = fields.note || null;
  return supabase.from('purchase_orders').update(row).eq('id', id);
}

/** Warehouse check-in: record received pieces per line and close the PO. */
export async function receivePurchaseOrder(id: string, received: { itemId: string; qty: number }[]) {
  for (const r of received) {
    const { error } = await supabase.from('purchase_order_items').update({ qty_received: r.qty }).eq('id', r.itemId);
    if (error) return { error };
  }
  return supabase
    .from('purchase_orders')
    .update({ status: 'received', received_at: new Date().toISOString() })
    .eq('id', id);
}
