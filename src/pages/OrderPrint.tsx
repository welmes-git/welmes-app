import { useEffect, useState } from 'react';
import Logo from '../components/Logo';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';

/**
 * Orders are stored in JPY. An official document must show the currency the
 * order was actually recorded in, not whatever the viewer happens to have
 * selected in the header, so this page never converts.
 */
const formatPrice = (amount: number) => `¥${Math.round(amount).toLocaleString('en-US')}`;

export default function OrderPrint() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders, members, currentUser, isAuthenticated, loadMyOrders } = useStore();
  const [loaded, setLoaded] = useState(false);

  const order = orders.find((o) => o.id === id);
  const today = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Orders are in Supabase — fetch them so a refreshed/deep-linked print page
  // can still find its order (the store only holds them in-session otherwise)
  useEffect(() => {
    if (isAuthenticated) loadMyOrders().finally(() => setLoaded(true));
    else setLoaded(true);
  }, [isAuthenticated, loadMyOrders]);

  useEffect(() => {
    if (!isAuthenticated) navigate('/login');
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!order) return;
    document.title = `Purchase Order — ${order.id}`;
    return () => { document.title = 'WELMES Business'; };
  }, [order]);

  if (!isAuthenticated) return null;

  if (!order) {
    // Still fetching — show a spinner rather than flashing "not found"
    if (!loaded) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 size={28} className="animate-spin text-ink-500" />
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <div>
          <p className="text-[18px] text-ink-500 mb-4">Order not found.</p>
          <button onClick={() => navigate('/account')} className="font-bold text-ink-900 underline underline-offset-2">
            ← Back to My Account
          </button>
        </div>
      </div>
    );
  }

  const sh = order.shippingAddress;
  // Bill the member who placed the order — not whoever happens to be viewing
  // (an admin printing a buyer's invoice used to see their own details here).
  const billTo =
    members.find((m) => m.id === order.memberId) ??
    (currentUser?.id === order.memberId ? currentUser : null);

  return (
    <>
      {/* ── Action toolbar (hidden when printing) ── */}
      <div className="print:hidden bg-ink-900 text-white px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate('/account')}
          className="flex items-center gap-2 text-[13px] text-white/80 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} />
          Back to My Account
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-white hover:bg-sunken text-ink-900 text-[13px] font-bold px-4 py-2 rounded-lg transition-colors"
        >
          <Printer size={15} />
          Save as PDF / Print
        </button>
      </div>

      {/* ── Print document ── */}
      <div
        id="print-area"
        className="bg-white mx-auto print:mx-0 print:shadow-none"
        style={{ width: '210mm', minHeight: '297mm', padding: '16mm 18mm', fontFamily: "'Arial', sans-serif" }}
      >
        {/* Header */}
        <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-ink-900">
          <div>
            <div className="mb-2">
              <Logo size="print" />
            </div>
            <p className="text-[11px] text-ink-500 leading-relaxed">
              123 Teheran-ro, Gangnam-gu, Seoul, South Korea<br />
              Tel: 1544-1234 &nbsp;|&nbsp; support@welmes.kr<br />
              Business Reg. No.: 123-45-67890
            </p>
          </div>
          <div className="text-right">
            <p className="text-[22px] font-bold text-ink-900 uppercase tracking-widest mb-1">
              Purchase Order
            </p>
            <table className="text-[11px] text-right ml-auto">
              <tbody>
                <tr>
                  <td className="text-ink-500 pr-3 py-0.5">Order No.</td>
                  <td className="font-bold text-ink-900 font-mono">{order.id}</td>
                </tr>
                <tr>
                  <td className="text-ink-500 pr-3 py-0.5">Order Date</td>
                  <td className="font-semibold text-ink-900">{order.date}</td>
                </tr>
                <tr>
                  <td className="text-ink-500 pr-3 py-0.5">Print Date</td>
                  <td className="font-semibold text-ink-900">{today}</td>
                </tr>
                {order.poNumber && (
                  <tr>
                    <td className="text-ink-500 pr-3 py-0.5">PO Number</td>
                    <td className="font-semibold text-ink-900">{order.poNumber}</td>
                  </tr>
                )}
                <tr>
                  <td className="text-ink-500 pr-3 py-0.5">Status</td>
                  <td>
                    <span className="inline-flex items-center gap-1.5 font-bold uppercase text-[10px] text-ink-900">
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        order.status === 'completed' ? 'bg-signal-ok' :
                        order.status === 'cancelled' ? 'bg-signal-error' :
                        order.status === 'shipped'   ? 'bg-ink-900' : 'bg-ink-500'
                      }`} />
                      {order.status}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Bill To / Ship To */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {/* Bill To */}
          <div className="bg-sunken rounded-lg p-4 border border-line">
            <p className="text-[10px] font-bold text-ink-500 uppercase tracking-widest mb-2">Bill To</p>
            <p className="text-[13px] font-bold text-ink-900">{order.memberName}</p>
            {billTo && (
              <>
                <p className="text-[11px] text-ink-500 mt-0.5">{billTo.email}</p>
                <p className="text-[11px] text-ink-500">Reg. No.: {billTo.businessNumber}</p>
                <p className="text-[11px] text-ink-500">Rep.: {billTo.representative}</p>
                <p className="text-[11px] text-ink-500">{billTo.phone}</p>
              </>
            )}
          </div>

          {/* Ship To */}
          <div className="bg-sunken rounded-lg p-4 border border-line">
            <p className="text-[10px] font-bold text-ink-500 uppercase tracking-widest mb-2">Ship To</p>
            {sh ? (
              <>
                <p className="text-[13px] font-bold text-ink-900">{sh.company}</p>
                <p className="text-[11px] text-ink-500 mt-0.5">Attn: {sh.recipient}</p>
                <p className="text-[11px] text-ink-500">{sh.phone}</p>
                <p className="text-[11px] text-ink-500">{sh.addressLine1}{sh.addressLine2 ? `, ${sh.addressLine2}` : ''}</p>
                <p className="text-[11px] text-ink-500">
                  {[sh.city, sh.state, sh.zipCode].filter(Boolean).join(', ')}, {sh.country}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-ink-500">{order.memberName}</p>
            )}
          </div>
        </div>

        {/* Order Notes */}
        {order.notes && (
          <div className="mb-6 p-3 bg-sunken border border-line-strong rounded-lg">
            <p className="text-[10px] font-bold text-ink-900 uppercase tracking-wide mb-1">Delivery Notes</p>
            <p className="text-[12px] text-ink-500">{order.notes}</p>
          </div>
        )}

        {/* Items table */}
        <table className="w-full mb-6" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--wm-ink-900)', color: 'white' }}>
              {['#', 'Product', 'Brand', 'Set', 'Qty (sets)', 'Unit Price', 'Amount'].map((h) => (
                <th
                  key={h}
                  className="text-left py-2.5 px-3 text-[10px] font-bold uppercase tracking-wide"
                  style={{ borderBottom: '2px solid var(--wm-ink-900)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {order.items.length > 0 ? (
              order.items.map((item, idx) => {
                // Bill at the set price when a set option is chosen
                const unitPrice = item.setOption?.wholesalePrice ?? item.product.wholesalePrice;
                const lineTotal = unitPrice * item.quantity;
                return (
                  <tr
                    key={idx}
                    style={{ backgroundColor: idx % 2 === 0 ? 'var(--wm-canvas)' : 'var(--wm-sunken)' }}
                  >
                    <td className="py-2.5 px-3 text-[11px] text-ink-500">{idx + 1}</td>
                    <td className="py-2.5 px-3 text-[11px] text-ink-900 font-medium" style={{ maxWidth: '180px' }}>
                      {item.product.nameEn ?? item.product.name}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-ink-500">{item.product.brand}</td>
                    <td className="py-2.5 px-3 text-[11px]">
                      {item.setOption ? (
                        <span>
                          <span className="font-bold text-ink-900">{item.setOption.id}</span>
                          <span className="text-ink-500"> · {item.setOption.description}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-ink-700 text-center font-semibold">{item.quantity}</td>
                    <td className="py-2.5 px-3 text-[11px] text-ink-700 text-right tabular-nums">{formatPrice(unitPrice)}</td>
                    <td className="py-2.5 px-3 text-[11px] font-bold text-ink-900 text-right tabular-nums">{formatPrice(lineTotal)}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[12px] text-ink-300">
                  Item details not available for legacy orders.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-8">
          <div style={{ width: '240px' }}>
            <div className="space-y-1.5">
              <div className="flex justify-between text-[12px]">
                <span className="text-ink-500">Subtotal (excl. VAT)</span>
                <span className="font-medium">{formatPrice(order.subtotal ?? order.total)}</span>
              </div>
              {order.vat !== undefined && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-ink-500">VAT (10%)</span>
                  <span className="font-medium">{formatPrice(order.vat)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] font-bold text-ink-900 pt-2 border-t-2 border-ink-900 mt-2">
                <span>Grand Total</span>
                <span>{formatPrice(order.total)}</span>
              </div>
              <p className="text-[10px] text-ink-300 text-right">VAT included in total amount</p>
            </div>
          </div>
        </div>

        {/* Signature / Terms */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          {/* Terms */}
          <div>
            <p className="text-[10px] font-bold text-ink-500 uppercase tracking-wide mb-2">Terms & Conditions</p>
            <ul className="text-[10px] text-ink-500 space-y-1 list-disc list-inside">
              <li>Payment due within 30 days of invoice date.</li>
              <li>All prices are in Japanese Yen (JPY).</li>
              <li>Goods remain property of WELMES until full payment received.</li>
              <li>Returns accepted within 7 days of delivery for defective items only.</li>
              <li>This document serves as an official purchase order record.</li>
            </ul>
          </div>

          {/* Signatures */}
          <div className="space-y-6">
            <div>
              <p className="text-[10px] font-bold text-ink-500 uppercase tracking-wide mb-3">Authorized by (Buyer)</p>
              <div className="border-b border-line-strong mb-1" style={{ height: '36px' }} />
              <p className="text-[10px] text-ink-300">Signature &nbsp; / &nbsp; Date</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-ink-500 uppercase tracking-wide mb-3">Confirmed by (WELMES)</p>
              <div className="border-b border-line-strong mb-1" style={{ height: '36px' }} />
              <p className="text-[10px] text-ink-300">Signature &nbsp; / &nbsp; Date</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-line pt-4 text-center">
          <p className="text-[10px] text-ink-300">
            WELMES Co., Ltd. &nbsp;|&nbsp; 123 Teheran-ro, Gangnam-gu, Seoul &nbsp;|&nbsp;
            1544-1234 &nbsp;|&nbsp; support@welmes.kr &nbsp;|&nbsp; www.welmes.kr
          </p>
          <p className="text-[9px] text-line-strong mt-1">
            This document is computer-generated and valid without a physical signature where not required by law.
          </p>
        </div>
      </div>

      {/* Print-only page settings */}
      <style>{`
        @media print {
          @page {
            size: A4;
            margin: 0;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          #print-area {
            width: 210mm !important;
            min-height: 297mm !important;
          }
        }
      `}</style>
    </>
  );
}
