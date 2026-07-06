import { useNavigate } from 'react-router-dom';
import { Heart, ShoppingCart, Trash2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { initialProducts } from '../data/products';
import { useTranslation } from 'react-i18next';

export default function Wishlist() {
  const navigate = useNavigate();
  const { isAuthenticated, wishlist, toggleWishlist, addToCart, products, showToast, currentUser } = useStore();
  const { formatPrice } = useCurrency();
  const { t } = useTranslation();

  const allProducts = products.length > 0 ? products : initialProducts;
  const wishlistProducts = allProducts.filter((p) => wishlist.includes(p.id));
  const isVerified = currentUser?.status === 'approved';

  if (!isAuthenticated) {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-24 text-center">
        <Heart size={48} className="mx-auto text-[#ddd] mb-4" />
        <h2 className="text-[20px] font-bold mb-2">{t('wishlist.loginRequired')}</h2>
        <p className="text-[14px] text-[#999] mb-6">{t('wishlist.loginRequiredDesc')}</p>
        <button onClick={() => navigate('/login')} className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[14px] hover:bg-[#555] transition-colors">
          {t('wishlist.goToLogin')}
        </button>
      </div>
    );
  }

  if (wishlistProducts.length === 0) {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-24 text-center">
        <Heart size={48} className="mx-auto text-[#ddd] mb-4" />
        <h2 className="text-[20px] font-bold mb-2">{t('wishlist.empty')}</h2>
        <p className="text-[14px] text-[#999] mb-6">{t('wishlist.emptyDesc')}</p>
        <button onClick={() => navigate('/products')} className="px-6 py-2.5 bg-[#333] text-white rounded-lg text-[14px] hover:bg-[#555] transition-colors">
          {t('wishlist.browseProducts')}
        </button>
      </div>
    );
  }

  function handleAddToCart(product: typeof wishlistProducts[0]) {
    if (!isVerified) {
      showToast(t('products.verifyBusiness'), 'info');
      return;
    }
    addToCart(product);
    showToast(t('common.addToCart'), 'success');
  }

  return (
    <div className="bg-[#f8f8fa] min-h-screen pb-16">
      <div className="bg-white border-b border-[#e5e5e5]">
        <div className="max-w-[960px] mx-auto px-4 py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart size={18} className="text-[#ff4d6d] fill-[#ff4d6d]" />
            <h1 className="text-[20px] font-bold text-[#222]">{t('wishlist.title')}</h1>
            <span className="text-[13px] text-[#aaa] ml-1">{wishlistProducts.length}</span>
          </div>
          {wishlistProducts.length > 0 && (
            <button
              onClick={() => {
                wishlist.forEach((id) => toggleWishlist(id));
                showToast(t('wishlist.title'), 'info');
              }}
              className="text-[12px] text-[#aaa] hover:text-[#ff4d6d] transition-colors flex items-center gap-1"
            >
              <Trash2 size={13} />
              {t('wishlist.clearAll')}
            </button>
          )}
        </div>
      </div>

      <div className="max-w-[960px] mx-auto px-4 pt-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {wishlistProducts.map((product) => (
            <div key={product.id} className="bg-white rounded-xl border border-[#e5e5e5] overflow-hidden hover:shadow-md transition-shadow group">
              <div className="relative aspect-square overflow-hidden cursor-pointer bg-[#f8f8fa]" onClick={() => navigate(`/product/${product.id}`)}>
                <img
                  src={product.image}
                  alt={product.nameEn}
                  onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/300x300/f0f0f0/999?text=IMG'; }}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {product.discount > 0 && (
                  <span className="absolute top-2 left-2 bg-[#ff4d6d] text-white text-[11px] font-bold px-2 py-0.5 rounded">-{product.discount}%</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWishlist(product.id);
                    showToast(t('wishlist.removedFromWishlist'), 'info');
                  }}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm hover:scale-110 transition-transform"
                >
                  <Heart size={15} className="text-[#ff4d6d] fill-[#ff4d6d]" />
                </button>
              </div>

              <div className="p-3">
                <p className="text-[11px] text-[#aaa] uppercase tracking-wide mb-0.5">{product.brand}</p>
                <p className="text-[13px] text-[#222] font-medium line-clamp-2 leading-snug mb-2 cursor-pointer hover:text-[#4a90e2] transition-colors min-h-[36px]" onClick={() => navigate(`/product/${product.id}`)}>
                  {product.nameEn}
                </p>

                {isVerified ? (
                  <div className="mb-2">
                    <span className="text-[15px] font-bold text-[#333]">{formatPrice(product.wholesalePrice)}</span>
                    {product.discount > 0 && <span className="text-[12px] text-[#bbb] line-through ml-2">{formatPrice(product.originalPrice)}</span>}
                  </div>
                ) : (
                  <p className="text-[12px] text-[#bbb] mb-2">{t('products.loginToView')}</p>
                )}

                <button
                  onClick={() => handleAddToCart(product)}
                  disabled={!isVerified}
                  className={`w-full py-2 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${isVerified ? 'bg-[#333] text-white hover:bg-[#555]' : 'bg-[#f0f0f0] text-[#bbb] cursor-not-allowed'}`}
                >
                  <ShoppingCart size={13} />
                  {t('common.addToCart')}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
