/**
 * Home hero (faire.com homepage layout). Drop a video into public/banners and set
 * `video` — the image stays as the poster while it loads and as the fallback.
 * `scrim` darkens the media so the white copy stays readable (AA needs ~50% on
 * our bright stills); lower it or set 0 once a darker video is in place.
 */
export const homeHero: { image: string; video?: string; focus: string; scrim: number } = {
  image: '/banners/banner2.jpg',
  video: undefined,
  focus: '30% 50%',
  scrim: 0.5,
};

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
