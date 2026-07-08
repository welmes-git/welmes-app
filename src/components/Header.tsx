import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { AppNotification } from '../store/useStore';
import CartDrawer from './CartDrawer';
import CurrencySelector from './CurrencySelector';
import { useTranslation } from 'react-i18next';
import { brands } from '../data/products';
import { categoryMenuColumns } from '../config/categoryMenu';
import { useOutsideClick } from '../hooks/useOutsideClick';
import {
  ShoppingBag,
  Heart,
  Bell,
  Search,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  User,
  LogOut,
  LayoutDashboard,
  Globe,
  CheckCheck,
  Trash2,
  Package,
  Truck,
  CheckCircle2,
  XCircle,
  ShieldCheck,
} from 'lucide-react';

const LANGUAGES = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'ja', label: 'JA', name: '日本語' },
  { code: 'zh', label: 'ZH', name: '中文' },
  { code: 'ko', label: 'KO', name: '한국어' },
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'fr', label: 'FR', name: 'Français' },
  { code: 'de', label: 'DE', name: 'Deutsch' },
  { code: 'vi', label: 'VI', name: 'Tiếng Việt' },
  { code: 'th', label: 'TH', name: 'ไทย' },
  { code: 'id', label: 'ID', name: 'Bahasa Indonesia' },
  { code: 'ru', label: 'RU', name: 'Русский' },
];


