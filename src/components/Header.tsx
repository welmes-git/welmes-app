import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import CartDrawer from './CartDrawer';
import CurrencySelector from './CurrencySelector';
import { useTranslation } from 'react-i18next';
import { brands } from '../data/products';
import {
  ShoppingBag,
  Heart,
  Bell,
  Search,
  Menu,
  X,
  ChevronDown,
  User,
  LogOut,
  LayoutDashboard,
  Globe,
} from 'lucide-react';

const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'ja', label: 'JA', name: '日本語' },
  { code: 'zh', label: 'ZH', name: '中文' },
];

const subCategories = [
  'Skincare',
  'Makeup',
  'Body/Hair',
  'Health Food',
  'Beauty Tools',
  'Fragrance',
];

export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, isAdmin, currentUser, logout, cart, wishlist } = useStore();
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileBrands, setShowMobileBrands] = useState(false);

  const navItems = [
    { label: t('nav.specialPrice'), path: '/products?sort=discount' },
    { label: t('nav.ranking'), path: '/products?sort=popular' },
    { label: t('nav.theme'), path: '/products' },
    { label: t('nav.event'), path: '/products' },
  ];

  const currentLang = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      setShowMobileSearch(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
    setShowUserDropdown(false);
  };

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <>
      {/* Top Utility Bar */}
      <div className="bg-[#f8f8fa] border-b border-[#e5e5e5]">
        <div className="max-w-[1100px] mx-auto px-4 flex justify-end items-center h-9">
          <div className="flex items-center gap-3 text-[12px] text-[#666666]">
            {!isAuthenticated ? (
              <>
                <Link to="/register" className="hover:text-[#ff4d6d] transition-colors" style={{whiteSpace: 'nowrap'}}>
                  {t('common.register')}
                </Link>
                <span className="text-[#ddd]">|</span>
                <Link to="/login" className="hover:text-[#ff4d6d] transition-colors" style={{whiteSpace: 'nowrap'}}>
                  {t('common.login')}
                </Link>
              </>
            ) : (
              <>
                <span className="text-[#333] font-medium" style={{whiteSpace: 'nowrap'}}>
                  {currentUser?.companyName || currentUser?.email}
                </span>
                <span className="text-[#ddd]">|</span>
                <Link to="/account" className="hover:text-[#ff4d6d] transition-colors" style={{whiteSpace: 'nowrap'}}>
                  {t('common.myAccount')}
                </Link>
                <span className="text-[#ddd]">|</span>
                <button
                  onClick={handleLogout}
                  className="hover:text-[#ff4d6d] transition-colors flex items-center gap-1"
                  style={{whiteSpace: 'nowrap'}}
                >
                  <LogOut size={12} />
                  {t('common.logout')}
                </button>
              </>
            )}
            <span className="text-[#ddd]">|</span>
            <Link to="/support" className="hover:text-[#ff4d6d] transition-colors" style={{whiteSpace: 'nowrap'}}>
              {t('common.support')}
            </Link>
            <span className="text-[#ddd]">|</span>
            <CurrencySelector />
            <span className="text-[#ddd]">|</span>
            {/* Language Switcher */}
            <div className="relative">
              <button
                onClick={() => setShowLangDropdown(!showLangDropdown)}
                className="flex items-center gap-1 hover:text-[#ff4d6d] transition-colors"
                style={{whiteSpace: 'nowrap'}}
              >
                <Globe size={12} />
                {currentLang.label}
                <ChevronDown size={10} />
              </button>
              {showLangDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-[#e5e5e5] rounded-lg shadow-lg py-1 z-50 min-w-[100px]">
                  {LANGUAGES.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => { i18n.changeLanguage(lang.code); setShowLangDropdown(false); }}
                      className={`w-full text-left px-3 py-1.5 text-[12px] hover:bg-[#f8f8fa] transition-colors ${
                        i18n.language === lang.code ? 'font-bold text-[#4a90e2]' : 'text-[#555]'
                      }`}
                    >
                      {lang.label} · {lang.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Header */}
      <header className="bg-white sticky top-0 z-40 border-b border-[#e5e5e5]">
        <div className="max-w-[1100px] mx-auto px-4">
          <div className="flex items-center justify-between h-[70px]">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 shrink-0">
              <span className="text-[24px] font-bold tracking-tight text-[#333]">
                WELMES
              </span>
              <span className="bg-[#4a90e2] text-white text-[11px] font-semibold px-2 py-0.5 rounded">
                Business
              </span>
            </Link>

            {/* Search Bar */}
            <form onSubmit={handleSearch} className="flex-1 max-w-[420px] mx-8 hidden md:block">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('nav.searchPlaceholder')}
                  className="w-full h-[42px] pl-4 pr-12 border border-[#cccccc] rounded-full text-[14px] focus:outline-none focus:border-[#333333] transition-colors"
                />
                <button
                  type="submit"
                  className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-[#333] hover:text-[#ff4d6d]"
                >
                  <Search size={18} />
                </button>
              </div>
            </form>

            {/* Right Icons */}
            <div className="flex items-center gap-4">
              {isAuthenticated && (
                <div className="relative">
                  <button
                    onClick={() => setShowUserDropdown(!showUserDropdown)}
                    className="flex items-center gap-1 text-[#333] hover:text-[#ff4d6d] transition-colors"
                  >
                    <User size={22} />
                    <ChevronDown size={14} />
                  </button>
                  {showUserDropdown && (
                    <div className="absolute right-0 top-full mt-2 w-48 bg-white border border-[#e5e5e5] rounded-lg shadow-lg py-2 z-50">
                      <div className="px-4 py-2 border-b border-[#f0f0f0]">
                        <p className="text-[13px] font-medium text-[#333]">
                          {currentUser?.companyName}
                        </p>
                        <p className="text-[11px] text-[#999]">
                          {currentUser?.status === 'approved'
                            ? t('account.verifiedBusiness')
                            : t('account.pendingReview')}
                        </p>
                      </div>
                      <Link
                        to="/account"
                        className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-[#333] hover:bg-[#f8f8fa]"
                        onClick={() => setShowUserDropdown(false)}
                      >
                        <User size={14} />
                        {t('common.myAccount')}
                      </Link>
                      {isAdmin && (
                        <Link
                          to="/admin"
                          className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-[#333] hover:bg-[#f8f8fa]"
                          onClick={() => setShowUserDropdown(false)}
                        >
                          <LayoutDashboard size={14} />
                          Admin Dashboard
                        </Link>
                      )}
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-[#333] hover:bg-[#f8f8fa] w-full"
                      >
                        <LogOut size={14} />
                        {t('common.logout')}
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => navigate('/wishlist')}
                className="relative text-[#333] hover:text-[#ff4d6d] transition-colors hidden sm:block"
              >
                <Heart size={22} className={wishlist.length > 0 ? 'text-[#ff4d6d]' : ''} />
                {wishlist.length > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-[18px] h-[18px] bg-[#ff4d6d] text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {wishlist.length}
                  </span>
                )}
              </button>
              <button className="text-[#333] hover:text-[#ff4d6d] transition-colors hidden sm:block">
                <Bell size={22} />
              </button>
              <button
                onClick={() => setIsCartOpen(true)}
                className="relative text-[#333] hover:text-[#ff4d6d] transition-colors"
              >
                <ShoppingBag size={22} />
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4.5 h-4.5 bg-[#ff4d6d] text-white text-[10px] font-bold rounded-full flex items-center justify-center min-w-[18px] h-[18px]">
                    {cartCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setShowMobileSearch(!showMobileSearch); }}
                className="md:hidden text-[#333] hover:text-[#ff4d6d] transition-colors"
              >
                <Search size={22} />
              </button>
            </div>
          </div>

          {/* Navigation Bar — desktop only */}
          <nav className="hidden md:flex items-center border-t border-[#e5e5e5]">
            {/* Category with dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setShowCategoryDropdown(true)}
              onMouseLeave={() => setShowCategoryDropdown(false)}
            >
              <button className="flex items-center gap-2 py-3.5 px-5 text-[14px] font-semibold text-[#333] hover:text-[#ff4d6d]">
                <Menu size={16} />
                CATEGORY
              </button>
              {showCategoryDropdown && (
                <div className="absolute top-full left-0 w-[200px] bg-white border border-[#e5e5e5] shadow-lg py-2 z-50">
                  {subCategories.map((cat) => (
                    <Link
                      key={cat}
                      to={`/products?category=${cat}`}
                      className="block px-5 py-2.5 text-[13px] text-[#555] hover:bg-[#f8f8fa] hover:text-[#ff4d6d]"
                      onClick={() => setShowCategoryDropdown(false)}
                    >
                      {cat}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Brand Shop with dropdown */}
            <div
              className="relative"
              onMouseEnter={() => setShowBrandDropdown(true)}
              onMouseLeave={() => setShowBrandDropdown(false)}
            >
              <button className="flex items-center gap-1 py-3.5 px-5 text-[14px] font-semibold text-[#333] hover:text-[#ff4d6d]">
                {t('nav.brandShop')}
                <ChevronDown size={14} />
              </button>
              {showBrandDropdown && (
                <div className="absolute top-full left-0 w-[360px] bg-white border border-[#e5e5e5] shadow-lg py-3 z-50">
                  <div className="grid grid-cols-2">
                    {brands.map((brand) => (
                      <Link
                        key={brand}
                        to={`/products?brand=${encodeURIComponent(brand)}`}
                        className="px-5 py-2 text-[13px] text-[#555] hover:bg-[#f8f8fa] hover:text-[#ff4d6d]"
                        onClick={() => setShowBrandDropdown(false)}
                      >
                        {brand}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Nav items */}
            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.path}
                className={`py-3.5 px-5 text-[14px] font-semibold transition-colors ${
                  isActive(item.path)
                    ? 'text-[#ff4d6d]'
                    : 'text-[#333] hover:text-[#ff4d6d]'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* Mobile Search Full-Screen Overlay */}
        {showMobileSearch && (
          <div className="fixed inset-0 bg-white z-[60] flex flex-col md:hidden">
            {/* Overlay Header */}
            <div className="flex items-center justify-between px-4 h-[56px] border-b border-[#e5e5e5] shrink-0">
              <button
                onClick={() => { setShowMobileSearch(false); setSearchQuery(''); }}
                className="text-[#333] w-8"
              >
                <X size={22} />
              </button>
              <span className="text-[16px] font-bold text-[#222]">Search</span>
              <button onClick={() => setIsCartOpen(true)} className="relative text-[#333] w-8 flex justify-end">
                <ShoppingBag size={22} />
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-0 min-w-[18px] h-[18px] bg-[#ff4d6d] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                    {cartCount}
                  </span>
                )}
              </button>
            </div>

            {/* Search Input */}
            <div className="px-4 py-3 border-b border-[#e5e5e5] shrink-0">
              <form onSubmit={handleSearch}>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search products, brands, ingredients..."
                    autoFocus
                    className="w-full h-[42px] pl-4 pr-10 bg-[#f4f4f4] rounded-full focus:outline-none"
                    style={{ fontSize: '16px' }}
                  />
                  <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888]">
                    <Search size={17} />
                  </button>
                </div>
              </form>
            </div>

            {/* Overlay Content */}
            <div className="flex-1 overflow-y-auto px-4 pt-5 pb-8">
              {/* Keyword Recommendations */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[15px] font-bold text-[#222]">Keyword Suggestions</span>
                  <span className="text-[12px] text-[#aaa] font-normal">beta</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Serum picks', 'Moisturizer TOP5', 'Sunscreen recs',
                    'Cleansing oil', 'Vitamin C ampoule', 'Toner pad recs',
                    'Collagen mask', 'New lip tints',
                  ].map((kw) => (
                    <button
                      key={kw}
                      onClick={() => {
                        setSearchQuery(kw);
                        navigate(`/products?search=${encodeURIComponent(kw)}`);
                        setShowMobileSearch(false);
                      }}
                      className="px-4 py-2 bg-[#f4f4f4] rounded-full text-[13px] text-[#444] hover:bg-[#e8e8e8] transition-colors"
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>

              {/* Trending Searches */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[15px] font-bold text-[#222]">Trending Searches</span>
                  <span className="text-[11px] text-[#bbb]">
                    as of {new Date().getHours()}:{String(new Date().getMinutes()).padStart(2, '0')}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-y-3">
                  {[
                    'Serum', 'Sunscreen', 'Toner', 'Essence',
                    'Sheet mask', 'Cleanser', 'Eye cream', 'Foundation',
                    'BB cream', 'Lip balm',
                  ].map((term, idx) => (
                    <button
                      key={term}
                      onClick={() => {
                        navigate(`/products?search=${encodeURIComponent(term)}`);
                        setShowMobileSearch(false);
                      }}
                      className="flex items-center gap-3 text-left"
                    >
                      <span className={`text-[14px] font-bold w-5 ${idx < 3 ? 'text-[#ff4d6d]' : 'text-[#aaa]'}`}>
                        {idx + 1}
                      </span>
                      <span className="text-[14px] text-[#333]">{term}</span>
                      <span className="text-[#ff4d6d]" style={{fontSize: '9px'}}>▲</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mobile Navigation Tab Bar */}
        {isMobile && (
          <div>
            <div style={{
              borderTop: '1px solid #e5e5e5',
              overflowX: 'auto',
              display: 'flex',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
            }}>
              <Link
                to="/products"
                onClick={() => { setShowMobileBrands(false); }}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#333',
                  whiteSpace: 'nowrap',
                  textDecoration: 'none',
                }}
              >
                <Menu size={14} />
                CATEGORY
              </Link>
              <button
                onClick={() => setShowMobileBrands((v) => !v)}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: showMobileBrands ? '#ff4d6d' : '#333',
                  whiteSpace: 'nowrap',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {t('nav.brandShop')}
                <ChevronDown size={13} style={{ transform: showMobileBrands ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              </button>
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  to={item.path}
                  onClick={() => setShowMobileBrands(false)}
                  style={{
                    flexShrink: 0,
                    padding: '10px 14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: isActive(item.path) ? '#ff4d6d' : '#333',
                    whiteSpace: 'nowrap',
                    textDecoration: 'none',
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            {/* Brand panel */}
            {showMobileBrands && (
              <div style={{ borderTop: '1px solid #e5e5e5', background: '#fafafa', padding: '12px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                  {brands.map((brand) => (
                    <Link
                      key={brand}
                      to={`/products?brand=${encodeURIComponent(brand)}`}
                      onClick={() => setShowMobileBrands(false)}
                      style={{
                        padding: '8px 10px',
                        fontSize: '12px',
                        color: '#444',
                        textDecoration: 'none',
                        background: '#fff',
                        border: '1px solid #e5e5e5',
                        borderRadius: '4px',
                        textAlign: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {brand}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </header>

      {/* Cart Drawer */}
      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
}
