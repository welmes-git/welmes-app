import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { SetOption } from '../store/useStore';
import { initialProducts } from '../data/products';
import { useCurrency } from '../context/CurrencyContext';
import ProductCard from '../components/ProductCard';
import {
  Heart,
  Share2,
  Minus,
  Plus,
  ShoppingCart,
  MessageCircle,
  Lock,
  Star,
} from 'lucide-react';

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { products, addToCart, isAuthenticated, currentUser, showToast } =
    useStore();
  const { formatPrice } = useCurrency();
  // setQty: { S1: 0, S2: 2, S3: 0 } — quantity per set option
  const [setQty, setSetQty] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<'info' | 'reviews' | 'shipping'>('info');
  const [isWishlisted, setIsWishlisted] = useState(false);
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const allProducts = products.length > 0 ? products : initialProducts;
  const product = allProducts.find((p) => p.id === Number(id));

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
      showToast('Please login to add items to cart', 'info');
      navigate('/login');
      return;
    }
    if (!isVerified) {
      showToast('Business verification required', 'info');
      return;
    }
    if (!product) return;
    if (selectedSets.length === 0) {
      showToast('Please select at least one set', 'info');
      return;
    }
    selectedSets.forEach((opt) => {
      addToCart(product, setQty[opt.id], opt);
    });
    showToast(`${selectedSets.length} set(s) added to cart`, 'success');
    setSetQty({});
  };

  const handleOrderInquiry = () => {
    showToast('Order inquiry feature coming soon', 'info');
  };

  if (!product) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-[18px] text-[#999] mb-4">Product not found</p>
          <Link to="/" className="text-[#4a90e2] hover:underline">
            Back to Home
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
            Home
          </Link>
          <span>&gt;</span>
          <Link to={`/products?category=${product.category}`} className="hover:text-[#333]">
            {product.category}
          </Link>
          <span>&gt;</span>
          <span className="text-[#333] truncate max-w-[200px]">{product.name}</span>
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
                      alt={product.name}
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
            <h1 className="text-[22px] font-bold text-[#333] mt-1 mb-3">
              {product.name}
            </h1>

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
                ({product.reviews.toLocaleString()} reviews)
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
                Stock: {product.stock}
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
                          <p style={{fontSize:'11px', color:'#999', marginBottom:'8px'}}>{opt.unitsPerSet} units / set</p>
                          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-end', marginBottom:'10px'}}>
                            <div>
                              {canSeePrice ? (
                                <>
                                  <p style={{fontSize:'10px', color:'#999'}}>Unit price</p>
                                  <p style={{fontSize:'11px', color:'#bbb', textDecoration:'line-through'}}>{formatPrice(unitOriginal)}</p>
                                  <p style={{fontSize:'13px', fontWeight:600, color:'#333'}}>{formatPrice(unitWholesale)} <span style={{fontSize:'10px', fontWeight:400, color:'#999'}}>/ unit</span></p>
                                </>
                              ) : (
                                <span style={{fontSize:'12px', color:'#999'}}>Login to view price</span>
                              )}
                            </div>
                            {canSeePrice && (
                              <div style={{textAlign:'right'}}>
                                <p style={{fontSize:'10px', color:'#999'}}>Set total</p>
                                <p style={{fontSize:'11px', color:'#bbb', textDecoration:'line-through'}}>{formatPrice(opt.originalPrice)}</p>
                                <p style={{fontSize:'15px', fontWeight:700, color:'#e53e3e'}}>{formatPrice(opt.wholesalePrice)}</p>
                                <p style={{fontSize:'10px', color:'#999'}}>1 set ({opt.unitsPerSet}pcs)</p>
                              </div>
                            )}
                          </div>
                          <div style={{display:'flex', alignItems:'center', borderTop:'1px solid #f0f0f0', paddingTop:'8px'}}>
                            <span style={{fontSize:'12px', color:'#666', flex:1}}>Qty</span>
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
                      <span className="text-right">Unit Price</span>
                      <span className="text-right">Set Total</span>
                      <span className="text-right">Qty</span>
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
                              <p className="text-[11px] text-[#999] mt-0.5">{opt.unitsPerSet} units / set</p>
                            </div>
                            <div className="text-right">
                              {canSeePrice ? (
                                <>
                                  <p className="text-[11px] text-[#bbb] line-through">{formatPrice(unitOriginal)}</p>
                                  <p className="text-[13px] font-semibold text-[#333]">{formatPrice(unitWholesale)}</p>
                                  <p className="text-[10px] text-[#999]">/ unit</p>
                                </>
                              ) : (
                                <div className="flex items-center justify-end gap-1 text-[#999]"><Lock size={12} /><span className="text-[12px]">Login</span></div>
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
                        ? 'Business verification required to view wholesale prices'
                        : 'Login to view wholesale prices'}
                    </p>
                    <button
                      onClick={() => navigate(isAuthenticated ? '/register' : '/login')}
                      className="text-[13px] text-[#4a90e2] hover:underline"
                    >
                      {isAuthenticated ? 'Verify now →' : 'Login →'}
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
                      <span className="text-[13px] text-[#999]">Total</span>
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
                Set options not available for this product.
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
                onClick={() => showToast('Share link copied!', 'success')}
                className="w-12 h-12 flex items-center justify-center border border-[#ddd] rounded-lg text-[#999] hover:border-[#4a90e2] hover:text-[#4a90e2] transition-colors"
              >
                <Share2 size={20} />
              </button>
              <button
                onClick={handleAddToCart}
                className="flex-1 h-12 border-2 border-[#333] text-[#333] rounded-lg font-medium text-[14px] hover:bg-[#333] hover:text-white transition-colors flex items-center justify-center gap-2"
              >
                <ShoppingCart size={16} />
                Add to Cart
              </button>
              <button
                onClick={handleOrderInquiry}
                className="flex-1 h-12 bg-[#333] text-white rounded-lg font-medium text-[14px] hover:bg-[#555] transition-colors flex items-center justify-center gap-2"
              >
                <MessageCircle size={16} />
                Inquiry
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
                  ? 'Product Info'
                  : tab === 'reviews'
                  ? `Reviews (${product.reviews.toLocaleString()})`
                  : 'Shipping'}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="mb-16">
          {activeTab === 'info' && (
            <div className="prose max-w-none">
              <p className="text-[14px] text-[#555] leading-relaxed">
                {product.description}
              </p>
              <div className="mt-6 bg-[#f8f8fa] rounded-lg p-6">
                <h3 className="text-[16px] font-bold text-[#333] mb-4">
                  Product Details
                </h3>
                <table className="w-full text-[13px]">
                  <tbody>
                    <tr className="border-b border-[#e5e5e5]">
                      <td className="py-2.5 text-[#999] w-[120px]">Brand</td>
                      <td className="py-2.5 text-[#333]">{product.brand}</td>
                    </tr>
                    <tr className="border-b border-[#e5e5e5]">
                      <td className="py-2.5 text-[#999]">Category</td>
                      <td className="py-2.5 text-[#333]">{product.category}</td>
                    </tr>
                    <tr className="border-b border-[#e5e5e5]">
                      <td className="py-2.5 text-[#999]">Stock</td>
                      <td className="py-2.5 text-[#333]">
                        {product.stock} units
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-[#999]">Status</td>
                      <td className="py-2.5">
                        <span
                          className={`text-[12px] px-2 py-0.5 rounded ${
                            product.status === 'active'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {product.status === 'active' ? 'In Stock' : 'Out of Stock'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'reviews' && (
            <div className="text-center py-12">
              <div className="flex items-center justify-center gap-1 mb-3">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    size={24}
                    className={
                      star <= Math.round(product.rating)
                        ? 'text-[#ffc107] fill-[#ffc107]'
                        : 'text-[#ddd]'
                    }
                  />
                ))}
              </div>
              <p className="text-[18px] font-bold text-[#333] mb-1">
                {product.rating} / 5.0
              </p>
              <p className="text-[14px] text-[#999]">
                Based on {product.reviews.toLocaleString()} reviews
              </p>
              <p className="text-[13px] text-[#999] mt-4">
                Review system integration coming soon.
              </p>
            </div>
          )}

          {activeTab === 'shipping' && (
            <div className="bg-[#f8f8fa] rounded-lg p-6">
              <h3 className="text-[16px] font-bold text-[#333] mb-4">
                Shipping Information
              </h3>
              <div className="space-y-4 text-[13px] text-[#555]">
                <div>
                  <p className="font-medium text-[#333] mb-1">Standard Shipping</p>
                  <p>2,500원 (Free for orders over 100,000원)</p>
                  <p>Estimated delivery: 2-3 business days</p>
                </div>
                <div>
                  <p className="font-medium text-[#333] mb-1">Bulk Orders</p>
                  <p>Free shipping for orders over 500,000원</p>
                  <p>Estimated delivery: 3-5 business days</p>
                </div>
                <div>
                  <p className="font-medium text-[#333] mb-1">Return Policy</p>
                  <p>Returns accepted within 7 days of delivery</p>
                  <p>Items must be unopened and in original packaging</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Related Products */}
        {relatedProducts.length > 0 && (
          <div>
            <h2 className="text-[20px] font-bold text-[#333] mb-6">
              Related Products
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