export default function Header() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    isAuthenticated, isAdmin, currentUser, logout,
    cart, wishlist, notifications,
    markNotificationRead, markAllNotificationsRead, clearNotifications,
  } = useStore();
  const { t, i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [showMobileBrands, setShowMobileBrands] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const megaMenuRef = useRef<HTMLElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  // Every popover closes on an outside click
  useOutsideClick(megaMenuRef, showCategoryDropdown, () => setShowCategoryDropdown(false));
  useOutsideClick(langRef, showLangDropdown, () => setShowLangDropdown(false));
  useOutsideClick(userRef, showUserDropdown, () => setShowUserDropdown(false));

  const navItems = [
    { label: t('nav.specialPrice'), path: '/products?sort=discount' },
    { label: t('nav.ranking'), path: '/products?sort=popular' },
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

  useOutsideClick(notifRef, showNotifications, () => setShowNotifications(false));

  // My notifications (filter by current user)
  const myNotifications = currentUser
    ? notifications.filter((n) => n.memberId === currentUser.id)
    : [];
  const unreadCount = myNotifications.filter((n) => !n.read).length;

  function getNotifMeta(n: AppNotification): { icon: React.ReactNode; title: string; message: string; link: string } {
    const shortId = n.orderId ? `…${n.orderId.slice(-6)}` : '';
    switch (n.type) {
      case 'member_approved':
        return {
          icon: <ShieldCheck size={16} className="text-green-500" />,
          title: t('notifications.member_approved_title'),
          message: t('notifications.member_approved_message'),
          link: '/account',
        };
      case 'member_rejected':
        return {
          icon: <XCircle size={16} className="text-red-500" />,
          title: t('notifications.member_rejected_title'),
          message: t('notifications.member_rejected_message'),
          link: '/support',
        };
      case 'order_shipped':
        return {
          icon: <Truck size={16} className="text-indigo-500" />,
          title: t('notifications.order_shipped_title'),
          message: t('notifications.order_shipped_message', {
            orderId: shortId,
            carrier: n.carrier ?? '',
            trackingNumber: n.trackingNumber ?? '',
          }),
          link: '/account',
        };
      case 'order_status': {
        const statusIcon =
          n.orderStatus === 'completed' ? <CheckCircle2 size={16} className="text-green-500" /> :
          n.orderStatus === 'cancelled' ? <XCircle size={16} className="text-red-500" /> :
          n.orderStatus === 'processing' ? <Package size={16} className="text-blue-500" /> :
          <Package size={16} className="text-[#aaa]" />;
        return {
          icon: statusIcon,
          title: t('notifications.order_status_title'),
          message: t('notifications.order_status_message', {
            orderId: shortId,
            status: n.orderStatus ? t(`status.${n.orderStatus}`) : '',
          }),
          link: '/account',
        };
      }
    }
  }

  function formatRelativeTime(iso: string): string {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return t('notifications.justNow');
    if (diff < 3600) return t('notifications.minutesAgo', { count: Math.floor(diff / 60) });
    if (diff < 86400) return t('notifications.hoursAgo', { count: Math.floor(diff / 3600) });
    return t('notifications.daysAgo', { count: Math.floor(diff / 86400) });
  }

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
            <div className="relative" ref={langRef}>
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
                <div className="absolute right-0 top-full mt-1 bg-white border border-[#e5e5e5] rounded-lg shadow-lg py-1 z-50 min-w-[170px] max-h-[320px] overflow-y-auto">
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
                <div className="relative" ref={userRef}>
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
              {/* Bell Notification Button */}
              {isAuthenticated && (
                <div className="relative hidden sm:block" ref={notifRef}>
                  <button
                    onClick={() => setShowNotifications((v) => !v)}
                    className="relative text-[#333] hover:text-[#ff4d6d] transition-colors"
                    aria-label={t('notifications.title')}
                  >
                    <Bell size={22} />
                    {unreadCount > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] bg-[#ff4d6d] text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {showNotifications && (
                    <div className="absolute right-0 top-full mt-2 w-[360px] bg-white border border-[#e5e5e5] rounded-xl shadow-xl z-50 overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-[#f0f0f0]">
                        <span className="text-[14px] font-bold text-[#222]">
                          {t('notifications.title')}
                          {unreadCount > 0 && (
                            <span className="ml-2 text-[11px] font-semibold bg-[#ff4d6d] text-white rounded-full px-1.5 py-0.5">
                              {unreadCount}
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1">
                          {myNotifications.length > 0 && (
                            <>
                              <button
                                onClick={() => markAllNotificationsRead()}
                                className="p-1.5 text-[#999] hover:text-[#4a90e2] rounded-lg hover:bg-[#f0f7ff] transition-colors"
                                title={t('notifications.markAllRead')}
                              >
                                <CheckCheck size={15} />
                              </button>
                              <button
                                onClick={() => clearNotifications(currentUser!.id)}
                                className="p-1.5 text-[#999] hover:text-[#ff4d6d] rounded-lg hover:bg-[#fff0f0] transition-colors"
                                title={t('notifications.clearAll')}
                              >
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {/* List */}
                      <div className="max-h-[400px] overflow-y-auto">
                        {myNotifications.length === 0 ? (
                          <div className="py-12 text-center">
                            <Bell size={32} className="mx-auto text-[#ddd] mb-3" />
                            <p className="text-[13px] font-medium text-[#999]">{t('notifications.empty')}</p>
                            <p className="text-[12px] text-[#bbb] mt-0.5">{t('notifications.emptyDesc')}</p>
                          </div>
                        ) : (
                          myNotifications.map((n) => {
                            const { icon, title, message, link } = getNotifMeta(n);
                            return (
                              <button
                                key={n.id}
                                onClick={() => {
                                  markNotificationRead(n.id);
                                  setShowNotifications(false);
                                  navigate(link);
                                }}
                                className={`w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-[#f8f8fa] transition-colors border-b border-[#f5f5f5] last:border-0 ${
                                  !n.read ? 'bg-[#f0f7ff]' : ''
                                }`}
                              >
                                <div className="shrink-0 w-8 h-8 rounded-full bg-white border border-[#e5e5e5] flex items-center justify-center mt-0.5 shadow-sm">
                                  {icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-[13px] leading-snug ${!n.read ? 'font-semibold text-[#222]' : 'font-medium text-[#333]'}`}>
                                    {title}
                                  </p>
                                  <p className="text-[12px] text-[#777] mt-0.5 leading-relaxed line-clamp-2">
                                    {message}
                                  </p>
                                  <p className="text-[11px] text-[#bbb] mt-1">
                                    {formatRelativeTime(n.createdAt)}
                                  </p>
                                </div>
                                {!n.read && (
                                  <div className="shrink-0 w-2 h-2 rounded-full bg-[#4a90e2] mt-1.5" />
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
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
          <nav ref={megaMenuRef} className="hidden md:flex items-center border-t border-[#e5e5e5] relative">
            {/* Category — Olive Young style mega menu */}
            <button
              onClick={() => setShowCategoryDropdown((v) => !v)}
              className={`flex items-center gap-2 py-3.5 px-5 text-[14px] font-semibold transition-colors ${
                showCategoryDropdown ? 'bg-[#222] text-white' : 'text-[#333] hover:text-[#ff4d6d]'
              }`}
            >
              <Menu size={16} />
              {t('nav.category')}
            </button>
            {showCategoryDropdown && (
              <div className="absolute top-full left-0 right-0 bg-white border border-[#e5e5e5] shadow-[0_16px_32px_rgba(0,0,0,0.12)] z-50">
                <div className="grid grid-cols-6 divide-x divide-[#f0f0f0] px-1 py-7">
                  {categoryMenuColumns.map((column, colIdx) => (
                    <div key={colIdx} className="px-5 space-y-7">
                      {column.map((group) => (
                        <div key={group.key}>
                          <Link
                            to={group.link}
                            onClick={() => setShowCategoryDropdown(false)}
                            className="inline-flex items-center gap-1 text-[15px] font-bold text-[#222] hover:text-[#ff4d6d] mb-3 transition-colors"
                          >
                            {t(`categoryMenu.${group.key}`)}
                            <ChevronRight size={14} className="text-[#999]" />
                          </Link>
                          <ul className="space-y-1">
                            {group.subs.map((sub) => (
                              <li key={sub.key}>
                                <Link
                                  to={sub.link}
                                  onClick={() => setShowCategoryDropdown(false)}
                                  className="block py-[4px] text-[13px] text-[#666] hover:text-[#ff4d6d] hover:underline transition-colors"
                                >
                                  {t(`categoryMenu.${sub.key}`)}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => setShowCategoryDropdown(false)}
                  className="absolute bottom-0 right-0 w-9 h-9 bg-[#222] text-white flex items-center justify-center hover:bg-[#444] transition-colors"
                  aria-label="Close category menu"
                >
                  <X size={16} />
                </button>
              </div>
            )}

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
              <span className="text-[16px] font-bold text-[#222]">{t('common.search')}</span>
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
                    placeholder={t('nav.searchPlaceholderFull')}
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
                  <span className="text-[15px] font-bold text-[#222]">{t('nav.keywordSuggestions')}</span>
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
                  <span className="text-[15px] font-bold text-[#222]">{t('nav.trendingSearches')}</span>
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
                {t('nav.category')}
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
