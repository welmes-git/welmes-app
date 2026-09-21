import { useState, useEffect, useCallback, useContext } from 'react';
import { useParams, Link, useNavigate, Navigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { SetOption } from '../store/useStore';
import { initialProducts } from '../data/products';
import { productSlug } from '../lib/productUrl';
import { displaySections, sectionLabelKey } from '../lib/productDescription';
import { SsrProductContext } from '../lib/ssrProductContext';
import { useCurrency } from '../context/CurrencyContext';
import { useTranslation } from 'react-i18next';
import { localizedName } from '../lib/productName';
import ProductSeo from '../components/ProductSeo';
import ProductCard from '../components/ProductCard';
import { BADGE_TAGS, hasJapanese, maskDigits } from '../lib/utils';
import * as db from '../lib/db';
import type { Review } from '../lib/db';
import {
  Heart,
  Share2,
  Minus,
  Plus,
  ShoppingCart,
  MessageCircle,
  Lock,
  Star,
  CheckCircle2,
} from 'lucide-react';

export default function ProductDetail() {
  const { id, slug } = useParams<{ id: string; slug?: string }>();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const { products, productsLoading, addToCart, isAuthenticated, currentUser, showToast, toggleWishlist, isWishlisted } =
    useStore();
  const { formatPrice, currencyInfo } = useCurrency();
  const [setQty, setSetQty] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<'info' | 'reviews' | 'shipping'>('info');
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const [reviews, setReviews] = useState<Review[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [alreadyReviewed, setAlreadyReviewed] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [reviewContent, setReviewContent] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const productId = Number(id);

  const loadReviews = useCallback(async () => {
    setReviewsLoading(true);
    const data = await db.fetchReviewsByProductId(productId);
    setReviews(data);
    setReviewsLoading(false);
    if (currentUser) {
      const reviewed = await db.hasReviewedProduct(currentUser.id, productId);
      setAlreadyReviewed(reviewed);
    }
  }, [productId, currentUser]);

  useEffect(() => {
    if (activeTab === 'reviews') queueMicrotask(() => { void loadReviews(); });
  }, [activeTab, loadReviews]);

  async function submitReview() {
    if (!currentUser) return;
    if (reviewContent.trim().length < 10) {
      setReviewError(t('review.placeholder'));
      return;
    }
    setReviewSubmitting(true);
    setReviewError('');
    const { error } = await db.insertReview({
      productId,
      memberId: currentUser.id,
      memberName: currentUser.companyName,
      rating: reviewRating,
      content: reviewContent.trim(),
    });
    setReviewSubmitting(false);
    if (error) {
      setReviewError(t('common.error'));
      return;
    }
    setReviewContent('');
    setReviewRating(5);
    setAlreadyReviewed(true);
    showToast(t('review.submitted'), 'success');
    loadReviews();
  }

  // Only fall back to the demo catalogue once loading has actually finished
  // and come back empty — otherwise a real product can flash as "not found"
  // (or briefly show an unrelated demo product at the same id) while the
  // real Supabase fetch is still in flight.
  const ssrProduct = useContext(SsrProductContext);
  const storeProducts = products.length > 0 ? products : productsLoading ? [] : initialProducts;
  const allProducts = ssrProduct && ssrProduct.id === productId
    ? [ssrProduct, ...storeProducts.filter((item) => item.id !== ssrProduct.id)]
    : storeProducts;
  const product = allProducts.find((p) => p.id === productId);
  // Readable name for the active language; falls back to English, then Japanese.
  const displayName = product ? localizedName(product, i18n.language) : '';

  const isVerified = currentUser?.status === 'approved';
  const canSeePrice = isAuthenticated && isVerified;

  const changeQty = (setId: string, delta: number) => {
    setSetQty((prev) => ({
      ...prev,
      [setId]: Math.max(0, (prev[setId] ?? 0) + delta),
    }));
  };

  const grandTotal = product
    ? (product.setOptions ?? []).reduce((sum, opt) => {
        return sum + opt.wholesalePrice * (setQty[opt.id] ?? 0);
      }, 0)
    : 0;

  const selectedSets = product
    ? (product.setOptions ?? []).filter((opt) => (setQty[opt.id] ?? 0) > 0)
    : [];

  const handleAddToCart = () => {
    if (!isAuthenticated) {
      showToast(t('productDetail.loginToAddCart'), 'info');
      navigate('/login');
      return;
    }
    if (!isVerified) {
      showToast(t('productDetail.verifyToOrder'), 'info');
      return;
    }
    if (!product) return;
    if (product.stock <= 0) {
      showToast(t('productDetail.outOfStock'), 'error');
      return;
    }
    if (selectedSets.length === 0) {
      showToast(t('productDetail.selectAtLeastOne'), 'info');
      return;
    }
    // `stock` is in pieces, so compare against total pieces across the sets
    const requestedUnits = selectedSets.reduce(
      (sum, opt) => sum + (setQty[opt.id] ?? 0) * opt.unitsPerSet,
      0,
    );
    if (requestedUnits > product.stock) {
      showToast(t('productDetail.notEnoughStock', { stock: product.stock }), 'error');
      return;
    }
    selectedSets.forEach((opt) => {
      addToCart(product, setQty[opt.id], opt);
    });
    showToast(`${selectedSets.length} set(s) ${t('productDetail.addedToCart')}`, 'success');
    setSetQty({});
  };

  const handleOrderInquiry = () => {
    showToast(t('productDetail.orderInquiryComingSoon'), 'info');
  };

  const ratingLabels = ['', t('review.poor'), t('review.fair'), t('review.good'), t('review.veryGood'), t('review.excellent')];

  if (!product) {
    if (productsLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-line border-t-ink-700 rounded-full animate-spin" />
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[18px] text-ink-500 mb-4">{t('productDetail.notFound')}</p>
          <Link to="/" className="text-ink-900 font-bold underline underline-offset-2">
            {t('common.backToHome')}
          </Link>
        </div>
      </div>
    );
  }

  // Canonical slug redirect: the id is authoritative, so a missing or stale slug
  // is corrected with a single replace navigation to /products/{id}/{slug}.
  const canonicalSlug = productSlug(product);
  if (slug !== canonicalSlug) {
    return <Navigate to={`/products/${product.id}/${canonicalSlug}`} replace />;
  }

  // Locked price: currency symbol stays crisp, only digits blur (DESIGN.md §4 가격 게이팅)
  const lockedPrice = (amount: number) => (
    <span className="inline-flex items-baseline gap-[2px]">
      <span>{currencyInfo.symbol}</span>
      <span className="tabular-nums select-none blur-[4px]" aria-hidden="true">
        {maskDigits(formatPrice(amount), currencyInfo.symbol)}
      </span>
    </span>
  );

  const stepper = (setId: string, qty: number, size: 'sm' | 'lg') => {
    const box = size === 'sm' ? 'h-7 w-7' : 'h-9 w-9';
    return (
      <div className="inline-flex overflow-hidden rounded-md border border-line-strong">
        <button type="button" aria-label="-" onClick={() => changeQty(setId, -1)} disabled={!canSeePrice}
          className={`${box} flex items-center justify-center text-ink-700 hover:bg-sunken disabled:opacity-30`}>
          <Minus size={11} />
        </button>
        <span className={`${size === 'sm' ? 'h-7 w-9' : 'h-9 w-11'} flex items-center justify-center border-x border-line-strong text-[13px] font-medium tabular-nums text-ink-900`}>
          {qty}
        </span>
        <button type="button" aria-label="+" onClick={() => changeQty(setId, 1)} disabled={!canSeePrice}
          className={`${box} flex items-center justify-center text-ink-700 hover:bg-sunken disabled:opacity-30`}>
          <Plus size={11} />
        </button>
      </div>
    );
  };

  // Selected set: sunken ground + 2px ink stripe on the left, never a color
  const selectedRow = 'bg-sunken shadow-[inset_2px_0_0_var(--wm-ink-900)]';
  const wishlisted = isWishlisted(product.id);

  const relatedProducts = allProducts
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 6);

  return (
    <div className="min-h-screen bg-white">
      <ProductSeo product={product} />
      <div className="page-container py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[13px] text-ink-500 mb-6">
          <Link to="/" className="hover:text-ink-700">
            {t('common.home')}
          </Link>
          <span>&gt;</span>
          <Link to={`/products?category=${product.category}`} className="hover:text-ink-700">
            {product.category}
          </Link>
          <span>&gt;</span>
          <span className="text-ink-700 truncate max-w-[200px]">{displayName}</span>
        </div>

        {/* Product Info */}
        <div className="grid grid-cols-1 gap-10 mb-12 md:grid-cols-2 lg:grid-cols-[minmax(0,600px)_minmax(0,720px)] lg:gap-12">
          {/* Left - Image Gallery */}
          <div>
            {(() => {
              const imgs = product.images && product.images.length > 0
                ? product.images
                : product.image ? [product.image] : [];
              const current = imgs[activeImageIdx] || imgs[0] || '';
              return (
                <>
                  <div className="aspect-square bg-canvas border border-line rounded-md overflow-hidden mb-3 relative">
                    <img
                      src={current}
                      alt={`${displayName} wholesale product image`}
                      className="w-full h-full object-cover"
                    />
                    {imgs.length > 1 && (
                      <>
                        <button
                          onClick={() => setActiveImageIdx((i) => (i - 1 + imgs.length) % imgs.length)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-canvas/90 border border-line-strong rounded-full flex items-center justify-center text-ink-700 hover:bg-canvas"
                        >‹</button>
                        <button
                          onClick={() => setActiveImageIdx((i) => (i + 1) % imgs.length)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-canvas/90 border border-line-strong rounded-full flex items-center justify-center text-ink-700 hover:bg-canvas"
                        >›</button>
                      </>
                    )}
                  </div>
                  {imgs.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {imgs.map((url, idx) => (
                        <button
                          key={idx}
                          onClick={() => setActiveImageIdx(idx)}
                          className={`shrink-0 w-16 h-16 rounded-md border-2 overflow-hidden bg-canvas transition-colors ${
                            idx === activeImageIdx ? 'border-ink-700' : 'border-line'
                          }`}
                        >
                          <img src={url} alt={`thumb ${idx + 1}`} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {/* Right - Info */}
          <div>
            {/* Brand */}
            <Link
              to={`/products?brand=${product.brand}`}
              className="text-[14px] text-ink-500 hover:text-ink-900 transition-colors"
            >
              {product.brand}
            </Link>

            {/* Name */}
            <h1 className={`mt-1 font-serif text-[30px] font-normal leading-[38px] text-ink-700 ${hasJapanese(displayName) ? 'font-jp' : ''}`}>
              {displayName}
            </h1>
            {product.name !== displayName && (
              <p className={`mb-3 text-[13px] text-ink-500 ${hasJapanese(product.name) ? 'font-jp' : ''}`}>
                {product.name}
              </p>
            )}
            {product.name === product.nameEn && <div className="mb-3" />}

            {product.seoDescription && (
              <p className="mb-4 max-w-2xl text-[14px] leading-6 text-ink-500" lang="en">
                {product.seoDescription}
              </p>
            )}

            {/* Rating */}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={16}
                    className={
                      star <= Math.round(product.rating)
                        ? 'text-ink-700 fill-ink-700'
                        : 'text-line-strong'
                    }
                  />
                ))}
              </div>
              <span className="text-[13px] text-ink-700 font-medium">
                {product.rating}
              </span>
              <span className="text-[13px] text-ink-500">
                ({t('review.basedOn', { count: product.reviews })})
              </span>
            </div>

            {/* Tags */}
            <div className="mb-5 flex items-center gap-2">
              {product.tags.filter((tag) => BADGE_TAGS.includes(tag)).map((tag) => (
                <span key={tag} className="rounded-sm border border-line-strong bg-canvas px-[7px] py-[3px] text-[11px] font-bold tracking-[0.02em] text-ink-700">
                  {tag}
                </span>
              ))}
              <span className="text-[11.5px] tabular-nums text-ink-500">
                {t('productDetail.stock')}: {product.stock}
              </span>
            </div>

            {/* Set Order Table */}
            {product.setOptions && product.setOptions.length > 0 ? (
              <div className="mb-5">
                {isMobile ? (
                  /* Mobile: Card layout */
                  <div className="flex flex-col gap-2">
                    {product.setOptions.map((opt: SetOption) => {
                      const qty = setQty[opt.id] ?? 0;
                      const unitWholesale = Math.round(opt.wholesalePrice / opt.unitsPerSet);
                      const unitOriginal = Math.round(opt.originalPrice / opt.unitsPerSet);
                      return (
                        <div key={opt.id} className={`rounded-sm border border-line p-3 transition-colors ${qty > 0 ? selectedRow : 'bg-canvas'}`}>
                          <div className="mb-2 flex items-center gap-2">
                            <span className="rounded-sm border border-line-strong bg-canvas px-[7px] py-[3px] text-[11px] font-bold tracking-[0.02em] text-ink-700">{opt.id}</span>
                            <span className="text-[13px] font-semibold text-ink-700">{opt.description}</span>
                          </div>
                          <p className="mb-2 text-[11px] text-ink-500">{t('productDetail.unitsPerSet', { count: opt.unitsPerSet })}</p>
                          <div className="mb-2.5 flex items-end justify-between">
                            <div>
                              <p className="text-[10px] font-semibold text-ink-500">{t('productDetail.unitPrice')}</p>
                              {canSeePrice ? (
                                <>
                                  <p className="text-[11px] tabular-nums text-ink-300 line-through">{formatPrice(unitOriginal)}</p>
                                  <p className="text-[13px] font-semibold tabular-nums text-ink-700">{formatPrice(unitWholesale)} <span className="text-[10px] font-normal text-ink-500">/ {t('productDetail.units')}</span></p>
                                </>
                              ) : (
                                <p className="text-[13px] font-semibold text-ink-700">{lockedPrice(unitWholesale)}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] font-semibold text-ink-500">{t('productDetail.setTotal')}</p>
                              {canSeePrice ? (
                                <>
                                  <p className="text-[11px] tabular-nums text-ink-300 line-through">{formatPrice(opt.originalPrice)}</p>
                                  <p className="text-[15px] font-bold tabular-nums text-ink-900">{formatPrice(opt.wholesalePrice)}</p>
                                </>
                              ) : (
                                <p className="text-[15px] font-bold text-ink-900">{lockedPrice(opt.wholesalePrice)}</p>
                              )}
                              <p className="text-[10px] text-ink-500">1 set ({opt.unitsPerSet}pcs)</p>
                            </div>
                          </div>
                          <div className="flex items-center border-t border-line pt-2">
                            <span className="flex-1 text-[12px] text-ink-500">{t('productDetail.qty')}</span>
                            {stepper(opt.id, qty, 'lg')}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Desktop: Table layout */
                  <div className="overflow-hidden rounded-sm border border-line">
                    <div className="grid grid-cols-[1fr_92px_112px_auto] gap-x-3 bg-sunken px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.02em] text-ink-500">
                      <span>Set</span>
                      <span className="text-right">{t('productDetail.unitPrice')}</span>
                      <span className="text-right">{t('productDetail.setTotal')}</span>
                      <span className="text-right">{t('productDetail.qty')}</span>
                    </div>
                    <div className="divide-y divide-line border-t border-line">
                      {product.setOptions.map((opt: SetOption) => {
                        const qty = setQty[opt.id] ?? 0;
                        const unitWholesale = Math.round(opt.wholesalePrice / opt.unitsPerSet);
                        const unitOriginal = Math.round(opt.originalPrice / opt.unitsPerSet);
                        return (
                          <div key={opt.id} className={`grid grid-cols-[1fr_92px_112px_auto] gap-x-3 items-center px-3 py-3 transition-colors ${qty > 0 ? selectedRow : 'hover:bg-sunken'}`}>
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-ink-700"><span className="mr-1.5 font-bold text-ink-900">{opt.id}</span>{opt.description}</p>
                              <p className="mt-0.5 text-[11px] text-ink-500">{t('productDetail.unitsPerSet', { count: opt.unitsPerSet })}</p>
                            </div>
                            <div className="text-right">
                              {canSeePrice ? (
                                <>
                                  <p className="text-[11px] tabular-nums text-ink-300 line-through">{formatPrice(unitOriginal)}</p>
                                  <p className="text-[13px] font-semibold tabular-nums text-ink-700">{formatPrice(unitWholesale)}</p>
                                </>
                              ) : (
                                <p className="text-[13px] font-semibold text-ink-700">{lockedPrice(unitWholesale)}</p>
                              )}
                              <p className="text-[10px] text-ink-500">/ {t('productDetail.units')}</p>
                            </div>
                            <div className="text-right">
                              {canSeePrice ? (
                                <>
                                  <p className="text-[11px] tabular-nums text-ink-300 line-through">{formatPrice(opt.originalPrice)}</p>
                                  <p className="text-[15px] font-bold tabular-nums text-ink-900">{formatPrice(opt.wholesalePrice)}</p>
                                </>
                              ) : (
                                <p className="text-[15px] font-bold text-ink-900">{lockedPrice(opt.wholesalePrice)}</p>
                              )}
                              <p className="text-[10px] text-ink-500">1 set ({opt.unitsPerSet}pcs)</p>
                            </div>
                            <div className="flex justify-end">{stepper(opt.id, qty, 'sm')}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Login / approval prompt */}
                {!canSeePrice && (
                  <div className="mt-3 flex items-center gap-2 px-1">
                    <Lock size={14} className="text-ink-500" />
                    <p className="text-[13px] text-ink-500">
                      {isAuthenticated
                        ? t('productDetail.verifyToViewPrices')
                        : t('productDetail.loginToOrder')}
                    </p>
                    <button
                      onClick={() => navigate(isAuthenticated ? '/register' : '/login')}
                      className="text-[13px] font-bold text-ink-900 underline underline-offset-2"
                    >
                      {isAuthenticated ? t('productDetail.verifyNow') : t('productDetail.loginArrow')}
                    </button>
                  </div>
                )}

                {/* Grand Total */}
                {canSeePrice && grandTotal > 0 && (
                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
                    <div className="text-[13px] tabular-nums text-ink-500">
                      {selectedSets.map((opt) => (
                        <span key={opt.id} className="mr-3">
                          {opt.id} × {setQty[opt.id]}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-[13px] text-ink-500">{t('productDetail.grandTotal')}</span>
                      <span className="text-[22px] font-medium tabular-nums text-ink-700">
                        {formatPrice(grandTotal)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Fallback: no set options */
              <div className="bg-sunken rounded-lg p-4 mb-5 text-[14px] text-ink-500">
                {t('productDetail.setOptionsNA')}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!isAuthenticated) {
                    showToast(t('wishlist.loginRequired'), 'info');
                    navigate('/login');
                    return;
                  }
                  toggleWishlist(product.id);
                  showToast(t(wishlisted ? 'wishlist.removedFromWishlist' : 'wishlist.addedToWishlist'), 'success');
                }}
                aria-pressed={wishlisted}
                aria-label={t('wishlist.title')}
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border transition-colors ${
                  wishlisted ? 'border-ink-900 text-ink-900' : 'border-line-strong text-ink-500 hover:border-ink-900 hover:text-ink-900'
                }`}
              >
                <Heart size={18} className={wishlisted ? 'fill-ink-900' : ''} />
              </button>
              <button
                onClick={() => showToast(t('productDetail.shareLink'), 'success')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line-strong text-ink-500 transition-colors hover:border-ink-900 hover:text-ink-900"
              >
                <Share2 size={18} />
              </button>
              <button
                onClick={handleAddToCart}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border-[1.5px] border-ink-900 bg-canvas text-[14px] font-bold text-ink-900 transition-colors hover:bg-sunken"
              >
                <ShoppingCart size={16} />
                {t('productDetail.addToCart')}
              </button>
              <button
                onClick={handleOrderInquiry}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-ink-700 text-[14px] text-white transition-colors hover:bg-ink-900"
              >
                <MessageCircle size={16} />
                {t('productDetail.orderInquiry')}
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-line mb-6">
          <div className="flex gap-0">
            {(['info', 'reviews', 'shipping'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 text-[14px] font-medium border-b-2 transition-colors capitalize ${
                  activeTab === tab
                    ? 'border-ink-900 font-bold text-ink-900'
                    : 'border-transparent text-ink-500 hover:text-ink-900'
                }`}
              >
                {tab === 'info'
                  ? t('productDetail.productInfo')
                  : tab === 'reviews'
                  ? `${t('productDetail.reviews')} (${reviews.length || product.reviews})`
                  : t('productDetail.shipping')}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="mb-16">
          {activeTab === 'info' && (
            <div className="prose max-w-none">
              {(() => {
                // Translation for the active language when available, otherwise the
                // parsed Japanese source — so section headings show in every
                // language (description_i18n never carries a `ja` entry).
                const sections = displaySections(product.descriptionI18n, i18n.language, product.description);
                if (sections) {
                  // Localized, template-ordered sections (overview, usage, size, spec, shipping, extras)
                  return (
                    <div className="space-y-5">
                      {sections.map((s, idx) => (
                        <div key={s.key ?? `extra-${idx}`}>
                          {s.key && (
                            <h4 className="text-[15px] font-medium text-ink-700 mb-1.5">
                              {t(sectionLabelKey(s.key))}
                            </h4>
                          )}
                          <div
                            className="text-[14px] text-ink-500 leading-relaxed"
                            dangerouslySetInnerHTML={{
                              __html: s.value
                                .replace(/&/g, '&amp;')
                                .replace(/</g, '&lt;')
                                .replace(/>/g, '&gt;')
                                .replace(/\r?\n/g, '<br />'),
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  );
                }
                // Fallback: raw source (Japanese) description
                return (
                  <div
                    className="text-[14px] text-ink-500 leading-relaxed"
                    dangerouslySetInnerHTML={{
                      __html: (product.description || '')
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/\r?\n/g, '<br />'),
                    }}
                  />
                );
              })()}
              <div className="mt-6 bg-sunken rounded-lg p-6">
                <h3 className="text-[16px] font-medium text-ink-700 mb-4">
                  {t('productDetail.productDetails')}
                </h3>
                <table className="w-full text-[13px]">
                  <tbody>
                    <tr className="border-b border-line">
                      <td className="py-2.5 text-ink-500 w-[120px]">{t('productDetail.brand')}</td>
                      <td className="py-2.5 text-ink-700">{product.brand}</td>
                    </tr>
                    <tr className="border-b border-line">
                      <td className="py-2.5 text-ink-500">{t('products.category')}</td>
                      <td className="py-2.5 text-ink-700">{product.category}</td>
                    </tr>
                    <tr className="border-b border-line">
                      <td className="py-2.5 text-ink-500">{t('productDetail.stock')}</td>
                      <td className="py-2.5 text-ink-700">
                        {t('cart.units', { count: product.stock })}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-ink-500">{t('productDetail.status')}</td>
                      <td className="py-2.5">
                        <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-700">
                          <span className={`h-1.5 w-1.5 rounded-full ${product.stock <= 0 ? 'bg-signal-error' : product.status === 'active' ? 'bg-signal-ok' : 'bg-ink-300'}`} />
                          {/* Availability follows stock; imported-but-unreviewed
                              (inactive, in stock) products show as coming soon */}
                          {product.stock <= 0
                            ? t('productDetail.outOfStock')
                            : product.status === 'active' ? t('productDetail.inStock') : t('productDetail.comingSoon')}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="space-y-6">

              {/* ── Rating Summary ── */}
              <div className="bg-sunken rounded-sm p-5 flex flex-col sm:flex-row gap-6 items-center">
                <div className="text-center shrink-0">
                  <p className="text-[40px] font-medium tabular-nums text-ink-700 leading-none">
                    {reviews.length > 0
                      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)
                      : product.rating.toFixed(1)}
                  </p>
                  <div className="flex justify-center gap-0.5 my-1.5">
                    {[1,2,3,4,5].map((s) => {
                      const avg = reviews.length > 0
                        ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length
                        : product.rating;
                      return (
                        <Star key={s} size={16}
                          className={s <= Math.round(avg) ? 'text-ink-700 fill-ink-700' : 'text-line-strong'} />
                      );
                    })}
                  </div>
                  <p className="text-[13px] text-ink-500">{t('review.basedOn', { count: reviews.length })}</p>
                </div>

                <div className="flex-1 w-full space-y-1.5">
                  {[5,4,3,2,1].map((star) => {
                    const count = reviews.filter((r) => r.rating === star).length;
                    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                    return (
                      <div key={star} className="flex items-center gap-2 text-[12px]">
                        <span className="w-4 text-ink-500 text-right">{star}</span>
                        <Star size={11} className="text-ink-700 fill-ink-700 shrink-0" />
                        <div className="flex-1 h-2 bg-line rounded-full overflow-hidden">
                          <div
                            className="h-full bg-ink-700 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-6 text-ink-500">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Write Review Form ── */}
              {isAuthenticated && isVerified && !alreadyReviewed && (
                <div className="bg-white border border-line rounded-sm p-5">
                  <h3 className="text-[15px] font-medium text-ink-700 mb-4">{t('review.writeReview')}</h3>

                  <div className="mb-4">
                    <p className="text-[12px] text-ink-500 mb-2">{t('review.yourRating')}</p>
                    <div className="flex gap-1">
                      {[1,2,3,4,5].map((s) => (
                        <button
                          key={s}
                          onMouseEnter={() => setHoverRating(s)}
                          onMouseLeave={() => setHoverRating(0)}
                          onClick={() => setReviewRating(s)}
                          className="transition-transform hover:scale-110"
                        >
                          <Star
                            size={28}
                            className={
                              s <= (hoverRating || reviewRating)
                                ? 'text-ink-700 fill-ink-700'
                                : 'text-line-strong'
                            }
                          />
                        </button>
                      ))}
                      <span className="ml-2 text-[13px] text-ink-500 self-center">
                        {ratingLabels[hoverRating || reviewRating]}
                      </span>
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-[12px] text-ink-500 mb-2">{t('review.review')}</p>
                    <textarea
                      value={reviewContent}
                      onChange={(e) => setReviewContent(e.target.value)}
                      rows={4}
                      maxLength={500}
                      placeholder={t('review.placeholder')}
                      className="w-full px-3 py-2.5 border border-line rounded-lg text-[13px] text-ink-700 focus:outline-none focus:border-ink-900 resize-none transition-colors"
                    />
                    <div className="flex justify-between mt-1">
                      {reviewError
                        ? <p className="text-[11px] text-signal-error">{reviewError}</p>
                        : <span />}
                      <span className="text-[11px] text-ink-300">{reviewContent.length}/500</span>
                    </div>
                  </div>

                  <button
                    onClick={submitReview}
                    disabled={reviewSubmitting}
                    className="px-6 py-2.5 bg-ink-700 text-white rounded-lg text-[13px] hover:bg-ink-900 transition-colors disabled:opacity-50"
                  >
                    {reviewSubmitting ? t('review.submitting') : t('review.submit')}
                  </button>
                </div>
              )}

              {/* Already reviewed */}
              {isAuthenticated && isVerified && alreadyReviewed && (
                <div className="flex items-center gap-2 px-4 py-3 border border-line rounded-lg text-[13px] text-ink-700">
                  <CheckCircle2 size={15} className="text-signal-ok" />
                  {t('review.alreadyReviewed')}
                </div>
              )}

              {/* Login prompt */}
              {!isAuthenticated && (
                <div className="text-center py-6 border border-line rounded-sm">
                  <Lock size={24} className="mx-auto text-ink-300 mb-2" />
                  <p className="text-[13px] text-ink-500 mb-3">{t('review.loginToReview')}</p>
                  <button
                    onClick={() => navigate('/login')}
                    className="px-5 py-2 bg-ink-700 text-white rounded-lg text-[13px] font-medium hover:bg-ink-900 transition-colors"
                  >
                    {t('common.login')}
                  </button>
                </div>
              )}

              {/* ── Review List ── */}
              {reviewsLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-7 h-7 border-2 border-ink-900 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : reviews.length === 0 ? (
                <div className="text-center py-12 text-ink-300">
                  <MessageCircle size={40} className="mx-auto mb-3 opacity-40" />
                  <p className="text-[14px]">{t('review.noReviews')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <div key={review.id} className="bg-white border border-line rounded-sm p-5">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[14px] font-semibold text-ink-900">{review.memberName}</p>
                          <div className="flex gap-0.5 mt-0.5">
                            {[1,2,3,4,5].map((s) => (
                              <Star key={s} size={13}
                                className={s <= review.rating ? 'text-ink-700 fill-ink-700' : 'text-line-strong'} />
                            ))}
                          </div>
                        </div>
                        <span className="text-[11px] text-ink-300 shrink-0">
                          {new Date(review.createdAt).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}
                        </span>
                      </div>
                      <p className="text-[13px] text-ink-500 leading-relaxed">{review.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'shipping' && (
            <div className="bg-sunken rounded-lg p-6">
              <h3 className="text-[16px] font-medium text-ink-700 mb-4">
                {t('productDetail.shippingInfo')}
              </h3>
              <div className="space-y-4 text-[13px] text-ink-500">
                <div>
                  <p className="font-medium text-ink-700 mb-1">{t('productDetail.standardShipping')}</p>
                  <p>{t('productDetail.standardShippingDesc1')}</p>
                  <p>{t('productDetail.standardShippingDesc2')}</p>
                </div>
                <div>
                  <p className="font-medium text-ink-700 mb-1">{t('productDetail.bulkOrders')}</p>
                  <p>{t('productDetail.bulkOrdersDesc1')}</p>
                  <p>{t('productDetail.bulkOrdersDesc2')}</p>
                </div>
                <div>
                  <p className="font-medium text-ink-700 mb-1">{t('productDetail.returnPolicy')}</p>
                  <p>{t('productDetail.returnPolicyDesc1')}</p>
                  <p>{t('productDetail.returnPolicyDesc2')}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <div>
            <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 mb-5">
              {t('productDetail.relatedProducts')}
            </h2>
            <div className="product-grid">
              {relatedProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
