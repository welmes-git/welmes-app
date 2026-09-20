/**
 * Canonical product URL helpers (Task 9).
 *
 * Canonical path is `/products/{id}/{stable-slug}`. The slug is generated once
 * at first approval and stored on the product; it must not silently change when
 * the title is later edited, so URLs stay constant. When a product has no stored
 * slug yet we derive a display slug from the current English name — the id is
 * always the authoritative lookup key, so a slug mismatch just triggers a
 * canonical redirect, never a 404.
 */
import type { Product } from '../store/useStore';
import { slugifyProductName } from './nameReview.ts';

/** Best-effort slug: prefer the stored stable slug, else derive from the name. */
export function productSlug(product: Pick<Product, 'id' | 'seoSlug' | 'nameEn' | 'name'>): string {
  if (product.seoSlug) return product.seoSlug;
  const base = product.nameEn || product.name || '';
  return slugifyProductName(base, product.id);
}

/** Canonical path used by every internal link and the SSR canonical tag. */
export function productPath(product: Pick<Product, 'id' | 'seoSlug' | 'nameEn' | 'name'>): string {
  return `/products/${product.id}/${productSlug(product)}`;
}
