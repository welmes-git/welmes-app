import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { initialProducts, brands, categories } from '../data/products';
import ProductCard from '../components/ProductCard';
import { ChevronLeft, ChevronRight, ChevronDown, Search } from 'lucide-react';

type SortOption = 'popular' | 'price-low' | 'price-high' | 'newest' | 'discount';

export default function ProductList() {
  const [searchParams] = useSearchParams();
  const { products } = useStore();

  const allProducts = products.length > 0 ? products : initialProducts;

  const categoryFilter = searchParams.get('category') || 'All';
  const brandFilter = searchParams.get('brand') || '';
  const searchQuery = searchParams.get('search') || '';
  const sortParam = searchParams.get('sort') || 'popular';

  const [sortBy, setSortBy] = useState<SortOption>(sortParam as SortOption);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(
    brandFilter ? [brandFilter] : []
  );
  const [selectedCategory, setSelectedCategory] = useState(categoryFilter);
  const [currentPage, setCurrentPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const itemsPerPage = 12;

  const priceMin = useMemo(() => Math.floor(Math.min(...allProducts.map((p) => p.wholesalePrice))), [allProducts]);
  const priceMax = useMemo(() => Math.ceil(Math.max(...allProducts.map((p) => p.wholesalePrice))), [allProducts]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, Infinity]);

  const filteredProducts = useMemo(() => {
    let result = [...allProducts];

    // Category filter
    if (selectedCategory !== 'All') {
      result = result.filter((p) => p.category === selectedCategory);
    }

    // Brand filter
    if (selectedBrands.length > 0) {
      result = result.filter((p) => selectedBrands.includes(p.brand));
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q)
      );
    }

    // Price range
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
  }, [allProducts, selectedCategory, selectedBrands, searchQuery, priceRange, sortBy]);

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

  const rangeMin = priceRange[0];
  const rangeMax = priceRange[1] === Infinity ? priceMax : priceRange[1];
  const rangePercLow = priceMax > priceMin ? ((rangeMin - priceMin) / (priceMax - priceMin)) * 100 : 0;
  const rangePercHigh = priceMax > priceMin ? ((rangeMax - priceMin) / (priceMax - priceMin)) * 100 : 100;

  const pageTitle = searchQuery
    ? `Search: "${searchQuery}"`
    : selectedCategory !== 'All'
    ? selectedCategory
    : 'All Products';

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[1100px] mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[13px] text-[#999] mb-6">
          <Link to="/" className="hover:text-[#333]">
            Home
          </Link>
          <span>&gt;</span>
          <span className="text-[#333]">
            {selectedCategory !== 'All' ? selectedCategory : 'Products'}
          </span>
        </div>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar Filters */}
          <aside className={`lg:w-[220px] shrink-0 ${showFilters ? 'block' : 'hidden lg:block'}`}>
            <div className="bg-[#f8f8fa] rounded-lg p-4">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-[14px] font-bold">Filters</h3>
                <button
                  onClick={clearFilters}
                  className="text-[12px] text-[#4a90e2] hover:underline"
                >
                  Reset
                </button>
              </div>

              {/* Category */}
              <div className="mb-5">
                <h4 className="text-[13px] font-semibold mb-2">Category</h4>
                <div className="space-y-1">
                  {categories.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => {
                        setSelectedCategory(cat);
                        setCurrentPage(1);
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
                <h4 className="text-[13px] font-semibold mb-2">Brand</h4>
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {brands.map((brand) => (
                    <label
                      key={brand}
                      className="flex items-center gap-2 text-[12px] text-[#666] cursor-pointer hover:text-[#333] py-0.5"
                    >
                      <input
                        type="checkbox"
                        checked={selectedBrands.includes(brand)}
                        onChange={() => toggleBrand(brand)}
                        className="w-3.5 h-3.5 rounded border-[#ccc]"
                      />
                      {brand}
                    </label>
                  ))}
                </div>
              </div>

              {/* Price Range */}
              <div>
                <h4 className="text-[13px] font-semibold mb-3">Price Range</h4>
                {/* Current range labels */}
                <div className="flex justify-between text-[12px] text-[#555] mb-3">
                  <span className="font-medium">¥{rangeMin.toLocaleString()}</span>
                  <span className="font-medium">
                    {priceRange[1] === Infinity ? `¥${priceMax.toLocaleString()}+` : `¥${rangeMax.toLocaleString()}`}
                  </span>
                </div>
                {/* Dual range slider */}
                <div className="relative h-5 flex items-center">
                  {/* Track background */}
                  <div className="absolute w-full h-1.5 bg-[#e5e5e5] rounded-full" />
                  {/* Active track fill */}
                  <div
                    className="absolute h-1.5 bg-[#4a90e2] rounded-full"
                    style={{ left: `${rangePercLow}%`, right: `${100 - rangePercHigh}%` }}
                  />
                  {/* Min handle */}
                  <input
                    type="range"
                    min={priceMin}
                    max={priceMax}
                    value={rangeMin}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val < rangeMax) {
                        setPriceRange([val, priceRange[1]]);
                        setCurrentPage(1);
                      }
                    }}
                    className="absolute w-full appearance-none bg-transparent cursor-pointer range-thumb"
                    style={{ zIndex: rangePercLow > 90 ? 5 : 3 }}
                  />
                  {/* Max handle */}
                  <input
                    type="range"
                    min={priceMin}
                    max={priceMax}
                    value={rangeMax}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val > rangeMin) {
                        setPriceRange([priceRange[0], val]);
                        setCurrentPage(1);
                      }
                    }}
                    className="absolute w-full appearance-none bg-transparent cursor-pointer range-thumb"
                    style={{ zIndex: 4 }}
                  />
                </div>
                {/* Min/Max bounds */}
                <div className="flex justify-between text-[11px] text-[#bbb] mt-2">
                  <span>¥{priceMin.toLocaleString()}</span>
                  <span>¥{priceMax.toLocaleString()}</span>
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
                  {filteredProducts.length} products
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className="lg:hidden px-3 py-2 border border-[#ddd] rounded text-[13px] text-[#666]"
                >
                  Filters
                </button>
                <div className="relative">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOption)}
                    className="appearance-none bg-white border border-[#ddd] rounded px-3 py-2 pr-8 text-[13px] text-[#666] focus:outline-none"
                  >
                    <option value="popular">Popular</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    <option value="newest">Newest</option>
                    <option value="discount">Highest Discount</option>
                  </select>
                  <ChevronDown
                    size={14}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none"
                  />
                </div>
              </div>
            </div>

            {/* No Results */}
            {paginatedProducts.length === 0 && (
              <div className="text-center py-16">
                <Search size={48} className="mx-auto text-[#ddd] mb-4" />
                <p className="text-[14px] text-[#999]">No products found</p>
                <button
                  onClick={clearFilters}
                  className="mt-3 text-[13px] text-[#4a90e2] hover:underline"
                >
                  Clear all filters
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
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (page) => (
                    <button
                      key={page}
                      onClick={() => setCurrentPage(page)}
                      className={`w-8 h-8 flex items-center justify-center rounded text-[13px] ${
                        page === currentPage
                          ? 'bg-[#333] text-white'
                          : 'border border-[#ddd] hover:bg-[#f5f5f5]'
                      }`}
                    >
                      {page}
                    </button>
                  )
                )}
                <button
                  onClick={() =>
                    setCurrentPage((p) => Math.min(totalPages, p + 1))
                  }
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
