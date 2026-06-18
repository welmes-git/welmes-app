import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import CartDrawer from './CartDrawer';
import CurrencySelector from './CurrencySelector';
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
} from 'lucide-react';

const navItems = [
  { label: 'Special Price', path: '/products?sort=discount' },
  { label: 'Ranking', path: '/products?sort=popular' },
  { label: 'Brand Shop', path: '/products' },
  { label: 'Theme', path: '/products' },
  { label: 'Event', path: '/products' },
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
  const { isAuthenticated, isAdmin, currentUser, logout, cart } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

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
      {/* Top Utility Bar — hidden on mobile via JS to prevent horizontal overflow */}
      {!isMobile && <div className="bg-[#f8f8fa] border-b border-[#e5e5e5]">
        <div className="max-w-[1100px] mx-auto px-4 flex justify-end items-center h-9">
          <div className="flex items-center gap-3 text-[12px] text-[#666666]">
            {!isAuthenticated ? (
              <>
                <Link to="/register" className="hover:text-[#ff4d6d] transition-colors">
                  Register
                </Link>
                <span className="text-[#ddd]">|</span>
                <Link to="/login" className="hover:text-[#ff4d6d] transition-colors">
                  Login
                </Link>
              </>
            ) : (
              <>
                <span className="text-[#333] font-medium">
                  {currentUser?.companyName || currentUser?.email}
                </span>
                <span className="text-[#ddd]">|</span>
                <Link
                  to="/account"
                  className="hover:text-[#ff4d6d] transition-colors"
                >
                  My Account
                </Link>
                <span className="text-[#ddd]">|</span>
                <button
                  onClick={handleLogout}
                  className="hover:text-[#ff4d6d] transition-colors flex items-center gap-1"
                >
                  <LogOut size={12} />
                  Logout
                </button>
              </>
            )}
            <span className="text-[#ddd]">|</span>
            <Link to="/support" className="hover:text-[#ff4d6d] transition-colors">
              Support
            </Link>
            <span className="text-[#ddd]">|</span>
            <CurrencySelector />
          </div>
        </div>
      </div>}

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
                  placeholder="Search products, brands..."
                  className="w-full h-[42px] pl-4 pr-12 border-2 border-[#333333] rounded-full text-[14px] focus:outline-none focus:border-[#ff4d6d] transition-colors"
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
                            ? 'Verified Business'
                            : 'Pending Verification'}
                        </p>
                      </div>
                      <Link
                        to="/account"
                        className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-[#333] hover:bg-[#f8f8fa]"
                        onClick={() => setShowUserDropdown(false)}
                      >
                        <User size={14} />
                        My Account
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
                        Logout
                      </button>
                    </div>
                  )}
                </div>
              )}
              <button className="text-[#333] hover:text-[#ff4d6d] transition-colors hidden sm:block">
                <Heart size={22} />
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
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="md:hidden text-[#333]"
              >
                {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
              </button>
            </div>
          </div>

          {/* Navigation Bar */}
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

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white border-t border-[#e5e5e5]">
            <div className="px-4 py-3">
              <form onSubmit={handleSearch} className="mb-4">
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search products..."
                    className="w-full h-10 pl-4 pr-10 border border-[#e5e5e5] rounded-full text-[14px]"
                  />
                  <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2">
                    <Search size={18} />
                  </button>
                </div>
              </form>
              {navItems.map((item) => (
                <Link
                  key={item.label}
                  to={item.path}
                  className="block py-3 text-[14px] text-[#333] border-b border-[#f5f5f5]"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
              {subCategories.map((cat) => (
                <Link
                  key={cat}
                  to={`/products?category=${cat}`}
                  className="block py-3 text-[14px] text-[#666] border-b border-[#f5f5f5]"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  {cat}
                </Link>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Cart Drawer */}
      <CartDrawer isOpen={isCartOpen} onClose={() => setIsCartOpen(false)} />
    </>
  );
}
