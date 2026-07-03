export interface HeroBanner {
  image: string;
  link: string;
  /** i18n key prefix under `banners.` — omit when the text is baked into the image */
  textKey?: string;
  /** which side the overlay text sits on (desktop) */
  textSide?: 'left' | 'right';
  /** CSS object-position keeping the photo's subject visible when sides are cropped on mobile */
  focus?: string;
}

export const heroBanners: HeroBanner[] = [
  {
    image: '/banners/banner5.jpg',
    link: '/products',
  },
  {
    image: '/banners/banner1.jpg',
    link: '/products',
    textKey: 'b1',
    textSide: 'left',
    focus: '30% center',
  },
  {
    image: '/banners/banner2.jpg',
    link: '/register',
    textKey: 'b2',
    textSide: 'right',
    focus: '70% center',
  },
];

export const eventBanners = [
  {
    image: '/banners/event1.jpg',
    title: 'Spring Skincare Special',
    subtitle: '봄 스킨케어 특별전',
    link: '/products',
  },
  {
    image: '/banners/event2.jpg',
    title: 'Trending Colors 2025',
    subtitle: '트렌딩 컬러 2025',
    link: '/products',
  },
];
