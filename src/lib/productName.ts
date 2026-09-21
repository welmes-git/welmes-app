// WELMES — Per-language product name selection.
//
// products.name holds the Japanese supplier name and products.name_en is only
// populated by the grounded naming pipeline, which gates nearly every row behind
// review. The storefront therefore showed raw Japanese to every customer — and
// 68% of the characters in these names are katakana/hiragana, unreadable to
// Chinese and Korean buyers.
//
// name_i18n carries the readable per-language name. Japanese is never stored
// there (it is the source), so a Japanese UI falls through to `name`.

/** Per-language names stored in products.name_i18n, keyed by language code. */
export type NameI18n = Record<string, string>;

/**
 * Pick the name to display.
 *
 * Order: translation for the active language → English translation (a usable
 * fallback for any unsupported locale) → curated name_en → Japanese source.
 * `name_en` is skipped when it is merely a copy of the Japanese name, which is
 * the current state for 227 of 229 products.
 */
export function localizedName(
  product: { name: string; nameEn?: string; nameI18n?: NameI18n },
  language: string,
): string {
  const i18n = product.nameI18n || {};
  const exact = i18n[language];
  if (exact && exact.trim()) return exact.trim();

  // Japanese UI wants the original, not an English stand-in.
  if (language !== 'ja') {
    const english = i18n.en;
    if (english && english.trim()) return english.trim();
  }

  const nameEn = (product.nameEn || '').trim();
  if (nameEn && nameEn !== (product.name || '').trim()) return nameEn;
  return product.name;
}
