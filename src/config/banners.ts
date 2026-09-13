/**
 * Home hero (faire.com homepage layout). `video` plays muted on loop with `image` as its poster;
 * phones get the lighter `videoMobile`. The 18s-style sizzle is 5 Flow shots cut in ffmpeg
 * (AI glitches trimmed out). `focus` only moves the crop on mobile, where 9:10 keeps the middle
 * half of the 16:9 frame — the people stand right of centre. `scrim` keeps the white copy readable.
 */
export const homeHero: { image: string; video?: string; videoMobile?: string; focus: string; scrim: number } = {
  image: '/hero/hero-poster.jpg',
  video: '/hero/hero-desktop.mp4',
  videoMobile: '/hero/hero-mobile.mp4',
  focus: '62% 50%',
  scrim: 0.4,
};
