// Canonical product-description section keys, in template order.
// Mirrors DESCRIPTION_SECTION_TEMPLATE in scripts/lib/sd-core.mjs (backend).
// See docs/product-description-i18n-contract.md.

export const SECTION_KEYS = ['overview', 'usage', 'size', 'spec', 'shipping'] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export interface DescriptionExtra {
  label: string;
  value: string;
}

/** Per-language translated sections stored in products.description_i18n[lang]. */
export interface DescriptionI18n {
  overview?: string;
  usage?: string;
  size?: string;
  spec?: string;
  shipping?: string;
  extras?: DescriptionExtra[];
}

/** i18n key for a section's localized label, e.g. productDetail.section.overview */
export function sectionLabelKey(key: SectionKey): string {
  return `productDetail.section.${key}`;
}

/**
 * Given the description_i18n map and the current UI language, return the ordered
 * localized sections to render, or null when no translation exists for that
 * language (caller should fall back to the raw Japanese description).
 */
export function localizedSections(
  descriptionI18n: Record<string, DescriptionI18n> | undefined,
  language: string,
): { key: SectionKey | null; value: string }[] | null {
  const langBlock = descriptionI18n?.[language];
  if (!langBlock) return null;
  const out: { key: SectionKey | null; value: string }[] = [];
  for (const key of SECTION_KEYS) {
    const value = langBlock[key];
    if (value && value.trim()) out.push({ key, value: value.trim() });
  }
  for (const extra of langBlock.extras || []) {
    if (extra?.value?.trim()) out.push({ key: null, value: `${extra.label}\n${extra.value}`.trim() });
  }
  return out.length ? out : null;
}
