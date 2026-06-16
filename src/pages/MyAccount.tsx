import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
import { useCurrency } from '../context/CurrencyContext';
import {
  Package,
  User,
  Lock,
  ChevronRight,
  CheckCircle2,
  Clock,
  Truck,
  XCircle,
  AlertCircle,
  Eye,
  EyeOff,
  Building2,
  Phone,
  MapPin,
  CreditCard,
  Printer,
} from 'lucide-react';

type Tab = 'orders' | 'account' | 'security';

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending:    { label: 'Pending',    color: 'bg-yellow-50 text-yellow-700 border-yellow-200',  icon: <Clock size={13} /> },
  processing: { label: 'Processing', color: 'bg-blue-50 text-blue-700 border-blue-200',         icon: <Package size={13} /> },
  shipped:    { label: 'Shipped',    color: 'bg-indigo-50 text-indigo-700 border-indigo-200',   icon: <Truck size={13} /> },
  completed:  { label: 'Completed',  color: 'bg-green-50 text-green-700 border-green-200',      icon: <CheckCircle2 size={13} /> },
  cancelled:  { label: 'Cancelled',  color: 'bg-red-50 text-red-700 border-red-200',            icon: <XCircle size={13} /> },
};

function fmt(n: number) {
  return new Intl.NumberFormat('en-US').format(n);
}

