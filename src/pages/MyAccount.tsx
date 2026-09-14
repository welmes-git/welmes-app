import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import { useCurrency } from '../context/CurrencyContext';
import {
  Package,
  User,
  Lock,
  ChevronRight,
  Truck,
  AlertCircle,
  Eye,
  EyeOff,
  Building2,
  Phone,
  MapPin,
  CreditCard,
  Printer,
  Heart,
} from 'lucide-react';

type Tab = 'orders' | 'account' | 'security';

export default function MyAccount() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { formatPrice } = useCurrency();
  const {
    isAuthenticated,
    currentUser,
    orders,
    members,
    updateMember,
    loadMyOrders,
    showToast,
  } = useStore();

  const [tab, setTab] = useState<Tab>('orders');
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Orders live in Supabase — pull the current user's orders on mount so the
  // list survives a page refresh (the store only holds them in-session otherwise)
  useEffect(() => {
    if (isAuthenticated) loadMyOrders();
  }, [isAuthenticated, loadMyOrders]);

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
        <User size={48} className="mx-auto text-line-strong mb-4" />
        <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 mb-2">{t('account.loginRequired')}</h2>
        <p className="text-[14px] text-ink-500 mb-6">{t('account.loginRequiredDesc')}</p>
        <button
          onClick={() => navigate('/login')}
          className="px-6 py-2.5 bg-ink-700 text-white rounded-lg text-[14px] hover:bg-ink-900 transition-colors"
        >
          {t('account.goToLogin')}
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
      showToast(t('common.required'), 'error');
      return;
    }
    setAccountSaving(true);
    const { error } = await updateMember(currentUser!.id, accountForm);
    setAccountSaving(false);
    if (error) {
      showToast(t('common.error'), 'error');
      return;
    }
    showToast(t('account.infoUpdated'), 'success');
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!pwForm.current || !pwForm.next || !pwForm.confirm) {
      showToast(t('common.required'), 'error');
      return;
    }
    if (pwForm.next.length < 8) {
      showToast(t('account.passwordHint'), 'error');
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      showToast(t('auth.passwordMismatch'), 'error');
      return;
    }
    setPwSaving(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: currentUser!.email,
      password: pwForm.current,
    });
    if (signInErr) {
      showToast(t('auth.loginFailed'), 'error');
      setPwSaving(false);
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password: pwForm.next });
    if (updateErr) {
      showToast(t('common.error'), 'error');
      setPwSaving(false);
      return;
    }
    setPwForm({ current: '', next: '', confirm: '' });
    setPwSaving(false);
    showToast(t('account.passwordUpdated'), 'success');
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'orders',   label: t('account.myOrders'),    icon: <Package size={16} /> },
    { key: 'account',  label: t('account.accountInfo'), icon: <User size={16} /> },
    { key: 'security', label: t('account.security'),    icon: <Lock size={16} /> },
  ];

  // Status is a 6px dot + text; only completed/cancelled earn a signal color
  const statusDot: Record<string, string> = {
    pending:    'bg-ink-300',
    processing: 'bg-ink-500',
    shipped:    'bg-ink-900',
    completed:  'bg-signal-ok',
    cancelled:  'bg-signal-error',
  };

  return (
    <div className="bg-canvas min-h-screen pb-16">
      {/* Page header */}
      <div className="bg-white border-b border-line">
        <div className="max-w-[960px] mx-auto px-4 py-5">
          <h1 className="font-serif text-[30px] font-normal leading-[38px] text-ink-700">{t('account.title')}</h1>
        </div>
      </div>

      <div className="max-w-[960px] mx-auto px-4 pt-6 flex flex-col lg:flex-row gap-6">

        {/* ── Sidebar ── */}
        <aside className="lg:w-[220px] shrink-0 space-y-3">
          {/* Profile card */}
          <div className="bg-white rounded-sm border border-line p-4">
            <div className="w-12 h-12 rounded-full border border-line flex items-center justify-center mb-3">
              <User size={22} className="text-ink-700" />
            </div>
            <p className="text-[14px] font-bold text-ink-900 leading-tight">{currentUser.companyName}</p>
            <p className="text-[12px] text-ink-500 mt-0.5">{currentUser.email}</p>
            <div className="mt-3">
              {approvalStatus === 'approved' ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ink-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal-ok" /> {t('account.verifiedBusiness')}
                </span>
              ) : approvalStatus === 'pending' ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ink-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-ink-500" /> {t('account.pendingReview')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ink-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal-error" /> {t('account.notApproved')}
                </span>
              )}
            </div>
          </div>

          {/* Nav */}
          <div className="bg-white rounded-sm border border-line overflow-hidden">
            {tabs.map((tabItem) => (
              <button
                key={tabItem.key}
                onClick={() => setTab(tabItem.key)}
                className={`w-full flex items-center justify-between px-4 py-3.5 text-[13px] font-medium transition-colors border-b border-line last:border-0 ${
                  tab === tabItem.key
                    ? 'bg-sunken font-bold text-ink-900 shadow-[inset_2px_0_0_var(--wm-ink-900)]'
                    : 'text-ink-700 hover:bg-sunken'
                }`}
              >
                <span className="flex items-center gap-2">
                  {tabItem.icon}
                  {tabItem.label}
                </span>
                <ChevronRight size={14} className="text-line-strong" />
              </button>
            ))}
            <button
              onClick={() => navigate('/wishlist')}
              className="w-full flex items-center justify-between px-4 py-3.5 text-[13px] font-medium transition-colors text-ink-500 hover:bg-sunken"
            >
              <span className="flex items-center gap-2">
                <Heart size={16} />
                {t('account.wishlist')}
              </span>
              <ChevronRight size={14} className="text-line-strong" />
            </button>
          </div>
        </aside>

        {/* ── Main Content ── */}
        <div className="flex-1 min-w-0">

          {/* ══ TAB: MY ORDERS ══ */}
          {tab === 'orders' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700">{t('account.orderHistory')}</h2>
                <span className="text-[13px] text-ink-500">{myOrders.length} {t('account.orders')}</span>
              </div>

              {myOrders.length === 0 ? (
                <div className="bg-white rounded-sm border border-line py-16 text-center">
                  <Package size={44} className="mx-auto text-line-strong mb-3" />
                  <p className="text-[14px] text-ink-500 mb-1">{t('account.noOrders')}</p>
                  <p className="text-[12px] text-ink-300 mb-5">{t('account.noOrdersDesc')}</p>
                  <Link
                    to="/products"
                    className="inline-block px-5 py-2 bg-ink-700 text-white text-[13px] rounded-lg hover:bg-ink-900 transition-colors"
                  >
                    {t('account.startShopping')}
                  </Link>
                </div>
              ) : (
                myOrders.map((order) => {
                  const dotCls = statusDot[order.status] ?? statusDot.pending;
                  const isExpanded = expandedOrder === order.id;
                  return (
                    <div key={order.id} className="bg-white rounded-sm border border-line overflow-hidden">
                      {/* Order header */}
                      <button
                        onClick={() => setExpandedOrder(isExpanded ? null : order.id)}
                        className="w-full px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-sunken transition-colors text-left"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div>
                            <p className="text-[13px] font-bold text-ink-900 font-mono">{order.id}</p>
                            <p className="text-[12px] text-ink-300 mt-0.5">{order.date}</p>
                          </div>
                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-ink-700 w-fit">
                            <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />{t(`status.${order.status}`)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className="text-[16px] font-bold tabular-nums text-ink-900">{formatPrice(order.total)}</p>
                            {order.vat !== undefined && (
                              <p className="text-[11px] text-ink-300">incl. VAT {formatPrice(order.vat)}</p>
                            )}
                          </div>
                          <Link
                            to={`/order/${order.id}/print`}
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 w-8 h-8 flex items-center justify-center text-ink-500 hover:text-ink-900 hover:bg-sunken rounded-lg transition-colors border border-line"
                            title={t('account.printOrder')}
                          >
                            <Printer size={14} />
                          </Link>
                          <ChevronRight
                            size={16}
                            className={`text-line-strong transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                          />
                        </div>
                      </button>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="border-t border-line px-5 py-4 space-y-4">
                          {/* Items */}
                          {order.items.length > 0 ? (
                            <div>
                              <p className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.02em] mb-3">{t('account.itemsOrdered')}</p>
                              <div className="space-y-3">
                                {order.items.map((item, idx) => (
                                  <div key={idx} className="flex items-center gap-3">
                                    <img
                                      src={item.product.image}
                                      alt={item.product.nameEn ?? item.product.name}
                                      onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/48x48/f0f0f0/999?text=IMG'; }}
                                      className="w-12 h-12 object-cover rounded-lg border border-line shrink-0"
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-[12px] text-ink-300 uppercase">{item.product.brand}</p>
                                      <p className="text-[13px] text-ink-700 truncate">{item.product.nameEn ?? item.product.name}</p>
                                      {item.setOption && (
                                        <p className="text-[11px] text-ink-500 truncate">
                                          <span className="font-bold text-ink-900">{item.setOption.id}</span> · {item.setOption.description}
                                        </p>
                                      )}
                                    </div>
                                    <div className="text-right shrink-0">
                                      <p className="text-[13px] font-semibold">×{item.quantity}</p>
                                      <p className="text-[12px] tabular-nums text-ink-500">{formatPrice((item.setOption?.wholesalePrice ?? item.product.wholesalePrice) * item.quantity)}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p className="text-[12px] text-ink-300">Item details not available for this order.</p>
                          )}

                          {/* Shipping */}
                          {order.shippingAddress && (
                            <div className="bg-sunken rounded-lg p-3">
                              <p className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.02em] mb-1.5">{t('account.shippingAddress')}</p>
                              <p className="text-[13px] text-ink-500">
                                {order.shippingAddress.company} · {t('checkout.attn')}: {order.shippingAddress.recipient}
                              </p>
                              <p className="text-[12px] text-ink-500">
                                {order.shippingAddress.addressLine1}, {order.shippingAddress.city} {order.shippingAddress.zipCode}, {order.shippingAddress.country}
                              </p>
                            </div>
                          )}

                          {/* Tracking */}
                          {order.trackingNumber && (
                            <div className="bg-sunken border border-line rounded-lg p-3">
                              <p className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.02em] mb-2 flex items-center gap-1.5">
                                <Truck size={13} />
                                {t('account.shipmentTracking')}
                              </p>
                              <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div>
                                  <p className="text-[13px] text-ink-700 font-medium">{order.trackingCarrier}</p>
                                  <p className="text-[13px] font-mono text-ink-500">{order.trackingNumber}</p>
                                  {order.trackingShippedAt && (
                                    <p className="text-[11px] text-ink-300 mt-0.5">{t('account.shippedOn')} {order.trackingShippedAt}</p>
                                  )}
                                </div>
                                <a
                                  href={`https://www.17track.net/en/track#nums=${order.trackingNumber}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 h-8 px-4 bg-ink-700 text-white text-[12px] rounded-lg flex items-center gap-1.5 hover:bg-ink-900 transition-colors"
                                >
                                  <Truck size={12} />
                                  {t('account.trackPackage')}
                                </a>
                              </div>
                            </div>
                          )}

                          {/* PO / Notes */}
                          {(order.poNumber || order.notes) && (
                            <div className="flex gap-4 text-[12px] text-ink-500">
                              {order.poNumber && <p>{t('account.po')}: <span className="font-medium text-ink-500">{order.poNumber}</span></p>}
                              {order.notes && <p>{t('account.notes')}: <span className="font-medium text-ink-500">{order.notes}</span></p>}
                            </div>
                          )}

                          {/* Price breakdown */}
                          <div className="border-t border-line pt-3 space-y-1 text-[13px]">
                            {order.subtotal !== undefined && (
                              <div className="flex justify-between text-ink-500">
                                <span>{t('checkout.subtotal')}</span>
                                <span className="tabular-nums">{formatPrice(order.subtotal)}</span>
                              </div>
                            )}
                            {order.vat !== undefined && (
                              <div className="flex justify-between text-ink-500">
                                <span>{t('checkout.vat')}</span>
                                <span className="tabular-nums">{formatPrice(order.vat)}</span>
                              </div>
                            )}
                            <div className="flex justify-between font-bold text-ink-900 pt-1 border-t border-line">
                              <span>{t('account.total')}</span>
                              <span className="tabular-nums">{formatPrice(order.total)}</span>
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

          {/* ══ TAB: ACCOUNT INFO ══ */}
          {tab === 'account' && (
            <div className="space-y-5">
              <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700">{t('account.accountInfo')}</h2>

              {/* Read-only info */}
              <div className="bg-white rounded-sm border border-line overflow-hidden">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                  <CreditCard size={15} className="text-ink-500" />
                  <h3 className="text-[14px] font-medium text-ink-700">{t('account.businessReg')}</h3>
                  <span className="text-[11px] text-ink-300 ml-1">({t('account.readOnly')})</span>
                </div>
                <div className="px-5 py-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InfoRow label={t('auth.email')} value={currentUser.email} />
                  <InfoRow label={t('auth.businessRegNo')} value={currentUser.businessNumber} />
                  {/* `members` is only loaded for admins — fall back to the
                      signed-in user's own record so this isn't always "—" */}
                  <InfoRow label="Member Since" value={memberRecord?.registeredDate ?? currentUser.registeredDate ?? '—'} />
                  <InfoRow
                    label={t('account.status')}
                    value={
                      approvalStatus === 'approved' ? t('account.verifiedBusiness')
                      : approvalStatus === 'pending' ? t('account.pendingReview')
                      : t('account.notApproved')
                    }
                  />
                </div>
              </div>

              {/* Editable fields */}
              <div className="bg-white rounded-sm border border-line overflow-hidden">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                  <Building2 size={15} className="text-ink-500" />
                  <h3 className="text-[14px] font-medium text-ink-700">{t('account.companyDetails')}</h3>
                </div>
                <form onSubmit={handleSaveAccount} className="px-5 py-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <AField label={`${t('auth.companyName')} *`}>
                      <input
                        value={accountForm.companyName}
                        onChange={(e) => setAccountForm({ ...accountForm, companyName: e.target.value })}
                        className={inputCls}
                      />
                    </AField>
                    <AField label={`${t('auth.representative')} *`}>
                      <input
                        value={accountForm.representative}
                        onChange={(e) => setAccountForm({ ...accountForm, representative: e.target.value })}
                        className={inputCls}
                      />
                    </AField>
                  </div>
                  <AField label={t('auth.phone')}>
                    <div className="relative">
                      <Phone size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-300" />
                      <input
                        value={accountForm.phone}
                        onChange={(e) => setAccountForm({ ...accountForm, phone: e.target.value })}
                        placeholder="+82-10-1234-5678"
                        className={`${inputCls} pl-8`}
                      />
                    </div>
                  </AField>
                  <AField label={t('auth.address')}>
                    <div className="relative">
                      <MapPin size={14} className="absolute left-3 top-3.5 text-ink-300" />
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
                      className="px-6 py-2.5 bg-ink-700 text-white rounded-lg text-[13px] hover:bg-ink-900 transition-colors disabled:opacity-50"
                    >
                      {accountSaving ? t('account.saving') : t('account.saveChanges')}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* ══ TAB: SECURITY ══ */}
          {tab === 'security' && (
            <div className="space-y-5">
              <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700">{t('account.securitySettings')}</h2>

              <div className="bg-white rounded-sm border border-line overflow-hidden">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                  <Lock size={15} className="text-ink-500" />
                  <h3 className="text-[14px] font-medium text-ink-700">{t('account.changePassword')}</h3>
                </div>

                <form onSubmit={handleChangePassword} className="px-5 py-5 space-y-4 max-w-[400px]">
                  {[
                    { key: 'current' as const, label: t('account.currentPassword') },
                    { key: 'next'    as const, label: t('account.newPassword') },
                    { key: 'confirm' as const, label: t('account.confirmNewPassword') },
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
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-500"
                        >
                          {showPw[key] ? <EyeOff size={15} /> : <Eye size={15} />}
                        </button>
                      </div>
                    </AField>
                  ))}

                  <div className="bg-sunken rounded-lg p-3 flex gap-2 text-[12px] text-ink-500">
                    <AlertCircle size={14} className="text-ink-300 shrink-0 mt-0.5" />
                    <span>{t('account.passwordHint')}</span>
                  </div>

                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={pwSaving}
                      className="px-6 py-2.5 bg-ink-700 text-white rounded-lg text-[13px] hover:bg-ink-900 transition-colors disabled:opacity-50"
                    >
                      {pwSaving ? t('account.updating') : t('account.updatePassword')}
                    </button>
                  </div>
                </form>
              </div>

              {/* Login info */}
              <div className="bg-white rounded-sm border border-line overflow-hidden">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                  <User size={15} className="text-ink-500" />
                  <h3 className="text-[14px] font-medium text-ink-700">{t('account.loginInfo')}</h3>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <InfoRow label={t('account.loginEmail')} value={currentUser.email} />
                  <InfoRow label={t('account.accountType')} value={currentUser.isAdmin ? t('account.administrator') : t('account.businessMember')} />
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
  'w-full px-3 py-2.5 border border-line-strong rounded-lg bg-canvas text-[13px] text-ink-700 placeholder:text-ink-300 focus:outline-none focus:border-ink-900 transition-colors';

function AField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-ink-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.02em] mb-0.5">{label}</p>
      <p className="text-[13px] text-ink-700 font-medium">{value || '—'}</p>
    </div>
  );
}
