import type { Product } from '../store/useStore';
import { productPath } from './productUrl.ts';

const JAPANESE_RE = /[\u3040-\u30ff\u3400-\u9fff]/u;
const APPROVED = new Set(['auto_approved', 'human_approved']);

export interface ProductSeoContract {
  title: string;
  description: string;
  canonical: string;
  robots: 'index,follow' | 'noindex,nofollow';
  indexable: boolean;
  image: string;
  imageAlt: string;
  jsonLd: Record<string, unknown>[];
}

function plainText(value = ''): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function trimAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const sliced = value.slice(0, max + 1);
  const cut = sliced.lastIndexOf(' ');
  return `${sliced.slice(0, cut > max * 0.6 ? cut : max).replace(/[\s,;:-]+$/, '')}…`;
}

export function normalizeSiteOrigin(value = ''): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
    return url.origin;
  } catch {
    return 'https://welmes.com';
  }
}

export function isProductIndexable(product: Pick<Product, 'status' | 'nameEnStatus' | 'nameEn' | 'seoSlug'>): boolean {
  return product.status === 'active'
    && APPROVED.has(product.nameEnStatus ?? '')
    && Boolean(product.seoSlug)
    && Boolean(product.nameEn)
    && !JAPANESE_RE.test(product.nameEn);
}

function gtinProperty(jan?: string): Record<string, string> {
  if (!jan || !/^\d{8,14}$/.test(jan)) return {};
  const key = `gtin${jan.length}`;
  if (!['gtin8', 'gtin12', 'gtin13', 'gtin14'].includes(key)) return {};
  return { [key]: jan };
}

export function buildProductSeo(product: Product, siteOrigin: string): ProductSeoContract {
  const origin = normalizeSiteOrigin(siteOrigin);
  const canonical = `${origin}${productPath(product)}`;
  const fallbackDescription = `${product.nameEn} by ${product.brand}. ${product.category} product supplied by WELMES for verified wholesale buyers.`;
  const description = trimAtWord(plainText(product.seoDescription || fallbackDescription), 160);
  const rawTitle = plainText(product.seoTitle || `${product.nameEn} Wholesale | WELMES`);
  const title = trimAtWord(rawTitle, 70);
  const image = product.image ? new URL(product.image, origin).href : `${origin}/welmes-product.png`;
  const indexable = isProductIndexable(product) && Boolean(description) && !JAPANESE_RE.test(description);

  const productLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.nameEn,
    description,
    image: (product.images?.length ? product.images : [image]).map((value) => new URL(value, origin).href),
    sku: String(product.id),
    brand: { '@type': 'Brand', name: product.brand },
    category: product.subcategory || product.category,
    url: canonical,
    ...gtinProperty(product.jan),
  };
  if (product.reviews > 0 && product.rating > 0 && product.rating <= 5) {
    productLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      reviewCount: product.reviews,
      bestRating: 5,
      worstRating: 1,
    };
  }

  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: origin },
      { '@type': 'ListItem', position: 2, name: product.category, item: `${origin}/products?category=${encodeURIComponent(product.category)}` },
      { '@type': 'ListItem', position: 3, name: product.nameEn, item: canonical },
    ],
  };
  const organizationLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'WELMES',
    url: origin,
  };

  return {
    title,
    description,
    canonical,
    robots: indexable ? 'index,follow' : 'noindex,nofollow',
    indexable,
    image,
    imageAlt: `${product.nameEn} wholesale product image`,
    jsonLd: [productLd, breadcrumbLd, organizationLd],
  };
}

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}

export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderProductSeoHead(seo: ProductSeoContract): string {
  const esc = escapeHtmlAttribute;
  return [
    `<title>${esc(seo.title)}</title>`,
    `<meta name="description" content="${esc(seo.description)}">`,
    `<meta name="robots" content="${seo.robots}">`,
    `<link rel="canonical" href="${esc(seo.canonical)}">`,
    `<meta property="og:type" content="product">`,
    `<meta property="og:site_name" content="WELMES">`,
    `<meta property="og:title" content="${esc(seo.title)}">`,
    `<meta property="og:description" content="${esc(seo.description)}">`,
    `<meta property="og:url" content="${esc(seo.canonical)}">`,
    `<meta property="og:image" content="${esc(seo.image)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(seo.title)}">`,
    `<meta name="twitter:description" content="${esc(seo.description)}">`,
    `<meta name="twitter:image" content="${esc(seo.image)}">`,
    ...seo.jsonLd.map((item) => `<script type="application/ld+json" data-welmes-jsonld="true">${safeJsonLd(item)}</script>`),
  ].join('\n');
}
