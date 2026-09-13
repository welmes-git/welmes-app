import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { initialProducts, categories } from '../data/products';
import { brandsByCount } from '../lib/utils';
import ProductCard from '../components/ProductCard';
import ProductGridSkeleton from '../components/ProductGridSkeleton';
import * as db from '../lib/db';
import { ChevronLeft, ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type SortOption = 'popular' | 'price-low' | 'price-high' | 'newest' | 'discount';

export default function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { products, productsLoading } = useStore();
  const { formatPrice } = useCurrency();
  const { t } = useTranslation();

  // Only fall back to the demo catalogue once loading has actually finished
  // and come back empty — otherwise this briefly flashes demo products before
  // the real Supabase fetch replaces them a moment later.
  const allProducts = products.length > 0 ? products : productsLoading ? [] : initialProducts;
  const brands = brandsByCount(allProducts).map(([brand]) => brand);

  const categoryFilter = searchParams.get('category') || 'All';
  const brandFilter    = searchParams.get('brand')    || '';
  const searchQuery    = searchParams.get('search')   || '';
  const sortParam      = searchParams.get('sort')     || 'popular';

  const [sortBy, setSortBy]               = useState<SortOption>(sortParam as SortOption);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(brandFilter ? [brandFilter] : []);
  const [selectedCategory, setSelectedCategory] = useState(categoryFilter);
  const [currentPage, setCurrentPage]     = useState(1);
  const [showFilters, setShowFilters]     = useState(false);
  const [inlineSearch, setInlineSearch]   = useState(searchQuery);

  // Sync URL → local state; reset page whenever any URL param changes
  useEffect(() => {
    setSelectedBrands(brandFilter ? [brandFilter] : []);
    setSelectedCategory(categoryFilter);
    setSortBy(sortParam as SortOption);
    setCurrentPage(1);
  }, [brandFilter, categoryFilter, sortParam]);

  // Separate effect for searchQuery so page resets when search changes
  useEffect(() => {
    setInlineSearch(searchQuery);
    setCurrentPage(1);
    // Clear sidebar brand/category filter when user performs a new text search
    // so results aren't accidentally empty from stale sidebar state
    if (searchQuery) {
      setSelectedBrands([]);
      setSelectedCategory('All');
    }
  }, [searchQuery]);

  const itemsPerPage = 12;

  const priceMin = useMemo(() => Math.floor(Math.min(...allProducts.map((p) => p.wholesalePrice))), [allProducts]);
  const priceMax = useMemo(() => Math.ceil(Math.max(...allProducts.map((p) => p.wholesalePrice))), [allProducts]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, Infinity]);

  const filteredProducts = useMemo(() => {
    let result = [...allProducts];

    // Text search — name, brand, category, tags, description (first 200 chars)
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.nameEn.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          p.description.slice(0, 200).toLowerCase().includes(q)
      );
    } else {
      // Only apply sidebar filters when NOT in search mode
      if (selectedCategory !== 'All') {
        result = result.filter((p) => p.category === selectedCategory);
      }
      if (selectedBrands.length > 0) {
        result = result.filter((p) => selectedBrands.includes(p.brand));
      }
    }

    // Price range (always applied)
    const rangeMax = priceRange[1] === Infinity ? priceMax : priceRange[1];
    result = result.filter(
      (p) => p.wholesalePrice >= priceRange[0] && p.wholesalePrice <= rangeMax
    );

    // Sort
    switch (sortBy) {
      case 'price-low':
        result.sort((a, b) => a.wholesalePrice - b.wholesalePrice);
        break;
      case 'price-high':
        result.sort((a, b) => b.wholesalePrice - a.wholesalePrice);
        break;
      case 'discount':
        result.sort((a, b) => b.discount - a.discount);
        break;
      case 'newest':
        result.sort((a, b) => b.id - a.id);
        break;
      default:
        result.sort((a, b) => b.reviews - a.reviews);
    }

    return result;
  }, [allProducts, selectedCategory, selectedBrands, searchQuery, priceRange, sortBy, priceMax]);

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const toggleBrand = (brand: string) => {
    setSelectedBrands((prev) =>
      prev.includes(brand) ? prev.filter((b) => b !== brand) : [...prev, brand]
    );
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setSelectedBrands([]);
    setSelectedCategory('All');
    setPriceRange([0, Infinity]);
    setCurrentPage(1);
  };

  const handleInlineSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = inlineSearch.trim();
    if (q) {
      db.logSearchQuery(q);
      navigate(`/products?search=${encodeURIComponent(q)}`);
    } else {
      // Clear search → back to all products
      const p = new URLSearchParams(searchParams);
      p.delete('search');
      setSearchParams(p);
    }
  };

  const clearSearch = () => {
    setInlineSearch('');
    const p = new URLSearchParams(searchParams);
    p.delete('search');
    setSearchParams(p);
  };

  const rangeMin = priceRange[0];
  const rangeMax = priceRange[1] === Infinity ? priceMax : priceRange[1];
  const rangePercLow  = priceMax > priceMin ? ((rangeMin - priceMin) / (priceMax - priceMin)) * 100 : 0;
  const rangePercHigh = priceMax > priceMin ? ((rangeMax - priceMin) / (priceMax - priceMin)) * 100 : 100;

  const pageTitle = searchQuery
    ? t('products.search', { query: searchQuery })
    : selectedCategory !== 'All'
    ? selectedCategory
    : t('products.allProducts');

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[1100px] mx-auto px-4 py-8">

        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[13px] text-ink-500 mb-6">
          <Link to="/" className="hover:text-ink-700">{t('common.home')}</Link>
          <span>&gt;</span>
          <span className="text-ink-700">
            {searchQuery
              ? t('common.search')
              : selectedCategory !== 'All'
              ? selectedCategory
              : t('products.allProducts')}
          </span>
        </div>

        {/* Inline Search Bar — mobile only. The header already has a persistent
            search bar on desktop (hidden below md), so showing this one too
            duplicated it right above the "Search: X" tag. */}
        <div className="mb-6">
          <form onSubmit={handleInlineSearch} className="md:hidden">
            <div className="relative max-w-[560px]">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-300" />
              <input
                type="text"
                value={inlineSearch}
                onChange={(e) => setInlineSearch(e.target.value)}
                placeholder={t('nav.searchPlaceholderFull')}
                className="w-full h-[44px] pl-10 pr-24 border border-line-strong rounded-full bg-canvas text-[14px] text-ink-700 placeholder:text-ink-300 focus:outline-none focus:border-ink-900 transition-colors"
              />
              {inlineSearch && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-16 top-1/2 -translate-y-1/2 text-ink-300 hover:text-ink-500 p-1"
                >
                  <X size={15} />
                </button>
              )}
              <button
                type="submit"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-[36px] px-4 bg-ink-900 text-white text-[13px] font-bold rounded-full hover:shadow-hover transition-shadow"
              >
                {t('common.search')}
              </button>
            </div>
          </form>

          {/* Active search tag */}
          {searchQuery && (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[12px] text-ink-500">{t('common.search')}:</span>
              <span className="inline-flex items-center gap-1.5 border border-ink-900 text-ink-900 text-[12px] font-bold px-2.5 py-1 rounded-md">
                "{searchQuery}"
                <button onClick={clearSearch} className="hover:opacity-70">
                  <X size={12} />
                </button>
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar Filters */}
          <aside className={`lg:w-[220px] shrink-0 ${showFilters ? 'block' : 'hidden lg:block'}`}>
            <div className="border border-line rounded-[10px] p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[14px] font-extrabold text-ink-900">{t('products.filters')}</h3>
                <button onClick={clearFilters} className="text-[12px] text-ink-500 underline underline-offset-2 hover:text-ink-900">
                  {t('products.reset')}
                </button>
              </div>

              {/* Category */}
              <div className="mb-5">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.02em] text-ink-500 mb-2">{t('products.category')}</h4>
                <div className="space-y-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setSelectedCategory(cat);
                        setCurrentPage(1);
                        // If in search mode, exit search mode and apply category filter
                        if (searchQuery) clearSearch();
                      }}
                      className={`block w-full text-left text-[13px] py-1 px-2 rounded ${
                        selectedCategory === cat
                          ? 'bg-sunken font-bold text-ink-900 shadow-[inset_2px_0_0_var(--wm-ink-900)]'
                          : 'text-ink-700 hover:bg-sunken'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Brand */}
              <div className="mb-5">
                <h4 className="text-[11px] font-bold uppercase tracking-[0.02em] text-ink-500 mb-2">{t('products.brand')}</h4>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {brands.map((brand) => (
                    <label
                      key={brand}
                      className="flex items-center gap-2 text-[12px] text-ink-700 cursor-pointer hover:text-ink-900 py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={selectedBrands.includes(brand)}
                        onChange={() => {
                          toggleBrand(brand);
                          if (searchQuery) clearSearch();
                        }}
                        className="w-3.5 h-3.5 rounded border-line-strong accent-ink-900"
                      />
                      {brand}
                    </label>
                  ))}
                </div>
              </div>

              {/* Price Range */}
              <div>
                <h4 className="text-[11px] font-bold uppercase tracking-[0.02em] text-ink-500 mb-3">{t('products.priceRange')}</h4>
                <div className="flex justify-between text-[12px] tabular-nums text-ink-700 mb-3">
                  <span className="font-medium">{formatPrice(rangeMin)}</span>
                  <span className="font-medium">
                    {priceRange[1] === Infinity ? `${formatPrice(priceMax)}+` : formatPrice(rangeMax)}
                  </span>
                </div>
                <div className="relative h-5 flex items-center">
                  <div className="absolute w-full h-1.5 bg-line rounded-full" />
                  <div
                    className="absolute h-1.5 bg-ink-900 rounded-full"
                    style={{ left: `${rangePercLow}%`, right: `${100 - rangePercHigh}%` }}
                  />
                  <input
                    type="range"
                    min={priceMin}
                    max={priceMax}
                    value={rangeMin}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val < rangeMax) { setPriceRange([val, priceRange[1]]); setCurrentPage(1); }
                    }}
                    className="absolute w-full appearance-none bg-transparent cursor-pointer range-thumb"
                    style={{ zIndex: rangePercLow > 90 ? 5 : 3 }}
                  />
                  <input
                    type="range"
                    min={priceMin}
                    max={priceMax}
                    value={rangeMax}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > rangeMin) { setPriceRange([priceRange[0], val]); setCurrentPage(1); }
                    }}
                    className="absolute w-full appearance-none bg-transparent cursor-pointer range-thumb"
                    style={{ zIndex: 4 }}
                  />
                </div>
                <div className="flex justify-between text-[11px] tabular-nums text-ink-300 mt-2">
                  <span>{formatPrice(priceMin)}</span>
                  <span>{formatPrice(priceMax)}</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Main Content */}
          <div className="flex-1">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
              <div>
                <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-ink-900">{pageTitle}</h1>
                <p className="text-[13px] tabular-nums text-ink-500">
                  {filteredProducts.length} {t('products.products')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="lg:hidden h-9 px-3 border border-line-strong rounded-md text-[13px] font-bold text-ink-700 hover:bg-sunken"
                >
                  {t('products.filters')}
                </button>
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="appearance-none bg-canvas border border-line-strong rounded-md h-9 px-3 pr-8 text-[13px] text-ink-700 focus:outline-none focus:border-ink-900"
                  >
                    <option value="popular">{t('products.popular')}</option>
                    <option value="price-low">{t('products.priceLow')}</option>
                    <option value="price-high">{t('products.priceHigh')}</option>
                    <option value="newest">{t('products.newest')}</option>
                    <option value="discount">{t('products.highestDiscount')}</option>
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none"
                  />
                </div>
              </div>
            </div>

            {productsLoading ? (
              <ProductGridSkeleton count={9} />
            ) : (
              <>
                {/* No Results */}
                {filteredProducts.length === 0 && (
                  <div className="text-center py-16">
                    <Search size={48} className="mx-auto text-line-strong mb-4" />
                    <p className="text-[15px] font-bold text-ink-700 mb-1">{t('products.noResults')}</p>
                    {searchQuery && (
                      <p className="text-[13px] text-ink-300 mb-4">
                        "{searchQuery}"
                      </p>
                    )}
                    <button
                      onClick={() => { clearFilters(); clearSearch(); }}
                      className="mt-2 h-10 px-5 bg-ink-900 text-white text-[13px] font-bold rounded-lg hover:shadow-hover transition-shadow"
                    >
                      {t('products.clearFilters')}
                    </button>
                  </div>
                )}

                {/* Product Grid */}
                <div className="grid grid-cols-2 gap-x-2 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
                  {paginatedProducts.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                </div>
              </>
            )}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-1 mt-10">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="w-8 h-8 flex items-center justify-center border border-line-strong rounded-md text-ink-700 hover:bg-sunken disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((page) => {
                    // Show first, last, current ±1, and ellipsis
                    return page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1;
                  })
                  .reduce<(number | 'ellipsis')[]>((acc, page, idx, arr) => {
                    if (idx > 0 && (arr[idx - 1] as number) + 1 < page) acc.push('ellipsis');
                    acc.push(page);
                    return acc;
                  }, [])
                  .map((item, idx) =>
                    item === 'ellipsis' ? (
                      <span key={`e-${idx}`} className="w-8 text-center text-ink-300 text-[13px]">…</span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => setCurrentPage(item as number)}
                        className={`w-8 h-8 flex items-center justify-center rounded-md text-[13px] tabular-nums ${
                          item === currentPage
                            ? 'bg-ink-900 font-bold text-white'
                            : 'border border-line-strong text-ink-700 hover:bg-sunken'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="w-8 h-8 flex items-center justify-center border border-line-strong rounded-md text-ink-700 hover:bg-sunken disabled:opacity-30"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
