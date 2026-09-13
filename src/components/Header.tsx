import { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import type { AppNotification } from '../store/useStore';
import CartDrawer from './CartDrawer';
import CurrencySelector from './CurrencySelector';
import { useTranslation } from 'react-i18next';
import { initialProducts } from '../data/products';
import { brandsByCount } from '../lib/utils';
import { categoryMenuColumns } from '../config/categoryMenu';
import { useOutsideClick } from '../hooks/useOutsideClick';
import * as db from '../lib/db';
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
    cart, wishlist, notifications, products, productsLoading,
    markNotificationRead, markAllNotificationsRead, clearNotifications,
  } = useStore();
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showBrandDropdown, setShowBrandDropdown] = useState(false);
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const [trendingSearches, setTrendingSearches] = useState<db.TrendingSearch[] | null>(null);
  const [trendingUpdatedAt, setTrendingUpdatedAt] = useState<Date | null>(null);

  // Fetch real trending searches each time the overlay opens, rather than
  // showing a hardcoded list next to a fake "as of HH:MM" timestamp.
  useEffect(() => {
    if (!showMobileSearch) return;
    let cancelled = false;
    db.fetchTrendingSearches(10).then((rows) => {
      if (cancelled) return;
      setTrendingSearches(rows);
      setTrendingUpdatedAt(new Date());
    });
    return () => { cancelled = true; };
  }, [showMobileSearch]);
  const [showMobileCategory, setShowMobileCategory] = useState(false);
  const [showMobileBrandShop, setShowMobileBrandShop] = useState(false);
  const [brandSearch, setBrandSearch] = useState('');
  // Brand Shop lists brands we actually carry (same fallback as the product pages)
  const brands = useMemo(
    () => brandsByCount(products.length > 0 ? products : productsLoading ? [] : initialProducts).map(([b]) => b),
    [products, productsLoading]
  );
  const filteredBrands = useMemo(
    () => brands.filter((b) => b.toLowerCase().includes(brandSearch.trim().toLowerCase())),
    [brands, brandSearch]
  );
  const [showNotifications, setShowNotifications] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const megaMenuRef = useRef<HTMLElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  // Flat, ordered list of every top-level category group (column-major, same
  // order as the desktop mega menu) for the mobile master/detail overlay.
  const allCategoryGroups = useMemo(() => categoryMenuColumns.flat(), []);
  const [activeGroupKey, setActiveGroupKey] = useState(allCategoryGroups[0]?.key);
  const mobileCategoryPanelRef = useRef<HTMLDivElement>(null);
  const categorySectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const categoryNavButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Reset to the first group each time the overlay opens
  useEffect(() => {
    if (showMobileCategory) setActiveGroupKey(allCategoryGroups[0]?.key);
  }, [showMobileCategory, allCategoryGroups]);

  // Scrollspy: walk the sections in order and take the last one whose top has
  // passed a fixed anchor line near the top of the panel. This is computed
  // directly from scroll position (not IntersectionObserver thresholds), so
  // it tracks the actual scroll 1:1 instead of lagging a section behind.
  useEffect(() => {
    if (!showMobileCategory) return;
    const root = mobileCategoryPanelRef.current;
    if (!root) return;

    let frame = 0;
    const updateActive = () => {
      const anchor = root.scrollTop + root.clientHeight * 0.25;
      let current = allCategoryGroups[0]?.key;
      for (const group of allCategoryGroups) {
        const el = categorySectionRefs.current[group.key];
        if (el && el.offsetTop <= anchor) current = group.key;
        else break;
      }
      setActiveGroupKey((prev) => (prev === current ? prev : current));
    };
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updateActive);
    };

    updateActive();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [showMobileCategory, allCategoryGroups]);

  // Keep the left rail's highlighted item scrolled into view as the active
  // group changes, so the left list follows the right panel instead of the
  // highlight silently jumping off-screen.
  useEffect(() => {
    if (!showMobileCategory) return;
    categoryNavButtonRefs.current[activeGroupKey]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeGroupKey, showMobileCategory]);

  const scrollToCategoryGroup = (key: string) => {
    setActiveGroupKey(key);
    const el = categorySectionRefs.current[key];
    // scrollIntoView computes the target's true position within its actual
    // scrolling ancestor — manual offsetTop math landed a section too early
    // whenever an intervening element's offsetParent chain wasn't the panel.
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Every popover closes on an outside click
  useOutsideClick(megaMenuRef, showCategoryDropdown, () => setShowCategoryDropdown(false));
  useOutsideClick(userRef, showUserDropdown, () => setShowUserDropdown(false));

  const navItems = [
    { label: t('nav.specialPrice'), path: '/products?sort=discount' },
    { label: t('nav.ranking'), path: '/products?sort=popular' },
    { label: t('nav.event'), path: '/products' },
  ];

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
          icon: <ShieldCheck size={16} className="text-signal-ok" />,
          title: t('notifications.member_approved_title'),
          message: t('notifications.member_approved_message'),
          link: '/account',
        };
      case 'member_rejected':
        return {
          icon: <XCircle size={16} className="text-signal-error" />,
          title: t('notifications.member_rejected_title'),
          message: t('notifications.member_rejected_message'),
          link: '/support',
        };
      case 'order_shipped':
        return {
          icon: <Truck size={16} className="text-ink-900" />,
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
          n.orderStatus === 'completed' ? <CheckCircle2 size={16} className="text-signal-ok" /> :
          n.orderStatus === 'cancelled' ? <XCircle size={16} className="text-signal-error" /> :
          n.orderStatus === 'processing' ? <Package size={16} className="text-ink-500" /> :
          <Package size={16} className="text-ink-300" />;
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
    const term = searchQuery.trim();
    if (term) {
      db.logSearchQuery(term, currentUser?.id);
      navigate(`/products?search=${encodeURIComponent(term)}`);
      setShowMobileSearch(false);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/');
    setShowUserDropdown(false);
  };

  const isActive = (path: string) => {
    const [pathname, query = ''] = path.split('?');
    return location.pathname === pathname && location.search.replace(/^\?/, '') === query;
  };

  return (
    <>
      {/* Utility strip below lg (Faire also swaps headers at 1024px) — the row has no room for
          account, currency and language, and the hamburger menu was removed. */}
      <div className="lg:hidden bg-sunken border-b border-line">
        <div className="page-container flex justify-end items-center h-9">
          <div className="flex items-center gap-3 text-[12px] text-ink-500">
            {!isAuthenticated ? (
              <>
                <Link to="/register" className="whitespace-nowrap hover:text-ink-900 transition-colors">{t('common.register')}</Link>
                <span className="text-line-strong">|</span>
                <Link to="/login" className="whitespace-nowrap hover:text-ink-900 transition-colors">{t('common.login')}</Link>
              </>
            ) : (
              <>
                <Link to="/account" className="whitespace-nowrap hover:text-ink-900 transition-colors">{t('common.myAccount')}</Link>
                <span className="text-line-strong">|</span>
                <button onClick={handleLogout} className="flex items-center gap-1 whitespace-nowrap hover:text-ink-900 transition-colors">
                  <LogOut size={12} />
                  {t('common.logout')}
                </button>
              </>
            )}
            <span className="text-line-strong">|</span>
            <Link to="/support" className="whitespace-nowrap hover:text-ink-900 transition-colors">{t('common.support')}</Link>
            <span className="text-line-strong">|</span>
            <CurrencySelector />
            <span className="text-line-strong">|</span>
            <LanguageSwitcher compact />
          </div>
        </div>
      </div>

      {/* Header — measured on faire.com (1440px): one 60px row
          [logo · 16 · search (flex, 40px pill, #dadada) · 16 · language · links · Sign in · Sign up]
          then a 47px centred link row, 1px #dadada under both.
          Sticky is dropped while the category mega menu is open so the panel
          scrolls away with the page (Olive Young behaviour). */}
      <header className={`bg-white z-40 border-b border-line-control tracking-[0.15px] ${showCategoryDropdown ? '' : 'sticky top-0'}`}>
        <div className="flex h-[50px] md:h-[60px] items-center pr-1 md:pr-3">
          {/* Wordmark: Cormorant Garamond 500 with wide tracking, small BUSINESS line below.
              Negative right margins cancel the trailing letter-spacing so both lines end flush. */}
          <Link to="/" aria-label="WELMES Business" className="mx-2 flex shrink-0 flex-col items-start gap-1 px-2 py-2 md:px-4">
            <span className="-mr-[0.32em] font-logo text-[18px] font-medium leading-none tracking-[0.32em] text-ink-900 md:text-[21px]">WELMES</span>
            <span className="-mr-[0.5em] text-[10px] leading-none tracking-[0.5em] text-ink-500 md:text-[11px]">BUSINESS</span>
          </Link>

          {/* Search — 40px pill, 1px #dadada, 16px icon inset 16px, text 14/20 */}
          <form onSubmit={handleSearch} className="mx-4 hidden min-w-0 flex-1 md:block" role="search">
            <label className="relative flex h-10 items-center rounded-full border border-line-control bg-canvas pr-4 focus-within:border-ink-700">
              <Search size={16} strokeWidth={1.5} className="pointer-events-none absolute left-4 text-ink-700" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('nav.searchPlaceholder')}
                aria-label={t('common.search')}
                autoComplete="off"
                className="w-full bg-transparent pl-10 text-[14px] leading-5 text-ink-700 placeholder:text-ink-500 focus:outline-none"
              />
            </label>
          </form>
          <div className="flex-1 md:hidden" />

          <div className="flex h-full items-center">
            <div className="hidden h-full items-center px-3 lg:flex">
              <CurrencySelector large />
            </div>
            <LanguageSwitcher className="hidden h-full px-3 lg:flex" />
            <Link to="/support" className="hidden h-full items-center px-3 text-[14px] leading-5 text-ink-700 transition-colors hover:text-ink-900 lg:flex">
              {t('common.support')}
            </Link>

              {isAuthenticated && (
                <div className="relative h-full" ref={userRef}>
                  <button
                    onClick={() => setShowUserDropdown(!showUserDropdown)}
                    aria-label={t('common.myAccount')}
                    className="h-full px-3 flex items-center gap-1 text-ink-700 hover:text-ink-900 transition-colors"
                  >
                    <User size={20} strokeWidth={1.5} />
                    <ChevronDown size={14} />
                  </button>
                  {showUserDropdown && (
                    <div className="absolute right-0 top-full w-48 bg-white border border-line rounded-lg shadow-hover py-2 z-50">
                      <div className="px-4 py-2 border-b border-line">
                        <p className="text-[13px] font-medium text-ink-700">
                          {currentUser?.companyName}
                        </p>
                        <p className="text-[11px] text-ink-500">
                          {currentUser?.status === 'approved'
                            ? t('account.verifiedBusiness')
                            : t('account.pendingReview')}
                        </p>
                      </div>
                      <Link
                        to="/account"
                        className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-ink-700 hover:bg-sunken"
                        onClick={() => setShowUserDropdown(false)}
                      >
                        <User size={14} />
                        {t('common.myAccount')}
                      </Link>
                      {isAdmin && (
                        <Link
                          to="/admin"
                          className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-ink-700 hover:bg-sunken"
                          onClick={() => setShowUserDropdown(false)}
                        >
                          <LayoutDashboard size={14} />
                          Admin Dashboard
                        </Link>
                      )}
                      <button
                        onClick={handleLogout}
                        className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-ink-700 hover:bg-sunken w-full"
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
                aria-label={t('wishlist.title')}
                className="relative h-full px-3 flex items-center text-ink-700 hover:text-ink-900 transition-colors max-sm:hidden"
              >
                <Heart size={20} strokeWidth={1.5} />
                {wishlist.length > 0 && (
                  <span className="absolute top-3 right-0.5 w-[18px] h-[18px] bg-ink-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {wishlist.length}
                  </span>
                )}
              </button>
              {/* Bell Notification Button */}
              {isAuthenticated && (
                <div className="relative h-full max-sm:hidden" ref={notifRef}>
                  <button
                    onClick={() => setShowNotifications((v) => !v)}
                    className="relative h-full px-3 flex items-center text-ink-700 hover:text-ink-900 transition-colors"
                    aria-label={t('notifications.title')}
                  >
                    <Bell size={20} strokeWidth={1.5} />
                    {unreadCount > 0 && (
                      <span className="absolute top-3 right-0.5 min-w-[18px] h-[18px] bg-ink-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    )}
                  </button>

                  {showNotifications && (
                    <div className="absolute right-0 top-full w-[360px] bg-white border border-line rounded-[10px] shadow-hover z-50 overflow-hidden">
                      {/* Header */}
                      <div className="flex items-center justify-between px-4 py-3 border-b border-line">
                        <span className="text-[14px] font-bold text-ink-900">
                          {t('notifications.title')}
                          {unreadCount > 0 && (
                            <span className="ml-2 text-[11px] font-semibold bg-ink-900 text-white rounded-full px-1.5 py-0.5">
                              {unreadCount}
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-1">
                          {myNotifications.length > 0 && (
                            <>
                              <button
                                onClick={() => markAllNotificationsRead()}
                                className="p-1.5 text-ink-500 hover:text-ink-900 rounded-lg hover:bg-sunken transition-colors"
                                title={t('notifications.markAllRead')}
                              >
                                <CheckCheck size={15} />
                              </button>
                              <button
                                onClick={() => clearNotifications(currentUser!.id)}
                                className="p-1.5 text-ink-500 hover:text-ink-900 rounded-lg hover:bg-sunken transition-colors"
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
                            <Bell size={32} className="mx-auto text-line-strong mb-3" />
                            <p className="text-[13px] font-medium text-ink-500">{t('notifications.empty')}</p>
                            <p className="text-[12px] text-ink-300 mt-0.5">{t('notifications.emptyDesc')}</p>
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
                                className={`w-full flex items-start gap-3 px-4 py-3.5 text-left hover:bg-sunken transition-colors border-b border-line last:border-0 ${
                                  !n.read ? 'bg-sunken' : ''
                                }`}
                              >
                                <div className="shrink-0 w-8 h-8 rounded-full bg-white border border-line flex items-center justify-center mt-0.5">
                                  {icon}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-[13px] leading-snug ${!n.read ? 'font-semibold text-ink-900' : 'font-medium text-ink-700'}`}>
                                    {title}
                                  </p>
                                  <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed line-clamp-2">
                                    {message}
                                  </p>
                                  <p className="text-[11px] text-ink-300 mt-1">
                                    {formatRelativeTime(n.createdAt)}
                                  </p>
                                </div>
                                {!n.read && (
                                  <div className="shrink-0 w-2 h-2 rounded-full bg-ink-900 mt-1.5" />
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
                aria-label={t('cart.title')}
                className="relative h-full px-3 flex items-center text-ink-700 hover:text-ink-900 transition-colors"
              >
                <ShoppingBag size={20} strokeWidth={1.5} />
                {cartCount > 0 && (
                  <span className="absolute top-3 right-0.5 bg-ink-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center min-w-[18px] h-[18px]">
                    {cartCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => { setShowMobileSearch(!showMobileSearch); }}
                aria-label={t('common.search')}
                className="md:hidden h-full px-3 flex items-center text-ink-700 hover:text-ink-900 transition-colors"
              >
                <Search size={20} strokeWidth={1.5} />
              </button>

              {!isAuthenticated && (
                <>
                  <Link to="/login" className="hidden h-full items-center px-4 text-[14px] leading-5 text-ink-700 transition-colors hover:text-ink-900 lg:flex">
                    {t('common.login')}
                  </Link>
                  {/* Faire "Sign up to buy": 36px, #333 fill, 4px radius, 20px padding */}
                  <Link to="/register" className="ml-3 hidden h-9 items-center whitespace-nowrap rounded-sm border border-ink-700 bg-ink-700 px-5 text-[14px] leading-5 text-white transition-colors hover:bg-ink-900 lg:inline-flex">
                    {t('common.register')}
                  </Link>
                </>
              )}
          </div>
        </div>

        {/* Link row — desktop only, 47px, centred, 14px regular. Faire uses 14px gaps between
            long category names; our five short labels need 32–40px to read as separate items. */}
        <nav ref={megaMenuRef} className="relative hidden h-[47px] items-center justify-center gap-8 lg:gap-10 md:flex">
            <button
              onClick={() => setShowCategoryDropdown((v) => !v)}
              aria-expanded={showCategoryDropdown}
              className={`flex h-full items-center text-[14px] leading-5 transition-colors gap-1.5 ${
                showCategoryDropdown ? 'text-ink-900 underline underline-offset-[6px]' : 'text-ink-700 hover:text-ink-900'
              }`}
            >
              <Menu size={16} strokeWidth={1.5} />
              {t('nav.category')}
            </button>
            {showCategoryDropdown && (
              // No max-height/overflow here on purpose — the header drops its
              // `sticky` above while this is open, so the panel renders at its
              // natural height and the whole page scrolls past it (Olive
              // Young's actual mechanism), instead of scrolling inside a box.
              <div className="absolute top-full left-0 right-0 bg-white border border-line shadow-hover z-50">
                <div className="page-container grid grid-cols-6 divide-x divide-line py-7">
                  {categoryMenuColumns.map((column, colIdx) => (
                    <div key={colIdx} className="px-5 space-y-7">
                      {column.map((group) => (
                        <div key={group.key}>
                          <Link
                            to={group.link}
                            onClick={() => setShowCategoryDropdown(false)}
                            className="inline-flex items-center gap-1 text-[15px] font-bold text-ink-900 hover:text-ink-900 mb-3 transition-colors"
                          >
                            {t(`categoryMenu.${group.key}`)}
                            <ChevronRight size={14} className="text-ink-500" />
                          </Link>
                          <ul className="space-y-1">
                            {group.subs.map((sub) => (
                              <li key={sub.key}>
                                <Link
                                  to={sub.link}
                                  onClick={() => setShowCategoryDropdown(false)}
                                  className="block py-[4px] text-[13px] text-ink-500 hover:text-ink-900 hover:underline transition-colors"
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
                  className="absolute bottom-0 right-0 w-9 h-9 bg-ink-900 text-white flex items-center justify-center hover:bg-ink-700 transition-colors"
                  aria-label="Close category menu"
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Brand Shop with dropdown */}
            <div
              className="relative h-full"
              onMouseEnter={() => setShowBrandDropdown(true)}
              onMouseLeave={() => setShowBrandDropdown(false)}
            >
              <button className="flex h-full items-center gap-1 text-[14px] leading-5 text-ink-700 hover:text-ink-900">
                {t('nav.brandShop')}
                <ChevronDown size={14} />
              </button>
              {showBrandDropdown && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 w-[360px] bg-white border border-line rounded-lg shadow-hover py-3 z-50">
                  <div className="grid grid-cols-2">
                    {brands.map((brand) => (
                      <Link
                        key={brand}
                        to={`/products?brand=${encodeURIComponent(brand)}`}
                        className="px-5 py-2 text-[13px] text-ink-500 hover:bg-sunken hover:text-ink-900"
                        onClick={() => setShowBrandDropdown(false)}
                      >
                        {brand}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {navItems.map((item) => (
              <Link
                key={item.label}
                to={item.path}
                className={`flex h-full items-center text-[14px] leading-5 transition-colors ${
                  isActive(item.path)
                    ? 'text-ink-900 underline underline-offset-[6px]'
                    : 'text-ink-700 hover:text-ink-900'
                }`}
              >
                {item.label}
              </Link>
            ))}
        </nav>

        {/* Mobile Search Full-Screen Overlay */}
        {showMobileSearch && (
          <div className="fixed inset-0 bg-white z-[60] flex flex-col md:hidden">
            {/* Overlay Header */}
            <div className="flex items-center justify-between px-4 h-[56px] border-b border-line shrink-0">
              <button
                onClick={() => { setShowMobileSearch(false); setSearchQuery(''); }}
                className="text-ink-700 w-8"
              >
                <X size={22} />
              </button>
              <span className="text-[16px] font-bold text-ink-900">{t('common.search')}</span>
              <button onClick={() => setIsCartOpen(true)} className="relative text-ink-700 w-8 flex justify-end">
                <ShoppingBag size={22} />
                {cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-0 min-w-[18px] h-[18px] bg-ink-900 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                    {cartCount}
                  </span>
                )}
              </button>
            </div>

            {/* Search Input */}
            <div className="px-4 py-3 border-b border-line shrink-0">
              <form onSubmit={handleSearch}>
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('nav.searchPlaceholderFull')}
                    autoFocus
                    className="w-full h-[42px] pl-4 pr-10 bg-sunken rounded-full focus:outline-none"
                    style={{ fontSize: '16px' }}
                  />
                  <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500">
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
                  <span className="text-[15px] font-bold text-ink-900">{t('nav.keywordSuggestions')}</span>
                  <span className="text-[12px] text-ink-300 font-normal">beta</span>
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
                      className="px-4 py-2 bg-sunken rounded-full text-[13px] text-ink-700 hover:bg-line transition-colors"
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>

              {/* Trending Searches — real buyer search activity, not a fixed list */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[15px] font-bold text-ink-900">{t('nav.trendingSearches')}</span>
                  {trendingUpdatedAt && (
                    <span className="text-[11px] text-ink-300">
                      {t('nav.asOf', {
                        time: `${trendingUpdatedAt.getHours()}:${String(trendingUpdatedAt.getMinutes()).padStart(2, '0')}`,
                      })}
                    </span>
                  )}
                </div>
                {trendingSearches === null ? (
                  <div className="grid grid-cols-2 gap-y-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="h-[18px] w-24 bg-sunken rounded animate-pulse" />
                    ))}
                  </div>
                ) : trendingSearches.length === 0 ? (
                  <p className="text-[13px] text-ink-300 py-2">{t('nav.noTrendingSearches')}</p>
                ) : (
                <div className="grid grid-cols-2 gap-y-3">
                  {trendingSearches.map(({ term }, idx) => (
                    <button
                      key={term}
                      onClick={() => {
                        db.logSearchQuery(term, currentUser?.id);
                        navigate(`/products?search=${encodeURIComponent(term)}`);
                        setShowMobileSearch(false);
                      }}
                      className="flex items-center gap-3 text-left"
                    >
                      <span className={`text-[14px] font-bold w-5 ${idx < 3 ? 'text-ink-900' : 'text-ink-300'}`}>
                        {idx + 1}
                      </span>
                      <span className="text-[14px] text-ink-700">{term}</span>
                    </button>
                  ))}
                </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Mobile Category Full-Screen Overlay — Olive Young style master/detail */}
        {showMobileCategory && (
          <div className="fixed inset-0 bg-white z-[60] flex flex-col md:hidden">
            {/* Overlay Header */}
            <div className="flex items-center justify-between px-4 h-[56px] border-b border-line shrink-0">
              <button onClick={() => setShowMobileCategory(false)} className="text-ink-700 w-8">
                <X size={22} />
              </button>
              <span className="text-[16px] font-bold text-ink-900">{t('nav.category')}</span>
              <span className="w-8" />
            </div>

            {/* Master/detail body */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left rail — every top-level group */}
              <div className="w-[104px] shrink-0 bg-sunken overflow-y-auto border-r border-line">
                {allCategoryGroups.map((group) => (
                  <button
                    key={group.key}
                    ref={(el) => { categoryNavButtonRefs.current[group.key] = el; }}
                    onClick={() => scrollToCategoryGroup(group.key)}
                    className={`w-full text-left px-3 py-3.5 text-[12.5px] leading-tight border-l-[3px] transition-colors ${
                      activeGroupKey === group.key
                        ? 'border-ink-900 bg-white text-ink-900 font-bold'
                        : 'border-transparent text-ink-500'
                    }`}
                  >
                    {t(`categoryMenu.${group.key}`)}
                  </button>
                ))}
              </div>

              {/* Right panel — scrollable sections, one per group */}
              <div ref={mobileCategoryPanelRef} className="flex-1 overflow-y-auto px-4 py-4">
                {allCategoryGroups.map((group) => (
                  <div
                    key={group.key}
                    ref={(el) => { categorySectionRefs.current[group.key] = el; }}
                    data-group-key={group.key}
                    className="mb-7 last:mb-2"
                  >
                    <Link
                      to={group.link}
                      onClick={() => setShowMobileCategory(false)}
                      className="inline-flex items-center gap-1 text-[16px] font-bold text-ink-900 mb-2.5"
                    >
                      {t(`categoryMenu.${group.key}`)}
                      <ChevronRight size={15} className="text-ink-500" />
                    </Link>
                    <div>
                      {group.subs.map((sub) => (
                        <Link
                          key={sub.key}
                          to={sub.link}
                          onClick={() => setShowMobileCategory(false)}
                          className="block py-2 text-[14px] text-ink-500 active:text-ink-900"
                        >
                          {t(`categoryMenu.${sub.key}`)}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Mobile Navigation Tab Bar */}
        {isMobile && (
          <div>
            <div style={{
              borderTop: '1px solid var(--wm-line)',
              overflowX: 'auto',
              display: 'flex',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch',
            }}>
              <button
                onClick={() => { setShowMobileBrandShop(false); setShowMobileCategory(true); }}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--wm-ink-700)',
                  whiteSpace: 'nowrap',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <Menu size={14} />
                {t('nav.category')}
              </button>
              <button
                onClick={() => { setShowMobileCategory(false); setShowMobileBrandShop(true); }}
                style={{
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  color: 'var(--wm-ink-700)',
                  whiteSpace: 'nowrap',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                {t('nav.brandShop')}
              </button>
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  to={item.path}
                  onClick={() => setShowMobileBrandShop(false)}
                  style={{
                    flexShrink: 0,
                    padding: '10px 14px',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: isActive(item.path) ? 'var(--wm-ink-900)' : 'var(--wm-ink-700)',
                    whiteSpace: 'nowrap',
                    textDecoration: 'none',
                  }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Mobile Brand Shop Full-Screen Overlay — Olive Young style searchable list */}
        {showMobileBrandShop && (
          <div className="fixed inset-0 bg-white z-[60] flex flex-col md:hidden">
            {/* Overlay Header */}
            <div className="flex items-center justify-between px-4 h-[56px] border-b border-line shrink-0">
              <button
                onClick={() => { setShowMobileBrandShop(false); setBrandSearch(''); }}
                className="text-ink-700 w-8"
              >
                <X size={22} />
              </button>
              <span className="text-[16px] font-bold text-ink-900">{t('nav.brandShop')}</span>
              <span className="w-8" />
            </div>

            {/* Search */}
            <div className="px-4 py-3 border-b border-line shrink-0">
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-300" />
                <input
                  type="text"
                  value={brandSearch}
                  onChange={(e) => setBrandSearch(e.target.value)}
                  placeholder={t('nav.brandSearchPlaceholder')}
                  autoFocus
                  className="w-full h-[42px] pl-10 pr-4 bg-sunken rounded-full focus:outline-none"
                  style={{ fontSize: '16px' }}
                />
              </div>
            </div>

            {/* Brand list */}
            <div className="flex-1 overflow-y-auto">
              {filteredBrands.length === 0 ? (
                <p className="text-center text-[13px] text-ink-500 py-16">{t('nav.noBrandsFound')}</p>
              ) : (
                filteredBrands.map((brand) => (
                  <Link
                    key={brand}
                    to={`/products?brand=${encodeURIComponent(brand)}`}
                    onClick={() => { setShowMobileBrandShop(false); setBrandSearch(''); }}
                    className="flex items-center justify-between px-4 py-4 border-b border-line text-[15px] text-ink-900 active:bg-sunken"
                  >
                    {brand}
                    <ChevronRight size={16} className="text-ink-300" />
                  </Link>
                ))
              )}
            </div>
          </div>
        )}

      </header>

      {/* Cart Drawer */}
      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
}

/** Globe + language code; opens the 11-language list. Faire: 16px icon, 8px gap, 14/20 text. */
function LanguageSwitcher({ className = '', compact = false }: { className?: string; compact?: boolean }) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClick(ref, open, () => setOpen(false));
  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0];

  return (
    <div ref={ref} className={`relative items-center ${compact ? 'flex' : ''} ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex h-full items-center whitespace-nowrap transition-colors hover:text-ink-900 ${
          compact ? 'gap-1 text-[12px]' : 'gap-2 text-[14px] leading-5 text-ink-700'
        }`}
      >
        <Globe size={compact ? 12 : 16} strokeWidth={1.5} />
        {current.label}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 max-h-[320px] min-w-[170px] overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-hover">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              onClick={() => { i18n.changeLanguage(lang.code); setOpen(false); }}
              className={`w-full px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-sunken ${
                i18n.language === lang.code ? 'font-bold text-ink-900' : 'text-ink-500'
              }`}
            >
              {lang.label} · {lang.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
