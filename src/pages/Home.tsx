import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { initialProducts } from '../data/products';
import ProductCard from '../components/ProductCard';
import { ChevronLeft, ChevronRight, ChevronRight as ChevronRightIcon } from 'lucide-react';
import { heroBanners as banners, eventBanners } from '../config/banners';
import { useTranslation } from 'react-i18next';

const brandLogos = [
  { name: 'COSRX', color: '#333' },
  { name: 'Innisfree', color: '#2e7d32' },
  { name: 'Etude', color: '#f48fb1' },
  { name: 'Laneige', color: '#4a90e2' },
  { name: 'Peripera', color: '#ff6b6b' },
  { name: 'Mediheal', color: '#00bcd4' },
  { name: 'Some By Mi', color: '#4caf50' },
  { name: 'Dr.G', color: '#e53935' },
  { name: 'Beauty of Joseon', color: '#8d6e63' },
  { name: 'Anua', color: '#66bb6a' },
];

export default function Home() {
  const { t } = useTranslation();
  const { products } = useStore();
  const [currentBanner, setCurrentBanner] = useState(0);
  const allProducts = products.length > 0 ? products : initialProducts;

  // Weekly best = most reviewed; New arrivals = highest id (newest first).
  // Previously New Arrivals was `slice(4, 12)`, which rendered an empty section
  // whenever the catalogue held 5 products or fewer.
  const weeklyBest = [...allProducts].sort((a, b) => b.reviews - a.reviews).slice(0, 8);
  const newArrivals = [...allProducts].sort((a, b) => b.id - a.id).slice(0, 8);

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
                    <p className="text-[10px] md:text-[13px] font-semibold tracking-[2.5px] uppercase text-[#4a90e2] mb-2 md:mb-3">
                      {t(`banners.${banner.textKey}Eyebrow`)}
                    </p>
                    <h2 className="text-[26px] md:text-[46px] font-extrabold leading-[1.08] text-[#26221c] whitespace-pre-line">
                      {t(`banners.${banner.textKey}Title`)}
                    </h2>
                    <p className="text-[12px] md:text-[15px] text-[#6b665e] mt-2 md:mt-3 leading-relaxed">
                      {t(`banners.${banner.textKey}Subtitle`)}
                    </p>
                    <span className="inline-flex items-center gap-2 mt-3 md:mt-5 bg-[#2f2b26] text-white text-[12px] md:text-[14px] font-semibold px-4 py-2 md:px-6 md:py-3 rounded-lg">
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
          className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 rounded-full flex items-center justify-center shadow-md hover:bg-white transition-colors z-10"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          onClick={nextBanner}
          className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/80 rounded-full flex items-center justify-center shadow-md hover:bg-white transition-colors z-10"
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
                index === currentBanner ? 'bg-[#333]' : 'bg-white/60'
              }`}
            />
          ))}
        </div>
      </section>

      {/* Weekly Best Sellers */}
      <section className="max-w-[1100px] mx-auto px-4 py-16">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-[22px] font-bold text-[#333]">{t('home.weeklySellers')}</h2>
          <Link
            to="/products?sort=popular"
            className="flex items-center gap-1 text-[13px] text-[#999] hover:text-[#ff4d6d] transition-colors"
          >
            {t('common.viewAll')}
            <ChevronRightIcon size={14} />
          </Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {weeklyBest.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      </section>

      {/* Event Banners */}
      <section className="max-w-[1100px] mx-auto px-4 pb-16">
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
      {newArrivals.length > 0 && (
        <section className="bg-[#f8f8fa] py-16">
          <div className="max-w-[1100px] mx-auto px-4">
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-[22px] font-bold text-[#333]">{t('home.newArrivals')}</h2>
              <Link
                to="/products?sort=newest"
                className="flex items-center gap-1 text-[13px] text-[#999] hover:text-[#ff4d6d] transition-colors"
              >
                {t('common.viewAll')}
                <ChevronRightIcon size={14} />
              </Link>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
              {newArrivals.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Brand Showcase */}
      <section className="max-w-[1100px] mx-auto px-4 py-16">
        <h2 className="text-[22px] font-bold text-[#333] mb-8 text-center">
          {t('home.popularBrands')}
        </h2>
        <div className="flex flex-wrap justify-center gap-6 md:gap-10">
          {brandLogos.map((brand) => (
            <Link
              key={brand.name}
              to={`/products?brand=${brand.name}`}
              className="group flex flex-col items-center"
            >
              <div
                className="w-[70px] h-[70px] md:w-[80px] md:h-[80px] rounded-full flex items-center justify-center text-white text-[11px] md:text-[12px] font-bold shadow-md transition-transform group-hover:scale-110"
                style={{ backgroundColor: brand.color }}
              >
                {brand.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="mt-2 text-[12px] text-[#666] group-hover:text-[#ff4d6d] transition-colors">
                {brand.name}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* B2B Info Section */}
      <section className="bg-[#2c3e50] py-16">
        <div className="max-w-[1100px] mx-auto px-4 text-center">
          <h2 className="text-[24px] md:text-[28px] font-bold text-white mb-4">
            {t('home.businessExclusive')}
          </h2>
          <p className="text-[#bdc3c7] text-[14px] md:text-[16px] max-w-[600px] mx-auto mb-8 leading-relaxed">
            {t('home.businessDesc')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/register"
              className="bg-[#4a90e2] text-white px-8 py-3 rounded-lg text-[14px] font-semibold hover:bg-[#357abd] transition-colors"
            >
              {t('home.registerBusiness')}
            </Link>
            <Link
              to="/login"
              className="bg-transparent border border-white/30 text-white px-8 py-3 rounded-lg text-[14px] font-semibold hover:bg-white/10 transition-colors"
            >
              {t('home.memberLogin')}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
