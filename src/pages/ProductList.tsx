import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { initialProducts, brands, categories } from '../data/products';
import ProductCard from '../components/ProductCard';
import { ChevronLeft, ChevronRight, ChevronDown, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type SortOption = 'popular' | 'price-low' | 'price-high' | 'newest' | 'discount';

export default function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { products } = useStore();
  const { formatPrice } = useCurrency();
  const { t } = useTranslation();

  const allProducts = products.length > 0 ? products : initialProducts;

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
        <div className="flex items-center gap-2 text-[13px] text-[#999] mb-6">
          <Link to="/" className="hover:text-[#333]">{t('common.home')}</Link>
          <span>&gt;</span>
          <span className="text-[#333]">
            {searchQuery
              ? t('common.search')
              : selectedCategory !== 'All'
              ? selectedCategory
              : t('products.allProducts')}
          </span>
        </div>

        {/* Inline Search Bar — shown when in search mode or always on mobile */}
        <div className="mb-6">
          <form onSubmit={handleInlineSearch}>
            <div className="relative max-w-[560px]">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#aaa]" />
              <input
                type="text"
                value={inlineSearch}
                onChange={(e) => setInlineSearch(e.target.value)}
                placeholder={t('nav.searchPlaceholderFull')}
                className="w-full h-[44px] pl-10 pr-24 border border-[#ddd] rounded-full text-[14px] focus:outline-none focus:border-[#333] transition-colors"
              />
              {inlineSearch && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-16 top-1/2 -translate-y-1/2 text-[#bbb] hover:text-[#666] p-1"
                >
                  <X size={15} />
                </button>
              )}
              <button
                type="submit"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-[36px] px-4 bg-[#333] text-white text-[13px] font-medium rounded-full hover:bg-[#555] transition-colors"
              >
                {t('common.search')}
              </button>
            </div>
          </form>

          {/* Active search tag */}
          {searchQuery && (
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[12px] text-[#999]">{t('common.search')}:</span>
              <span className="inline-flex items-center gap-1.5 bg-[#333] text-white text-[12px] font-medium px-3 py-1 rounded-full">
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
            <div className="bg-[#f8f8fa] rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[14px] font-bold">{t('products.filters')}</h3>
                <button onClick={clearFilters} className="text-[12px] text-[#4a90e2] hover:underline">
                  {t('products.reset')}
                </button>
              </div>

              {/* Category */}
              <div className="mb-5">
                <h4 className="text-[13px] font-semibold mb-2">{t('products.category')}</h4>
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
                          ? 'bg-[#333] text-white'
                          : 'text-[#666] hover:bg-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Brand */}
              <div className="mb-5">
                <h4 className="text-[13px] font-semibold mb-2">{t('products.brand')}</h4>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {brands.map((brand) => (
                    <label
                      key={brand}
                      className="flex items-center gap-2 text-[12px] text-[#666] cursor-pointer hover:text-[#333] py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={selectedBrands.includes(brand)}
                        onChange={() => {
                          toggleBrand(brand);
                          if (searchQuery) clearSearch();
                        }}
                        className="w-3.5 h-3.5 rounded border-[#ccc]"
                      />
                      {brand}
                    </label>
                  ))}
                </div>
              </div>

              {/* Price Range */}
              <div>
                <h4 className="text-[13px] font-semibold mb-3">{t('products.priceRange')}</h4>
                <div className="flex justify-between text-[12px] text-[#555] mb-3">
                  <span className="font-medium">{formatPrice(rangeMin)}</span>
                  <span className="font-medium">
                    {priceRange[1] === Infinity ? `${formatPrice(priceMax)}+` : formatPrice(rangeMax)}
                  </span>
                </div>
                <div className="relative h-5 flex items-center">
                  <div className="absolute w-full h-1.5 bg-[#e5e5e5] rounded-full" />
                  <div
                    className="absolute h-1.5 bg-[#4a90e2] rounded-full"
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
                <div className="flex justify-between text-[11px] text-[#bbb] mt-2">
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
                <h1 className="text-[20px] font-bold text-[#333]">{pageTitle}</h1>
                <p className="text-[13px] text-[#999]">
                  {filteredProducts.length} {t('products.products')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="lg:hidden px-3 py-2 border border-[#ddd] rounded text-[13px] text-[#666]"
                >
                  {t('products.filters')}
                </button>
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="appearance-none bg-white border border-[#ddd] rounded px-3 py-2 pr-8 text-[13px] text-[#666] focus:outline-none"
                  >
                    <option value="popular">{t('products.popular')}</option>
                    <option value="price-low">{t('products.priceLow')}</option>
                    <option value="price-high">{t('products.priceHigh')}</option>
                    <option value="newest">{t('products.newest')}</option>
                    <option value="discount">{t('products.highestDiscount')}</option>
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none"
                  />
                </div>
              </div>
            </div>

            {/* No Results */}
            {filteredProducts.length === 0 && (
              <div className="text-center py-16">
                <Search size={48} className="mx-auto text-[#ddd] mb-4" />
                <p className="text-[15px] font-medium text-[#666] mb-1">{t('products.noResults')}</p>
                {searchQuery && (
                  <p className="text-[13px] text-[#aaa] mb-4">
                    "{searchQuery}"
                  </p>
                )}
                <button
                  onClick={() => { clearFilters(); clearSearch(); }}
                  className="mt-2 px-5 py-2 bg-[#333] text-white text-[13px] rounded-lg hover:bg-[#555] transition-colors"
                >
                  {t('products.clearFilters')}
                </button>
              </div>
            )}

            {/* Product Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              {paginatedProducts.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center items-center gap-1 mt-10">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="w-8 h-8 flex items-center justify-center border border-[#ddd] rounded hover:bg-[#f5f5f5] disabled:opacity-30"
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
                      <span key={`e-${idx}`} className="w-8 text-center text-[#bbb] text-[13px]">…</span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => setCurrentPage(item as number)}
                        className={`w-8 h-8 flex items-center justify-center rounded text-[13px] ${
                          item === currentPage
                            ? 'bg-[#333] text-white'
                            : 'border border-[#ddd] hover:bg-[#f5f5f5]'
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="w-8 h-8 flex items-center justify-center border border-[#ddd] rounded hover:bg-[#f5f5f5] disabled:opacity-30"
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
