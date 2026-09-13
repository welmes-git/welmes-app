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
