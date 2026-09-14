import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useStore } from '../store/useStore';
import * as supply from '../lib/supply';
import type { PurchaseOrder, PurchaseOrderStatus, Supplier } from '../lib/supply';
import { buildSettlement, toCsv } from '../lib/settlement';

/**
 * Brand supply pilot (受注後仕入): suppliers, purchase prices, purchase orders, monthly settlement.
 * Admin-only, English like the rest of the admin. Products without a supplier count as WELMES stock.
 */
type Tab = 'suppliers' | 'prices' | 'orders' | 'settlement';
const TABS: { id: Tab; label: string }[] = [
  { id: 'suppliers', label: 'Suppliers' },
  { id: 'prices', label: 'Purchase prices' },
  { id: 'orders', label: 'Purchase orders' },
  { id: 'settlement', label: 'Monthly settlement' },
];

const input = 'h-9 rounded-sm border border-[#dadada] bg-white px-3 text-[13px] focus:border-[#333] focus:outline-none';
const btn = 'h-9 rounded-sm bg-[#333] px-4 text-[13px] text-white hover:bg-black disabled:opacity-40';
const btnGhost = 'h-9 rounded-sm border border-[#dadada] bg-white px-4 text-[13px] text-[#333] hover:border-[#333] disabled:opacity-40';
const th = 'px-3 py-2 text-left text-[12px] font-medium text-[#777]';
const td = 'px-3 py-2 text-[13px] text-[#333] align-top';
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

const PO_STATUS_STYLE: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  accepted: 'bg-purple-100 text-purple-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
};

function without<T>(obj: Record<string | number, T>, key: string | number) {
  const next = { ...obj };
  delete next[key];
  return next;
}

function download(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminSupply() {
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, products, orders, loadOrders, showToast } = useStore();
  const [tab, setTab] = useState<Tab>('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplyMap, setSupplyMap] = useState(new Map<number, supply.ProductSupply>());
  const [pos, setPos] = useState<PurchaseOrder[]>([]);

  const reload = () =>
    Promise.all([supply.fetchSuppliers(), supply.fetchProductSupply(), supply.fetchPurchaseOrders()]).then(([s, ps, p]) => {
      setSuppliers(s);
      setSupplyMap(new Map(ps.map((r) => [r.productId, r])));
      setPos(p);
    });

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) { navigate('/login'); return; }
    reload();
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isAdmin]);

  if (!isAuthenticated || !isAdmin) return null;

  const report = (error: { message: string } | null | undefined, ok: string) => {
    if (error) { showToast(error.message, 'error'); return false; }
    showToast(ok, 'success');
    reload();
    return true;
  };

  return (
    <div className="min-h-screen bg-[#f4f5f7]">
      <header className="flex items-center gap-4 border-b border-[#e5e5e5] bg-white px-6 py-3">
        <Link to="/admin" className="flex items-center gap-1 text-[13px] text-[#666] hover:text-[#333]">
          <ArrowLeft size={16} /> Admin
        </Link>
        <h1 className="text-[18px] font-semibold text-[#333]">Brand supply</h1>
        <nav className="ml-6 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`h-9 rounded-sm px-3 text-[13px] ${tab === t.id ? 'bg-[#333] text-white' : 'text-[#555] hover:bg-[#f0f0f0]'}`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="p-6">
        {tab === 'suppliers' && <SuppliersTab suppliers={suppliers} report={report} />}
        {tab === 'prices' && (
          <PricesTab products={products} suppliers={suppliers} supplyMap={supplyMap} report={report} />
        )}
        {tab === 'orders' && (
          <OrdersTab orders={orders} pos={pos} suppliers={suppliers} report={report} showToast={showToast} />
        )}
        {tab === 'settlement' && <SettlementTab pos={pos} suppliers={suppliers} />}
      </main>
    </div>
  );
}

type Report = (error: { message: string } | null | undefined, ok: string) => boolean;

// ── Suppliers ───────────────────────────────────────────────────────────────

