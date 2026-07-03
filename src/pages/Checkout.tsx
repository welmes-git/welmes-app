import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PayPalButtons, usePayPalScriptReducer } from '@paypal/react-paypal-js';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import type { ShippingAddress } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { convert, getCurrencyInfo } from '../lib/currency';
import type { CurrencyCode } from '../lib/currency';
import {
  ChevronRight,
  CheckCircle2,
  Package,
  Truck,
  ClipboardList,
  ArrowLeft,
  Building2,
  Copy,
} from 'lucide-react';

// ── Bank account config (replace with real info) ──────────────────────────────
const BANK_ACCOUNTS = [
  {
    currency: 'USD',
    bankName: 'Airwallex / JPMorgan Chase',
    accountName: 'WELMES Co., Ltd.',
    accountNumber: 'XXXX-XXXX-XXXX',
    swiftCode: 'XXXXUS33',
    routingNumber: '021000021',
    note: 'For USD wire transfers',
  },
  {
    currency: 'JPY',
    bankName: 'Airwallex / MUFG Bank',
    accountName: 'WELMES Co., Ltd.',
    accountNumber: 'XXXX-XXXXXXX',
    swiftCode: 'BOTKJPJT',
    note: 'For JPY wire transfers',
  },
  {
    currency: 'EUR',
    bankName: 'Airwallex / Barclays',
    accountName: 'WELMES Co., Ltd.',
    accountNumber: 'GB00 BARC XXXX XXXX XXXX XX',
    swiftCode: 'BARCGB22',
    note: 'For EUR wire transfers (IBAN)',
  },
];

type Step = 'review' | 'shipping' | 'confirmed';

const STEPS: { key: Step; labelKey: string }[] = [
  { key: 'review', labelKey: 'checkout.reviewOrder' },
  { key: 'shipping', labelKey: 'checkout.shippingInfo' },
  { key: 'confirmed', labelKey: 'checkout.confirmed' },
];

const COUNTRIES = [
  'South Korea',
  'United States',
  'Japan',
  'China',
  'Australia',
  'Canada',
  'United Kingdom',
  'Germany',
  'France',
  'Singapore',
  'Hong Kong',
  'Taiwan',
  'Vietnam',
  'Thailand',
  'Indonesia',
  'Malaysia',
  'Philippines',
  'Other',
];

const VAT_RATE = 0.1;

// Currencies PayPal accepts; KRW/CNY are unsupported so those fall back to JPY
const PAYPAL_CURRENCIES: CurrencyCode[] = ['JPY', 'USD', 'EUR', 'GBP', 'SGD', 'AUD'];


function genOrderId() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 900 + 100);
  return `ORD-${date}-${rand}`;
}

