import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { useTranslation } from 'react-i18next';
import { Lock, Eye, ShoppingCart, Heart } from 'lucide-react';

interface ProductCardProps {
  product: {
    id: number;
    name: string;
    nameEn: string;
    brand: string;
    category: string;
    image: string;
    originalPrice: number;
    wholesalePrice: number;
    discount: number;
    tags: string[];
    rating: number;
    reviews: number;
    description: string;
    stock: number;
    status: 'active' | 'inactive';
  };
  showQuickAdd?: boolean;
}

export default function ProductCard({ product, showQuickAdd = true }: ProductCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { isAuthenticated, currentUser, addToCart, showToast, toggleWishlist, isWishlisted } = useStore();
  const { formatPrice } = useCurrency();
  const [isHovered, setIsHovered] = useState(false);

  const isVerified = currentUser?.status === 'approved';
  const canSeePrice = isAuthenticated && isVerified;
  const wishlisted = isWishlisted(product.id);

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

  const handleQuickAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isAuthenticated) {
      showToast(t('productDetail.loginToAddCart'), 'info');
      navigate('/login');
      return;
    }
    if (!isVerified) {
      showToast(t('productDetail.verifyToOrder'), 'info');
      return;
    }
    addToCart(product);
    showToast(t('productDetail.addedToCart'), 'success');
  };

  const tagColors: Record<string, string> = {
    Sale: 'bg-[#ff4d6d]',
    Best: 'bg-[#ff6b35]',
    New: 'bg-[#4a90e2]',
    Hot: 'bg-[#e74c3c]',
  };

  return (
    <Link
      to={`/product/${product.id}`}
      className="group block"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Image Container */}
      <div className="relative aspect-square overflow-hidden rounded-lg bg-[#f8f8fa] mb-3">
        <img
          src={product.image}
          alt={product.nameEn}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {/* Tags */}
        <div className="absolute top-2 left-2 flex gap-1">
          {product.tags.map((tag) => (
            <span
              key={tag}
              className={`${tagColors[tag] || 'bg-[#999]'} text-white text-[11px] font-medium px-2 py-0.5 rounded`}
            >
              {tag}
            </span>
          ))}
        </div>

        {/* Wishlist button */}
        <button
          onClick={handleWishlist}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm hover:scale-110 transition-transform"
        >
          <Heart
            size={15}
            className={wishlisted ? 'text-[#ff4d6d] fill-[#ff4d6d]' : 'text-[#bbb]'}
          />
        </button>

        {/* Hover Overlay */}
        {showQuickAdd && isHovered && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center gap-2 transition-opacity">
            {canSeePrice ? (
              <button
                onClick={handleQuickAdd}
                className="bg-white text-[#333] px-4 py-2 rounded-full text-[13px] font-medium flex items-center gap-2 hover:bg-[#ff4d6d] hover:text-white transition-colors shadow-lg"
              >
                <ShoppingCart size={14} />
                {t('common.addToCart')}
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate('/login');
                }}
                className="bg-white text-[#333] px-4 py-2 rounded-full text-[13px] font-medium flex items-center gap-2 hover:bg-[#4a90e2] hover:text-white transition-colors shadow-lg"
              >
                <Eye size={14} />
                {isAuthenticated ? t('products.verifyBusiness') : t('products.loginToView')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Product Info */}
      <div>
        {/* Brand */}
        <p className="text-[12px] text-[#999] uppercase tracking-wide mb-0.5">
          {product.brand}
        </p>

        {/* Name */}
        <div className="mb-2 min-h-[52px]">
          <h3 className="text-[14px] text-[#333] leading-[1.4] line-clamp-2">
            {product.nameEn}
          </h3>
          {product.name !== product.nameEn && (
            <p className="text-[11px] text-[#aaa] truncate mt-0.5">
              {product.name}
            </p>
          )}
        </div>

        {/* Price Section - B2B Masked */}
        {canSeePrice ? (
          <div className="flex items-center gap-2 flex-wrap">
            {product.discount > 0 && (
              <span className="text-[14px] font-bold text-[#ff4d6d]">
                {product.discount}%
              </span>
            )}
            <span className="text-[16px] font-bold text-[#333]">
              {formatPrice(product.wholesalePrice)}
            </span>
            {product.discount > 0 && (
              <span className="text-[13px] text-[#999] line-through">
                {formatPrice(product.originalPrice)}
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Lock size={14} className="text-[#999]" />
            <span className="text-[13px] text-[#999]">
              {isAuthenticated
                ? t('products.verifyBusiness')
                : t('products.loginToView')}
            </span>
          </div>
        )}

        {/* Rating */}
        <div className="flex items-center gap-1 mt-1.5">
          <div className="flex">
            {[1, 2, 3, 4, 5].map((star) => (
              <svg
                key={star}
                className={`w-3.5 h-3.5 ${
                  star <= Math.round(product.rating)
                    ? 'text-[#ffc107] fill-[#ffc107]'
                    : 'text-[#ddd]'
                }`}
                viewBox="0 0 20 20"
              >
                <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
              </svg>
            ))}
          </div>
          <span className="text-[11px] text-[#999]">
            ({product.reviews.toLocaleString()})
          </span>
        </div>
      </div>
    </Link>
  );
}
