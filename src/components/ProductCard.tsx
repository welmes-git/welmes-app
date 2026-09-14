import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { Product } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Heart, ShoppingCart } from 'lucide-react';
import { BADGE_TAGS, hasJapanese, maskDigits } from '../lib/utils';
import SignUpModal from './SignUpModal';
import SignInModal from './SignIn';

interface ProductCardProps {
  /** Use the shared Product type so this card can't drift from the model */
  product: Product;
  showQuickAdd?: boolean;
}

export default function ProductCard({ product, showQuickAdd = true }: ProductCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAuthenticated, currentUser, addToCart, showToast, toggleWishlist, isWishlisted } = useStore();
  const { formatPrice, currencyInfo } = useCurrency();
  // Faire: signed-out visitors get the sign-up sheet instead of the product page
  const [authModal, setAuthModal] = useState<'signup' | 'signin' | null>(null);

  const isVerified = currentUser?.status === 'approved';
  const canSeePrice = isAuthenticated && isVerified;
  const wishlisted = isWishlisted(product.id);
  const outOfStock = product.stock <= 0;
  const hasSetOptions = (product.setOptions?.length ?? 0) > 0;
  const badge = outOfStock ? null : product.tags.find((tag) => BADGE_TAGS.includes(tag));

  const handleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      showToast(t('wishlist.loginRequired'), 'info');
      navigate('/login');
      return;
    }
    toggleWishlist(product.id);
    showToast(wishlisted ? t('wishlist.removedFromWishlist') : t('wishlist.addedToWishlist'), 'success');
  };

  const handleUnlock = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Signed in but unverified: the button is disabled, so this only runs signed out.
    setAuthModal('signup');
  };

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (outOfStock) {
      showToast(t('productDetail.outOfStock'), 'error');
      return;
    }
    // Products sold in sets must be configured on the detail page — adding them
    // here would silently bill the single-unit price.
    if (hasSetOptions) {
      navigate(`/product/${product.id}`);
      return;
    }
    addToCart(product);
    showToast(t('productDetail.addedToCart'), 'success');
  };

  const priceText = formatPrice(product.wholesalePrice);

  // Faire x-small secondary button: 34px tall, 1px #dadada, 4px radius, 8px padding/gap
  const ctaCls =
    'inline-flex w-full min-[361px]:w-max max-w-full items-center justify-start gap-2 rounded-sm border border-line-control bg-canvas p-2 text-left text-[12px] leading-4 text-ink-700 transition-colors hover:border-ink-700 disabled:text-ink-300 disabled:hover:border-line-control';

  return (
    <Link
      to={`/product/${product.id}`}
      onClick={(e) => {
        if (isAuthenticated) return;
        e.preventDefault();
        setAuthModal('signup');
      }}
      className="group flex h-full flex-col tracking-[0.15px]"
    >
      {authModal === 'signup' && (
        <SignUpModal image={product.image} onClose={() => setAuthModal(null)} onSignIn={() => setAuthModal('signin')} />
      )}
      {authModal === 'signin' && <SignInModal onClose={() => setAuthModal(null)} />}
      {/* Image — 1:1, 4px radius, no border; a 2% black wash separates white packshots from the page */}
      <div className="relative">
        <img
          src={product.image}
          alt={product.nameEn}
          loading="lazy"
          className="aspect-square w-full rounded-sm bg-canvas object-cover object-center"
        />
        <div className="pointer-events-none absolute inset-0 rounded-sm bg-black/[0.02]" />

        {(badge || outOfStock) && (
          <span className="absolute left-2 top-2 min-h-[22px] min-w-[20px] max-w-[calc(100%-56px)] truncate rounded-sm border border-canvas bg-canvas px-[3px] py-[3px] text-[12px] font-medium leading-4 text-ink-700 lg:px-[7px]">
            {outOfStock ? t('productDetail.outOfStock') : badge}
          </span>
        )}

        {/* Faire only shows the favourite control to signed-in retailers */}
        {isAuthenticated && (
          <button
            type="button"
            onClick={handleWishlist}
            aria-label={t('wishlist.addedToWishlist')}
            aria-pressed={wishlisted}
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-canvas text-ink-700 transition-colors hover:text-ink-900"
          >
            <Heart size={14} className={wishlisted ? 'fill-ink-900 text-ink-900' : ''} />
          </button>
        )}
      </div>

      {/* Info: 8px under the image, price → name 2px, name → brand 0 */}
      <div className="flex flex-col gap-[2px] pt-2">
        {/* Price — locked keeps the currency symbol crisp and blurs only the digits */}
        <div className="flex items-baseline gap-[2px] text-[18px] font-medium leading-[26px] text-ink-700">
          {canSeePrice ? (
            <>
              {product.discount > 0 && (
                <span className="tabular-nums mr-1 font-bold text-ink-900">{product.discount}%</span>
              )}
              <span className="tabular-nums">{priceText}</span>
              {product.discount > 0 && (
                <span className="tabular-nums ml-1 text-[12px] font-normal leading-4 text-ink-300 line-through">
                  {formatPrice(product.originalPrice)}
                </span>
              )}
            </>
          ) : (
            <>
              <span>{currencyInfo.symbol}</span>
              <span className="tabular-nums pointer-events-none select-none blur-[8px]" aria-hidden="true">
                {maskDigits(priceText, currencyInfo.symbol)}
              </span>
            </>
          )}
        </div>

        <h3
          className={`line-clamp-1 break-words text-[14px] font-medium leading-5 text-ink-700 ${
            hasJapanese(product.nameEn) ? 'font-jp' : ''
          }`}
        >
          {product.nameEn}
        </h3>
      </div>

      <p className={`truncate text-[14px] leading-5 text-ink-700 ${hasJapanese(product.brand) ? 'font-jp' : ''}`}>
        {product.brand}
      </p>

      {/* Brand → CTA 12px. One fixed 34px slot so every tile in a row ends on the same line */}
      <div className="tile-cta mt-3 flex min-h-[34px] items-start">
        {!canSeePrice ? (
          <button type="button" onClick={handleUnlock} disabled={isAuthenticated} className={ctaCls}>
            <span className="min-w-0 flex-1 text-pretty">
              {isAuthenticated ? t('products.pendingPrice') : t('products.unlockPrice')}
            </span>
            {!isAuthenticated && <ArrowRight size={12} strokeWidth={1.5} className="tile-cta-icon shrink-0" />}
          </button>
        ) : showQuickAdd ? (
          <button type="button" onClick={handleQuickAdd} disabled={outOfStock} className={ctaCls}>
            <ShoppingCart size={12} strokeWidth={1.5} className="shrink-0" />
            <span className="min-w-0 flex-1 text-pretty">
              {outOfStock
                ? t('productDetail.outOfStock')
                : hasSetOptions
                ? t('productDetail.chooseSet')
                : t('common.addToCart')}
            </span>
          </button>
        ) : (
          <span className={`py-2 text-[12px] leading-4 ${outOfStock ? 'font-medium text-signal-error' : 'text-ink-500'}`}>
            {outOfStock
              ? t('productDetail.outOfStock')
              : `${t('productDetail.stock')} ${product.stock.toLocaleString()}`}
          </span>
        )}
      </div>
    </Link>
  );
}
