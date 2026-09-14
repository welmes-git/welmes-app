import { useNavigate } from 'react-router-dom';
import { Heart, Trash2 } from 'lucide-react';
import ProductCard from '../components/ProductCard';
import { useStore } from '../store/useStore';
import { initialProducts } from '../data/products';
import { useTranslation } from 'react-i18next';

export default function Wishlist() {
  const navigate = useNavigate();
  const { isAuthenticated, wishlist, toggleWishlist, products, productsLoading, showToast } = useStore();
  const { t } = useTranslation();

  // Only fall back to the demo catalogue once loading has actually finished
  // and come back empty — otherwise a wishlist that genuinely has items can
  // flash the "your wishlist is empty" state while the real fetch is in flight.
  const allProducts = products.length > 0 ? products : productsLoading ? [] : initialProducts;
  const wishlistProducts = allProducts.filter((p) => wishlist.includes(p.id));

  if (!isAuthenticated) {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-24 text-center">
        <Heart size={48} className="mx-auto text-line-strong mb-4" />
        <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 mb-2">{t('wishlist.loginRequired')}</h2>
        <p className="text-[14px] text-ink-500 mb-6">{t('wishlist.loginRequiredDesc')}</p>
        <button onClick={() => navigate('/login')} className="h-11 px-6 bg-ink-700 text-white rounded-lg text-[14px] hover:bg-ink-900 transition-colors">
          {t('wishlist.goToLogin')}
        </button>
      </div>
    );
  }

  if (productsLoading && wishlist.length > 0) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-line border-t-ink-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (wishlistProducts.length === 0) {
    return (
      <div className="max-w-[640px] mx-auto px-4 py-24 text-center">
        <Heart size={48} className="mx-auto text-line-strong mb-4" />
        <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 mb-2">{t('wishlist.empty')}</h2>
        <p className="text-[14px] text-ink-500 mb-6">{t('wishlist.emptyDesc')}</p>
        <button onClick={() => navigate('/products')} className="h-11 px-6 bg-ink-700 text-white rounded-lg text-[14px] hover:bg-ink-900 transition-colors">
          {t('wishlist.browseProducts')}
        </button>
      </div>
    );
  }

  return (
    <div className="bg-canvas min-h-screen pb-16">
      <div className="border-b border-line">
        <div className="page-container py-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart size={18} className="text-ink-900 fill-ink-900" />
            <h1 className="font-serif text-[30px] font-normal leading-[38px] text-ink-700">{t('wishlist.title')}</h1>
            <span className="text-[13px] tabular-nums text-ink-500 ml-1">{wishlistProducts.length}</span>
          </div>
          {wishlistProducts.length > 0 && (
            <button
              onClick={() => {
                wishlist.forEach((id) => toggleWishlist(id));
                showToast(t('wishlist.removedFromWishlist'), 'info');
              }}
              className="text-[12px] text-ink-500 hover:text-ink-900 transition-colors flex items-center gap-1"
            >
              <Trash2 size={13} />
              {t('wishlist.clearAll')}
            </button>
          )}
        </div>
      </div>

      <div className="page-container pt-6">
        <div className="product-grid">
          {wishlistProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </div>
    </div>
  );
}
