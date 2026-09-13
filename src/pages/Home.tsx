import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { initialProducts } from '../data/products';
import ProductCard from '../components/ProductCard';
import ProductGridSkeleton from '../components/ProductGridSkeleton';
import { ChevronLeft, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { homeHero } from '../config/banners';
import { categoryMenuColumns } from '../config/categoryMenu';
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
  const categoryGroups = categoryMenuColumns.flat();
  const categoryTrack = useRef<HTMLDivElement>(null);
  // One page = 3 tiles + gap; wraps around at either end like Faire's looping carousel
  const pageCategories = (dir: 1 | -1) => {
    const el = categoryTrack.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const atEdge = dir === 1 ? el.scrollLeft >= max - 1 : el.scrollLeft <= 1;
    if (atEdge) el.scrollTo({ left: dir === 1 ? 0 : max, behavior: 'smooth' });
    else el.scrollBy({ left: dir * (el.clientWidth + 16), behavior: 'smooth' });
  };

  // Faire's banner hard-cuts between photos; negative delay puts the left tile half a beat ahead
  const retailerTiles = [
    { images: ['/banners/retailer-drugstore.jpg', '/banners/retailer-select-shop.jpg'], delay: '-1.5s' },
    { images: ['/banners/retailer-salon.jpg', '/banners/retailer-stockroom.jpg'], delay: '0s' },
  ];
  const tilePhotos = ({ images, delay }: (typeof retailerTiles)[number]) => (
    <>
      <img src={images[0]} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      <img src={images[1]} alt="" loading="lazy" className="retailer-flip absolute inset-0 size-full object-cover" style={{ animationDelay: delay }} />
    </>
  );

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

      {/* Brand statement — faire.com "We're Faire" banner, measured at 375/768/1024/1280/1440/1920px.
          Faire breakpoints here are md 768, lg 1024, xl 1440, 2xl 1920. */}
      <section className="flex flex-col items-stretch overflow-hidden bg-[#41252a] px-4 pb-4 pt-[26px] md:p-8 lg:p-12 min-[1920px]:px-20 min-[1920px]:py-12">
        <div className="flex w-full flex-col justify-center gap-4 md:flex-row md:items-center md:gap-0">
          <div className="flex w-full flex-col md:w-1/2">
            <h2 className="font-serif text-[30px] font-normal leading-[38px] text-[#f1f29f] min-[1440px]:text-[38px] min-[1440px]:leading-[50px] min-[1920px]:text-[52px] min-[1920px]:leading-[64px]">
              {t('brandStatement.title')}
            </h2>
            <p className="text-[22px] leading-8 tracking-[0.15px] text-white min-[1440px]:text-[30px] min-[1440px]:leading-[38px]">
              {t('brandStatement.subtitle')}
            </p>
          </div>
          <p className="w-full text-[14px] font-medium leading-5 tracking-[0.15px] text-white md:w-1/2 lg:text-[18px] lg:leading-[26px] min-[1440px]:text-[22px] min-[1440px]:leading-8 min-[1920px]:text-[30px] min-[1920px]:leading-[38px]">
            {t('brandStatement.body')}
          </p>
        </div>
        {/* 16:9 source: square crop shifted right (x 36%) to keep the product group; 3:1 stays centred */}
        <img
          src="/banners/brand-statement.jpg"
          alt=""
          loading="lazy"
          className="mt-8 aspect-square w-full bg-[#6b4e8a] object-cover object-[36%_50%] md:aspect-[3/1] md:object-center"
        />
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

      {/* Retailer range — faire.com "For any retailer" banner, measured at 375/1024/1440/1920px
          (Faire breakpoints md 768, xl 1440, 2xl 1920). Each tile flips between its photos every 1s,
          the two tiles offset by 0.5s (.retailer-flip in index.css). */}
      <section className="flex flex-col gap-4 bg-[#595604] px-4 pb-6 pt-4 md:flex-row md:items-center md:justify-between md:p-8 min-[1440px]:p-12">
        {/* Mobile: two tiles side by side above the copy */}
        <div className="flex justify-between gap-4 md:hidden" aria-hidden="true">
          {retailerTiles.map((tile) => (
            <div key={tile.images[0]} className="relative h-44 min-w-0 flex-1 overflow-hidden bg-[#8a8636]">{tilePhotos(tile)}</div>
          ))}
        </div>
        <div className="hidden md:block relative shrink-0 overflow-hidden bg-[#8a8636] md:size-60 min-[1440px]:size-[437px] min-[1920px]:size-[576px]" aria-hidden="true">
          {tilePhotos(retailerTiles[0])}
        </div>
        <div className="flex w-full flex-col items-start gap-4 md:w-60 md:items-center min-[1440px]:w-[370px] min-[1440px]:gap-6 min-[1920px]:w-[500px]">
          <h2 className="font-serif text-[30px] font-normal leading-[38px] text-white md:mx-auto md:text-center min-[1440px]:text-[38px] min-[1440px]:leading-[50px] min-[1920px]:text-[52px] min-[1920px]:leading-[64px]">
            {t('retailerRange.title')}
          </h2>
          <p className="text-[14px] leading-5 tracking-[0.15px] text-white md:text-center min-[1920px]:text-[18px] min-[1920px]:leading-[26px]">
            {t('retailerRange.body')}
          </p>
          <Link
            to={isAuthenticated ? '/products' : '/register'}
            className="inline-flex h-12 items-center rounded-sm border border-ink-700 bg-white px-[23px] text-[14px] leading-5 tracking-[0.15px] text-ink-700 transition-colors hover:bg-sunken"
          >
            {t(isAuthenticated ? 'homeHero.ctaMember' : 'homeHero.cta')}
          </Link>
        </div>
        <div className="hidden md:block relative shrink-0 overflow-hidden bg-[#8a8636] md:size-60 min-[1440px]:size-[437px] min-[1920px]:size-[576px]" aria-hidden="true">
          {tilePhotos(retailerTiles[1])}
        </div>
      </section>

      {/* Explore categories — faire.com carousel, measured at 375/768/1024/1440/1920px.
          Mobile: stacked 3.75:1 tiles. md+: 3 per view, 1.4:1, arrows centred 32px outside the track
          (clipped by the section like Faire's). Photos live in public/categories/<group key>.jpg. */}
      <section className="relative overflow-hidden px-4 pb-4 pt-8 md:p-8 lg:p-12 min-[1920px]:px-20 min-[1920px]:py-12">
        <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 min-[1440px]:text-[30px] min-[1440px]:leading-[38px] min-[1920px]:text-[38px] min-[1920px]:leading-[50px]">
          {t('home.exploreCategories')}
        </h2>
        <div className="relative mt-6">
          <button
            type="button"
            onClick={() => pageCategories(-1)}
            aria-label="Previous categories"
            className="absolute -left-14 top-1/2 z-10 hidden size-12 -translate-y-1/2 items-center justify-center text-ink-700 md:flex"
          >
            <ChevronLeft size={20} strokeWidth={1.25} />
          </button>
          <div
            ref={categoryTrack}
            className="flex flex-col gap-4 md:snap-x md:snap-mandatory md:flex-row md:overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {categoryGroups.map((group) => (
              <Link
                key={group.key}
                to={group.link}
                className="group relative block shrink-0 snap-start overflow-hidden rounded-sm md:w-[calc((100%-32px)/3)]"
              >
                <img
                  src={`/categories/${group.key}.jpg`}
                  alt=""
                  loading="lazy"
                  // Oral care props sit low in the frame; keep them inside the 3.75:1 mobile crop
                  className={`aspect-[3.75/1] w-full bg-sunken object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.17,0.67,0.24,1)] group-hover:scale-110 md:aspect-[1.4/1] ${group.key === 'oralCare' ? 'object-[50%_68%]' : ''}`}
                />
                <div
                  className="absolute inset-0 z-[1]"
                  style={{ background: 'linear-gradient(22.18deg, rgba(0,0,0,0.5) 1.86%, rgba(0,0,0,0) 31.23%)' }}
                  aria-hidden="true"
                />
                <span className="absolute bottom-0 left-0 z-[2] pb-2 pl-2 text-[14px] leading-5 tracking-[0.15px] text-white md:p-4 md:font-serif md:text-[22px] md:leading-8 md:tracking-normal">
                  {t(`categoryMenu.${group.key}`)}
                </span>
              </Link>
            ))}
          </div>
          <button
            type="button"
            onClick={() => pageCategories(1)}
            aria-label="Next categories"
            className="absolute -right-14 top-1/2 z-10 hidden size-12 -translate-y-1/2 items-center justify-center text-ink-700 md:flex"
          >
            <ChevronRightIcon size={20} strokeWidth={1.25} />
          </button>
        </div>
      </section>

      {/* Brand Showcase */}
      {popularBrands.length > 0 && (
        <section className="page-container py-16">
          <h2 className="font-serif text-[22px] font-normal leading-8 text-ink-700 mb-5">
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
