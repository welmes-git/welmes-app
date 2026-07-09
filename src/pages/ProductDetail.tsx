import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { SetOption } from '../store/useStore';
import { initialProducts } from '../data/products';
import { useCurrency } from '../context/CurrencyContext';
import { useTranslation } from 'react-i18next';
import ProductCard from '../components/ProductCard';
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
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { products, productsLoading, addToCart, isAuthenticated, currentUser, showToast } =
    useStore();
  const { formatPrice } = useCurrency();
  const [setQty, setSetQty] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<'info' | 'reviews' | 'shipping'>('info');
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);

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
    if (activeTab === 'reviews') loadReviews();
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
  const allProducts = products.length > 0 ? products : productsLoading ? [] : initialProducts;
  const product = allProducts.find((p) => p.id === productId);

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
          <div className="w-8 h-8 border-2 border-[#e5e5e5] border-t-[#333] rounded-full animate-spin" />
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[18px] text-[#999] mb-4">{t('productDetail.notFound')}</p>
          <Link to="/" className="text-[#4a90e2] hover:underline">
            {t('common.backToHome')}
          </Link>
        </div>
      </div>
    );
  }

  const relatedProducts = allProducts
    .filter((p) => p.category === product.category && p.id !== product.id)
    .slice(0, 4);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[1100px] mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[13px] text-[#999] mb-6">
          <Link to="/" className="hover:text-[#333]">
            {t('common.home')}
          </Link>
          <span>&gt;</span>
          <Link to={`/products?category=${product.category}`} className="hover:text-[#333]">
            {product.category}
          </Link>
          <span>&gt;</span>
          <span className="text-[#333] truncate max-w-[200px]">{product.nameEn}</span>
        </div>

        {/* Product Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mb-12">
          {/* Left - Image Gallery */}
          <div>
            {(() => {
              const imgs = product.images && product.images.length > 0
                ? product.images
                : product.image ? [product.image] : [];
              const current = imgs[activeImageIdx] || imgs[0] || '';
              return (
                <>
                  <div className="aspect-square bg-[#f8f8fa] rounded-lg overflow-hidden mb-3 relative">
                    <img
                      src={current}
                      alt={product.nameEn}
                      className="w-full h-full object-cover"
                    />
                    {imgs.length > 1 && (
                      <>
                        <button
                          onClick={() => setActiveImageIdx((i) => (i - 1 + imgs.length) % imgs.length)}
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center text-[#333] hover:bg-white shadow"
                        >‹</button>
                        <button
                          onClick={() => setActiveImageIdx((i) => (i + 1) % imgs.length)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 rounded-full flex items-center justify-center text-[#333] hover:bg-white shadow"
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
                          className={`shrink-0 w-16 h-16 rounded border-2 overflow-hidden bg-[#f8f8fa] transition-colors ${
                            idx === activeImageIdx ? 'border-[#333]' : 'border-[#e5e5e5]'
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
              className="text-[14px] text-[#999] hover:text-[#ff4d6d] transition-colors"
            >
              {product.brand}
            </Link>

            {/* Name */}
            <h1 className="text-[22px] font-bold text-[#333] mt-1">
              {product.nameEn}
            </h1>
            {product.name !== product.nameEn && (
              <p className="text-[13px] text-[#aaa] mb-3">
                {product.name}
              </p>
            )}
            {product.name === product.nameEn && <div className="mb-3" />}

            {/* Rating */}
            <div className="flex items-center gap-2 mb-4">
              <div className="flex">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={16}
                    className={
                      star <= Math.round(product.rating)
                        ? 'text-[#ffc107] fill-[#ffc107]'
                        : 'text-[#ddd]'
                    }
                  />
                ))}
              </div>
              <span className="text-[13px] text-[#333] font-medium">
                {product.rating}
              </span>
              <span className="text-[13px] text-[#999]">
                ({product.reviews.toLocaleString()} {t('review.basedOn')})
              </span>
            </div>

            {/* Tags */}
            <div className="flex gap-2 mb-5">
              {product.tags.map((tag) => (
                <span
                  key={tag}
                  className={`${
                    tag === 'Sale'
                      ? 'bg-[#ff4d6d]'
                      : tag === 'Best'
                      ? 'bg-[#ff6b35]'
                      : tag === 'New'
                      ? 'bg-[#4a90e2]'
                      : 'bg-[#e74c3c]'
                  } text-white text-[11px] font-medium px-2.5 py-1 rounded`}
                >
                  {tag}
                </span>
              ))}
              <span className="bg-[#f8f8fa] text-[#666] text-[11px] px-2.5 py-1 rounded">
                {t('productDetail.stock')}: {product.stock}
              </span>
            </div>

            {/* Set Order Table */}
            {product.setOptions && product.setOptions.length > 0 ? (
              <div className="mb-5">
                {isMobile ? (
                  /* Mobile: Card layout */
                  <div style={{display:'flex', flexDirection:'column', gap:'8px'}}>
                    {product.setOptions.map((opt: SetOption) => {
                      const qty = setQty[opt.id] ?? 0;
                      const unitWholesale = Math.round(opt.wholesalePrice / opt.unitsPerSet);
                      const unitOriginal = Math.round(opt.originalPrice / opt.unitsPerSet);
                      return (
                        <div
                          key={opt.id}
                          style={{
                            border: qty > 0 ? '1.5px solid #4a90e2' : '1px solid #e5e5e5',
                            borderRadius: '10px',
                            padding: '12px',
                            backgroundColor: qty > 0 ? '#f0f7ff' : '#fff',
                          }}
                        >
                          <div style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px'}}>
                            <span style={{fontSize:'11px', fontWeight:700, color:'#4a90e2', background:'#eef4ff', padding:'2px 7px', borderRadius:'4px'}}>{opt.id}</span>
                            <span style={{fontSize:'13px', fontWeight:600, color:'#333'}}>{opt.description}</span>
                          </div>
                          <p style={{fontSize:'11px', color:'#999', marginBottom:'8px'}}>{opt.unitsPerSet} {t('productDetail.units')} / {t('productDetail.setOptions').toLowerCase()}</p>
                          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:'10px'}}>
                            <div>
                              {canSeePrice ? (
                                <>
                                  <p style={{fontSize:'10px', color:'#999'}}>{t('productDetail.unitPrice')}</p>
                                  <p style={{fontSize:'11px', color:'#bbb', textDecoration:'line-through'}}>{formatPrice(unitOriginal)}</p>
                                  <p style={{fontSize:'13px', fontWeight:600, color:'#333'}}>{formatPrice(unitWholesale)} <span style={{fontSize:'10px', fontWeight:400, color:'#999'}}>/ {t('productDetail.units')}</span></p>
                                </>
                              ) : (
                                <span style={{fontSize:'12px', color:'#999'}}>{t('products.loginToView')}</span>
                              )}
                            </div>
                            {canSeePrice && (
                              <div style={{textAlign:'right'}}>
                                <p style={{fontSize:'10px', color:'#999'}}>{t('productDetail.setTotal')}</p>
                                <p style={{fontSize:'11px', color:'#bbb', textDecoration:'line-through'}}>{formatPrice(opt.originalPrice)}</p>
                                <p style={{fontSize:'15px', fontWeight:700, color:'#e53e3e'}}>{formatPrice(opt.wholesalePrice)}</p>
                                <p style={{fontSize:'10px', color:'#999'}}>1 set ({opt.unitsPerSet}pcs)</p>
                              </div>
                            )}
                          </div>
                          <div style={{display:'flex', alignItems:'center', borderTop:'1px solid #f0f0f0', paddingTop:'8px'}}>
                            <span style={{fontSize:'12px', color:'#666', flex:1}}>{t('productDetail.qty')}</span>
                            <button onClick={() => changeQty(opt.id, -1)} disabled={!canSeePrice} style={{width:'32px', height:'32px', border:'1px solid #ddd', background:'#fff', borderRadius:'6px 0 0 6px', display:'flex', alignItems:'center', justifyContent:'center', opacity: !canSeePrice ? 0.3 : 1}}><Minus size={12} /></button>
                            <span style={{width:'40px', height:'32px', border:'1px solid #ddd', borderLeft:'none', borderRight:'none', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'14px', fontWeight:500}}>{qty}</span>
                            <button onClick={() => changeQty(opt.id, 1)} disabled={!canSeePrice} style={{width:'32px', height:'32px', border:'1px solid #ddd', background:'#fff', borderRadius:'0 6px 6px 0', display:'flex', alignItems:'center', justifyContent:'center', opacity: !canSeePrice ? 0.3 : 1}}><Plus size={12} /></button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* Desktop: Table layout */
                  <>
                    <div className="grid grid-cols-[48px_1fr_120px_140px_110px] text-[11px] font-semibold text-[#999] uppercase tracking-wide bg-[#f8f8fa] border border-[#e5e5e5] rounded-t-lg px-3 py-2.5">
                      <span>Set</span>
                      <span>Description</span>
                      <span className="text-right">{t('productDetail.unitPrice')}</span>
                      <span className="text-right">{t('productDetail.setTotal')}</span>
                      <span className="text-right">{t('productDetail.qty')}</span>
                    </div>
                    <div className="border-x border-b border-[#e5e5e5] rounded-b-lg divide-y divide-[#f0f0f0]">
                      {product.setOptions.map((opt: SetOption) => {
                        const qty = setQty[opt.id] ?? 0;
                        const unitWholesale = Math.round(opt.wholesalePrice / opt.unitsPerSet);
                        const unitOriginal = Math.round(opt.originalPrice / opt.unitsPerSet);
                        const setTotal = opt.wholesalePrice;
                        return (
                          <div key={opt.id} className={`grid grid-cols-[48px_1fr_120px_140px_110px] items-center px-3 py-3 transition-colors ${qty > 0 ? 'bg-[#f0f7ff]' : 'hover:bg-[#fafafa]'}`}>
                            <span className="text-[13px] font-bold text-[#333]">{opt.id}</span>
                            <div>
                              <p className="text-[13px] text-[#333] font-medium">{opt.description}</p>
                              <p className="text-[11px] text-[#999] mt-0.5">{opt.unitsPerSet} {t('productDetail.units')} / set</p>
                            </div>
                            <div className="text-right">
                              {canSeePrice ? (
                                <>
                                  <p className="text-[11px] text-[#bbb] line-through">{formatPrice(unitOriginal)}</p>
                                  <p className="text-[13px] font-semibold text-[#333]">{formatPrice(unitWholesale)}</p>
                                  <p className="text-[10px] text-[#999]">/ {t('productDetail.units')}</p>
                                </>
                              ) : (
                                <div className="flex items-center justify-end gap-1 text-[#999]"><Lock size={12} /><span className="text-[12px]">{t('common.login')}</span></div>
                              )}
                            </div>
                            <div className="text-right">
                              {canSeePrice ? (
                                <>
                                  <p className="text-[11px] text-[#bbb] line-through">{formatPrice(opt.originalPrice)}</p>
                                  <p className="text-[14px] font-bold text-[#e53e3e]">{formatPrice(setTotal)}</p>
                                  <p className="text-[10px] text-[#999]">1 set ({opt.unitsPerSet}pcs)</p>
                                </>
                              ) : (
                                <span className="text-[12px] text-[#ccc]">—</span>
                              )}
                            </div>
                            <div className="flex items-center justify-end">
                              <button onClick={() => changeQty(opt.id, -1)} disabled={!canSeePrice} className="w-7 h-7 border border-[#ddd] flex items-center justify-center rounded-l hover:bg-[#f0f0f0] disabled:opacity-30"><Minus size={11} /></button>
                              <span className="w-9 h-7 border-t border-b border-[#ddd] flex items-center justify-center text-[13px] font-medium">{qty}</span>
                              <button onClick={() => changeQty(opt.id, 1)} disabled={!canSeePrice} className="w-7 h-7 border border-[#ddd] flex items-center justify-center rounded-r hover:bg-[#f0f0f0] disabled:opacity-30"><Plus size={11} /></button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* Login prompt */}
                {!canSeePrice && (
                  <div className="flex items-center gap-2 mt-3 px-1">
                    <Lock size={14} className="text-[#999]" />
                    <p className="text-[13px] text-[#999]">
                      {isAuthenticated
                        ? t('productDetail.verifyToViewPrices')
                        : t('productDetail.loginToOrder')}
                    </p>
                    <button
                      onClick={() => navigate(isAuthenticated ? '/register' : '/login')}
                      className="text-[13px] text-[#4a90e2] hover:underline"
                    >
                      {isAuthenticated ? t('productDetail.verifyNow') : t('productDetail.loginArrow')}
                    </button>
                  </div>
                )}

                {/* Grand Total */}
                {canSeePrice && grandTotal > 0 && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#e5e5e5]">
                    <div className="text-[13px] text-[#666]">
                      {selectedSets.map((opt) => (
                        <span key={opt.id} className="mr-3">
                          {opt.id} × {setQty[opt.id]}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-[#999]">{t('productDetail.grandTotal')}</span>
                      <span className="text-[22px] font-bold text-[#333]">
                        {formatPrice(grandTotal)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Fallback: no set options */
              <div className="bg-[#f8f8fa] rounded-lg p-4 mb-5 text-[14px] text-[#999]">
                {t('productDetail.setOptionsNA')}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => setIsWishlisted(!isWishlisted)}
                className={`w-12 h-12 flex items-center justify-center border rounded-lg transition-colors ${
                  isWishlisted
                    ? 'border-[#ff4d6d] text-[#ff4d6d]'
                    : 'border-[#ddd] text-[#999] hover:border-[#ff4d6d] hover:text-[#ff4d6d]'
                }`}
              >
                <Heart size={20} className={isWishlisted ? 'fill-[#ff4d6d]' : ''} />
              </button>
              <button
                onClick={() => showToast(t('productDetail.shareLink'), 'success')}
                className="w-12 h-12 flex items-center justify-center border border-[#ddd] rounded-lg text-[#999] hover:border-[#4a90e2] hover:text-[#4a90e2] transition-colors"
              >
                <Share2 size={20} />
              </button>
              <button
                onClick={handleAddToCart}
                className="flex-1 h-12 border-2 border-[#333] text-[#333] rounded-lg font-medium text-[14px] hover:bg-[#333] hover:text-white transition-colors flex items-center justify-center gap-2"
              >
                <ShoppingCart size={16} />
                {t('productDetail.addToCart')}
              </button>
              <button
                onClick={handleOrderInquiry}
                className="flex-1 h-12 bg-[#333] text-white rounded-lg font-medium text-[14px] hover:bg-[#555] transition-colors flex items-center justify-center gap-2"
              >
                <MessageCircle size={16} />
                {t('productDetail.orderInquiry')}
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-[#e5e5e5] mb-6">
          <div className="flex gap-0">
            {(['info', 'reviews', 'shipping'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-6 py-3 text-[14px] font-medium border-b-2 transition-colors capitalize ${
                  activeTab === tab
                    ? 'border-[#333] text-[#333]'
                    : 'border-transparent text-[#999] hover:text-[#666]'
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
              <div
                className="text-[14px] text-[#555] leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: (product.description || '')
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/\r?\n/g, '<br />'),
                }}
              />
              <div className="mt-6 bg-[#f8f8fa] rounded-lg p-6">
                <h3 className="text-[16px] font-bold text-[#333] mb-4">
                  {t('productDetail.productDetails')}
                </h3>
                <table className="w-full text-[13px]">
                  <tbody>
                    <tr className="border-b border-[#e5e5e5]">
                      <td className="py-2.5 text-[#999] w-[120px]">{t('productDetail.brand')}</td>
                      <td className="py-2.5 text-[#333]">{product.brand}</td>
                    </tr>
                    <tr className="border-b border-[#e5e5e5]">
                      <td className="py-2.5 text-[#999]">{t('products.category')}</td>
                      <td className="py-2.5 text-[#333]">{product.category}</td>
                    </tr>
                    <tr className="border-b border-[#e5e5e5]">
                      <td className="py-2.5 text-[#999]">{t('productDetail.stock')}</td>
                      <td className="py-2.5 text-[#333]">
                        {product.stock} {t('productDetail.units')}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-[#999]">{t('productDetail.status')}</td>
                      <td className="py-2.5">
                        <span
                          className={`text-[12px] px-2 py-0.5 rounded ${
                            product.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {product.status === 'active' ? t('productDetail.inStock') : t('productDetail.outOfStock')}
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
              <div className="bg-[#f8f8fa] rounded-xl p-5 flex flex-col sm:flex-row gap-6 items-center">
                <div className="text-center shrink-0">
                  <p className="text-[52px] font-black text-[#222] leading-none">
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
                          className={s <= Math.round(avg) ? 'text-[#ffc107] fill-[#ffc107]' : 'text-[#ddd]'} />
                      );
                    })}
                  </div>
                  <p className="text-[13px] text-[#999]">{reviews.length} {t('review.basedOn')}</p>
                </div>

                <div className="flex-1 w-full space-y-1.5">
                  {[5,4,3,2,1].map((star) => {
                    const count = reviews.filter((r) => r.rating === star).length;
                    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                    return (
                      <div key={star} className="flex items-center gap-2 text-[12px]">
                        <span className="w-4 text-[#666] text-right">{star}</span>
                        <Star size={11} className="text-[#ffc107] fill-[#ffc107] shrink-0" />
                        <div className="flex-1 h-2 bg-[#e5e5e5] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-[#ffc107] rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-6 text-[#999]">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Write Review Form ── */}
              {isAuthenticated && isVerified && !alreadyReviewed && (
                <div className="bg-white border border-[#e5e5e5] rounded-xl p-5">
                  <h3 className="text-[15px] font-bold text-[#222] mb-4">{t('review.writeReview')}</h3>

                  <div className="mb-4">
                    <p className="text-[12px] text-[#999] mb-2">{t('review.yourRating')}</p>
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
                                ? 'text-[#ffc107] fill-[#ffc107]'
                                : 'text-[#ddd]'
                            }
                          />
                        </button>
                      ))}
                      <span className="ml-2 text-[13px] text-[#666] self-center">
                        {ratingLabels[hoverRating || reviewRating]}
                      </span>
                    </div>
                  </div>

                  <div className="mb-4">
                    <p className="text-[12px] text-[#999] mb-2">{t('review.review')}</p>
                    <textarea
                      value={reviewContent}
                      onChange={(e) => setReviewContent(e.target.value)}
                      rows={4}
                      maxLength={500}
                      placeholder={t('review.placeholder')}
                      className="w-full px-3 py-2.5 border border-[#e5e5e5] rounded-lg text-[13px] text-[#333] focus:outline-none focus:border-[#4a90e2] resize-none transition-colors"
                    />
                    <div className="flex justify-between mt-1">
                      {reviewError
                        ? <p className="text-[11px] text-red-500">{reviewError}</p>
                        : <span />}
                      <span className="text-[11px] text-[#bbb]">{reviewContent.length}/500</span>
                    </div>
                  </div>

                  <button
                    onClick={submitReview}
                    disabled={reviewSubmitting}
                    className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[13px] font-semibold hover:bg-[#555] transition-colors disabled:opacity-50"
                  >
                    {reviewSubmitting ? t('review.submitting') : t('review.submit')}
                  </button>
                </div>
              )}

              {/* Already reviewed */}
              {isAuthenticated && isVerified && alreadyReviewed && (
                <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-[13px] text-green-700">
                  <CheckCircle2 size={15} />
                  {t('review.alreadyReviewed')}
                </div>
              )}

              {/* Login prompt */}
              {!isAuthenticated && (
                <div className="text-center py-6 border border-[#e5e5e5] rounded-xl">
                  <Lock size={24} className="mx-auto text-[#ccc] mb-2" />
                  <p className="text-[13px] text-[#999] mb-3">{t('review.loginToReview')}</p>
                  <button
                    onClick={() => navigate('/login')}
                    className="px-5 py-2 bg-[#333] text-white rounded-lg text-[13px] font-medium hover:bg-[#555] transition-colors"
                  >
                    {t('common.login')}
                  </button>
                </div>
              )}

              {/* ── Review List ── */}
              {reviewsLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-7 h-7 border-2 border-[#4a90e2] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : reviews.length === 0 ? (
                <div className="text-center py-12 text-[#bbb]">
                  <MessageCircle size={40} className="mx-auto mb-3 opacity-40" />
                  <p className="text-[14px]">{t('review.noReviews')}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {reviews.map((review) => (
                    <div key={review.id} className="bg-white border border-[#e5e5e5] rounded-xl p-5">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="text-[14px] font-semibold text-[#222]">{review.memberName}</p>
                          <div className="flex gap-0.5 mt-0.5">
                            {[1,2,3,4,5].map((s) => (
                              <Star key={s} size={13}
                                className={s <= review.rating ? 'text-[#ffc107] fill-[#ffc107]' : 'text-[#ddd]'} />
                            ))}
                          </div>
                        </div>
                        <span className="text-[11px] text-[#bbb] shrink-0">
                          {new Date(review.createdAt).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })}
                        </span>
                      </div>
                      <p className="text-[13px] text-[#555] leading-relaxed">{review.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'shipping' && (
            <div className="bg-[#f8f8fa] rounded-lg p-6">
              <h3 className="text-[16px] font-bold text-[#333] mb-4">
                {t('productDetail.shippingInfo')}
              </h3>
              <div className="space-y-4 text-[13px] text-[#555]">
                <div>
                  <p className="font-medium text-[#333] mb-1">{t('productDetail.standardShipping')}</p>
                  <p>{t('productDetail.standardShippingDesc1')}</p>
                  <p>{t('productDetail.standardShippingDesc2')}</p>
                </div>
                <div>
                  <p className="font-medium text-[#333] mb-1">{t('productDetail.bulkOrders')}</p>
                  <p>{t('productDetail.bulkOrdersDesc1')}</p>
                  <p>{t('productDetail.bulkOrdersDesc2')}</p>
                </div>
                <div>
                  <p className="font-medium text-[#333] mb-1">{t('productDetail.returnPolicy')}</p>
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
            <h2 className="text-[20px] font-bold text-[#333] mb-6">
              {t('productDetail.relatedProducts')}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
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
