import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { Printer, ArrowLeft, Loader2 } from 'lucide-react';

export default function OrderPrint() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { orders, currentUser, isAuthenticated, loadMyOrders } = useStore();
  const { formatPrice } = useCurrency();
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
          <Loader2 size={28} className="animate-spin text-[#4a90e2]" />
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <div>
          <p className="text-[18px] text-[#999] mb-4">Order not found.</p>
          <button onClick={() => navigate('/account')} className="text-[#4a90e2] hover:underline">
            ← Back to My Account
          </button>
        </div>
      </div>
    );
  }

  const sh = order.shippingAddress;

  return (
    <>
      {/* ── Action toolbar (hidden when printing) ── */}
      <div className="print:hidden bg-[#2c3e50] text-white px-6 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate('/account')}
          className="flex items-center gap-2 text-[13px] text-white/80 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} />
          Back to My Account
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-[#4a90e2] hover:bg-[#357abd] text-white text-[13px] font-semibold px-4 py-2 rounded-lg transition-colors"
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
        <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-[#2c3e50]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[26px] font-bold text-[#2c3e50] tracking-tight">WELMES</span>
              <span className="bg-[#4a90e2] text-white text-[10px] font-bold px-2 py-0.5 rounded">Business</span>
            </div>
            <p className="text-[11px] text-[#666] leading-relaxed">
              123 Teheran-ro, Gangnam-gu, Seoul, South Korea<br />
              Tel: 1544-1234 &nbsp;|&nbsp; support@welmes.kr<br />
              Business Reg. No.: 123-45-67890
            </p>
          </div>
          <div className="text-right">
            <p className="text-[22px] font-bold text-[#2c3e50] uppercase tracking-widest mb-1">
              Purchase Order
            </p>
            <table className="text-[11px] text-right ml-auto">
              <tbody>
                <tr>
                  <td className="text-[#888] pr-3 py-0.5">Order No.</td>
                  <td className="font-bold text-[#222] font-mono">{order.id}</td>
                </tr>
                <tr>
                  <td className="text-[#888] pr-3 py-0.5">Order Date</td>
                  <td className="font-semibold text-[#222]">{order.date}</td>
                </tr>
                <tr>
                  <td className="text-[#888] pr-3 py-0.5">Print Date</td>
                  <td className="font-semibold text-[#222]">{today}</td>
                </tr>
                {order.poNumber && (
                  <tr>
                    <td className="text-[#888] pr-3 py-0.5">PO Number</td>
                    <td className="font-semibold text-[#222]">{order.poNumber}</td>
                  </tr>
                )}
                <tr>
                  <td className="text-[#888] pr-3 py-0.5">Status</td>
                  <td>
                    <span className={`font-bold uppercase text-[10px] px-1.5 py-0.5 rounded ${
                      order.status === 'completed' ? 'bg-green-100 text-green-700' :
                      order.status === 'shipped'   ? 'bg-indigo-100 text-indigo-700' :
                      order.status === 'processing'? 'bg-blue-100 text-blue-700' :
                      order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                                                     'bg-yellow-100 text-yellow-700'
                    }`}>
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
          <div className="bg-[#f8f8fa] rounded-lg p-4 border border-[#e5e5e5]">
            <p className="text-[10px] font-bold text-[#4a90e2] uppercase tracking-widest mb-2">Bill To</p>
            <p className="text-[13px] font-bold text-[#222]">{order.memberName}</p>
            {currentUser && (
              <>
                <p className="text-[11px] text-[#666] mt-0.5">{currentUser.email}</p>
                <p className="text-[11px] text-[#666]">Reg. No.: {currentUser.businessNumber}</p>
                <p className="text-[11px] text-[#666]">Rep.: {currentUser.representative}</p>
                <p className="text-[11px] text-[#666]">{currentUser.phone}</p>
              </>
            )}
          </div>

          {/* Ship To */}
          <div className="bg-[#f8f8fa] rounded-lg p-4 border border-[#e5e5e5]">
            <p className="text-[10px] font-bold text-[#4a90e2] uppercase tracking-widest mb-2">Ship To</p>
            {sh ? (
              <>
                <p className="text-[13px] font-bold text-[#222]">{sh.company}</p>
                <p className="text-[11px] text-[#666] mt-0.5">Attn: {sh.recipient}</p>
                <p className="text-[11px] text-[#666]">{sh.phone}</p>
                <p className="text-[11px] text-[#666]">{sh.addressLine1}{sh.addressLine2 ? `, ${sh.addressLine2}` : ''}</p>
                <p className="text-[11px] text-[#666]">
                  {[sh.city, sh.state, sh.zipCode].filter(Boolean).join(', ')}, {sh.country}
                </p>
              </>
            ) : (
              <p className="text-[11px] text-[#666]">{order.memberName}</p>
            )}
          </div>
        </div>

        {/* Order Notes */}
        {order.notes && (
          <div className="mb-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-[10px] font-bold text-yellow-700 uppercase tracking-wide mb-1">Delivery Notes</p>
            <p className="text-[12px] text-[#555]">{order.notes}</p>
          </div>
        )}

        {/* Items table */}
        <table className="w-full mb-6" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ backgroundColor: '#2c3e50', color: 'white' }}>
              {['#', 'Product', 'Brand', 'Set', 'Qty (sets)', 'Unit Price', 'Amount'].map((h) => (
                <th
                  key={h}
                  className="text-left py-2.5 px-3 text-[10px] font-bold uppercase tracking-wide"
                  style={{ borderBottom: '2px solid #2c3e50' }}
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
                    style={{ backgroundColor: idx % 2 === 0 ? '#ffffff' : '#f8f8fa' }}
                  >
                    <td className="py-2.5 px-3 text-[11px] text-[#888]">{idx + 1}</td>
                    <td className="py-2.5 px-3 text-[11px] text-[#222] font-medium" style={{ maxWidth: '180px' }}>
                      {item.product.nameEn ?? item.product.name}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-[#888]">{item.product.brand}</td>
                    <td className="py-2.5 px-3 text-[11px]">
                      {item.setOption ? (
                        <span>
                          <span className="font-bold text-[#4a90e2]">{item.setOption.id}</span>
                          <span className="text-[#888]"> · {item.setOption.description}</span>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-[11px] text-[#333] text-center font-semibold">{item.quantity}</td>
                    <td className="py-2.5 px-3 text-[11px] text-[#333] text-right">{formatPrice(unitPrice)}</td>
                    <td className="py-2.5 px-3 text-[11px] font-bold text-[#222] text-right">{formatPrice(lineTotal)}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[12px] text-[#aaa]">
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
                <span className="text-[#666]">Subtotal (excl. VAT)</span>
                <span className="font-medium">{formatPrice(order.subtotal ?? order.total)}</span>
              </div>
              {order.vat !== undefined && (
                <div className="flex justify-between text-[12px]">
                  <span className="text-[#666]">VAT (10%)</span>
                  <span className="font-medium">{formatPrice(order.vat)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] font-bold text-[#222] pt-2 border-t-2 border-[#2c3e50] mt-2">
                <span>Grand Total</span>
                <span>{formatPrice(order.total)}</span>
              </div>
              <p className="text-[10px] text-[#aaa] text-right">VAT included in total amount</p>
            </div>
          </div>
        </div>

        {/* Signature / Terms */}
        <div className="grid grid-cols-2 gap-8 mb-8">
          {/* Terms */}
          <div>
            <p className="text-[10px] font-bold text-[#888] uppercase tracking-wide mb-2">Terms & Conditions</p>
            <ul className="text-[10px] text-[#888] space-y-1 list-disc list-inside">
              <li>Payment due within 30 days of invoice date.</li>
              <li>All prices are in Korean Won (KRW).</li>
              <li>Goods remain property of WELMES until full payment received.</li>
              <li>Returns accepted within 7 days of delivery for defective items only.</li>
              <li>This document serves as an official purchase order record.</li>
            </ul>
          </div>

          {/* Signatures */}
          <div className="space-y-6">
            <div>
              <p className="text-[10px] font-bold text-[#888] uppercase tracking-wide mb-3">Authorized by (Buyer)</p>
              <div className="border-b border-[#ccc] mb-1" style={{ height: '36px' }} />
              <p className="text-[10px] text-[#aaa]">Signature &nbsp; / &nbsp; Date</p>
            </div>
            <div>
              <p className="text-[10px] font-bold text-[#888] uppercase tracking-wide mb-3">Confirmed by (WELMES)</p>
              <div className="border-b border-[#ccc] mb-1" style={{ height: '36px' }} />
              <p className="text-[10px] text-[#aaa]">Signature &nbsp; / &nbsp; Date</p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[#e5e5e5] pt-4 text-center">
          <p className="text-[10px] text-[#aaa]">
            WELMES Co., Ltd. &nbsp;|&nbsp; 123 Teheran-ro, Gangnam-gu, Seoul &nbsp;|&nbsp;
            1544-1234 &nbsp;|&nbsp; support@welmes.kr &nbsp;|&nbsp; www.welmes.kr
          </p>
          <p className="text-[9px] text-[#ccc] mt-1">
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
