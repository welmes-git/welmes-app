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

// ── Source (Japanese) description parsing ─────────────────────────────
// `description_i18n` intentionally never contains a `ja` entry: Japanese is the
// source language and lives in `products.description`. Without the parser below,
// a Japanese UI (and any language lacking a translation) fell back to rendering
// that column as one undifferentiated blob — no section headings at all.
//
// This mirrors parseStoredDescription() in scripts/lib/sd-core.mjs: the backend
// serializes sections as `label\nvalue` blocks joined by blank lines, with the
// overview written without a label.

/** Japanese source labels accepted for each canonical key (mirror of the backend template). */
const JA_LABEL_TO_KEY: Record<string, SectionKey> = {
  商品説明: 'overview',
  '【商品説明】': 'overview',
  商品詳細: 'overview',
  商品情報: 'overview',
  使用方法: 'usage',
  ご使用方法: 'usage',
  お手入れ方法: 'usage',
  使い方: 'usage',
  'ご使用上の注意': 'usage',
  '用法・用量': 'usage',
  'サイズ・容量': 'size',
  サイズ: 'size',
  容量: 'size',
  'サイズ/容量': 'size',
  内容量: 'size',
  '内容量・サイズ': 'size',
  規格: 'spec',
  成分: 'spec',
  '素材・成分': 'spec',
  仕様: 'spec',
  全成分: 'spec',
  原材料: 'spec',
  品質表示: 'spec',
  出荷: 'shipping',
  納期: 'shipping',
  発送: 'shipping',
  出荷目安: 'shipping',
};

const SECTION_ORDER: Record<SectionKey, number> = {
  overview: 1, usage: 2, size: 3, spec: 4, shipping: 5,
};

/**
 * Parse the raw Japanese `description` column into ordered template sections.
 * Same-key blocks are merged (a stored description can contain more than one),
 * and unlabeled trailing blocks are preserved as extras so nothing is dropped.
 * Returns null when the text has no recognizable structure.
 */
export function sourceSections(
  description: string | undefined,
): { key: SectionKey | null; value: string }[] | null {
  const text = String(description || '').trim();
  if (!text) return null;
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const byKey = new Map<SectionKey, string>();
  const extras: { key: null; value: string }[] = [];

  blocks.forEach((block, i) => {
    const lines = block.split('\n');
    const firstLine = lines[0].trim().replace(/\s+/g, '');
    const key = JA_LABEL_TO_KEY[firstLine];
    if (key) {
      const value = lines.slice(1).join('\n').trim();
      if (value) byKey.set(key, byKey.has(key) ? `${byKey.get(key)}\n${value}` : value);
    } else if (i === 0) {
      byKey.set('overview', byKey.has('overview') ? `${byKey.get('overview')}\n${block}` : block);
    } else {
      extras.push({ key: null, value: block });
    }
  });

  const out: { key: SectionKey | null; value: string }[] = [...byKey.entries()]
    .sort((a, b) => SECTION_ORDER[a[0]] - SECTION_ORDER[b[0]])
    .map(([key, value]) => ({ key, value }));
  out.push(...extras);
  return out.length ? out : null;
}

/**
 * Pick the sections to render: a translation for the current language when one
 * exists, otherwise the parsed Japanese source (so the template is visible in
 * every language, including ja itself).
 */
export function displaySections(
  descriptionI18n: Record<string, DescriptionI18n> | undefined,
  language: string,
  description: string | undefined,
): { key: SectionKey | null; value: string }[] | null {
  return localizedSections(descriptionI18n, language) ?? sourceSections(description);
}
