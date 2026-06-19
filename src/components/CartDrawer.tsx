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
        className={`fixed top-0 right-0 h-full w-full max-w-[400px] bg-white shadow-2xl z-50 transform transition-transform duration-300 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <ShoppingBag size={20} />
            <h2 className="text-[16px] font-bold">{t('cart.title')}</h2>
            <span className="text-[13px] text-[#999]">
              ({cart.reduce((sum, item) => sum + item.quantity, 0)} {t('cart.items', { count: cart.reduce((s, i) => s + i.quantity, 0) })})
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center hover:bg-[#f5f5f5] rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto h-[calc(100%-180px)] p-4">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <ShoppingBag size={48} className="text-[#ddd] mb-4" />
              <p className="text-[14px] text-[#999] mb-2">{t('cart.empty')}</p>
              <p className="text-[12px] text-[#bbb]">{t('cart.emptyDesc')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map((item) => (
                <div
                  key={`${item.product.id}-${item.setOption?.id ?? 'solo'}`}
                  className="flex gap-3 p-3 bg-[#f8f8fa] rounded-lg"
                >
                  <img
                    src={item.product.image}
                    alt={item.product.name}
                    onError={(e) => {
                      (e.target as HTMLImageElement).src =
                        'https://placehold.co/70x70/f0f0f0/999?text=IMG';
                    }}
                    className="w-[70px] h-[70px] object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] text-[#999] uppercase">
                      {item.product.brand}
                    </p>
                    <p className="text-[13px] text-[#333] truncate">
                      {item.product.name}
                    </p>
                    {item.setOption && (
                      <p className="text-[11px] text-[#4a90e2] font-medium">
                        {item.setOption.id} · {item.setOption.description}
                      </p>
                    )}
                    <p className="text-[14px] font-bold text-[#333] mt-1">
                      {formatPrice(item.setOption?.wholesalePrice ?? item.product.wholesalePrice)}
                      <span className="text-[11px] text-[#aaa] font-normal ml-1">
                        {item.setOption ? `/ set (${item.setOption.unitsPerSet}pcs)` : '/ unit'}
                      </span>
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <div className="flex items-center gap-2">
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
                          className="w-6 h-6 flex items-center justify-center border border-[#ddd] rounded hover:bg-[#eee]"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="text-[13px] w-6 text-center">
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
                          className="w-6 h-6 flex items-center justify-center border border-[#ddd] rounded hover:bg-[#eee]"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <button
                        onClick={() => removeFromCart(item.product.id, item.setOption?.id)}
                        className="text-[#999] hover:text-[#ff4d6d] transition-colors"
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
          <div className="absolute bottom-0 left-0 right-0 p-4 bg-white border-t border-[#e5e5e5]">
            <div className="flex justify-between items-center mb-3">
              <span className="text-[14px] text-[#666]">{t('cart.total')}</span>
              <span className="text-[18px] font-bold text-[#333]">
                {formatPrice(total)}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={clearCart}
                className="flex-1 py-3 border border-[#ddd] rounded-lg text-[13px] text-[#666] hover:bg-[#f5f5f5] transition-colors"
              >
                {t('common.delete')}
              </button>
              <Link
                to="/checkout"
                onClick={onClose}
                className="flex-1 py-3 bg-[#333] text-white rounded-lg text-[13px] font-medium text-center hover:bg-[#555] transition-colors"
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
