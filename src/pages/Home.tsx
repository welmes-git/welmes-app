import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { initialProducts } from '../data/products';
import ProductCard from '../components/ProductCard';
import ProductGridSkeleton from '../components/ProductGridSkeleton';
import { ChevronLeft, ChevronRight, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { heroBanners as banners, eventBanners } from '../config/banners';
import { useTranslation } from 'react-i18next';
import { brandsByCount, hasJapanese } from '../lib/utils';


export default function Home() {
  const { t } = useTranslation();
  const { products, productsLoading } = useStore();
  const [currentBanner, setCurrentBanner] = useState(0);
  // Only fall back to the demo catalogue once loading has actually finished
  // and come back empty — otherwise this briefly flashes demo products before
  // the real Supabase fetch replaces them a moment later.
  const allProducts = products.length > 0 ? products : productsLoading ? [] : initialProducts;

  // Weekly best = most reviewed; New arrivals = highest id (newest first).
  // Previously New Arrivals was `slice(4, 12)`, which rendered an empty section
  // whenever the catalogue held 5 products or fewer.
  const weeklyBest = [...allProducts].sort((a, b) => b.reviews - a.reviews).slice(0, 12);
  const newArrivals = [...allProducts].sort((a, b) => b.id - a.id).slice(0, 12);
  // From the live catalogue — the old hardcoded list was brands we don't carry
  const popularBrands = brandsByCount(allProducts).slice(0, 10);

  // Auto-slide banners
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentBanner((prev) => (prev + 1) % banners.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const nextBanner = () => setCurrentBanner((prev) => (prev + 1) % banners.length);
  const prevBanner = () => setCurrentBanner((prev) => (prev - 1 + banners.length) % banners.length);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Banner Slider */}
      <section className="relative w-full h-[360px] md:h-[420px] overflow-hidden">
        {banners.map((banner, index) => (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-700 ${
              index === currentBanner ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <Link to={banner.link} className="block w-full h-full">
              <img
                src={banner.image}
                alt={banner.textKey ? t(`banners.${banner.textKey}Title`).replace(/\n/g, ' ') : 'WELMES'}
                className="w-full h-full object-cover"
                style={banner.focus ? { objectPosition: banner.focus } : undefined}
              />
              {banner.textKey && (
                <div
                  className={`absolute inset-0 flex items-center px-14 md:px-[7%] ${
                    banner.textSide === 'right' ? 'justify-end text-right' : 'justify-start text-left'
                  }`}
                >
                  <div className="max-w-[85%] md:max-w-[44%]">
                    <p className="text-[10px] md:text-[13px] font-semibold tracking-[2.5px] uppercase text-ink-500 mb-2 md:mb-3">
                      {t(`banners.${banner.textKey}Eyebrow`)}
                    </p>
                    <h2 className="text-[26px] md:text-[46px] font-extrabold leading-[1.08] tracking-[-0.02em] text-ink-900 whitespace-pre-line">
                      {t(`banners.${banner.textKey}Title`)}
                    </h2>
                    <p className="text-[12px] md:text-[15px] text-ink-500 mt-2 md:mt-3 leading-relaxed">
                      {t(`banners.${banner.textKey}Subtitle`)}
                    </p>
                    <span className="inline-flex items-center gap-2 mt-3 md:mt-5 bg-ink-900 text-white text-[12px] md:text-[14px] font-bold px-4 py-2 md:px-6 md:py-3 rounded-lg">
                      {t(`banners.${banner.textKey}Cta`)}
                      <ChevronRightIcon size={14} />
                    </span>
                  </div>
                </div>
              )}
            </Link>
          </div>
        ))}

        {/* Navigation Arrows */}
        <button
          onClick={prevBanner}
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-canvas/90 border border-line-strong text-ink-700 rounded-full flex items-center justify-center hover:bg-canvas transition-colors z-10"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={nextBanner}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-canvas/90 border border-line-strong text-ink-700 rounded-full flex items-center justify-center hover:bg-canvas transition-colors z-10"
        >
          <ChevronRight size={20} />
        </button>

        {/* Dot Indicators */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 z-10">
          {banners.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentBanner(index)}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                index === currentBanner ? 'bg-ink-900' : 'bg-canvas/70 border border-line-strong'
              }`}
            />
          ))}
        </div>
      </section>

      {/* Weekly Best Sellers */}
      <section className="page-container py-16">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em] text-ink-900">{t('home.weeklySellers')}</h2>
          <Link
            to="/products?sort=popular"
            className="flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900 transition-colors"
          >
            {t('common.viewAll')}
            <ChevronRightIcon size={14} />
          </Link>
        </div>
        {productsLoading ? (
          <ProductGridSkeleton />
        ) : (
          <div className="product-grid">
            {weeklyBest.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>

      {/* Event Banners */}
      <section className="page-container pb-16">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {eventBanners.map((event, index) => (
            <Link
              key={index}
              to={event.link}
              className="group relative overflow-hidden rounded-lg aspect-[3/2]"
            >
              <img
                src={event.image}
                alt={event.title}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <div className="absolute bottom-4 left-4 text-white">
                <p className="text-[12px] opacity-80 mb-1">{event.subtitle}</p>
                <p className="text-[18px] font-bold">{event.title}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* New Arrivals */}
      {(productsLoading || newArrivals.length > 0) && (
        <section className="bg-sunken py-16">
          <div className="page-container">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-[17px] font-extrabold tracking-[-0.01em] text-ink-900">{t('home.newArrivals')}</h2>
              <Link
                to="/products?sort=newest"
                className="flex items-center gap-1 text-[13px] text-ink-500 hover:text-ink-900 transition-colors"
              >
                {t('common.viewAll')}
                <ChevronRightIcon size={14} />
              </Link>
            </div>
            {productsLoading ? <ProductGridSkeleton /> : (
              <div className="product-grid">
                {newArrivals.map((product) => (
                  <ProductCard key={product.id} product={product} />
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Brand Showcase */}
      {popularBrands.length > 0 && (
        <section className="page-container py-16">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em] text-ink-900 mb-5">
            {t('home.popularBrands')}
          </h2>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            {popularBrands.map(([brand, count]) => (
              <Link
                key={brand}
                to={`/products?brand=${encodeURIComponent(brand)}`}
                className="flex h-16 flex-col items-center justify-center rounded-md border border-line px-3 text-center transition-colors hover:border-ink-900"
              >
                <span className={`max-w-full truncate text-[13px] font-bold text-ink-900 ${hasJapanese(brand) ? 'font-jp' : ''}`}>
                  {brand}
                </span>
                <span className="text-[11.5px] tabular-nums text-ink-500">{count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* B2B Info Section */}
      <section className="bg-sunken border-t border-line py-16">
        <div className="page-container text-center">
          <h2 className="text-[24px] md:text-[30px] font-extrabold tracking-[-0.02em] text-ink-900 mb-4">
            {t('home.businessExclusive')}
          </h2>
          <p className="text-ink-500 text-[14px] md:text-[16px] max-w-[600px] mx-auto mb-8 leading-relaxed">
            {t('home.businessDesc')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/register"
              className="h-11 inline-flex items-center justify-center bg-ink-900 text-white px-8 rounded-lg text-[14px] font-bold hover:shadow-hover transition-shadow"
            >
              {t('home.registerBusiness')}
            </Link>
            <Link
              to="/login"
              className="h-11 inline-flex items-center justify-center bg-canvas border-[1.5px] border-ink-900 text-ink-900 px-8 rounded-lg text-[14px] font-bold hover:bg-line transition-colors"
            >
              {t('home.memberLogin')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
