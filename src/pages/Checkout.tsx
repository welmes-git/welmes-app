import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { PayPalButtons, PayPalScriptProvider, usePayPalScriptReducer } from '@paypal/react-paypal-js';
import { useTranslation } from 'react-i18next';
import { localizedName } from '../lib/productName';
import { useStore } from '../store/useStore';
import type { ShippingAddress } from '../store/useStore';
import * as db from '../lib/db';
import { createPayPalOrder, capturePayPalOrder, paymentErrorKey } from '../lib/paypal';
import { useCurrency } from '../context/CurrencyContext';
import { getCurrencyInfo } from '../lib/currency';
import type { CurrencyCode } from '../lib/currency';
import { BANK_ACCOUNTS, isPlaceholderAccount } from '../config/bankAccounts';
import { COUNTRIES, HOME_COUNTRY } from '../config/countries';
import {
  ChevronRight,
  CheckCircle2,
  Package,
  Truck,
  ClipboardList,
  ArrowLeft,
  Building2,
  Copy,
  AlertTriangle,
} from 'lucide-react';

type Step = 'review' | 'shipping' | 'confirmed';

const STEPS: { key: Step; labelKey: string }[] = [
  { key: 'review', labelKey: 'checkout.reviewOrder' },
  { key: 'shipping', labelKey: 'checkout.shippingInfo' },
  { key: 'confirmed', labelKey: 'checkout.confirmed' },
];



/**
 * Settlement currency. Fixed to JPY — see PAYPAL_CURRENCIES in
 * server/payments.mjs for why. Prices are still DISPLAYED in the buyer's
 * currency via CurrencyContext.
 */
const CHARGE_CURRENCY: CurrencyCode = 'JPY';

/**
 * Read once at module scope so the value is inlined in exactly one place.
 *
 * Empty when VITE_PAYPAL_CLIENT_ID was absent at BUILD time — the variable is
 * baked into the bundle, so a Vercel change only takes effect on the next build.
 * The old code fell back to the SDK's `'test'` placeholder, which rendered a
 * button that looked fine and failed on click with no clue as to why. PayPal is
 * now hidden outright when it is not configured, and the reason is logged.
 */
const PAYPAL_CLIENT_ID = (import.meta.env.VITE_PAYPAL_CLIENT_ID as string | undefined)?.trim() || '';
const PAYPAL_CONFIGURED = PAYPAL_CLIENT_ID.length > 0;

/**
 * Order ids are issued by `place_order` now — a client-generated id meant a
 * retried submit created a second order. This key instead lets the server
 * recognise a retry of the same checkout and return the original order.
 */
function genIdempotencyKey() {
  return crypto.randomUUID();
}