const EMPTY_SUPPLIER: Omit<Supplier, 'id' | 'isInternal'> = {
  name: '', status: 'pilot', contactName: '', email: '', phone: '', invoiceNo: '',
  bankName: '', bankBranch: '', accountType: '普通', accountNumber: '', accountHolder: '',
  paymentTerms: '月末締め翌月末払い', notes: '',
};

function SuppliersTab({ suppliers, report }: { suppliers: Supplier[]; report: Report }) {
  const [form, setForm] = useState<(Omit<Supplier, 'id' | 'isInternal'> & { id?: string }) | null>(null);

  const save = async () => {
    if (!form?.name.trim()) return;
    if (form.invoiceNo && !/^T\d{13}$/.test(form.invoiceNo.trim())) {
      report({ message: 'Invoice number must be T followed by 13 digits' }, '');
      return;
    }
    const { error } = await supply.saveSupplier(form);
    if (report(error, 'Supplier saved')) setForm(null);
  };

  const field = (key: keyof typeof EMPTY_SUPPLIER, label: string, placeholder = '') => (
    <label className="flex flex-col gap-1 text-[12px] text-[#777]">
      {label}
      <input
        className={input}
        placeholder={placeholder}
        value={form![key] as string}
        onChange={(e) => setForm({ ...form!, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className={btn} onClick={() => setForm({ ...EMPTY_SUPPLIER })}>Add supplier</button>
      </div>

      {form && (
        <div className="rounded-sm border border-[#e5e5e5] bg-white p-5">
          <h2 className="mb-4 text-[15px] font-semibold">{form.id ? 'Edit supplier' : 'New supplier'}</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {field('name', 'Brand / company name *')}
            <label className="flex flex-col gap-1 text-[12px] text-[#777]">
              Status
              <select className={input} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Supplier['status'] })}>
                <option value="pilot">pilot</option>
                <option value="active">active</option>
                <option value="paused">paused</option>
              </select>
            </label>
            {field('invoiceNo', '適格請求書 登録番号', 'T1234567890123')}
            {field('contactName', 'Contact name')}
            {field('email', 'Order email')}
            {field('phone', 'Phone')}
            {field('bankName', '銀行名')}
            {field('bankBranch', '支店名')}
            <label className="flex flex-col gap-1 text-[12px] text-[#777]">
              口座種別
              <select className={input} value={form.accountType} onChange={(e) => setForm({ ...form, accountType: e.target.value as Supplier['accountType'] })}>
                <option value="普通">普通</option>
                <option value="当座">当座</option>
              </select>
            </label>
            {field('accountNumber', '口座番号')}
            {field('accountHolder', '口座名義 (カナ)')}
            {field('paymentTerms', 'Payment terms')}
          </div>
          <label className="mt-3 flex flex-col gap-1 text-[12px] text-[#777]">
            Notes
            <textarea className={`${input} h-20 py-2`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <div className="mt-4 flex gap-2">
            <button className={btn} onClick={save} disabled={!form.name.trim()}>Save</button>
            <button className={btnGhost} onClick={() => setForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-sm border border-[#e5e5e5] bg-white">
        <table className="w-full">
          <thead className="border-b border-[#e5e5e5]">
            <tr><th className={th}>Name</th><th className={th}>Status</th><th className={th}>Contact</th><th className={th}>Invoice no.</th><th className={th}>Bank</th><th className={th} /></tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id} className="border-b border-[#f0f0f0] last:border-0">
                <td className={td}>
                  {s.name}
                  {s.isInternal && <span className="ml-2 rounded-sm bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">own stock · no POs</span>}
                </td>
                <td className={td}>{s.status}</td>
                <td className={td}>{s.contactName}<div className="text-[#888]">{s.email}</div></td>
                <td className={td}>{s.invoiceNo || <span className="text-[#c00]">{s.isInternal ? '' : 'missing'}</span>}</td>
                <td className={td}>{s.bankName && `${s.bankName} ${s.bankBranch} ${s.accountType} ${s.accountNumber}`}</td>
                <td className={`${td} text-right`}>
                  {!s.isInternal && <button className="text-[13px] underline" onClick={() => setForm({ ...s })}>Edit</button>}
                </td>
              </tr>
            ))}
            {suppliers.length === 0 && (
              <tr><td className={`${td} text-[#888]`} colSpan={6}>No suppliers — run supabase/migrations/20260916_supply_pilot.sql first.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Purchase prices ─────────────────────────────────────────────────────────

function PricesTab({ products, suppliers, supplyMap, report }: {
  products: ReturnType<typeof useStore.getState>['products'];
  suppliers: Supplier[];
  supplyMap: Map<number, supply.ProductSupply>;
  report: Report;
}) {
  const [search, setSearch] = useState('');
  const [brand, setBrand] = useState('');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [selected, setSelected] = useState(new Set<number>());
  const [bulkSupplier, setBulkSupplier] = useState('');
  const [bulkCost, setBulkCost] = useState('');
  const [costDrafts, setCostDrafts] = useState<Record<number, string>>({});

  const internalId = suppliers.find((s) => s.isInternal)?.id;
  const brands = useMemo(() => [...new Set(products.map((p) => p.brand))].sort(), [products]);
  const rows = products.filter((p) => {
    if (brand && p.brand !== brand) return false;
    const mapped = supplyMap.get(p.id);
    if (onlyUnassigned && mapped && mapped.supplierId !== internalId) return false;
    const q = search.toLowerCase();
    return !q || p.nameEn.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || String(p.id) === q;
  });

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const applyBulk = async () => {
    const ids = [...selected];
    const cost = bulkCost.trim() === '' ? undefined : Number(bulkCost);
    if (cost !== undefined && !(cost >= 0)) { report({ message: 'Cost must be a number ≥ 0' }, ''); return; }
    // cost_price is required, so a product without one can't just switch supplier
    if (cost === undefined && ids.some((id) => !supplyMap.has(id))) {
      report({ message: 'Some selected products have no cost yet — enter a cost to assign them' }, '');
      return;
    }
    const { error } = await supply.saveProductSupply(ids, bulkSupplier, cost);
    if (report(error, `Updated ${ids.length} products`)) { setSelected(new Set()); setBulkCost(''); }
  };

  const saveCost = async (productId: number) => {
    const cost = Number(costDrafts[productId]);
    if (!(cost >= 0) || costDrafts[productId].trim() === '') { report({ message: 'Cost must be a number ≥ 0' }, ''); return; }
    const supplierId = supplyMap.get(productId)?.supplierId ?? internalId;
    if (!supplierId) return;
    const { error } = await supply.saveProductSupply([productId], supplierId, cost);
    if (report(error, 'Cost saved')) setCostDrafts((d) => without(d, productId));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} w-64`} placeholder="Search name or ID" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={input} value={brand} onChange={(e) => setBrand(e.target.value)}>
          <option value="">All brands</option>
          {brands.map((b) => <option key={b}>{b}</option>)}
        </select>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />
          WELMES stock only
        </label>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-sm border border-[#333] bg-white p-3 text-[13px]">
          <span>{selected.size} selected →</span>
          <select className={input} value={bulkSupplier} onChange={(e) => setBulkSupplier(e.target.value)}>
            <option value="">Choose supplier</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <input className={`${input} w-40`} inputMode="decimal" placeholder="Cost ¥/piece (optional)" value={bulkCost} onChange={(e) => setBulkCost(e.target.value)} />
          <button className={btn} disabled={!bulkSupplier} onClick={applyBulk}>Apply</button>
          <button className={btnGhost} onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="overflow-x-auto rounded-sm border border-[#e5e5e5] bg-white">
        <table className="w-full">
          <thead className="border-b border-[#e5e5e5]">
            <tr>
              <th className={th}>
                <input
                  type="checkbox"
                  checked={rows.length > 0 && rows.every((p) => selected.has(p.id))}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((p) => p.id)) : new Set())}
                />
              </th>
              <th className={th}>Product</th><th className={th}>Brand</th><th className={th}>Supplier</th>
              <th className={th}>Wholesale</th><th className={th}>Cost / piece</th><th className={th}>Margin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const mapped = supplyMap.get(p.id);
              const draft = costDrafts[p.id];
              const cost = draft !== undefined ? Number(draft) : mapped?.costPrice;
              const margin = cost !== undefined && p.wholesalePrice > 0 ? (1 - cost / p.wholesalePrice) * 100 : null;
              return (
                <tr key={p.id} className="border-b border-[#f0f0f0] last:border-0">
                  <td className={td}><input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td>
                  <td className={td}><div className="max-w-[360px] truncate">{p.nameEn}</div><div className="text-[11px] text-[#999]">#{p.id}</div></td>
                  <td className={td}>{p.brand}</td>
                  <td className={td}>{mapped ? supplierName(suppliers, mapped.supplierId) : <span className="text-[#999]">WELMES stock</span>}</td>
                  <td className={td}>{yen(p.wholesalePrice)}</td>
                  <td className={td}>
                    <div className="flex gap-1">
                      <input
                        className={`${input} w-24`}
                        inputMode="decimal"
                        value={draft ?? mapped?.costPrice ?? ''}
                        onChange={(e) => setCostDrafts({ ...costDrafts, [p.id]: e.target.value })}
                      />
                      {draft !== undefined && <button className={btnGhost} onClick={() => saveCost(p.id)}>Save</button>}
                    </div>
                  </td>
                  <td className={`${td} ${margin !== null && margin < 15 ? 'text-[#c00]' : ''}`}>
                    {margin === null || Number.isNaN(margin) ? '—' : `${margin.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const supplierName = (suppliers: Supplier[], id: string) => suppliers.find((s) => s.id === id)?.name ?? '—';

// ── Purchase orders ─────────────────────────────────────────────────────────

function poEmail(po: PurchaseOrder, supplier: Supplier | undefined) {
  const lines = po.items.map((i) => `・${i.productName}${i.setLabel ? ` (${i.setLabel})` : ''} × ${i.qty}個 @${yen(i.unitCost)}`);
  const subtotal = po.items.reduce((s, i) => s + i.qty * i.unitCost, 0);
  return {
    subject: `【WELMES】発注書 ${po.orderId}`,
    body: [
      `${supplier?.name ?? ''} ${supplier?.contactName ?? ''} 様`,
      '',
      'いつもお世話になっております。WELMESです。',
      '下記の通り発注いたします。WELMES倉庫までご納品をお願いいたします。',
      '',
      `発注番号: ${po.orderId}`,
      ...lines,
      '',
      `小計(税抜): ${yen(subtotal)}`,
      `お支払い: ${supplier?.paymentTerms ?? '月末締め翌月末払い'}`,
      '',
      '出荷後、送り状番号をご返信ください。',
    ].join('\n'),
  };
}

function OrdersTab({ orders, pos, suppliers, report, showToast }: {
  orders: ReturnType<typeof useStore.getState>['orders'];
  pos: PurchaseOrder[];
  suppliers: Supplier[];
  report: Report;
  showToast: (msg: string, type: 'success' | 'error') => void;
}) {
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open');
  const [receiving, setReceiving] = useState<Record<string, Record<string, string>>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});

  const openOrders = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'completed');
  const visiblePos = pos.filter((p) => statusFilter === 'all' || (p.status !== 'received' && p.status !== 'cancelled'));

  const generate = async (orderId: string) => {
    const { created, error } = await supply.generatePurchaseOrders(orderId);
    if (error) { showToast(error, 'error'); return; }
    report(null, created ? `Created ${created} purchase order(s)` : 'Nothing to order — lines are WELMES stock or already ordered');
  };

  const setStatus = async (po: PurchaseOrder, status: PurchaseOrderStatus) => {
    const { error } = await supply.updatePurchaseOrder(po.id, { status });
    report(error, `Marked ${status}`);
  };

  const receive = async (po: PurchaseOrder) => {
    const draft = receiving[po.id];
    const received = po.items.map((i) => ({ itemId: i.id, qty: Number(draft[i.id]) }));
    if (received.some((r) => !Number.isInteger(r.qty) || r.qty < 0)) { report({ message: 'Received quantities must be whole numbers ≥ 0' }, ''); return; }
    const { error } = await supply.receivePurchaseOrder(po.id, received);
    if (report(error, 'Goods received')) setReceiving((r) => without(r, po.id));
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_1fr]">
      <section>
        <h2 className="mb-2 text-[14px] font-semibold">Open sales orders</h2>
        <div className="divide-y divide-[#f0f0f0] rounded-sm border border-[#e5e5e5] bg-white">
          {openOrders.map((o) => {
            const count = pos.filter((p) => p.orderId === o.id).length;
            return (
              <div key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-[13px]">
                <div>
                  <div className="font-medium">{o.id}</div>
                  <div className="text-[12px] text-[#888]">{o.memberName} · {o.status} · {count} PO</div>
                </div>
                <button className={btnGhost} onClick={() => generate(o.id)}>Generate POs</button>
              </div>
            );
          })}
          {openOrders.length === 0 && <p className="px-3 py-4 text-[13px] text-[#888]">No open orders.</p>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[14px] font-semibold">Purchase orders</h2>
          <select className={input} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'open' | 'all')}>
            <option value="open">Open</option>
            <option value="all">All</option>
          </select>
        </div>

        {visiblePos.map((po) => {
          const supplier = suppliers.find((s) => s.id === po.supplierId);
          const mail = poEmail(po, supplier);
          const draft = receiving[po.id];
          const closed = po.status === 'received' || po.status === 'cancelled';
          return (
            <article key={po.id} className="rounded-sm border border-[#e5e5e5] bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold">{supplierName(suppliers, po.supplierId)}</span>
                <span className="text-[12px] text-[#888]">for {po.orderId}</span>
                <span className={`rounded-sm px-2 py-0.5 text-[11px] ${PO_STATUS_STYLE[po.status]}`}>{po.status}</span>
                {po.receivedAt && <span className="text-[12px] text-[#888]">received {new Date(po.receivedAt).toLocaleDateString('ja-JP')}</span>}
              </div>

              <table className="mt-3 w-full">
                <thead><tr><th className={th}>Item</th><th className={th}>Qty</th><th className={th}>Unit cost</th><th className={th}>Received</th></tr></thead>
                <tbody>
                  {po.items.map((i) => (
                    <tr key={i.id} className="border-t border-[#f0f0f0]">
                      <td className={td}>{i.productName}{i.setLabel && <span className="text-[#888]"> ({i.setLabel})</span>}</td>
                      <td className={td}>{i.qty}</td>
                      <td className={td}>{yen(i.unitCost)}</td>
                      <td className={td}>
                        {draft ? (
                          <input
                            className={`${input} w-20`}
                            inputMode="numeric"
                            value={draft[i.id]}
                            onChange={(e) => setReceiving({ ...receiving, [po.id]: { ...draft, [i.id]: e.target.value } })}
                          />
                        ) : (i.qtyReceived ?? '—')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {!closed && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {supplier?.email ? (
                    <a
                      className={`${btnGhost} inline-flex items-center`}
                      href={`mailto:${supplier.email}?subject=${encodeURIComponent(mail.subject)}&body=${encodeURIComponent(mail.body)}`}
                    >
                      Open email
                    </a>
                  ) : (
                    <span className="text-[12px] text-[#c00]">No supplier email</span>
                  )}
                  <button
                    className={btnGhost}
                    onClick={() => navigator.clipboard.writeText(`${mail.subject}\n\n${mail.body}`).then(() => showToast('Copied', 'success'))}
                  >
                    Copy text
                  </button>
                  {po.status === 'draft' && <button className={btn} onClick={() => setStatus(po, 'sent')}>Mark sent</button>}
                  {po.status === 'sent' && <button className={btnGhost} onClick={() => setStatus(po, 'accepted')}>Mark accepted</button>}
                  <input
                    className={`${input} w-40`}
                    placeholder="Tracking no."
                    value={tracking[po.id] ?? po.trackingNo}
                    onChange={(e) => setTracking({ ...tracking, [po.id]: e.target.value })}
                    onBlur={async () => {
                      if (tracking[po.id] === undefined || tracking[po.id] === po.trackingNo) return;
                      const { error } = await supply.updatePurchaseOrder(po.id, { trackingNo: tracking[po.id] });
                      report(error, 'Tracking saved');
                    }}
                  />
                  {draft ? (
                    <>
                      <button className={btn} onClick={() => receive(po)}>Confirm receipt</button>
                      <button className={btnGhost} onClick={() => setReceiving((r) => without(r, po.id))}>Cancel</button>
                    </>
                  ) : (
                    <button
                      className={btnGhost}
                      onClick={() => setReceiving({ ...receiving, [po.id]: Object.fromEntries(po.items.map((i) => [i.id, String(i.qty)])) })}
                    >
                      Receive goods
                    </button>
                  )}
                  <button
                    className="ml-auto text-[12px] text-[#c00] underline"
                    onClick={() => confirm('Cancel this purchase order?') && setStatus(po, 'cancelled')}
                  >
                    Cancel PO
                  </button>
                </div>
              )}
            </article>
          );
        })}
        {visiblePos.length === 0 && <p className="text-[13px] text-[#888]">No purchase orders.</p>}
      </section>
    </div>
  );
}

// ── Monthly settlement ──────────────────────────────────────────────────────

function SettlementTab({ pos, suppliers }: { pos: PurchaseOrder[]; suppliers: Supplier[] }) {
  // Default to last month — the one being closed
  const [month, setMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }).slice(0, 7);
  });
  const rows = buildSettlement(month, pos, suppliers);
  const grand = rows.reduce((s, r) => s + r.total, 0);

  const summaryCsv = () => download(`welmes-settlement-${month}.csv`, toCsv([
    ['Supplier', 'Invoice no.', 'POs', 'Subtotal (excl. tax)', 'Consumption tax 10%', 'Total'],
    ...rows.map((r) => [r.supplier.name, r.supplier.invoiceNo, r.poCount, r.subtotal, r.tax, r.total]),
  ]));

  const transferCsv = () => download(`welmes-transfers-${month}.csv`, toCsv([
    ['銀行名', '支店名', '口座種別', '口座番号', '口座名義', '振込金額', '仕入先'],
    ...rows.map((r) => [r.supplier.bankName, r.supplier.bankBranch, r.supplier.accountType, r.supplier.accountNumber, r.supplier.accountHolder, r.total, r.supplier.name]),
  ]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" className={input} value={month} onChange={(e) => setMonth(e.target.value)} />
        <span className="text-[13px] text-[#777]">Goods received this month (JST) · paid end of next month</span>
        <div className="ml-auto flex gap-2">
          <button className={btnGhost} disabled={!rows.length} onClick={summaryCsv}>Summary CSV</button>
          <button className={btn} disabled={!rows.length} onClick={transferCsv}>Bank transfer CSV</button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-sm border border-[#e5e5e5] bg-white">
        <table className="w-full tabular-nums">
          <thead className="border-b border-[#e5e5e5]">
            <tr>
              <th className={th}>Supplier</th><th className={th}>POs</th><th className={th}>Subtotal</th>
              <th className={th}>Tax 10%</th><th className={th}>Total</th><th className={th}>Pay to</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.supplier.id} className="border-b border-[#f0f0f0]">
                <td className={td}>
                  {r.supplier.name}
                  {!r.supplier.invoiceNo && <div className="text-[11px] text-[#c00]">No invoice number — tax credit at risk</div>}
                </td>
                <td className={td}>{r.poCount}</td>
                <td className={td}>{yen(r.subtotal)}</td>
                <td className={td}>{yen(r.tax)}</td>
                <td className={`${td} font-semibold`}>{yen(r.total)}</td>
                <td className={td}>
                  {r.supplier.accountNumber
                    ? `${r.supplier.bankName} ${r.supplier.bankBranch} ${r.supplier.accountType} ${r.supplier.accountNumber} ${r.supplier.accountHolder}`
                    : <span className="text-[#c00]">No bank details</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td className={`${td} text-[#888]`} colSpan={6}>No goods received from suppliers in {month}.</td></tr>
            ) : (
              <tr><td className={`${td} font-semibold`} colSpan={4}>Total transfers</td><td className={`${td} font-semibold`} colSpan={2}>{yen(grand)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
