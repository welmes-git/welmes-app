import { useEffect } from 'react';
import type { Product } from '../store/useStore';
import { buildProductSeo, safeJsonLd } from '../lib/productSeo';

export default function ProductSeo({ product }: { product: Product }) {
  useEffect(() => {
    const origin = import.meta.env.VITE_PUBLIC_SITE_URL || window.location.origin;
    const seo = buildProductSeo(product, origin);
    document.title = seo.title;

    const upsertMeta = (selector: string, attrs: Record<string, string>) => {
      let node = document.head.querySelector<HTMLMetaElement>(selector);
      if (!node) {
        node = document.createElement('meta');
        node.dataset.welmesSeo = 'true';
        document.head.appendChild(node);
      }
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    };
    upsertMeta('meta[name="description"]', { name: 'description', content: seo.description });
    upsertMeta('meta[name="robots"]', { name: 'robots', content: seo.robots });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: 'product' });
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: seo.title });
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: seo.description });
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: seo.canonical });
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: seo.image });
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: seo.title });
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: seo.description });
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: seo.image });

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.rel = 'canonical';
      canonical.dataset.welmesSeo = 'true';
      document.head.appendChild(canonical);
    }
    canonical.href = seo.canonical;

    document.head.querySelectorAll('script[data-welmes-jsonld]').forEach((node) => node.remove());
    for (const item of seo.jsonLd) {
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.dataset.welmesJsonld = 'true';
      script.text = safeJsonLd(item);
      document.head.appendChild(script);
    }
  }, [product]);

  return null;
}
