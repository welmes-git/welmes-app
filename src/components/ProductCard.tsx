import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { Product } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Heart, ShoppingCart, Star } from 'lucide-react';

interface ProductCardProps {
  /** Use the shared Product type so this card can't drift from the model */
  product: Product;
  showQuickAdd?: boolean;
}

/** Marketing badges we're willing to render. Anything else in `tags` — scraped
 *  genres, JAN codes, source names — is data, not a badge. */
const BADGE_TAGS = ['New', 'Best', 'Sale', 'Hot'];

/** Kana or CJK ideographs — these need the JP face, not Pretendard's Korean kanji. */
const hasJapanese = (s: string) => /[぀-ヿ一-龯]/.test(s);

/** "¥1,234" -> "¥" + "X,XXX" so the blurred placeholder keeps the real width. */
const maskDigits = (formatted: string, symbol: string) =>
  formatted.slice(symbol.length).replace(/\d/g, 'X');

export default function ProductCard({ product, showQuickAdd = true }: ProductCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAuthenticated, currentUser, addToCart, showToast, toggleWishlist, isWishlisted } = useStore();
  const { formatPrice, currencyInfo } = useCurrency();

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
    // Signed in but unverified: the price is gated on approval, not on login.
    navigate(isAuthenticated ? '/register' : '/login');
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

  return (
    <Link to={`/product/${product.id}`} className="group block">
      {/* Image */}
      <div className="relative">
        <img
          src={product.image}
          alt={product.nameEn}
          loading="lazy"
          className="aspect-square w-full rounded-md border border-line bg-canvas object-cover transition-shadow duration-200 group-hover:shadow-hover"
        />

        {(badge || outOfStock) && (
          <span className="absolute left-2 top-2 rounded-sm border border-line-strong bg-canvas px-[7px] py-[3px] text-[11px] font-bold tracking-[0.02em] text-ink-700">
            {outOfStock ? t('productDetail.outOfStock') : badge}
          </span>
        )}

        <button
          type="button"
          onClick={handleWishlist}
          aria-label={t('wishlist.addedToWishlist')}
          aria-pressed={wishlisted}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-canvas text-ink-500 transition-colors hover:text-ink-900"
        >
          <Heart size={13} className={wishlisted ? 'fill-ink-900 text-ink-900' : ''} />
        </button>
      </div>

      {/* Info */}
      <div className="flex flex-col gap-0.5 pt-2">
        {/* Price — locked keeps the currency symbol crisp and blurs only the digits,
            so the card holds the same shape for signed-out and approved buyers. */}
        <div className="flex items-baseline gap-[3px] text-[15px] font-bold text-ink-700">
          {canSeePrice ? (
            <>
              {product.discount > 0 && (
                <span className="tabular-nums mr-[3px] font-extrabold text-ink-900">{product.discount}%</span>
              )}
              <span className="tabular-nums">{priceText}</span>
              {product.discount > 0 && (
                <span className="tabular-nums ml-[3px] text-[11px] font-normal text-ink-300 line-through">
                  {formatPrice(product.originalPrice)}
                </span>
              )}
            </>
          ) : (
            <>
              <span>{currencyInfo.symbol}</span>
              <span className="tabular-nums select-none blur-[4px]" aria-hidden="true">
                {maskDigits(priceText, currencyInfo.symbol)}
              </span>
            </>
          )}
        </div>

        <h3
          className={`line-clamp-2 min-h-[36px] text-[12.5px] font-medium leading-[1.45] text-ink-700 ${
            hasJapanese(product.nameEn) ? 'font-jp' : ''
          }`}
        >
          {product.nameEn}
        </h3>

        <p className="truncate text-[11.5px] text-ink-500">{product.brand}</p>

        <div className="flex items-center gap-1 text-[11.5px] text-ink-700">
          <Star size={11} className="shrink-0 fill-ink-700 text-ink-700" />
          <span className="tabular-nums">
            {product.rating.toFixed(1)} ({product.reviews.toLocaleString()})
          </span>
        </div>

        {/* One fixed-height slot, so every card in a row ends on the same line */}
        <div className="mt-2 flex min-h-[28px] items-center">
          {!canSeePrice ? (
            <button
              type="button"
              onClick={handleUnlock}
              disabled={isAuthenticated}
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-canvas px-[9px] text-[11px] font-bold text-ink-700 transition-colors hover:border-ink-900 hover:text-ink-900 disabled:border-line disabled:text-ink-300 disabled:hover:border-line"
            >
              <span className="truncate">
                {isAuthenticated ? t('products.pendingPrice') : t('products.unlockPrice')}
              </span>
              {!isAuthenticated && <ArrowRight size={11} className="shrink-0" />}
            </button>
          ) : showQuickAdd ? (
            <button
              type="button"
              onClick={handleQuickAdd}
              disabled={outOfStock}
              className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-line-strong bg-canvas px-[9px] text-[11px] font-bold text-ink-700 transition-colors hover:border-ink-900 hover:text-ink-900 disabled:border-line disabled:text-ink-300"
            >
              <ShoppingCart size={11} className="shrink-0" />
              <span className="truncate">
                {outOfStock
                  ? t('productDetail.outOfStock')
                  : hasSetOptions
                  ? t('productDetail.chooseSet')
                  : t('common.addToCart')}
              </span>
            </button>
          ) : (
            <span className={`text-[11.5px] ${outOfStock ? 'font-bold text-signal-error' : 'text-ink-500'}`}>
              {outOfStock
                ? t('productDetail.outOfStock')
                : `${t('productDetail.stock')} ${product.stock.toLocaleString()}`}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