export default function MyAccount() {
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const {
    isAuthenticated,
    currentUser,
    orders,
    members,
    updateMember,
    showToast,
  } = useStore();

  const [tab, setTab] = useState<Tab>('orders');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  /* ── Account Info form ── */
  const [accountForm, setAccountForm] = useState({
    companyName:     currentUser?.companyName ?? '',
    representative:  currentUser?.representative ?? '',
    phone:           currentUser?.phone ?? '',
    address:         currentUser?.address ?? '',
    businessNumber:  currentUser?.businessNumber ?? '',
  });
  const [accountSaving, setAccountSaving] = useState(false);

  /* ── Password form ── */
  const [pwForm, setPwForm] = useState({
    current: '',
    next: '',
    confirm: '',
  });
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [pwSaving, setPwSaving] = useState(false);

  /* ── Guards ── */
  if (!isAuthenticated || !currentUser) {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-20 text-center">
        <User size={48} className="mx-auto text-[#ddd] mb-4" />
        <h2 className="text-[20px] font-bold mb-2">Login Required</h2>
        <p className="text-[14px] text-[#999] mb-6">Please log in to view your account.</p>
        <button
          onClick={() => navigate('/login')}
          className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[14px] hover:bg-[#555] transition-colors"
        >
          Go to Login
        </button>
      </div>
    );
  }

  /* ── Data ── */
  const myOrders = orders
    .filter((o) => o.memberId === currentUser.id)
    .sort((a, b) => b.date.localeCompare(a.date));

  const memberRecord = members.find((m) => m.id === currentUser.id);
  const approvalStatus = currentUser.isAdmin ? 'approved' : (memberRecord?.status ?? currentUser.status);

  /* ── Handlers ── */
  async function handleSaveAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!accountForm.companyName.trim() || !accountForm.representative.trim()) {
      showToast('Company name and representative are required.', 'error');
      return;
    }
    setAccountSaving(true);
    updateMember(currentUser.id, accountForm);
    setAccountSaving(false);
    showToast('Account information updated successfully.', 'success');
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwForm.current || !pwForm.next || !pwForm.confirm) {
      showToast('Please fill in all password fields.', 'error');
      return;
    }
    if (pwForm.next.length < 8) {
      showToast('New password must be at least 8 characters.', 'error');
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      showToast('New passwords do not match.', 'error');
      return;
    }
    setPwSaving(true);
    // Verify current password via Supabase re-auth
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: currentUser.email,
      password: pwForm.current,
    });
    if (signInErr) {
      showToast('Current password is incorrect.', 'error');
      setPwSaving(false);
      return;
    }
    // Update to new password
    const { error: updateErr } = await supabase.auth.updateUser({ password: pwForm.next });
    if (updateErr) {
      showToast('Failed to change password. Please try again.', 'error');
      setPwSaving(false);
      return;
    }
    setPwForm({ current: '', next: '', confirm: '' });
    setPwSaving(false);
    showToast('Password changed successfully.', 'success');
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'orders',   label: 'My Orders',    icon: <Package size={16} /> },
    { key: 'account',  label: 'Account Info', icon: <User size={16} /> },
    { key: 'security', label: 'Security',     icon: <Lock size={16} /> },
  ];

  return (
    <div className="bg-[#f8f8fa] min-h-screen pb-16">
      {/* Page header */}
      <div className="bg-white border-b border-[#e5e5e5]">
        <div className="max-w-[960px] mx-auto px-4 py-5">
          <h1 className="text-[20px] font-bold text-[#222]">My Account</h1>
        </div>
      </div>

      <div className="max-w-[960px] mx-auto px-4 pt-6 flex flex-col lg:flex-row gap-6">

        {/* ── Sidebar ── */}
        <aside className="lg:w-[220px] shrink-0 space-y-3">
          {/* Profile card */}
          <div className="bg-white rounded-xl border border-[#e5e5e5] p-4">
            <div className="w-12 h-12 rounded-full bg-[#4a90e2]/10 flex items-center justify-center mb-3">
              <User size={22} className="text-[#4a90e2]" />
            </div>
            <p className="text-[14px] font-bold text-[#222] leading-tight">{currentUser.companyName}</p>
            <p className="text-[12px] text-[#999] mt-0.5">{currentUser.email}</p>
            <div className="mt-3">
              {approvalStatus === 'approved' ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                  <CheckCircle2 size={11} /> Verified Business
                </span>
              ) : approvalStatus === 'pending' ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-full px-2.5 py-0.5">
                  <Clock size={11} /> Pending Review
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">
                  <XCircle size={11} /> Not Approved
                </span>
              )}
            </div>
          </div>

          {/* Nav */}
          <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`w-full flex items-center justify-between px-4 py-3.5 text-[13px] font-medium transition-colors border-b border-[#f5f5f5] last:border-0 ${
                  tab === t.key
                    ? 'bg-[#f0f7ff] text-[#4a90e2]'
                    : 'text-[#555] hover:bg-[#f8f8fa]'
                }`}
              >
                <span className="flex items-center gap-2">
                  {t.icon}
                  {t.label}
                </span>
                <ChevronRight size={14} className="text-[#ccc]" />
              </button>
            ))}
          </div>
        </aside>

        {/* ── Main Content ── */}
        <div className="flex-1 min-w-0">

          {/* ══════════════════════════════
              TAB: MY ORDERS
          ══════════════════════════════ */}
          {tab === 'orders' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-bold text-[#222]">Order History</h2>
                <span className="text-[13px] text-[#999]">{myOrders.length} order{myOrders.length !== 1 ? 's' : ''}</span>
              </div>

              {myOrders.length === 0 ? (
                <div className="bg-white rounded-xl border border-[#e5e5e5] py-16 text-center">
                  <Package size={44} className="mx-auto text-[#ddd] mb-3" />
                  <p className="text-[14px] text-[#999] mb-1">No orders yet</p>
                  <p className="text-[12px] text-[#bbb] mb-5">Your orders will appear here once you place them.</p>
                  <Link
                    to="/products"
                    className="inline-block px-5 py-2 bg-[#333] text-white text-[13px] rounded-lg hover:bg-[#555] transition-colors"
                  >
                    Start Shopping
                  </Link>
                </div>
              ) : (
                myOrders.map((order) => {
                  const sc = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
                  const isExpanded = expandedOrder === order.id;
                  return (
                    <div key={order.id} className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                      {/* Order header */}
                      <button
                        onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                        className="w-full px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#fafafa] transition-colors text-left"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div>
                            <p className="text-[13px] font-bold text-[#222] font-mono">{order.id}</p>
                            <p className="text-[12px] text-[#aaa] mt-0.5">{order.date}</p>
                          </div>
                          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold border rounded-full px-2.5 py-0.5 w-fit ${sc.color}`}>
                            {sc.icon} {sc.label}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-[16px] font-bold text-[#222]">{formatPrice(order.total)}</p>
                            {order.vat !== undefined && (
                              <p className="text-[11px] text-[#aaa]">incl. VAT {formatPrice(order.vat)}</p>
                            )}
                          </div>
                          <Link
                            to={`/order/${order.id}/print`}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 w-8 h-8 flex items-center justify-center text-[#aaa] hover:text-[#4a90e2] hover:bg-[#f0f7ff] rounded-lg transition-colors border border-[#e5e5e5]"
                            title="Print / Save as PDF"
                          >
                            <Printer size={14} />
                          </Link>
                          <ChevronRight
                            size={16}
                            className={`text-[#ccc] transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                          />
                        </div>
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="border-t border-[#f0f0f0] px-5 py-4 space-y-4">
                          {/* Items */}
                          {order.items.length > 0 ? (
                            <div>
                              <p className="text-[12px] font-semibold text-[#aaa] uppercase tracking-wide mb-3">Items Ordered</p>
                              <div className="space-y-3">
                                {order.items.map((item, idx) => (
                                  <div key={idx} className="flex items-center gap-3">
                                    <img
                                      src={item.product.image}
                                      alt={item.product.name}
                                      onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/48x48/f0f0f0/999?text=IMG'; }}
                                      className="w-12 h-12 object-cover rounded-lg border border-[#f0f0f0] shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] text-[#aaa] uppercase">{item.product.brand}</p>
                                      <p className="text-[13px] text-[#333] truncate">{item.product.name}</p>
                                      {item.setOption && (
                                        <p className="text-[11px] text-[#4a90e2]">
                                          {item.setOption.id} · {item.setOption.description}
                                        </p>
                                      )}
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className="text-[13px] font-semibold">×{item.quantity}</p>
                                      <p className="text-[12px] text-[#999]">{formatPrice(item.product.wholesalePrice * item.quantity)}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-[12px] text-[#bbb]">Item details not available for this order.</p>
                          )}

                          {/* Shipping */}
                          {order.shippingAddress && (
                            <div className="bg-[#f8f8fa] rounded-lg p-3">
                              <p className="text-[12px] font-semibold text-[#aaa] uppercase tracking-wide mb-1.5">Shipping Address</p>
                              <p className="text-[13px] text-[#555]">
                                {order.shippingAddress.company} · Attn: {order.shippingAddress.recipient}
                              </p>
                              <p className="text-[12px] text-[#888]">
                                {order.shippingAddress.addressLine1}, {order.shippingAddress.city} {order.shippingAddress.zipCode}, {order.shippingAddress.country}
                              </p>
                            </div>
                          )}

                          {/* PO / Notes */}
                          {(order.poNumber || order.notes) && (
                            <div className="flex gap-4 text-[12px] text-[#888]">
                              {order.poNumber && <p>PO: <span className="font-medium text-[#555]">{order.poNumber}</span></p>}
                              {order.notes && <p>Notes: <span className="font-medium text-[#555]">{order.notes}</span></p>}
                            </div>
                          )}

                          {/* Price breakdown */}
                          <div className="border-t border-[#f0f0f0] pt-3 space-y-1 text-[13px]">
                            {order.subtotal !== undefined && (
                              <div className="flex justify-between text-[#666]">
                                <span>Subtotal (excl. VAT)</span>
                                <span>{formatPrice(order.subtotal)}</span>
                              </div>
                            )}
                            {order.vat !== undefined && (
                              <div className="flex justify-between text-[#666]">
                                <span>VAT (10%)</span>
                                <span>{formatPrice(order.vat)}</span>
                              </div>
                            )}
                            <div className="flex justify-between font-bold text-[#222] pt-1 border-t border-[#f0f0f0]">
                              <span>Total</span>
                              <span>{formatPrice(order.total)}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ══════════════════════════════
              TAB: ACCOUNT INFO
          ══════════════════════════════ */}
          {tab === 'account' && (
            <div className="space-y-5">
              <h2 className="text-[16px] font-bold text-[#222]">Account Information</h2>

              {/* Read-only info */}
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <CreditCard size={15} className="text-[#4a90e2]" />
                  <h3 className="text-[14px] font-semibold text-[#222]">Business Registration</h3>
                  <span className="text-[11px] text-[#bbb] ml-1">(read-only)</span>
                </div>
                <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow label="Email" value={currentUser.email} />
                  <InfoRow label="Business Reg. No." value={currentUser.businessNumber} />
                  <InfoRow label="Member Since" value={memberRecord?.registeredDate ?? '—'} />
                  <InfoRow
                    label="Account Status"
                    value={
                      approvalStatus === 'approved' ? '✅ Verified Business'
                      : approvalStatus === 'pending' ? '⏳ Pending Review'
                      : '❌ Not Approved'
                    }
                  />
                </div>
              </div>

              {/* Editable fields */}
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <Building2 size={15} className="text-[#4a90e2]" />
                  <h3 className="text-[14px] font-semibold text-[#222]">Company Details</h3>
                </div>
                <form onSubmit={handleSaveAccount} className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <AField label="Company Name *">
                      <input
                        value={accountForm.companyName}
                        onChange={(e) => setAccountForm({ ...accountForm, companyName: e.target.value })}
                        className={inputCls}
                      />
                    </AField>
                    <AField label="Representative Name *">
                      <input
                        value={accountForm.representative}
                        onChange={(e) => setAccountForm({ ...accountForm, representative: e.target.value })}
                        className={inputCls}
                      />
                    </AField>
                  </div>
                  <AField label="Phone Number">
                    <div className="relative">
                      <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#bbb]" />
                      <input
                        value={accountForm.phone}
                        onChange={(e) => setAccountForm({ ...accountForm, phone: e.target.value })}
                        placeholder="+82-10-1234-5678"
                        className={`${inputCls} pl-8`}
                      />
                    </div>
                  </AField>
                  <AField label="Business Address">
                    <div className="relative">
                      <MapPin size={14} className="absolute left-3 top-3.5 text-[#bbb]" />
                      <textarea
                        value={accountForm.address}
                        onChange={(e) => setAccountForm({ ...accountForm, address: e.target.value })}
                        rows={2}
                        className={`${inputCls} pl-8 resize-none`}
                      />
                    </div>
                  </AField>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={accountSaving}
                      className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[13px] font-semibold hover:bg-[#555] transition-colors disabled:opacity-50"
                    >
                      {accountSaving ? 'Saving…' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ══════════════════════════════
              TAB: SECURITY
          ══════════════════════════════ */}
          {tab === 'security' && (
            <div className="space-y-5">
              <h2 className="text-[16px] font-bold text-[#222]">Security Settings</h2>

              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <Lock size={15} className="text-[#4a90e2]" />
                  <h3 className="text-[14px] font-semibold text-[#222]">Change Password</h3>
                </div>

                <form onSubmit={handleChangePassword} className="px-5 py-5 space-y-4 max-w-[400px]">
                  {[
                    { key: 'current' as const, label: 'Current Password' },
                    { key: 'next'    as const, label: 'New Password' },
                    { key: 'confirm' as const, label: 'Confirm New Password' },
                  ].map(({ key, label }) => (
                    <AField key={key} label={label}>
                      <div className="relative">
                        <input
                          type={showPw[key] ? 'text' : 'password'}
                          value={pwForm[key]}
                          onChange={(e) => setPwForm({ ...pwForm, [key]: e.target.value })}
                          className={`${inputCls} pr-10`}
                          placeholder={key === 'next' ? 'Min. 8 characters' : ''}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPw({ ...showPw, [key]: !showPw[key] })}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#bbb] hover:text-[#666]"
                        >
                          {showPw[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </AField>
                  ))}

                  <div className="bg-[#f8f8fa] rounded-lg p-3 flex gap-2 text-[12px] text-[#888]">
                    <AlertCircle size={14} className="text-[#aaa] shrink-0 mt-0.5" />
                    <span>Password must be at least 8 characters. Use a mix of letters, numbers, and symbols for better security.</span>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={pwSaving}
                      className="px-6 py-2.5 bg-[#4a90e2] text-white rounded-lg text-[13px] font-semibold hover:bg-[#357abd] transition-colors disabled:opacity-50"
                    >
                      {pwSaving ? 'Updating…' : 'Update Password'}
                    </button>
                  </div>
                </form>
              </div>

              {/* Login info */}
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <User size={15} className="text-[#4a90e2]" />
                  <h3 className="text-[14px] font-semibold text-[#222]">Login Information</h3>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <InfoRow label="Login Email" value={currentUser.email} />
                  <InfoRow label="Account Type" value={currentUser.isAdmin ? 'Administrator' : 'Business Member'} />
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

/* ── Shared helpers ── */
const inputCls =
  'w-full px-3 py-2.5 border border-[#e5e5e5] rounded-lg text-[13px] focus:outline-none focus:border-[#4a90e2] transition-colors';

function AField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-[#666] mb-1">{label}</label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-[#aaa] uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-[13px] text-[#333] font-medium">{value || '—'}</p>
    </div>
  );
}
