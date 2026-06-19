import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PayPalButtons, usePayPalScriptReducer } from '@paypal/react-paypal-js';
import { useStore } from '../store/useStore';
import type { ShippingAddress } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
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

const STEPS: { key: Step; label: string }[] = [
  { key: 'review', label: 'Review Order' },
  { key: 'shipping', label: 'Shipping Info' },
  { key: 'confirmed', label: 'Confirmed' },
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


function genOrderId() {
  const d = new Date();
  const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 900 + 100);
  return `ORD-${date}-${rand}`;
}

export default function Checkout() {
  const navigate = useNavigate();
  const { cart, currentUser, addOrder, clearCart, isAuthenticated, showToast } = useStore();
  const { formatPrice } = useCurrency();
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
        <h2 className="text-[20px] font-bold mb-2">Login Required</h2>
        <p className="text-[14px] text-[#999] mb-6">
          Please log in to proceed with checkout.
        </p>
        <button
          onClick={() => navigate('/login')}
          className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[14px] hover:bg-[#555] transition-colors"
        >
          Go to Login
        </button>
      </div>
    );
  }

  if (cart.length === 0 && step !== 'confirmed') {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-20 text-center">
        <Package size={48} className="mx-auto text-[#ddd] mb-4" />
        <h2 className="text-[20px] font-bold mb-2">Your cart is empty</h2>
        <p className="text-[14px] text-[#999] mb-6">
          Add products before proceeding to checkout.
        </p>
        <button
          onClick={() => navigate('/products')}
          className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[14px] hover:bg-[#555] transition-colors"
        >
          Browse Products
        </button>
      </div>
    );
  }

  /* ─── Validation ─── */
  function validateShipping(): boolean {
    const e: Partial<ShippingAddress> = {};
    if (!shipping.company.trim()) e.company = 'Company name is required';
    if (!shipping.recipient.trim()) e.recipient = 'Recipient name is required';
    if (!shipping.phone.trim()) e.phone = 'Phone number is required';
    if (!shipping.addressLine1.trim()) e.addressLine1 = 'Address is required';
    if (!shipping.city.trim()) e.city = 'City is required';
    if (!shipping.zipCode.trim()) e.zipCode = 'ZIP / Postal code is required';
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
    return actions.order.create({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: 'JPY',
          value: String(total),
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
          <h1 className="text-[20px] font-bold text-[#222]">Checkout</h1>
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
                    {s.label}
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
                  <h2 className="text-[15px] font-semibold text-[#222]">Order Items</h2>
                  <span className="text-[12px] text-[#aaa] ml-1">({cart.length} line{cart.length !== 1 ? 's' : ''})</span>
                </div>

                {/* Header row */}
                <div className="hidden md:grid grid-cols-[2fr_1fr_80px_90px] gap-2 px-5 py-2.5 bg-[#f8f8fa] border-b border-[#f0f0f0] text-[11px] font-semibold text-[#aaa] uppercase tracking-wide">
                  <span>Product</span>
                  <span>Set Option</span>
                  <span className="text-center">Qty (sets)</span>
                  <span className="text-right">Subtotal</span>
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
                            {formatPrice(item.product.wholesalePrice)} / set
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
                            <p className="text-[11px] text-[#bbb]">{item.setOption.unitsPerSet} units/set</p>
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
                            {item.quantity * item.setOption.unitsPerSet} units
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
                  <h2 className="text-[15px] font-semibold text-[#222]">Order Summary</h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">Total Sets</span>
                    <span className="font-medium">{cart.reduce((s, i) => s + i.quantity, 0)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">Total Units</span>
                    <span className="font-medium">{totalUnits.toLocaleString()}</span>
                  </div>
                  <div className="border-t border-[#f0f0f0] pt-3 flex justify-between text-[13px]">
                    <span className="text-[#666]">Subtotal (excl. VAT)</span>
                    <span className="font-medium">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">VAT (10%)</span>
                    <span className="font-medium">{formatPrice(vat)}</span>
                  </div>
                  <div className="border-t border-[#e5e5e5] pt-3 flex justify-between">
                    <span className="text-[14px] font-bold text-[#222]">Grand Total</span>
                    <span className="text-[18px] font-bold text-[#333]">{formatPrice(total)}</span>
                  </div>
                  <p className="text-[10px] text-[#bbb] leading-relaxed">
                    VAT included. Shipping costs will be confirmed by your account manager after the order is placed.
                  </p>
                </div>
                <div className="px-5 pb-5">
                  <button
                    onClick={() => setStep('shipping')}
                    className="w-full py-3 bg-[#333] text-white rounded-lg text-[14px] font-semibold hover:bg-[#555] transition-colors flex items-center justify-center gap-2"
                  >
                    Proceed to Shipping
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
                  <h2 className="text-[15px] font-semibold text-[#222]">Delivery Address</h2>
                </div>
                <div className="px-5 py-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Company Name *" error={errors.company}>
                    <input
                      value={shipping.company}
                      onChange={(e) => setShipping({ ...shipping, company: e.target.value })}
                      placeholder="ACME Trading Co., Ltd."
                      className={input(!!errors.company)}
                    />
                  </Field>

                  <Field label="Recipient Name *" error={errors.recipient}>
                    <input
                      value={shipping.recipient}
                      onChange={(e) => setShipping({ ...shipping, recipient: e.target.value })}
                      placeholder="John Smith"
                      className={input(!!errors.recipient)}
                    />
                  </Field>

                  <Field label="Phone Number *" error={errors.phone}>
                    <input
                      value={shipping.phone}
                      onChange={(e) => setShipping({ ...shipping, phone: e.target.value })}
                      placeholder="+82-10-1234-5678"
                      className={input(!!errors.phone)}
                    />
                  </Field>

                  <Field label="Country *">
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
                    <Field label="Address Line 1 *" error={errors.addressLine1}>
                      <input
                        value={shipping.addressLine1}
                        onChange={(e) => setShipping({ ...shipping, addressLine1: e.target.value })}
                        placeholder="123 Teheran-ro, Gangnam-gu"
                        className={input(!!errors.addressLine1)}
                      />
                    </Field>
                  </div>

                  <div className="md:col-span-2">
                    <Field label="Address Line 2">
                      <input
                        value={shipping.addressLine2}
                        onChange={(e) => setShipping({ ...shipping, addressLine2: e.target.value })}
                        placeholder="Suite / Floor / Building (optional)"
                        className={input(false)}
                      />
                    </Field>
                  </div>

                  <Field label="City *" error={errors.city}>
                    <input
                      value={shipping.city}
                      onChange={(e) => setShipping({ ...shipping, city: e.target.value })}
                      placeholder="Seoul"
                      className={input(!!errors.city)}
                    />
                  </Field>

                  <Field label="State / Province">
                    <input
                      value={shipping.state}
                      onChange={(e) => setShipping({ ...shipping, state: e.target.value })}
                      placeholder="Gyeonggi-do (optional)"
                      className={input(false)}
                    />
                  </Field>

                  <Field label="ZIP / Postal Code *" error={errors.zipCode}>
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
                  <h2 className="text-[15px] font-semibold text-[#222]">Order Details</h2>
                  <span className="text-[11px] text-[#bbb]">(optional)</span>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <Field label="Purchase Order (PO) Number">
                    <input
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      placeholder="e.g. PO-2026-0042"
                      className={input(false)}
                    />
                  </Field>
                  <Field label="Delivery Notes">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      placeholder="Special delivery instructions, fragile goods notice, etc."
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
                  <h2 className="text-[15px] font-semibold text-[#222]">Order Summary</h2>
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
                    <span className="text-[#666]">Subtotal</span>
                    <span>{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-[#666]">VAT (10%)</span>
                    <span>{formatPrice(vat)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[15px] pt-2 border-t border-[#e5e5e5]">
                    <span>Total</span>
                    <span>{formatPrice(total)}</span>
                  </div>
                </div>
                <div className="px-5 pb-5 space-y-3">
                  {/* Payment method selector */}
                  <p className="text-[11px] font-semibold text-[#999] uppercase tracking-wide">Payment Method</p>
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
                        <p className="text-[13px] font-semibold text-[#222]">Bank Transfer</p>
                        <p className="text-[10px] text-[#888]">Wire / TT · No transaction fee</p>
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
                        <p className="text-[10px] text-[#888]">Pay now · Fee may apply</p>
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
                        <BankRow label="Bank" value={selectedBank.bankName} field="bank" copiedField={copiedField} onCopy={copyToClipboard} />
                        <BankRow label="Account Name" value={selectedBank.accountName} field="name" copiedField={copiedField} onCopy={copyToClipboard} />
                        <BankRow label="Account No." value={selectedBank.accountNumber} field="account" copiedField={copiedField} onCopy={copyToClipboard} />
                        <BankRow label="SWIFT / BIC" value={selectedBank.swiftCode} field="swift" copiedField={copiedField} onCopy={copyToClipboard} />
                        {selectedBank.routingNumber && (
                          <BankRow label="Routing No." value={selectedBank.routingNumber} field="routing" copiedField={copiedField} onCopy={copyToClipboard} />
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
                          onError={() => showToast('PayPal payment failed. Please try again.', 'error')}
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
                      Place Order
                      <ChevronRight size={16} />
                    </button>
                  )}

                  <p className="text-[10px] text-[#bbb] text-center">
                    By placing this order you agree to our Terms &amp; Conditions.
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
              <h2 className="text-[22px] font-bold text-[#222] mb-1">Order Placed Successfully!</h2>
              <p className="text-[14px] text-[#666] mb-4">
                Thank you for your order. Your account manager will review and confirm your order shortly.
              </p>
              <div className="inline-block bg-[#f8f8fa] border border-[#e5e5e5] rounded-lg px-6 py-3">
                <p className="text-[11px] text-[#aaa] uppercase tracking-wide mb-0.5">Order Number</p>
                <p className="text-[20px] font-bold text-[#333] font-mono">{orderId}</p>
              </div>
            </div>

            {/* Shipping summary */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden mb-5">
              <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                <Truck size={15} className="text-[#4a90e2]" />
                <h3 className="text-[14px] font-semibold text-[#222]">Shipping To</h3>
              </div>
              <div className="px-5 py-4 text-[13px] text-[#555] space-y-1">
                <p className="font-semibold text-[#222]">{shipping.company}</p>
                <p>Attn: {shipping.recipient} · {shipping.phone}</p>
                <p>{shipping.addressLine1}{shipping.addressLine2 ? `, ${shipping.addressLine2}` : ''}</p>
                <p>{[shipping.city, shipping.state, shipping.zipCode].filter(Boolean).join(', ')}, {shipping.country}</p>
                {poNumber && <p className="pt-1 text-[#888]">PO Number: <span className="font-medium text-[#555]">{poNumber}</span></p>}
                {notes && <p className="text-[#888]">Notes: <span className="font-medium text-[#555]">{notes}</span></p>}
              </div>
            </div>

            {/* Price summary */}
            <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                <ClipboardList size={15} className="text-[#4a90e2]" />
                <h3 className="text-[14px] font-semibold text-[#222]">Payment Summary</h3>
              </div>
              <div className="px-5 py-4 space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[#666]">Subtotal (excl. VAT)</span>
                  <span>{formatPrice(confirmedTotals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#666]">VAT (10%)</span>
                  <span>{formatPrice(confirmedTotals.vat)}</span>
                </div>
                <div className="flex justify-between font-bold text-[15px] pt-3 border-t border-[#e5e5e5]">
                  <span>Grand Total</span>
                  <span>{formatPrice(confirmedTotals.total)}</span>
                </div>
              </div>
            </div>

            {/* Bank transfer instructions */}
            {paymentMethod === 'bank_transfer' && (
              <div className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden mb-5">
                <div className="px-5 py-4 border-b border-[#f0f0f0] flex items-center gap-2">
                  <Building2 size={15} className="text-[#4a90e2]" />
                  <h3 className="text-[14px] font-semibold text-[#222]">Bank Transfer Instructions</h3>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <p className="text-[13px] text-[#555]">
                    Please transfer the exact amount to one of the accounts below. Include your order number <strong className="font-mono text-[#333]">{orderId}</strong> in the transfer reference.
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
                    <BankRow label="Bank" value={selectedBank.bankName} field="c-bank" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label="Account Name" value={selectedBank.accountName} field="c-name" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label="Account No." value={selectedBank.accountNumber} field="c-account" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label="SWIFT / BIC" value={selectedBank.swiftCode} field="c-swift" copiedField={copiedField} onCopy={copyToClipboard} />
                    {selectedBank.routingNumber && (
                      <BankRow label="Routing No." value={selectedBank.routingNumber} field="c-routing" copiedField={copiedField} onCopy={copyToClipboard} />
                    )}
                    <div className="pt-1 flex justify-between items-center border-t border-[#e5e5e5] mt-1">
                      <span className="text-[#888] font-medium">Amount</span>
                      <span className="font-bold text-[#222] text-[13px]">{selectedBankCurrency} {formatPrice(confirmedTotals.total)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-[#888] font-medium">Reference</span>
                      <span className="font-mono font-bold text-[#4a90e2]">{orderId}</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#aaa]">Payment must be received within 5 business days to confirm your order.</p>
                </div>
              </div>
            )}

            {/* What's next */}
            <div className="bg-[#f0f7ff] border border-[#4a90e2]/20 rounded-xl px-5 py-4 mb-6 text-[13px] text-[#555] space-y-2">
              <p className="font-semibold text-[#333]">What happens next?</p>
              <ol className="list-decimal list-inside space-y-1 text-[#666]">
                {paymentMethod === 'bank_transfer' ? (
                  <>
                    <li>Transfer the amount to the account above with your order number as reference.</li>
                    <li>Our team will verify your payment within 1–2 business days.</li>
                    <li>Once confirmed, we will prepare and dispatch your goods.</li>
                    <li>You will receive a shipping notification with tracking information.</li>
                  </>
                ) : (
                  <>
                    <li>Your order is now pending review by our team.</li>
                    <li>You will be contacted within 1 business day to confirm stock &amp; delivery schedule.</li>
                    <li>Once confirmed, a proforma invoice will be issued for payment.</li>
                    <li>Goods are dispatched after payment is received.</li>
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
                Continue Shopping
              </button>
              <button
                onClick={() => navigate('/')}
                className="flex-1 py-3 bg-[#333] text-white rounded-lg text-[14px] font-semibold hover:bg-[#555] transition-colors"
              >
                Back to Home
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
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[#888] shrink-0 w-[90px]">{label}</span>
      <span className="font-semibold text-[#222] truncate flex-1">{value}</span>
      <button
        onClick={() => onCopy(value, field)}
        className="shrink-0 text-[#bbb] hover:text-[#4a90e2] transition-colors"
        title="Copy"
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
