import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { X, Plus, Minus, ShoppingBag, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CartDrawer({ isOpen, onClose }: CartDrawerProps) {
  const { cart, removeFromCart, updateCartQuantity, clearCart } = useStore();
  const { formatPrice } = useCurrency();
  const { t } = useTranslation();

  const total = cart.reduce(
    (sum, item) => sum + (item.setOption?.wholesalePrice ?? item.product.wholesalePrice) * item.quantity,
    0
  );

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-50"
          onClick={onClose}
        />
      )}

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-[400px] bg-canvas shadow-hover z-50 transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-line">
          <div className="flex items-center gap-2">
            <ShoppingBag size={20} />
            <h2 className="text-[17px] font-extrabold tracking-[-0.01em] text-ink-900">{t('cart.title')}</h2>
            <span className="text-[13px] tabular-nums text-ink-500">
              ({t('cart.items', { count: cart.reduce((s, i) => s + i.quantity, 0) })})
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-ink-700 hover:bg-sunken rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto h-[calc(100%-180px)] p-4">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <ShoppingBag size={48} className="text-line-strong mb-4" />
              <p className="text-[14px] text-ink-700 mb-2">{t('cart.empty')}</p>
              <p className="text-[12px] text-ink-500">{t('cart.emptyDesc')}</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {cart.map((item) => (
                <div
                  key={`${item.product.id}-${item.setOption?.id ?? 'solo'}`}
                  className="flex gap-3 py-4 first:pt-0"
                >
                  <img
                    src={item.product.image}
                    alt={item.product.nameEn ?? item.product.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        'https://placehold.co/70x70/f0f0f0/999?text=IMG';
                    }}
                    className="w-[70px] h-[70px] shrink-0 object-cover rounded-md border border-line bg-canvas"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11.5px] text-ink-500">
                      {item.product.brand}
                    </p>
                    <p className="text-[12.5px] font-medium text-ink-700 truncate">
                      {item.product.nameEn ?? item.product.name}
                    </p>
                    {item.setOption && (
                      <p className="text-[11px] text-ink-500 truncate">
                        <span className="font-bold text-ink-900">{item.setOption.id}</span> · {item.setOption.description}
                      </p>
                    )}
                    <p className="text-[15px] font-bold tabular-nums text-ink-900 mt-1">
                      {formatPrice(item.setOption?.wholesalePrice ?? item.product.wholesalePrice)}
                      <span className="text-[11px] text-ink-500 font-normal ml-1">
                        {item.setOption ? `/ set (${item.setOption.unitsPerSet}pcs)` : '/ unit'}
                      </span>
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <div className="inline-flex overflow-hidden rounded-md border border-line-strong">
                        <button
                          onClick={() =>
                            item.quantity > 1
                              ? updateCartQuantity(
                                  item.product.id,
                                  item.quantity - 1,
                                  item.setOption?.id
                                )
                              : removeFromCart(item.product.id, item.setOption?.id)
                          }
                          className="w-7 h-7 flex items-center justify-center text-ink-700 hover:bg-sunken"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-9 h-7 flex items-center justify-center border-x border-line-strong text-[13px] font-medium tabular-nums text-ink-900">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() =>
                            updateCartQuantity(
                              item.product.id,
                              item.quantity + 1,
                              item.setOption?.id
                            )
                          }
                          className="w-7 h-7 flex items-center justify-center text-ink-700 hover:bg-sunken"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.product.id, item.setOption?.id)}
                        aria-label={t('common.delete')}
                        className="text-ink-500 hover:text-ink-900 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {cart.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-canvas border-t border-line">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[14px] text-ink-500">{t('cart.total')}</span>
              <span className="text-[18px] font-extrabold tabular-nums text-ink-900">
                {formatPrice(total)}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={clearCart}
                className="flex-1 h-11 border border-line-strong rounded-lg text-[13px] font-bold text-ink-700 hover:bg-sunken transition-colors"
              >
                {t('common.delete')}
              </button>
              <Link
                to="/checkout"
                onClick={onClose}
                className="flex-1 h-11 flex items-center justify-center bg-ink-900 text-white rounded-lg text-[13px] font-bold hover:shadow-hover transition-shadow"
              >
                {t('cart.checkout')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
