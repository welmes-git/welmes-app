import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { initialProducts } from '../data/products';
import ProductCard from '../components/ProductCard';
import ProductGridSkeleton from '../components/ProductGridSkeleton';
import { ChevronRight as ChevronRightIcon } from 'lucide-react';
import { homeHero, eventBanners } from '../config/banners';
import { useTranslation } from 'react-i18next';
import { brandsByCount, hasJapanese } from '../lib/utils';


export default function Home() {
  const { t } = useTranslation();
  const { products, productsLoading, isAuthenticated } = useStore();
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

  return (
    <div className="min-h-screen bg-white">
      {/* Hero — measured on faire.com (1440px): full-bleed 1:0.38 media (9:10 on mobile),
          copy bottom-left on mobile and vertically centred 48px in on desktop;
          52/64 title, 22/32 medium subtitle, 20px gaps (8px mobile), 48px white button. */}
      <section className="relative aspect-[9/10] w-full overflow-hidden md:aspect-[1/0.38]">
        <div className="absolute inset-0">
          {homeHero.video ? (
            <video
              aria-hidden="true"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster={homeHero.image}
              className="h-full w-full object-cover"
              style={{ objectPosition: homeHero.focus }}
            >
              <source src={homeHero.video} type="video/mp4" />
            </video>
          ) : (
            <img src={homeHero.image} alt="" className="h-full w-full object-cover" style={{ objectPosition: homeHero.focus }} />
          )}
          {homeHero.scrim > 0 && <div className="absolute inset-0 bg-black" style={{ opacity: homeHero.scrim }} />}
        </div>
        <div className="absolute inset-0 z-10 flex h-full items-end px-4 pb-6 md:items-center md:px-0 md:pb-0 md:pl-12">
          <div className="flex w-full flex-col items-start gap-2 text-left tracking-[0.15px] text-white md:gap-5">
            <h1 className="font-serif text-[30px] font-normal leading-[38px] tracking-normal md:text-[52px] md:leading-[64px]">
              {t('homeHero.title')}
            </h1>
            <p className="text-[14px] font-medium leading-5 md:text-[22px] md:leading-8">
              {t(isAuthenticated ? 'homeHero.subtitleMember' : 'homeHero.subtitle')}
            </p>
            <Link
              to={isAuthenticated ? '/products' : '/register'}
              className="inline-flex h-12 items-center rounded-sm border border-line-control bg-white px-5 text-center text-[14px] leading-5 text-ink-700 transition-colors hover:bg-sunken"
            >
              {t(isAuthenticated ? 'homeHero.ctaMember' : 'homeHero.cta')}
            </Link>
            {!isAuthenticated && (
              <p className="text-[14px] leading-5">
                {t('homeHero.brandQuestion')}{' '}
                <Link to="/support" className="inline-block leading-5 underline [text-underline-offset:25%] hover:brightness-90">
                  {t('homeHero.brandCta')}
                </Link>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Weekly Best Sellers */}
      <section className="page-container py-16">
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700">{t('home.weeklySellers')}</h2>
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
              <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700">{t('home.newArrivals')}</h2>
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
          <h2 className="font-serif text-[30px] font-normal leading-[38px] text-ink-700 mb-5">
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
          <h2 className="font-serif text-[30px] font-normal leading-[38px] text-ink-700 mb-4">
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
