import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Marketing badges we're willing to render. Anything else in `tags` — scraped
 *  genres, JAN codes, source names — is data, not a badge. */
export const BADGE_TAGS = ['New', 'Best', 'Sale', 'Hot'];

/** Kana or CJK ideographs — these need the JP face, not Pretendard's Korean kanji. */
export const hasJapanese = (s: string) => /[぀-ヿ一-龯]/.test(s);

/** "¥1,234" -> "¥" + "X,XXX" so the blurred placeholder keeps the real width. */
export const maskDigits = (formatted: string, symbol: string) =>
  formatted.slice(symbol.length).replace(/\d/g, 'X');

/** Brands that actually exist in a catalogue, most products first. */
export const brandsByCount = (products: { brand: string }[]) => {
  const counts = new Map<string, number>();
  products.forEach((p) => p.brand && counts.set(p.brand, (counts.get(p.brand) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};
