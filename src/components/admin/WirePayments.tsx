// WELMES — admin reconciliation for incoming bank transfers.
//
// Wire orders sit at `payment_status = 'unpaid'` until a human confirms the money
// arrived; there was previously no way to do that at all. `mark_order_paid` is
// service-role only and demands an exact amount match, which a wire almost never
// satisfies because intermediary banks deduct their fee in transit.
//
// This screen also surfaces the deadline. `place_order` reserves stock, so an
// unpaid order holds sellable inventory until `expire_unpaid_orders` releases it
// seven days out — the overdue rows here are stock about to come back.
//
// Admin-only UI, English-only like the rest of AdminDashboard.
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock, RefreshCw, Landmark } from 'lucide-react';
import * as db from '../../lib/db';
import type { Order } from '../../store/useStore';
import { getCurrencyInfo } from '../../lib/currency';
import type { CurrencyCode } from '../../lib/currency';

/** The amount as the order was denominated — never reconverted for display. */
function formatCharge(order: Order): string {
  const code = (order.chargeCurrency || 'JPY') as CurrencyCode;
  const info = getCurrencyInfo(code);
  const amount = order.chargeAmount ?? order.total;
  return `${code} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: info.decimals,
    maximumFractionDigits: info.decimals,
  }).format(amount)}`;
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

interface Draft {
  reference: string;
  amount: string;
  receivedAt: string;
}

export default function WirePayments({ onSettled }: { onSettled?: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ reference: '', amount: '', receivedAt: '' });
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ orderId: string; text: string; ok: boolean } | null>(null);

  /* Fetching lives inside the effect and re-runs when `reloadToken` changes, the
     same shape as useExchangeRate. Hoisting it into a useCallback puts setState on
     a path reachable from the effect body, which risks cascading renders. */
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const rows = await db.fetchUnpaidWireOrders();
      if (!mounted) return;
      setOrders(rows);
      setLoading(false);
      setRefreshing(false);
    })();
    return () => { mounted = false; };
  }, [reloadToken]);

  const reload = () => setReloadToken((t) => t + 1);

  /** Manual refresh — an event handler, so showing the spinner first is fine. */
  function refresh() {
    setRefreshing(true);
    reload();
  }

  function startRecording(order: Order) {
    setOpenId(order.id);
    setFeedback(null);
    setDraft({
      // Prefilled with what we asked for, because that is the common case; the
      // admin overwrites it with what actually landed.
      reference: order.id,
      amount: String(order.chargeAmount ?? order.total),
      receivedAt: new Date().toISOString().slice(0, 10),
    });
  }

  async function submit(order: Order) {
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFeedback({ orderId: order.id, text: 'Enter the amount that actually arrived.', ok: false });
      return;
    }
    setSaving(true);
    const { result, error } = await db.recordWirePayment({
      orderId: order.id,
      reference: draft.reference || order.id,
      amount,
      currency: order.chargeCurrency || 'JPY',
      receivedAt: draft.receivedAt ? new Date(draft.receivedAt).toISOString() : undefined,
    });
    setSaving(false);

    if (error || !result) {
      setFeedback({ orderId: order.id, text: error ?? 'Could not record the payment.', ok: false });
      return;
    }

    if (result.accepted) {
      const short = result.shortfall > 0
        ? ` Short by ${result.shortfall} (within tolerance ${result.tolerance}) — recorded as a bank deduction.`
        : '';
      setFeedback({ orderId: order.id, text: `Settled.${short}`, ok: true });
      setOpenId(null);
      reload();
      onSettled?.();
      return;
    }

    // Beyond tolerance: recorded, still unpaid, waiting on a commercial decision.
    setFeedback({
      orderId: order.id,
      text: `Underpaid — expected ${result.expected}, received ${result.received} `
        + `(short ${result.shortfall}, tolerance ${result.tolerance}). Order left unpaid; `
        + `invoice the difference, carry it to the next order, or re-record once topped up.`,
      ok: false,
    });
    reload();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Landmark size={16} className="text-[#666]" />
          <h2 className="text-[15px] font-medium text-[#333]">Bank transfers awaiting payment</h2>
          <span className="text-[12px] text-[#999]">({orders.length})</span>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 text-[12px] text-[#666] hover:text-[#333] transition-colors"
        >
          <RefreshCw size={13} className={loading || refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <p className="text-[12px] text-[#666] leading-relaxed mb-4 bg-[#f8f8fa] border border-[#eee] rounded-lg px-4 py-3">
        Enter the amount that actually arrived, not the invoiced amount. A shortfall
        within tolerance (the larger of 2% or ¥3,000 at the order&apos;s fixed rate)
        settles the order and is recorded as a bank deduction. A larger shortfall is
        recorded but leaves the order unpaid. Overdue orders have their reserved
        stock released automatically.
      </p>

      {loading && orders.length === 0 ? (
        <p className="text-[13px] text-[#999] py-8 text-center">Loading…</p>
      ) : orders.length === 0 ? (
        <p className="text-[13px] text-[#999] py-8 text-center">No wire transfers are awaiting payment.</p>
      ) : (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-[#f8f8fa] text-[#666]">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Order ID</th>
                  <th className="px-4 py-3 text-left font-medium">Member</th>
                  <th className="px-4 py-3 text-left font-medium">Amount due</th>
                  <th className="px-4 py-3 text-left font-medium">Deadline</th>
                  <th className="px-4 py-3 text-left font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const remaining = daysUntil(order.paymentDueAt);
                  const overdue = remaining !== null && remaining < 0;
                  const isOpen = openId === order.id;
                  const note = feedback?.orderId === order.id ? feedback : null;

                  return (
                    <>
                      <tr key={order.id} className="border-t border-[#f5f5f5] hover:bg-[#fafafa]">
                        <td className="px-4 py-3 font-mono font-medium text-[#333]">{order.id}</td>
                        <td className="px-4 py-3 text-[#666]">{order.memberName}</td>
                        <td className="px-4 py-3 font-medium text-[#333] tabular-nums">
                          {formatCharge(order)}
                          {order.paymentShortfall ? (
                            <span className="block text-[11px] font-normal text-[#c0392b]">
                              short {order.paymentShortfall}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {order.paymentDueAt ? (
                            <span
                              className={`inline-flex items-center gap-1 text-[12px] ${
                                overdue ? 'text-[#c0392b] font-medium' : 'text-[#666]'
                              }`}
                            >
                              {overdue ? <AlertTriangle size={12} /> : <Clock size={12} />}
                              {new Date(order.paymentDueAt).toLocaleDateString()}
                              <span className="text-[11px]">
                                {overdue ? `(${Math.abs(remaining!)}d overdue)` : `(${remaining}d left)`}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[12px] text-[#999]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => (isOpen ? setOpenId(null) : startRecording(order))}
                            className="text-[12px] px-3 py-1.5 rounded border border-[#ddd] hover:border-[#333] hover:text-[#333] text-[#666] transition-colors"
                          >
                            {isOpen ? 'Cancel' : 'Record payment'}
                          </button>
                        </td>
                      </tr>

                      {(isOpen || note) && (
                        <tr key={`${order.id}-form`} className="border-t border-[#f5f5f5] bg-[#fcfcfd]">
                          <td colSpan={5} className="px-4 py-4">
                            {note && (
                              <p
                                className={`flex items-start gap-2 text-[12px] mb-3 leading-relaxed ${
                                  note.ok ? 'text-[#1e8449]' : 'text-[#c0392b]'
                                }`}
                              >
                                {note.ok ? <Check size={13} className="mt-0.5 shrink-0" /> : <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
                                {note.text}
                              </p>
                            )}

                            {isOpen && (
                              <div className="flex flex-wrap items-end gap-3">
                                <label className="flex flex-col gap-1">
                                  <span className="text-[11px] text-[#666]">Amount received ({order.chargeCurrency || 'JPY'})</span>
                                  <input
                                    value={draft.amount}
                                    onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                                    inputMode="decimal"
                                    className="w-[160px] px-3 py-2 border border-[#ddd] rounded text-[13px] tabular-nums focus:outline-none focus:border-[#333]"
                                  />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-[11px] text-[#666]">Bank reference</span>
                                  <input
                                    value={draft.reference}
                                    onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                                    className="w-[220px] px-3 py-2 border border-[#ddd] rounded text-[13px] focus:outline-none focus:border-[#333]"
                                  />
                                </label>
                                <label className="flex flex-col gap-1">
                                  <span className="text-[11px] text-[#666]">Received on</span>
                                  <input
                                    type="date"
                                    value={draft.receivedAt}
                                    onChange={(e) => setDraft({ ...draft, receivedAt: e.target.value })}
                                    className="px-3 py-2 border border-[#ddd] rounded text-[13px] focus:outline-none focus:border-[#333]"
                                  />
                                </label>
                                <button
                                  onClick={() => submit(order)}
                                  disabled={saving}
                                  className="px-4 py-2 rounded bg-[#333] text-white text-[13px] hover:bg-black transition-colors disabled:opacity-60"
                                >
                                  {saving ? 'Recording…' : 'Confirm payment'}
                                </button>
                              </div>
                            )}

                            {order.paymentError && !note && (
                              <p className="text-[11px] text-[#c0392b] mt-2">{order.paymentError}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
