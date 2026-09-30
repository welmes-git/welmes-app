import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useCurrency } from '../context/CurrencyContext';
import { categories } from '../data/products';
import { hasJapanese } from '../lib/utils';
import { useCatalogFacets, useCatalogPage, useDebounced } from '../hooks/useCatalog';
import { STORE_PAGE_SIZE } from '../lib/catalogQuery';
import type { CatalogQuery } from '../lib/catalogQuery';
import ProductCard from '../components/ProductCard';
import ProductGridSkeleton from '../components/ProductGridSkeleton';
import SignUpBanner from '../components/SignUpBanner';
import * as db from '../lib/db';
import { Check, ChevronLeft, ChevronRight, ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type SortOption = 'popular' | 'price-low' | 'price-high' | 'newest' | 'discount';

export default function ProductList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated } = useStore();
  const { formatPrice } = useCurrency();
  const { t } = useTranslation();

  // Brand list (most products first) and price bounds come from one small
  // aggregate query; the product grid is fetched a page at a time below.
  const { data: facets } = useCatalogFacets();
  const brands = useMemo(() => (facets?.brands ?? []).map(([brand]) => brand), [facets]);

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
  const [filtersHidden, setFiltersHidden] = useState(false);
  const [showAllCategories, setShowAllCategories] = useState(false);
  const [showAllBrands, setShowAllBrands] = useState(false);
  const [brandQuery, setBrandQuery]       = useState('');

  // Sync URL → local state; reset page whenever any URL param changes
  useEffect(() => {
    queueMicrotask(() => {
      setSelectedBrands(brandFilter ? [brandFilter] : []);
      setSelectedCategory(categoryFilter);
      setSortBy(sortParam as SortOption);
      setCurrentPage(1);
    });
  }, [brandFilter, categoryFilter, sortParam]);

  // Separate effect for searchQuery so page resets when search changes
  useEffect(() => {
    queueMicrotask(() => {
      setInlineSearch(searchQuery);
      setCurrentPage(1);
      if (searchQuery) {
        setSelectedBrands([]);
        setSelectedCategory('All');
      }
    });
  }, [searchQuery]);

  const itemsPerPage = STORE_PAGE_SIZE;

  const priceMin = Math.floor(facets?.priceMin ?? 0);
  const priceMax = Math.ceil(facets?.priceMax ?? 0);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, Infinity]);
  // The slider fires on every pixel; only query once it settles.
  const debouncedPrice = useDebounced(priceRange, 300);

  // One page, searched/filtered/sorted in the database (catalog_list). Search
  // mode ignores the sidebar category/brand filters, as before; the price
  // range always applies (the server ignores it for visitors without prices).
  const query = useMemo<CatalogQuery>(() => ({
    search: searchQuery || undefined,
    category: !searchQuery && selectedCategory !== 'All' ? selectedCategory : null,
    brands: !searchQuery && selectedBrands.length > 0 ? selectedBrands : null,
    priceMin: debouncedPrice[0] > 0 ? debouncedPrice[0] : null,
    priceMax: debouncedPrice[1] === Infinity ? null : debouncedPrice[1],
    sort: sortBy,
    limit: itemsPerPage,
    offset: (currentPage - 1) * itemsPerPage,
  }), [searchQuery, selectedCategory, selectedBrands, debouncedPrice, sortBy, currentPage, itemsPerPage]);
  // keepPrevious: paging/filtering swaps the grid in place instead of flashing a skeleton.
  const { data: page, loading: pageLoading, error: pageError } = useCatalogPage(query, { keepPrevious: true });
  const productsLoading = !page && pageLoading;
  const totalProducts = page?.total ?? 0;
  const paginatedProducts = page?.items ?? [];
  const totalPages = Math.ceil(totalProducts / itemsPerPage);

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

  // Faire shows three options per section, then "Show more". Checked options stay visible.
  const FILTER_PREVIEW = 3;
  const PILL = 'inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-line-control bg-canvas px-4 text-[14px] leading-5 text-ink-700 transition-colors hover:border-ink-700';
  const gridCls = filtersHidden ? 'product-grid' : 'grid grid-cols-2 gap-x-2 gap-y-6 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6';
  const visibleCategories = categories
    .filter((c) => c !== 'All')
    .filter((c, i) => showAllCategories || i < FILTER_PREVIEW || c === selectedCategory);
  const matchingBrands = brands.filter((b) => b.toLowerCase().includes(brandQuery.trim().toLowerCase()));
  const visibleBrands = matchingBrands.filter((b, i) => showAllBrands || i < FILTER_PREVIEW || selectedBrands.includes(b));

  return (
    <div className="min-h-screen bg-white tracking-[0.15px]">
      <div className="page-container pb-16">

        {/* Inline Search Bar — mobile only (the header search is hidden below md) */}
        <form onSubmit={handleInlineSearch} className="pt-4 md:hidden">
          <div className="relative">
            <Search size={16} strokeWidth={1.5} className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-700" />
            <input
              type="text"
              value={inlineSearch}
              onChange={(e) => setInlineSearch(e.target.value)}
              placeholder={t('nav.searchPlaceholderFull')}
              className="h-10 w-full rounded-full border border-line-control bg-canvas pl-10 pr-10 text-[14px] leading-5 text-ink-700 placeholder:text-ink-500 focus:border-ink-700 focus:outline-none"
            />
            {inlineSearch && (
              <button type="button" onClick={clearSearch} aria-label={t('common.close')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ink-500 hover:text-ink-900">
                <X size={16} strokeWidth={1.5} />
              </button>
            )}
          </div>
        </form>

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* Filter bar — measured on faire.com/search (1440px): 220px column, sticky under
              the header, 16px top padding, 40px "Filters" row, 16px, #dadada rule, then
              scrolling sections (24px header padding, 14/20 text, 16px checkbox, 8px rows). */}
          <aside
            className={`w-full shrink-0 flex-col pt-4 lg:mt-2 lg:sticky lg:top-[108px] lg:h-[calc(100vh-108px)] lg:w-[220px] ${
              showFilters ? 'flex' : 'hidden'
            } ${filtersHidden ? 'lg:hidden' : 'lg:flex'}`}
          >
            <div className="flex h-10 items-center gap-2">
              <h2 className="text-[14px] font-medium leading-5 text-ink-700">{t('products.filters')}</h2>
              <button onClick={clearFilters} className="ml-auto mr-4 text-[14px] leading-5 text-ink-700 underline [text-underline-offset:25%] hover:text-ink-900">
                {t('products.reset')}
              </button>
            </div>
            <div className="h-4 shrink-0" />
            <hr className="m-0 border-0 border-t border-line-control" />

            <div className="filter-scroll min-h-0 flex-1 divide-y divide-line-control overflow-y-auto">
              <FilterSection title={t('products.category')}>
                {visibleCategories.map((cat) => (
                  <FilterCheckbox
                    key={cat}
                    label={cat}
                    checked={selectedCategory === cat}
                    onChange={() => {
                      setSelectedCategory(selectedCategory === cat ? 'All' : cat);
                      setCurrentPage(1);
                      if (searchQuery) clearSearch();
                    }}
                  />
                ))}
                {categories.length - 1 > FILTER_PREVIEW && (
                  <ShowMore expanded={showAllCategories} onClick={() => setShowAllCategories((v) => !v)} />
                )}
              </FilterSection>

              <FilterSection title={t('products.brand')}>
                <label className="relative flex h-10 items-center rounded-full border border-line-control bg-canvas pr-4 focus-within:border-ink-700">
                  <Search size={16} strokeWidth={1.5} className="pointer-events-none absolute left-4 text-ink-700" />
                  <input
                    type="search"
                    value={brandQuery}
                    onChange={(e) => setBrandQuery(e.target.value)}
                    placeholder={t('common.search')}
                    aria-label={`${t('products.brand')} ${t('common.search')}`}
                    className="w-full bg-transparent pl-10 text-[14px] leading-5 text-ink-700 placeholder:text-ink-500 focus:outline-none"
                  />
                </label>
                <div className="h-6" />
                {visibleBrands.map((brand) => (
                  <FilterCheckbox
                    key={brand}
                    label={brand}
                    checked={selectedBrands.includes(brand)}
                    onChange={() => {
                      toggleBrand(brand);
                      if (searchQuery) clearSearch();
                    }}
                  />
                ))}
                {matchingBrands.length > FILTER_PREVIEW && (
                  <ShowMore expanded={showAllBrands} onClick={() => setShowAllBrands((v) => !v)} />
                )}
              </FilterSection>

              <FilterSection title={t('products.priceRange')}>
                <div className="flex justify-between pb-3 text-[14px] leading-5 tabular-nums text-ink-700">
                  <span>{formatPrice(rangeMin)}</span>
                  <span>{priceRange[1] === Infinity ? `${formatPrice(priceMax)}+` : formatPrice(rangeMax)}</span>
                </div>
                <div className="relative flex h-5 items-center">
                  <div className="absolute h-[2px] w-full rounded-full bg-line-control" />
                  <div
                    className="absolute h-[2px] rounded-full bg-ink-700"
                    style={{ left: `${rangePercLow}%`, right: `${100 - rangePercHigh}%` }}
                  />
                  <input
                    type="range"
                    min={priceMin}
                    max={priceMax}
                    value={rangeMin}
                    aria-label={`${t('products.priceRange')} min`}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val < rangeMax) { setPriceRange([val, priceRange[1]]); setCurrentPage(1); }
                    }}
                    className="range-thumb absolute w-full cursor-pointer appearance-none bg-transparent"
                    style={{ zIndex: rangePercLow > 90 ? 5 : 3 }}
                  />
                  <input
                    type="range"
                    min={priceMin}
                    max={priceMax}
                    value={rangeMax}
                    aria-label={`${t('products.priceRange')} max`}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > rangeMin) { setPriceRange([priceRange[0], val]); setCurrentPage(1); }
                    }}
                    className="range-thumb absolute w-full cursor-pointer appearance-none bg-transparent"
                    style={{ zIndex: 4 }}
                  />
                </div>
              </FilterSection>
              <div className="hidden h-[72px] lg:block" />
            </div>
          </aside>

          {/* Results */}
          <div className="min-w-0 flex-1">
            {/* Title row: 30/38 title, 14px count in #6c6a6a, "Hide filters" underline link (Faire) */}
            <div className="flex flex-wrap items-baseline pt-4">
              <h1 className="font-serif text-[30px] font-normal leading-[38px] text-ink-700">{pageTitle}</h1>
              <p className="ml-4 text-[14px] leading-5 tabular-nums text-ink-500">
                {t('products.products', { count: totalProducts })}
              </p>
              <button
                onClick={() => setFiltersHidden((v) => !v)}
                className="ml-4 hidden text-[14px] leading-5 text-ink-700 underline [text-underline-offset:25%] hover:text-ink-900 lg:inline"
              >
                {filtersHidden ? t('products.showFilters') : t('products.hideFilters')}
              </button>
            </div>

            {/* Pill row — 40px pills, 1px #dadada, fully rounded, 16px padding */}
            <div className="flex items-center gap-2 overflow-x-auto py-4 [scrollbar-width:none]">
              <button onClick={() => setShowFilters((v) => !v)} className={`${PILL} lg:hidden`} aria-expanded={showFilters}>
                <SlidersHorizontal size={16} strokeWidth={1.5} />
                {t('products.allFilters')}
              </button>
              {searchQuery && (
                <span className={PILL}>
                  &quot;{searchQuery}&quot;
                  <button onClick={clearSearch} aria-label={t('common.close')} className="text-ink-500 hover:text-ink-900">
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </span>
              )}
              <div className="relative ml-auto shrink-0">
                <select
                  value={sortBy}
                  onChange={(e) => { setSortBy(e.target.value as SortOption); setCurrentPage(1); }}
                  aria-label={t('products.sortBy')}
                  className={`${PILL} cursor-pointer appearance-none pr-10 focus:outline-none`}
                >
                  <option value="popular">{t('products.popular')}</option>
                  <option value="price-low">{t('products.priceLow')}</option>
                  <option value="price-high">{t('products.priceHigh')}</option>
                  <option value="newest">{t('products.newest')}</option>
                  <option value="discount">{t('products.highestDiscount')}</option>
                </select>
                <ChevronDown size={16} strokeWidth={1.5} className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-ink-700" />
              </div>
            </div>

            <div className="pt-2">
            {productsLoading ? (
              <ProductGridSkeleton count={10} className={gridCls} />
            ) : (
              <>
                {pageError && !page && (
                  <p role="alert" className="py-16 text-center text-[14px] leading-5 text-ink-500">{t('common.error')}</p>
                )}
                {page && totalProducts === 0 && (
                  <div className="py-16 text-center">
                    <Search size={48} strokeWidth={1} className="mx-auto mb-4 text-line-strong" />
                    <p className="mb-1 text-[14px] font-medium leading-5 text-ink-700">{t('products.noResults')}</p>
                    {searchQuery && <p className="mb-4 text-[14px] leading-5 text-ink-500">&quot;{searchQuery}&quot;</p>}
                    <button
                      onClick={() => { clearFilters(); clearSearch(); }}
                      className="mt-2 text-[14px] leading-5 text-ink-700 underline [text-underline-offset:25%] hover:text-ink-900"
                    >
                      {t('products.clearFilters')}
                    </button>
                  </div>
                )}

                <div className={gridCls}>
                  {paginatedProducts.map((product) => (
                    <ProductCard key={product.id} product={product} />
                  ))}
                  {/* Signed-out visitors: full-width banner pinned to the 3rd grid row (Faire),
                      8px inset on top and sides. With too few products for two rows it
                      follows the last tile instead of leaving an empty row. */}
                  {!isAuthenticated && paginatedProducts.length > 0 && (
                    <SignUpBanner
                      className="col-span-full px-2 pt-2"
                      style={paginatedProducts.length > 6 ? { gridRow: '3 / span 1' } : undefined}
                    />
                  )}
                </div>
              </>
            )}
            </div>

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

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="py-6 text-[14px] font-medium leading-5 text-ink-700">{title}</h3>
      <div className="pr-4">{children}</div>
      <div className="h-4" />
    </section>
  );
}

/** 16px square, 1px #333 border, 2px radius; checked = black fill with an 8px white check (Faire). */
function FilterCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="w-full pb-2">
      <label className="group flex cursor-pointer items-start gap-2 text-[14px] leading-5 text-ink-700 hover:text-ink-900">
        <span className="relative flex shrink-0">
          <input
            type="checkbox"
            checked={checked}
            onChange={onChange}
            className="peer h-4 w-4 cursor-pointer appearance-none rounded-[2px] border border-ink-700 checked:border-black checked:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-900"
          />
          <Check size={8} strokeWidth={4} className="pointer-events-none absolute left-1 top-1 hidden text-white peer-checked:block" />
        </span>
        <span className={`line-clamp-2 break-words ${hasJapanese(label) ? 'font-jp' : ''}`}>{label}</span>
      </label>
    </div>
  );
}

function ShowMore({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="pb-2">
      <button onClick={onClick} className="block text-[14px] leading-5 text-ink-700 underline [text-underline-offset:25%] hover:text-ink-900">
        {expanded ? t('products.showLess') : t('products.showMore')}
      </button>
    </div>
  );
}