export default function Checkout() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { cart, currentUser, addOrder, clearCart, isAuthenticated, showToast } = useStore();
  const { formatPrice, currency, rates } = useCurrency();
  const [step, setStep] = useState<Step>('review');
  const [orderId, setOrderId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<ShippingAddress>>({});
  const [confirmedTotals, setConfirmedTotals] = useState({ subtotal: 0, vat: 0, total: 0 });
  const [paymentMethod, setPaymentMethod] = useState<'paypal' | 'bank_transfer'>('bank_transfer');
  const [selectedBankCurrency, setSelectedBankCurrency] = useState('USD');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const [shipping, setShipping] = useState<ShippingAddress>({
    company: currentUser?.companyName ?? '',
    recipient: currentUser?.representative ?? '',
    phone: currentUser?.phone ?? '',
    addressLine1: currentUser?.address ?? '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'South Korea',
  });

  const subtotal = cart.reduce(
    (sum, item) => sum + (item.setOption?.wholesalePrice ?? item.product.wholesalePrice) * item.quantity,
    0
  );
  const vat = Math.round(subtotal * VAT_RATE);
  const total = subtotal + vat;
  const totalUnits = cart.reduce(
    (sum, item) => sum + (item.setOption?.unitsPerSet ?? 1) * item.quantity,
    0
  );

  if (!isAuthenticated) {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-20 text-center">
        <Package size={48} className="mx-auto text-[#ddd] mb-4" />
        <h2 className="text-[20px] font-bold mb-2">{t('checkout.loginRequired')}</h2>
        <p className="text-[14px] text-[#999] mb-6">
          {t('checkout.loginRequiredDesc')}
        </p>
        <button
          onClick={() => navigate('/login')}
          className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[14px] hover:bg-[#555] transition-colors"
        >
          {t('checkout.goToLogin')}
        </button>
      </div>
    );
  }

  if (cart.length === 0 && step !== 'confirmed') {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-20 text-center">
        <Package size={48} className="mx-auto text-[#ddd] mb-4" />
        <h2 className="text-[20px] font-bold mb-2">{t('checkout.cartEmpty')}</h2>
        <p className="text-[14px] text-[#999] mb-6">
          {t('checkout.cartEmptyDesc')}
        </p>
        <button
          onClick={() => navigate('/products')}
          className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[14px] hover:bg-[#555] transition-colors"
        >
          {t('checkout.browseProducts')}
        </button>
      </div>
    );
  }

  /* ─── Validation ─── */
  function validateShipping(): boolean {
    const e: Partial<ShippingAddress> = {};
    if (!shipping.company.trim()) e.company = t('checkout.errCompany');
    if (!shipping.recipient.trim()) e.recipient = t('checkout.errRecipient');
    if (!shipping.phone.trim()) e.phone = t('checkout.errPhone');
    if (!shipping.addressLine1.trim()) e.addressLine1 = t('checkout.errAddress');
    if (!shipping.city.trim()) e.city = t('checkout.errCity');
    if (!shipping.zipCode.trim()) e.zipCode = t('checkout.errZip');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /* ─── Place Order ─── */
  function handlePlaceOrder(method: 'paypal' | 'bank_transfer' = 'bank_transfer') {
    if (!validateShipping()) return;
    const id = genOrderId();
    addOrder({
      id,
      memberId: currentUser!.id,
      memberName: currentUser!.companyName,
      items: [...cart],
      subtotal,
      vat,
      total,
      status: method === 'paypal' ? 'processing' : 'pending',
      date: new Date().toISOString().split('T')[0],
      poNumber: poNumber.trim() || undefined,
      notes: notes.trim() || undefined,
      shippingAddress: shipping,
    });
    setConfirmedTotals({ subtotal, vat, total });
    clearCart();
    setOrderId(id);
    setStep('confirmed');
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  /* ─── PayPal ─── */
  const [{ isPending: paypalLoading }] = usePayPalScriptReducer();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function createPayPalOrder(_data: unknown, actions: any) {
    if (!validateShipping()) return Promise.reject('invalid');
    const paypalCurrency: CurrencyCode = PAYPAL_CURRENCIES.includes(currency) ? currency : 'JPY';
    const decimals = getCurrencyInfo(paypalCurrency).decimals;
    const amount = convert(total, paypalCurrency, rates);
    return actions.order.create({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: paypalCurrency,
          value: amount.toFixed(decimals),
        },
        description: `WELMES Order — ${cart.length} item(s)`,
      }],
    });
  }

  function onPayPalApprove(_data: unknown, actions: { order?: { capture: () => Promise<unknown> } }) {
    return actions.order!.capture().then(() => {
      handlePlaceOrder('paypal');
    });
  }

  const selectedBank = BANK_ACCOUNTS.find((b) => b.currency === selectedBankCurrency) ?? BANK_ACCOUNTS[0];

  // Wire transfers must be made in the bank account's currency, so convert the
  // JPY-based total into that currency instead of the display currency
  const formatBankAmount = (amountJPY: number) => {
    const code = selectedBankCurrency as CurrencyCode;
    const info = getCurrencyInfo(code);
    const value = convert(amountJPY, code, rates);
    return `${code} ${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(value)}`;
  };

  /* ─── Step indicator ─── */
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="bg-[#f8f8fa] min-h-screen pb-16">
      {/* Page header */}
      <div className="bg-white border-b border-[#e5e5e5]">
        <div className="max-w-[960px] mx-auto px-4 py-5 flex items-center gap-3">
          {step !== 'confirmed' && (
            <button
              onClick={() =>
                step === 'review' ? navigate('/products') : setStep('review')
              }
              className="text-[#999] hover:text-[#333] transition-colors mr-1"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h1 className="text-[20px] font-bold text-[#222]">{t('checkout.title')}</h1>
        </div>

        {/* Step progress */}
        <div className="max-w-[960px] mx-auto px-4 pb-4">
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                      i < stepIndex
                        ? 'bg-[#4a90e2] text-white'
                        : i === stepIndex
                        ? 'bg-[#333] text-white'
                        : 'bg-[#e5e5e5] text-[#aaa]'
                    }`}
                  >
                    {i < stepIndex ? <CheckCircle2 size={14} /> : i + 1}
                  </div>
                  <span
                    className={`text-[12px] font-medium ${
                      i === stepIndex ? 'text-[#222]' : 'text-[#aaa]'
                    }`}
                  >
                    {t(s.labelKey)}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight size={14} className="text-[#ccc] mx-3" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-[960px] mx-auto px-4 pt-6">

        {/* ═══════════════════════════════════════════
            STEP 1 — REVIEW ORDER
        ═══════════════════════════════════════════ */}
        {step === 'review' && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Item table */}
            <div className="flex-1">
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <ClipboardList size={16} className="text-[#4a90e2]" />
                  <h2 className="text-[15px] font-semibold text-[#222]">{t('checkout.orderItems')}</h2>
                  <span className="text-[12px] text-[#aaa] ml-1">({t('checkout.lines', { count: cart.length })})</span>
                </div>

                {/* Header row */}
                <div className="hidden md:grid grid-cols-[2fr_1fr_80px_90px] gap-2 px-5 py-2.5 bg-[#f8f8fa] border-b border-[#f0f0f0] text-[11px] font-semibold text-[#aaa] uppercase tracking-wide">
                  <span>{t('checkout.product')}</span>
                  <span>{t('checkout.setOption')}</span>
                  <span className="text-center">{t('checkout.qty')}</span>
                  <span className="text-right">{t('checkout.subtotalCol')}</span>
                </div>

                {cart.map((item) => {
                  const lineTotal = (item.setOption?.wholesalePrice ?? item.product.wholesalePrice) * item.quantity;
                  return (
                    <div
                      key={`${item.product.id}-${item.setOption?.id}`}
                      className="grid grid-cols-1 md:grid-cols-[2fr_1fr_80px_90px] gap-2 items-center px-5 py-4 border-b border-[#f8f8f8] last:border-0"
                    >
                      {/* Product */}
                      <div className="flex gap-3 items-center">
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'https://placehold.co/60x60/f0f0f0/999?text=IMG';
                          }}
                          className="w-[56px] h-[56px] object-cover rounded-lg border border-[#f0f0f0] shrink-0"
                        />
                        <div>
                          <p className="text-[11px] text-[#aaa] uppercase font-medium">{item.product.brand}</p>
                          <p className="text-[13px] text-[#222] font-medium leading-tight">{item.product.name}</p>
                          <p className="text-[12px] text-[#4a90e2] font-semibold mt-0.5">
                            {formatPrice(item.product.wholesalePrice)} {t('products.perSet')}
                          </p>
                        </div>
                      </div>

                      {/* Set option badge */}
                      <div>
                        {item.setOption ? (
                          <div>
                            <span className="inline-block px-2 py-0.5 bg-[#f0f7ff] text-[#4a90e2] text-[11px] font-bold rounded">
                              {item.setOption.id}
                            </span>
                            <p className="text-[11px] text-[#999] mt-0.5">{item.setOption.description}</p>
                            <p className="text-[11px] text-[#bbb]">{item.setOption.unitsPerSet} {t('productDetail.unitsPerSet')}</p>
                          </div>
                        ) : (
                          <span className="text-[12px] text-[#bbb]">—</span>
                        )}
                      </div>

                      {/* Qty */}
                      <div className="text-center">
                        <span className="text-[15px] font-semibold text-[#333]">{item.quantity}</span>
                        {item.setOption && (
                          <p className="text-[10px] text-[#bbb]">
                            {item.quantity * item.setOption.unitsPerSet} {t('cart.units')}
                          </p>
                        )}
                      </div>

                      {/* Subtotal */}
                      <div className="text-right">
                        <p className="text-[14px] font-bold text-[#222]">{formatPrice(lineTotal)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary sidebar */}
            <div className="lg:w-[280px] shrink-0">
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden sticky top-4">
                <div className="px-5 py-4 border-b border-[#f0f0f0]">
                  <h2 className="text-[15px] font-semibold text-[#222]">{t('checkout.orderSummary')}</h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">{t('checkout.totalSets')}</span>
                    <span className="font-medium">{cart.reduce((s, i) => s + i.quantity, 0)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">{t('checkout.totalUnits')}</span>
                    <span className="font-medium">{totalUnits.toLocaleString()}</span>
                  </div>
                  <div className="border-t border-[#f0f0f0] pt-3 flex justify-between text-[13px]">
                    <span className="text-[#666]">{t('checkout.subtotal')}</span>
                    <span className="font-medium">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">{t('checkout.vat')}</span>
                    <span className="font-medium">{formatPrice(vat)}</span>
                  </div>
                  <div className="border-t border-[#e5e5e5] pt-3 flex justify-between">
                    <span className="text-[14px] font-bold text-[#222]">{t('checkout.grandTotal')}</span>
                    <span className="text-[18px] font-bold text-[#333]">{formatPrice(total)}</span>
                  </div>
                  <p className="text-[10px] text-[#bbb] leading-relaxed">
                    {t('checkout.vatNote')}
                  </p>
                </div>
                <div className="px-5 pb-5">
                  <button
                    onClick={() => setStep('shipping')}
                    className="w-full py-3 bg-[#333] text-white rounded-lg text-[14px] font-semibold hover:bg-[#555] transition-colors flex items-center justify-center gap-2"
                  >
                    {t('checkout.proceedToShipping')}
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 2 — SHIPPING INFO
        ═══════════════════════════════════════════ */}
        {step === 'shipping' && (
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Form */}
            <div className="flex-1 space-y-5">

              {/* Delivery Address */}
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <Truck size={16} className="text-[#4a90e2]" />
                  <h2 className="text-[15px] font-semibold text-[#222]">{t('checkout.deliveryAddress')}</h2>
                </div>
                <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label={`${t('checkout.companyName')} *`} error={errors.company}>
                    <input
                      value={shipping.company}
                      onChange={(e) => setShipping({ ...shipping, company: e.target.value })}
                      placeholder="ACME Trading Co., Ltd."
                      className={input(!!errors.company)}
                    />
                  </Field>

                  <Field label={`${t('checkout.recipientName')} *`} error={errors.recipient}>
                    <input
                      value={shipping.recipient}
                      onChange={(e) => setShipping({ ...shipping, recipient: e.target.value })}
                      placeholder="John Smith"
                      className={input(!!errors.recipient)}
                    />
                  </Field>

                  <Field label={`${t('checkout.phoneNumber')} *`} error={errors.phone}>
                    <input
                      value={shipping.phone}
                      onChange={(e) => setShipping({ ...shipping, phone: e.target.value })}
                      placeholder="+82-10-1234-5678"
                      className={input(!!errors.phone)}
                    />
                  </Field>

                  <Field label={`${t('checkout.country')} *`}>
                    <select
                      value={shipping.country}
                      onChange={(e) => setShipping({ ...shipping, country: e.target.value })}
                      className={input(false)}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </Field>

                  <div className="md:col-span-2">
                    <Field label={`${t('checkout.addressLine1')} *`} error={errors.addressLine1}>
                      <input
                        value={shipping.addressLine1}
                        onChange={(e) => setShipping({ ...shipping, addressLine1: e.target.value })}
                        placeholder="123 Teheran-ro, Gangnam-gu"
                        className={input(!!errors.addressLine1)}
                      />
                    </Field>
                  </div>

                  <div className="md:col-span-2">
                    <Field label={t('checkout.addressLine2')}>
                      <input
                        value={shipping.addressLine2}
                        onChange={(e) => setShipping({ ...shipping, addressLine2: e.target.value })}
                        placeholder={t('checkout.addr2Placeholder')}
                        className={input(false)}
                      />
                    </Field>
                  </div>

                  <Field label={`${t('checkout.city')} *`} error={errors.city}>
                    <input
                      value={shipping.city}
                      onChange={(e) => setShipping({ ...shipping, city: e.target.value })}
                      placeholder="Seoul"
                      className={input(!!errors.city)}
                    />
                  </Field>

                  <Field label={t('checkout.stateProvince')}>
                    <input
                      value={shipping.state}
                      onChange={(e) => setShipping({ ...shipping, state: e.target.value })}
                      placeholder={t('checkout.statePlaceholder')}
                      className={input(false)}
                    />
                  </Field>

                  <Field label={`${t('checkout.zipCode')} *`} error={errors.zipCode}>
                    <input
                      value={shipping.zipCode}
                      onChange={(e) => setShipping({ ...shipping, zipCode: e.target.value })}
                      placeholder="06236"
                      className={input(!!errors.zipCode)}
                    />
                  </Field>
                </div>
              </div>

              {/* Order Details */}
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <ClipboardList size={16} className="text-[#4a90e2]" />
                  <h2 className="text-[15px] font-semibold text-[#222]">{t('checkout.orderDetails')}</h2>
                  <span className="text-[11px] text-[#bbb]">({t('common.optional')})</span>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <Field label={t('checkout.poNumber')}>
                    <input
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      placeholder={t('checkout.poPlaceholder')}
                      className={input(false)}
                    />
                  </Field>
                  <Field label={t('checkout.deliveryNotes')}>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      placeholder={t('checkout.notesPlaceholder')}
                      className={`${input(false)} resize-none`}
                    />
                  </Field>
                </div>
              </div>
            </div>

            {/* Summary sidebar */}
            <div className="lg:w-[280px] shrink-0">
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden sticky top-4">
                <div className="px-5 py-4 border-b border-[#f0f0f0]">
                  <h2 className="text-[15px] font-semibold text-[#222]">{t('checkout.orderSummary')}</h2>
                </div>
                <div className="px-5 py-4 space-y-2 max-h-[240px] overflow-y-auto">
                  {cart.map((item) => (
                    <div key={`${item.product.id}-${item.setOption?.id}`} className="flex justify-between text-[12px] py-1 border-b border-[#f8f8f8] last:border-0">
                      <span className="text-[#555] truncate pr-2 flex-1">
                        <span className="font-medium text-[#4a90e2] mr-1">{item.setOption?.id}</span>
                        {item.product.name}
                      </span>
                      <span className="shrink-0 text-[#222] font-semibold">×{item.quantity}</span>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 border-t border-[#f0f0f0] space-y-2">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">{t('cart.subtotal')}</span>
                    <span>{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">{t('checkout.vat')}</span>
                    <span>{formatPrice(vat)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[15px] pt-2 border-t border-[#e5e5e5]">
                    <span>{t('cart.total')}</span>
                    <span>{formatPrice(total)}</span>
                  </div>
                </div>
                <div className="px-5 pb-5 space-y-3">
                  {/* Payment method selector */}
                  <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">{t('checkout.paymentMethod')}</p>
                  <div className="space-y-2">
                    <button
                      onClick={() => setPaymentMethod('bank_transfer')}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                        paymentMethod === 'bank_transfer'
                          ? 'border-[#4a90e2] bg-[#f0f7ff]'
                          : 'border-[#e5e5e5] hover:border-[#bbb]'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        paymentMethod === 'bank_transfer' ? 'border-[#4a90e2]' : 'border-[#ccc]'
                      }`}>
                        {paymentMethod === 'bank_transfer' && (
                          <div className="w-2 h-2 rounded-full bg-[#4a90e2]" />
                        )}
                      </div>
                      <Building2 size={15} className={paymentMethod === 'bank_transfer' ? 'text-[#4a90e2]' : 'text-[#aaa]'} />
                      <div>
                        <p className="text-[13px] font-semibold text-[#222]">{t('checkout.bankTransfer')}</p>
                        <p className="text-[10px] text-[#888]">{t('checkout.bankTransferDesc')}</p>
                      </div>
                    </button>

                    <button
                      onClick={() => setPaymentMethod('paypal')}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                        paymentMethod === 'paypal'
                          ? 'border-[#4a90e2] bg-[#f0f7ff]'
                          : 'border-[#e5e5e5] hover:border-[#bbb]'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        paymentMethod === 'paypal' ? 'border-[#4a90e2]' : 'border-[#ccc]'
                      }`}>
                        {paymentMethod === 'paypal' && (
                          <div className="w-2 h-2 rounded-full bg-[#4a90e2]" />
                        )}
                      </div>
                      <img src="https://www.paypalobjects.com/webstatic/icon/pp258.png" alt="PayPal" className="w-4 h-4 object-contain" />
                      <div>
                        <p className="text-[13px] font-semibold text-[#222]">PayPal</p>
                        <p className="text-[10px] text-[#888]">{t('checkout.paypalDesc')}</p>
                      </div>
                    </button>
                  </div>

                  {/* Bank transfer details */}
                  {paymentMethod === 'bank_transfer' && (
                    <div className="bg-[#f8f8fa] rounded-lg border border-[#e5e5e5] p-3 space-y-2">
                      <div className="flex gap-1.5">
                        {BANK_ACCOUNTS.map((b) => (
                          <button
                            key={b.currency}
                            onClick={() => setSelectedBankCurrency(b.currency)}
                            className={`px-3 py-1 rounded text-[11px] font-bold transition-colors ${
                              selectedBankCurrency === b.currency
                                ? 'bg-[#333] text-white'
                                : 'bg-white text-[#666] border border-[#ddd] hover:border-[#aaa]'
                            }`}
                          >
                            {b.currency}
                          </button>
                        ))}
                      </div>
                      <div className="space-y-1.5 text-[12px]">
                        <BankRow label={t('checkout.bankLabel')} value={selectedBank.bankName} field="bank" copiedField={copiedField} onCopy={copyToClipboard} />
                        <BankRow label={t('checkout.accountNameLabel')} value={selectedBank.accountName} field="name" copiedField={copiedField} onCopy={copyToClipboard} />
                        <BankRow label={t('checkout.accountNoLabel')} value={selectedBank.accountNumber} field="account" copiedField={copiedField} onCopy={copyToClipboard} />
                        <BankRow label={t('checkout.swiftLabel')} value={selectedBank.swiftCode} field="swift" copiedField={copiedField} onCopy={copyToClipboard} />
                        {selectedBank.routingNumber && (
                          <BankRow label={t('checkout.routingLabel')} value={selectedBank.routingNumber} field="routing" copiedField={copiedField} onCopy={copyToClipboard} />
                        )}
                      </div>
                      <p className="text-[10px] text-[#aaa] pt-1">{selectedBank.note}</p>
                    </div>
                  )}

                  {/* PayPal buttons */}
                  {paymentMethod === 'paypal' && (
                    <div>
                      {paypalLoading ? (
                        <div className="w-full h-11 bg-[#f5c542] rounded-lg animate-pulse" />
                      ) : (
                        <PayPalButtons
                          style={{ layout: 'horizontal', color: 'gold', shape: 'rect', label: 'paypal', height: 44 }}
                          createOrder={createPayPalOrder}
                          onApprove={onPayPalApprove}
                          onError={() => showToast(t('checkout.paypalFailed'), 'error')}
                        />
                      )}
                    </div>
                  )}

                  {/* CTA */}
                  {paymentMethod === 'bank_transfer' && (
                    <button
                      onClick={() => handlePlaceOrder('bank_transfer')}
                      className="w-full py-3 bg-[#4a90e2] text-white rounded-lg text-[14px] font-semibold hover:bg-[#357abd] transition-colors flex items-center justify-center gap-2"
                    >
                      {t('checkout.placeOrder')}
                      <ChevronRight size={16} />
                    </button>
                  )}

                  <p className="text-[10px] text-[#bbb] text-center">
                    {t('checkout.terms')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════
            STEP 3 — ORDER CONFIRMED
        ═══════════════════════════════════════════ */}
        {step === 'confirmed' && (
          <div className="max-w-[640px] mx-auto">
            {/* Success banner */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] p-8 text-center mb-5">
              <div className="w-16 h-16 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={36} className="text-green-500" />
              </div>
              <h2 className="text-[22px] font-bold text-[#222] mb-1">{t('checkout.orderPlaced')}</h2>
              <p className="text-[14px] text-[#666] mb-4">
                {t('checkout.thankYou')}
              </p>
              <div className="inline-block bg-[#f8f8fa] border border-[#e5e5e5] rounded-lg px-6 py-3">
                <p className="text-[11px] text-[#aaa] uppercase tracking-wide mb-0.5">{t('checkout.orderNumber')}</p>
                <p className="text-[20px] font-bold text-[#333] font-mono">{orderId}</p>
              </div>
            </div>

            {/* Shipping summary */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden mb-5">
              <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                <Truck size={15} className="text-[#4a90e2]" />
                <h3 className="text-[14px] font-semibold text-[#222]">{t('checkout.shippingTo')}</h3>
              </div>
              <div className="px-5 py-4 text-[13px] text-[#555] space-y-1">
                <p className="font-semibold text-[#222]">{shipping.company}</p>
                <p>{t('checkout.attn')}: {shipping.recipient} · {shipping.phone}</p>
                <p>{shipping.addressLine1}{shipping.addressLine2 ? `, ${shipping.addressLine2}` : ''}</p>
                <p>{[shipping.city, shipping.state, shipping.zipCode].filter(Boolean).join(', ')}, {shipping.country}</p>
                {poNumber && <p className="pt-1 text-[#888]">{t('account.po')}: <span className="font-medium text-[#555]">{poNumber}</span></p>}
                {notes && <p className="text-[#888]">{t('account.notes')}: <span className="font-medium text-[#555]">{notes}</span></p>}
              </div>
            </div>

            {/* Price summary */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                <ClipboardList size={15} className="text-[#4a90e2]" />
                <h3 className="text-[14px] font-semibold text-[#222]">{t('checkout.paymentSummary')}</h3>
              </div>
              <div className="px-5 py-4 space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[#666]">{t('checkout.subtotal')}</span>
                  <span>{formatPrice(confirmedTotals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#666]">{t('checkout.vat')}</span>
                  <span>{formatPrice(confirmedTotals.vat)}</span>
                </div>
                <div className="flex justify-between font-bold text-[15px] pt-3 border-t border-[#e5e5e5]">
                  <span>{t('checkout.grandTotal')}</span>
                  <span>{formatPrice(confirmedTotals.total)}</span>
                </div>
              </div>
            </div>

            {/* Bank transfer instructions */}
            {paymentMethod === 'bank_transfer' && (
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden mb-5">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <Building2 size={15} className="text-[#4a90e2]" />
                  <h3 className="text-[14px] font-semibold text-[#222]">{t('checkout.bankInstructions')}</h3>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <p className="text-[13px] text-[#555]">
                    {t('checkout.bankInstructionsDesc', { orderId })}
                  </p>
                  <div className="flex gap-1.5 mb-2">
                    {BANK_ACCOUNTS.map((b) => (
                      <button
                        key={b.currency}
                        onClick={() => setSelectedBankCurrency(b.currency)}
                        className={`px-3 py-1 rounded text-[11px] font-bold transition-colors ${
                          selectedBankCurrency === b.currency
                            ? 'bg-[#333] text-white'
                            : 'bg-[#f5f5f5] text-[#666] border border-[#ddd] hover:border-[#aaa]'
                        }`}
                      >
                        {b.currency}
                      </button>
                    ))}
                  </div>
                  <div className="bg-[#f8f8fa] rounded-lg border border-[#e5e5e5] p-3 space-y-1.5 text-[12px]">
                    <BankRow label={t('checkout.bankLabel')} value={selectedBank.bankName} field="c-bank" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label={t('checkout.accountNameLabel')} value={selectedBank.accountName} field="c-name" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label={t('checkout.accountNoLabel')} value={selectedBank.accountNumber} field="c-account" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label={t('checkout.swiftLabel')} value={selectedBank.swiftCode} field="c-swift" copiedField={copiedField} onCopy={copyToClipboard} />
                    {selectedBank.routingNumber && (
                      <BankRow label={t('checkout.routingLabel')} value={selectedBank.routingNumber} field="c-routing" copiedField={copiedField} onCopy={copyToClipboard} />
                    )}
                    <div className="pt-1 flex justify-between items-center border-t border-[#e5e5e5] mt-1">
                      <span className="text-[#888] font-medium">{t('checkout.amount')}</span>
                      <span className="font-bold text-[#222] text-[13px]">{formatBankAmount(confirmedTotals.total)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[#888] font-medium">{t('checkout.reference')}</span>
                      <span className="font-mono font-bold text-[#4a90e2]">{orderId}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#aaa]">{t('checkout.bankPaymentNote')}</p>
                </div>
              </div>
            )}

            {/* What's next */}
            <div className="bg-[#f0f7ff] border border-[#4a90e2]/20 rounded-xl px-5 py-4 mb-6 text-[13px] text-[#555] space-y-2">
              <p className="font-semibold text-[#333]">{t('checkout.whatsNext')}</p>
              <ol className="list-decimal list-inside space-y-1 text-[#666]">
                {paymentMethod === 'bank_transfer' ? (
                  <>
                    <li>{t('checkout.bankStep1')}</li>
                    <li>{t('checkout.bankStep2')}</li>
                    <li>{t('checkout.bankStep3')}</li>
                    <li>{t('checkout.bankStep4')}</li>
                  </>
                ) : (
                  <>
                    <li>{t('checkout.invoiceStep1')}</li>
                    <li>{t('checkout.invoiceStep2')}</li>
                    <li>{t('checkout.invoiceStep3')}</li>
                    <li>{t('checkout.invoiceStep4')}</li>
                  </>
                )}
              </ol>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => navigate('/products')}
                className="flex-1 py-3 border border-[#ddd] rounded-lg text-[14px] text-[#555] hover:bg-[#f5f5f5] transition-colors font-medium"
              >
                {t('checkout.continueShopping')}
              </button>
              <button
                onClick={() => navigate('/')}
                className="flex-1 py-3 bg-[#333] text-white rounded-lg text-[14px] font-semibold hover:bg-[#555] transition-colors"
              >
                {t('common.backToHome')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Shared field wrapper ─── */
function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] text-[#666] mb-1 font-medium">{label}</label>
      {children}
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}

function input(hasError: boolean) {
  return `w-full px-3 py-2.5 border rounded-lg text-[13px] focus:outline-none transition-colors ${
    hasError
      ? 'border-red-400 focus:border-red-500'
      : 'border-[#e5e5e5] focus:border-[#4a90e2]'
  }`;
}

function BankRow({
  label,
  value,
  field,
  copiedField,
  onCopy,
}: {
  label: string;
  value: string;
  field: string;
  copiedField: string | null;
  onCopy: (text: string, field: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#888] shrink-0 w-[90px]">{label}</span>
      <span className="font-semibold text-[#222] truncate flex-1">{value}</span>
      <button
        onClick={() => onCopy(value, field)}
        className="shrink-0 text-[#bbb] hover:text-[#4a90e2] transition-colors"
        title={t('common.copy')}
      >
        {copiedField === field ? (
          <CheckCircle2 size={13} className="text-green-500" />
        ) : (
          <Copy size={13} />
        )}
      </button>
    </div>
  );
}