function CheckoutContent() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { cart, currentUser, placeOrder, syncOrderAfterPayment, clearCart, isAuthenticated, showToast } = useStore();
  /* Only `formatPrice` is taken. The page no longer converts anything itself:
     display formatting lives in CurrencyContext and every charge amount comes
     from the server. `convert`/`rates` used to be needed here to quote wire
     amounts, which is exactly how the quoted figure drifted from the recorded
     one. */
  const { formatPrice } = useCurrency();
  const [step, setStep] = useState<Step>('review');
  const [orderId, setOrderId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<ShippingAddress>>({});
  // Totals shown on the confirmation screen come from the server, not from the
  // client-side preview, so the buyer sees exactly what was recorded.
  /**
   * Everything the confirmation screen shows about money, as the server recorded
   * it. Previously the wire amount was recomputed from live rates at render time,
   * so the figure the buyer was told to remit could drift away from the
   * `charge_amount` the order will actually be reconciled against.
   */
  const [confirmed, setConfirmed] = useState({
    subtotal: 0,
    vat: 0,
    total: 0,
    chargeCurrency: CHARGE_CURRENCY as string,
    chargeAmount: 0,
    paymentDueAt: null as string | null,
  });
  const [paymentMethod, setPaymentMethod] = useState<'paypal' | 'bank_transfer'>('bank_transfer');
  /* Wire transfers arrive in the currency of the account the buyer picks, so the
     order is denominated in that currency and reconciles exactly. JPY is the
     default; the other accounts stay available for buyers whose bank cannot send
     yen cheaply. */
  const [selectedBankCurrency, setSelectedBankCurrency] = useState(CHARGE_CURRENCY as string);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  /** Stable for the lifetime of this checkout so retries resolve to one order. */
  const idempotencyKey = useRef(genIdempotencyKey());
  /** Our order id for the PayPal order currently in flight. */
  const pendingOrderId = useRef<string | null>(null);

  /* ─── Keep the server's FX table warm ───
     `place_order` reads the charge rate from `fx_rates` and refuses a
     foreign-currency order once the stored rate passes its hard age limit.
     Pinging /api/fx on entry means the storefront itself keeps the table
     current, so there is no cron to forget. Failure is ignored: a JPY order
     never needs a rate, and any other currency fails loudly in the RPC. */
  useEffect(() => {
    fetch('/api/fx').catch(() => {});
  }, []);

  /* ─── PayPal SDK ───
     We settle in JPY only, so the SDK's currency never changes and the old
     RESET_OPTIONS dance is gone. It existed to reload the script whenever the
     buyer's display currency was another PayPal-settleable currency; charging in
     the buyer's currency meant PayPal converting back to JPY on settlement and
     taking a spread out of every order. Display stays multi-currency. */
  const [{ isPending: paypalLoading }] = usePayPalScriptReducer();

  const [shipping, setShipping] = useState<ShippingAddress>({
    company: currentUser?.companyName ?? '',
    recipient: currentUser?.representative ?? '',
    phone: currentUser?.phone ?? '',
    addressLine1: currentUser?.address ?? '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'Japan',
    countryCode: HOME_COUNTRY,
  });

  /* Every figure below comes from `quote_order`. The page used to compute
     subtotal/VAT/total from a local VAT_RATE while place_order used its own copy;
     now that the rate depends on the destination, one of the two would always have
     been wrong. `subtotal` is still derived locally for the per-line display only. */
  /* ─── Server-side quote ───
     The destination decides the tax rate (Japan 10%, export 0%), so the quote is
     refreshed whenever the cart or the country changes. Nothing here is computed
     locally. */
  useEffect(() => {
    if (cart.length === 0) return;
    let mounted = true;
    (async () => {
      const { quote: q } = await db.quoteOrder(cart, shipping);
      if (mounted && q) setQuote(q);
    })();
    return () => { mounted = false; };
  }, [cart, shipping]);

  const subtotal = cart.reduce(
    (sum, item) => sum + (item.setOption?.wholesalePrice ?? item.product.wholesalePrice) * item.quantity,
    0
  );
  const totalUnits = cart.reduce(
    (sum, item) => sum + (item.setOption?.unitsPerSet ?? 1) * item.quantity,
    0
  );
  const [quote, setQuote] = useState<db.OrderQuote | null>(null);
  const vat = quote?.tax ?? 0;
  const shippingFee = quote?.shippingFee ?? 0;
  const total = quote?.total ?? subtotal;

  if (!isAuthenticated) {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-20 text-center">
        <Package size={48} className="mx-auto text-line-strong mb-4" />
        <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 mb-2">{t('checkout.loginRequired')}</h2>
        <p className="text-[14px] text-ink-500 mb-6">
          {t('checkout.loginRequiredDesc')}
        </p>
        <button
          onClick={() => navigate('/login')}
          className="px-6 py-2.5 bg-ink-700 text-white rounded-lg text-[14px] hover:bg-ink-900 transition-colors"
        >
          {t('checkout.goToLogin')}
        </button>
      </div>
    );
  }

  if (cart.length === 0 && step !== 'confirmed') {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-20 text-center">
        <Package size={48} className="mx-auto text-line-strong mb-4" />
        <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 mb-2">{t('checkout.cartEmpty')}</h2>
        <p className="text-[14px] text-ink-500 mb-6">
          {t('checkout.cartEmptyDesc')}
        </p>
        <button
          onClick={() => navigate('/products')}
          className="px-6 py-2.5 bg-ink-700 text-white rounded-lg text-[14px] hover:bg-ink-900 transition-colors"
        >
          {t('checkout.browseProducts')}
        </button>
      </div>
    );
  }


  /**
   * Naming the rule matters commercially. A flat "VAT" line on an export order
   * looked like Japanese tax being charged on top of the import VAT the buyer
   * already owes at their own border.
   */
  const taxLabel = () => {
    if (!quote || quote.taxMode === 'export_exempt') return t('checkout.taxExportExempt');
    if (quote.taxMode === 'domestic_vat') return t('checkout.taxDomestic', { rate: Math.round(quote.taxRate * 100) });
    return t('checkout.vat');
  };

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

  /* ─── Place order (bank transfer) ───
     Goes straight to the `place_order` RPC: the database re-prices every line,
     computes VAT/total and reserves stock in one transaction. The amounts below
     are only a preview — whatever the server returns is what we show and what
     was stored. */
  async function handlePlaceOrder() {
    if (placing) return;
    if (!validateShipping()) {
      showToast(t('checkout.fixShippingFirst'), 'error');
      return;
    }
    setPlacing(true);
    const { order, error } = await placeOrder({
      items: cart,
      shipping,
      paymentMethod: 'bank_transfer',
      poNumber,
      notes,
      // Wire transfers are quoted in the account currency. The rate is looked up
      // server-side from `fx_rates`; sending it from here let a buyer choose the
      // amount their incoming wire would be reconciled against.
      chargeCurrency: selectedBankCurrency,
      idempotencyKey: idempotencyKey.current,
    });
    setPlacing(false);

    if (error || !order) {
      // Keep the cart and stay on this step so the buyer can retry
      const message = error ?? '';
      const soldOut = message.includes('INSUFFICIENT_STOCK')
        || message.includes('PRODUCT_NOT_FOUND')
        || message.includes('PRODUCT_INACTIVE');
      const notApproved = message.includes('MEMBER_NOT_APPROVED');
      // A stale or missing rate must not be papered over — the old code would
      // have charged on a months-old fallback rate instead.
      const fxProblem = message.includes('FX_STALE') || message.includes('FX_UNSUPPORTED');
      showToast(
        t(soldOut ? 'checkout.insufficientStock'
          : notApproved ? 'checkout.memberNotApproved'
          : fxProblem ? 'checkout.fxUnavailable'
          : 'checkout.orderFailed'),
        'error',
      );
      return;
    }

    finishOrder(order.orderId, order);
  }

  function finishOrder(id: string, result: {
    subtotal: number;
    vat: number;
    total: number;
    chargeCurrency?: string;
    chargeAmount?: number;
    paymentDueAt?: string | null;
  }) {
    setConfirmed({
      subtotal: result.subtotal,
      vat: result.vat,
      total: result.total,
      // Fall back to the JPY total rather than recomputing: a missing charge
      // amount means the server did not denominate the order, and inventing a
      // converted figure here is what caused the drift in the first place.
      chargeCurrency: result.chargeCurrency ?? CHARGE_CURRENCY,
      chargeAmount: result.chargeAmount ?? result.total,
      paymentDueAt: result.paymentDueAt ?? null,
    });
    clearCart();
    setOrderId(id);
    setStep('confirmed');
  }

  function copyToClipboard(text: string, field: string) {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  /* ─── PayPal ───
     Both halves run on the server (api/paypal.ts). The browser used to build
     the amount itself and capture directly, so the charge was whatever the page
     said it was and nothing ever checked that the money matched the order. */
  async function createPayPalOrderHandler(): Promise<string> {
    if (!validateShipping()) {
      showToast(t('checkout.fixShippingFirst'), 'error');
      throw new Error('INVALID_SHIPPING');
    }
    const created = await createPayPalOrder({
      items: cart,
      shipping,
      poNumber,
      notes,
      displayCurrency: CHARGE_CURRENCY,
      idempotencyKey: idempotencyKey.current,
    });
    pendingOrderId.current = created.orderId;
    if (created.fxStale) console.warn('[checkout] charged on fallback FX rates');
    return created.paypalOrderId;
  }

  async function onPayPalApprove(data: { orderID?: string }) {
    const ourOrderId = pendingOrderId.current;
    if (!ourOrderId || !data?.orderID) {
      showToast(t('checkout.paypalFailed'), 'error');
      return;
    }
    setPlacing(true);
    try {
      // The server captures, then compares amount + currency + custom_id against
      // the stored order before anything is marked paid. A declined or mismatched
      // capture releases the stock (and refunds) server-side.
      const result = await capturePayPalOrder(data.orderID, ourOrderId);
      await syncOrderAfterPayment(result.orderId);
      finishOrder(result.orderId, result);
    } catch (error) {
      showToast(t(paymentErrorKey(error)), 'error');
    } finally {
      setPlacing(false);
    }
  }

  /* Before the order exists the buyer is choosing; afterwards the currency is
     fixed on the order, so the confirmation screen must follow the order rather
     than local UI state. */
  const activeBankCurrency = step === 'confirmed' ? confirmed.chargeCurrency : selectedBankCurrency;
  const selectedBank = BANK_ACCOUNTS.find((b) => b.currency === activeBankCurrency) ?? BANK_ACCOUNTS[0];
  const bankNotConfigured = isPlaceholderAccount(selectedBank);

  // Wire transfers must be made in the bank account's currency, so convert the
  // JPY-based total into that currency instead of the display currency
  /**
   * The amount to remit, exactly as the server froze it on the order.
   *
   * This used to convert the JPY total with whatever rate the browser happened to
   * hold, so the figure shown here could differ from `charge_amount` — the value a
   * received wire is reconciled against. No conversion happens now.
   */
  const formatChargeAmount = () => {
    const info = getCurrencyInfo(confirmed.chargeCurrency as CurrencyCode);
    return `${confirmed.chargeCurrency} ${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(confirmed.chargeAmount)}`;
  };

  /* ─── Step indicator ─── */
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="bg-canvas min-h-screen pb-16">
      {/* Page header */}
      <div className="bg-white border-b border-line">
        <div className="max-w-[960px] mx-auto px-4 py-5 flex items-center gap-3">
          {step !== 'confirmed' && (
            <button
              onClick={() =>
                step === 'review' ? navigate('/products') : setStep('review')
              }
              className="text-ink-500 hover:text-ink-700 transition-colors mr-1"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h1 className="font-serif text-[30px] font-normal leading-[38px] text-ink-700">{t('checkout.title')}</h1>
        </div>

        {/* Step progress */}
        <div className="max-w-[960px] mx-auto px-4 pb-4">
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => (
              <div key={s.key} className="flex items-center">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                      i <= stepIndex
                        ? 'bg-ink-900 text-white'
                        : 'border border-line-strong bg-canvas text-ink-500'
                    }`}
                  >
                    {i < stepIndex ? <CheckCircle2 size={14} /> : i + 1}
                  </div>
                  <span
                    className={`text-[12px] font-medium ${
                      i === stepIndex ? 'font-bold text-ink-900' : 'text-ink-500'
                    }`}
                  >
                    {t(s.labelKey)}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight size={14} className="text-ink-300 mx-3" />
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
              <div className="bg-white rounded-sm border border-line overflow-hidden">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                  <ClipboardList size={16} className="text-ink-500" />
                  <h2 className="text-[16px] font-medium text-ink-700">{t('checkout.orderItems')}</h2>
                  <span className="text-[12px] text-ink-300 ml-1">({t('checkout.lines', { count: cart.length })})</span>
                </div>

                {/* Header row */}
                <div className="hidden md:grid grid-cols-[2fr_1fr_80px_90px] gap-2 px-5 py-2.5 bg-sunken border-b border-line text-[11px] font-semibold text-ink-300 uppercase tracking-wide">
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
                      className="grid grid-cols-1 md:grid-cols-[2fr_1fr_80px_90px] gap-2 items-center px-5 py-4 border-b border-line last:border-0"
                    >
                      {/* Product */}
                      <div className="flex gap-3 items-center">
                        <img
                          src={item.product.image}
                          alt={localizedName(item.product, i18n.language)}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src =
                              'https://placehold.co/60x60/f0f0f0/999?text=IMG';
                          }}
                          className="w-[56px] h-[56px] object-cover rounded-lg border border-line shrink-0"
                        />
                        <div>
                          <p className="text-[11px] text-ink-300 uppercase font-medium">{item.product.brand}</p>
                          <p className="text-[13px] text-ink-900 font-medium leading-tight">{localizedName(item.product, i18n.language)}</p>
                          {localizedName(item.product, i18n.language) !== item.product.name && (
                            <p className="text-[11px] text-ink-300 leading-tight">{item.product.name}</p>
                          )}
                          <p className="text-[12px] text-ink-700 font-semibold tabular-nums mt-0.5">
                            {formatPrice(item.setOption?.wholesalePrice ?? item.product.wholesalePrice)} {t('products.perSet')}
                          </p>
                        </div>
                      </div>

                      {/* Set option badge */}
                      <div>
                        {item.setOption ? (
                          <div>
                            <span className="inline-block rounded-sm border border-line-strong bg-canvas px-[7px] py-[3px] text-[11px] font-bold tracking-[0.02em] text-ink-700">
                              {item.setOption.id}
                            </span>
                            <p className="text-[11px] text-ink-500 mt-0.5">{item.setOption.description}</p>
                            <p className="text-[11px] text-ink-300">{t('productDetail.unitsPerSet', { count: item.setOption.unitsPerSet })}</p>
                          </div>
                        ) : (
                          <span className="text-[12px] text-ink-300">—</span>
                        )}
                      </div>

                      {/* Qty */}
                      <div className="text-center">
                        <span className="text-[15px] font-semibold text-ink-700">{item.quantity}</span>
                        {item.setOption && (
                          <p className="text-[10px] text-ink-300">
                            {t('cart.units', { count: item.quantity * item.setOption.unitsPerSet })}
                          </p>
                        )}
                      </div>

                      {/* Subtotal */}
                      <div className="text-right">
                        <p className="text-[14px] font-bold tabular-nums text-ink-900">{formatPrice(lineTotal)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Summary sidebar */}
            <div className="lg:w-[280px] shrink-0">
              <div className="bg-white rounded-sm border border-line overflow-hidden lg:sticky lg:top-[124px]">
                <div className="px-5 py-4 border-b border-line">
                  <h2 className="text-[16px] font-medium text-ink-700">{t('checkout.orderSummary')}</h2>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink-500">{t('checkout.totalSets')}</span>
                    <span className="font-medium tabular-nums">{cart.reduce((s, i) => s + i.quantity, 0)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink-500">{t('checkout.totalUnits')}</span>
                    <span className="font-medium tabular-nums">{totalUnits.toLocaleString()}</span>
                  </div>
                  <div className="border-t border-line pt-3 flex justify-between text-[13px]">
                    <span className="text-ink-500">{t('checkout.subtotal')}</span>
                    <span className="font-medium tabular-nums">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink-500">{taxLabel()}</span>
                    <span className="font-medium tabular-nums">{formatPrice(vat)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink-500">{t('checkout.shipping')}</span>
                    <span className="font-medium tabular-nums">
                      {shippingFee > 0 ? formatPrice(shippingFee) : t('checkout.shippingQuoted')}
                    </span>
                  </div>
                  <div className="border-t border-line pt-3 flex justify-between">
                    <span className="text-[14px] font-bold text-ink-900">{t('checkout.grandTotal')}</span>
                    <span className="text-[18px] font-medium tabular-nums text-ink-700">{formatPrice(total)}</span>
                  </div>
                  <p className="text-[10px] text-ink-300 leading-relaxed">
                    {t('checkout.dutiesNote')}
                  </p>
                </div>
                <div className="px-5 pb-5">
                  <button
                    onClick={() => setStep('shipping')}
                    className="w-full h-11 bg-ink-700 text-white rounded-lg text-[14px] hover:bg-ink-900 transition-colors flex items-center justify-center gap-2"
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
              <div className="bg-white rounded-sm border border-line overflow-hidden">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                  <Truck size={16} className="text-ink-500" />
                  <h2 className="text-[16px] font-medium text-ink-700">{t('checkout.deliveryAddress')}</h2>
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
                      value={shipping.countryCode ?? HOME_COUNTRY}
                      onChange={(e) => {
                        const picked = COUNTRIES.find((c) => c.code === e.target.value);
                        // Both are stored: the code drives tax and shipping rules,
                        // the name is what appears on the label and invoice.
                        setShipping({ ...shipping, countryCode: e.target.value, country: picked?.name ?? '' });
                      }}
                      className={input(false)}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c.code} value={c.code}>{c.name}</option>
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
              <div className="bg-white rounded-sm border border-line overflow-hidden">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                  <ClipboardList size={16} className="text-ink-500" />
                  <h2 className="text-[16px] font-medium text-ink-700">{t('checkout.orderDetails')}</h2>
                  <span className="text-[11px] text-ink-300">({t('common.optional')})</span>
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
              <div className="bg-white rounded-sm border border-line overflow-hidden lg:sticky lg:top-[124px]">
                <div className="px-5 py-4 border-b border-line">
                  <h2 className="text-[16px] font-medium text-ink-700">{t('checkout.orderSummary')}</h2>
                </div>
                <div className="px-5 py-4 space-y-2 max-h-[240px] overflow-y-auto">
                  {cart.map((item) => (
                    <div key={`${item.product.id}-${item.setOption?.id}`} className="flex justify-between text-[12px] py-1 border-b border-line last:border-0">
                      <span className="text-ink-500 truncate pr-2 flex-1">
                        <span className="font-bold text-ink-900 mr-1">{item.setOption?.id}</span>
                        {localizedName(item.product, i18n.language)}
                      </span>
                      <span className="shrink-0 text-ink-900 font-semibold">×{item.quantity}</span>
                    </div>
                  ))}
                </div>
                <div className="px-5 py-4 border-t border-line space-y-2">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink-500">{t('cart.subtotal')}</span>
                    <span className="tabular-nums">{formatPrice(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink-500">{taxLabel()}</span>
                    <span className="tabular-nums">{formatPrice(vat)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-[15px] pt-2 border-t border-line">
                    <span>{t('cart.total')}</span>
                    <span className="tabular-nums">{formatPrice(total)}</span>
                  </div>
                  <p className="text-[10px] text-ink-300 leading-relaxed pt-1">
                    {t('checkout.dutiesNote')}
                  </p>
                </div>
                <div className="px-5 pb-5 space-y-3">
                  {/* Payment method selector */}
                  <p className="text-[11px] font-semibold text-ink-500 uppercase tracking-wide">{t('checkout.paymentMethod')}</p>
                  <div className="space-y-2">
                    <button
                      onClick={() => setPaymentMethod('bank_transfer')}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                        paymentMethod === 'bank_transfer'
                          ? 'border-ink-900 bg-sunken'
                          : 'border-line hover:border-line-strong'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        paymentMethod === 'bank_transfer' ? 'border-ink-900' : 'border-line-strong'
                      }`}>
                        {paymentMethod === 'bank_transfer' && (
                          <div className="w-2 h-2 rounded-full bg-ink-900" />
                        )}
                      </div>
                      <Building2 size={15} className={paymentMethod === 'bank_transfer' ? 'text-ink-900' : 'text-ink-300'} />
                      <div>
                        <p className="text-[13px] font-semibold text-ink-900">{t('checkout.bankTransfer')}</p>
                        <p className="text-[10px] text-ink-500">{t('checkout.bankTransferDesc')}</p>
                      </div>
                    </button>

                    {PAYPAL_CONFIGURED && (
                    <button
                      onClick={() => setPaymentMethod('paypal')}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${
                        paymentMethod === 'paypal'
                          ? 'border-ink-900 bg-sunken'
                          : 'border-line hover:border-line-strong'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        paymentMethod === 'paypal' ? 'border-ink-900' : 'border-line-strong'
                      }`}>
                        {paymentMethod === 'paypal' && (
                          <div className="w-2 h-2 rounded-full bg-ink-900" />
                        )}
                      </div>
                      <img src="https://www.paypalobjects.com/webstatic/icon/pp258.png" alt="PayPal" className="w-4 h-4 object-contain" />
                      <div>
                        <p className="text-[13px] font-semibold text-ink-900">PayPal</p>
                        <p className="text-[10px] text-ink-500">{t('checkout.paypalDesc')}</p>
                      </div>
                    </button>
                    )}
                  </div>

                  {/* Bank transfer details */}
                  {paymentMethod === 'bank_transfer' && (
                    <div className="bg-sunken rounded-lg border border-line p-3 space-y-2">
                      <div className="flex gap-1.5">
                        {BANK_ACCOUNTS.map((b) => (
                          <button
                            key={b.currency}
                            onClick={() => setSelectedBankCurrency(b.currency)}
                            className={`px-3 py-1 rounded text-[11px] font-bold transition-colors ${
                              selectedBankCurrency === b.currency
                                ? 'bg-ink-700 text-white'
                                : 'bg-white text-ink-500 border border-line-strong hover:border-ink-300'
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
                      <p className="text-[10px] text-ink-300 pt-1">{selectedBank.note}</p>
                      {bankNotConfigured && (
                        <div className="flex items-start gap-2 mt-2 p-2 bg-canvas border border-line-strong rounded-lg">
                          <AlertTriangle size={13} className="text-signal-error shrink-0 mt-0.5" />
                          <p className="text-[10px] text-ink-700 leading-relaxed">{t('checkout.bankNotConfigured')}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PayPal buttons */}
                  {paymentMethod === 'paypal' && (
                    <div>
                      {paypalLoading ? (
                        <div className="w-full h-11 bg-sunken rounded-lg animate-pulse" />
                      ) : (
                        <PayPalButtons
                          style={{ layout: 'horizontal', color: 'black', shape: 'rect', label: 'paypal', height: 44 }}
                          disabled={placing}
                          createOrder={createPayPalOrderHandler}
                          onApprove={onPayPalApprove}
                          onError={(err) => {
                            // Shipping-validation rejections already showed their
                            // own message; don't overwrite it with "PayPal failed".
                            if (String(err).includes('INVALID_SHIPPING')) return;
                            showToast(t(paymentErrorKey(err)), 'error');
                          }}
                          onCancel={() => showToast(t('checkout.paypalCancelled'), 'error')}
                        />
                      )}
                    </div>
                  )}

                  {/* CTA */}
                  {paymentMethod === 'bank_transfer' && (
                    <button
                      onClick={() => handlePlaceOrder()}
                      disabled={placing || bankNotConfigured}
                      className="w-full h-11 bg-ink-700 text-white rounded-lg text-[14px] hover:bg-ink-900 transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {placing ? t('common.loading') : t('checkout.placeOrder')}
                      <ChevronRight size={16} />
                    </button>
                  )}

                  <p className="text-[10px] text-ink-300 text-center">
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
            <div className="bg-white rounded-sm border border-line p-8 text-center mb-5">
              <div className="w-16 h-16 rounded-full border border-line flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 size={36} className="text-signal-ok" />
              </div>
              <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 mb-1">{t('checkout.orderPlaced')}</h2>
              <p className="text-[14px] text-ink-500 mb-4">
                {t('checkout.thankYou')}
              </p>
              <div className="inline-block bg-sunken border border-line rounded-lg px-6 py-3">
                <p className="text-[11px] text-ink-300 uppercase tracking-wide mb-0.5">{t('checkout.orderNumber')}</p>
                <p className="text-[20px] font-bold text-ink-700 font-mono">{orderId}</p>
              </div>
            </div>

            {/* Shipping summary */}
            <div className="bg-white rounded-sm border border-line overflow-hidden mb-5">
              <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                <Truck size={15} className="text-ink-500" />
                <h3 className="text-[14px] font-medium text-ink-700">{t('checkout.shippingTo')}</h3>
              </div>
              <div className="px-5 py-4 text-[13px] text-ink-500 space-y-1">
                <p className="font-semibold text-ink-900">{shipping.company}</p>
                <p>{t('checkout.attn')}: {shipping.recipient} · {shipping.phone}</p>
                <p>{shipping.addressLine1}{shipping.addressLine2 ? `, ${shipping.addressLine2}` : ''}</p>
                <p>{[shipping.city, shipping.state, shipping.zipCode].filter(Boolean).join(', ')}, {shipping.country}</p>
                {poNumber && <p className="pt-1 text-ink-500">{t('account.po')}: <span className="font-medium text-ink-500">{poNumber}</span></p>}
                {notes && <p className="text-ink-500">{t('account.notes')}: <span className="font-medium text-ink-500">{notes}</span></p>}
              </div>
            </div>

            {/* Price summary */}
            <div className="bg-white rounded-sm border border-line overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                <ClipboardList size={15} className="text-ink-500" />
                <h3 className="text-[14px] font-medium text-ink-700">{t('checkout.paymentSummary')}</h3>
              </div>
              <div className="px-5 py-4 space-y-2 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-ink-500">{t('checkout.subtotal')}</span>
                  <span className="tabular-nums">{formatPrice(confirmed.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-500">{t('checkout.vat')}</span>
                  <span className="tabular-nums">{formatPrice(confirmed.vat)}</span>
                </div>
                <div className="flex justify-between font-bold text-[15px] pt-3 border-t border-line">
                  <span>{t('checkout.grandTotal')}</span>
                  <span className="tabular-nums">{formatPrice(confirmed.total)}</span>
                </div>
              </div>
            </div>

            {/* Bank transfer instructions */}
            {paymentMethod === 'bank_transfer' && (
              <div className="bg-white rounded-sm border border-line overflow-hidden mb-5">
                <div className="px-5 py-4 border-b border-line flex items-center gap-2">
                  <Building2 size={15} className="text-ink-500" />
                  <h3 className="text-[14px] font-medium text-ink-700">{t('checkout.bankInstructions')}</h3>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <p className="text-[13px] text-ink-500">
                    {t('checkout.bankInstructionsDesc', { orderId })}
                  </p>
                  {/* No currency tabs here any more. The order is denominated in
                      confirmed.chargeCurrency, and letting the buyer switch after
                      placing it showed an amount the order would never be
                      reconciled against. */}
                  <div className="bg-sunken rounded-lg border border-line p-3 space-y-1.5 text-[12px]">
                    <BankRow label={t('checkout.bankLabel')} value={selectedBank.bankName} field="c-bank" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label={t('checkout.accountNameLabel')} value={selectedBank.accountName} field="c-name" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label={t('checkout.accountNoLabel')} value={selectedBank.accountNumber} field="c-account" copiedField={copiedField} onCopy={copyToClipboard} />
                    <BankRow label={t('checkout.swiftLabel')} value={selectedBank.swiftCode} field="c-swift" copiedField={copiedField} onCopy={copyToClipboard} />
                    {selectedBank.routingNumber && (
                      <BankRow label={t('checkout.routingLabel')} value={selectedBank.routingNumber} field="c-routing" copiedField={copiedField} onCopy={copyToClipboard} />
                    )}
                    <div className="pt-1 flex justify-between items-center border-t border-line mt-1">
                      <span className="text-ink-500 font-medium">{t('checkout.amount')}</span>
                      <span className="font-bold tabular-nums text-ink-900 text-[13px]">{formatChargeAmount()}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-ink-500 font-medium">{t('checkout.reference')}</span>
                      <span className="font-mono font-bold text-ink-900">{orderId}</span>
                    </div>
                    {confirmed.paymentDueAt && (
                      <div className="flex justify-between items-center">
                        <span className="text-ink-500 font-medium">{t('checkout.paymentDue')}</span>
                        <span className="font-bold text-ink-900">
                          {new Date(confirmed.paymentDueAt).toLocaleDateString()}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-ink-300">{t('checkout.bankPaymentNote')}</p>
                  {/* Industry terms put intermediary bank charges on the remitter
                      ("OUR"), but SHA is most banks' default, so without saying so
                      the transfer arrives short and the order looks underpaid. */}
                  <p className="text-[11px] text-ink-500 leading-relaxed">{t('checkout.wireFeesNote')}</p>
                  {confirmed.paymentDueAt && (
                    <p className="text-[11px] text-ink-500 leading-relaxed">
                      {t('checkout.paymentDueNote', {
                        date: new Date(confirmed.paymentDueAt).toLocaleDateString(),
                      })}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* What's next */}
            <div className="bg-sunken border border-line rounded-sm px-5 py-4 mb-6 text-[13px] text-ink-500 space-y-2">
              <p className="font-semibold text-ink-700">{t('checkout.whatsNext')}</p>
              <ol className="list-decimal list-inside space-y-1 text-ink-500">
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
                className="flex-1 h-11 border-[1.5px] border-ink-900 rounded-lg text-[14px] text-ink-900 hover:bg-sunken transition-colors font-bold"
              >
                {t('checkout.continueShopping')}
              </button>
              <button
                onClick={() => navigate('/')}
                className="flex-1 h-11 bg-ink-700 text-white rounded-lg text-[14px] hover:bg-ink-900 transition-colors"
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
      <label className="block text-[12px] text-ink-500 mb-1 font-medium">{label}</label>
      {children}
      {error && <p className="text-[11px] text-signal-error mt-1">{error}</p>}
    </div>
  );
}

function input(hasError: boolean) {
  return `w-full px-3 py-2.5 border rounded-lg bg-canvas text-[13px] text-ink-700 placeholder:text-ink-300 focus:outline-none transition-colors ${
    hasError
      ? 'border-signal-error'
      : 'border-line-strong focus:border-ink-900'
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
      <span className="text-ink-500 shrink-0 w-[90px]">{label}</span>
      <span className="font-semibold text-ink-900 truncate flex-1">{value}</span>
      <button
        onClick={() => onCopy(value, field)}
        className="shrink-0 text-ink-300 hover:text-ink-900 transition-colors"
        title={t('common.copy')}
      >
        {copiedField === field ? (
          <CheckCircle2 size={13} className="text-signal-ok" />
        ) : (
          <Copy size={13} />
        )}
      </button>
    </div>
  );
}

export default function Checkout() {
  if (!PAYPAL_CONFIGURED && typeof console !== 'undefined') {
    // Surfaced in the browser console rather than swallowed: the previous
    // `|| 'test'` fallback made a missing build-time variable look like a
    // PayPal outage.
    console.error(
      '[checkout] VITE_PAYPAL_CLIENT_ID was not set when this bundle was built — ' +
      'PayPal is hidden. Set it in the Vercel project and redeploy.',
    );
  }
  return (
    <PayPalScriptProvider options={{
      // 'unconfigured' keeps the provider mountable (CheckoutContent calls
      // usePayPalScriptReducer) while the PayPal option itself stays hidden.
      clientId: PAYPAL_CLIENT_ID || 'unconfigured',
      currency: 'JPY',
      intent: 'capture',
    }}>
      <CheckoutContent />
    </PayPalScriptProvider>
  );
}
