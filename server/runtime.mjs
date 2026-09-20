import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPublicProduct, listIndexableProducts } from './catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let templatePromise;
let rendererPromise;

function template() {
  templatePromise ??= fs.readFile(path.resolve(here, '../dist/client/index.html'), 'utf8');
  return templatePromise;
}
function renderer() {
  rendererPromise ??= import('../dist/server/entry-server.js');
  return rendererPromise;
}
function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}
function configuredOrigin(_requestUrl, env) {
  const configured = env.PUBLIC_SITE_URL || env.VITE_PUBLIC_SITE_URL || 'https://welmes.com';
  return new URL(configured).origin;
}
function response(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      ...headers,
    },
  });
}
function notFound(origin) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Product Not Found | WELMES</title><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${origin}/products"></head><body><main><h1>Product not found</h1><p>The requested product does not exist.</p><a href="/products">Browse products</a></main></body></html>`;
  return response(body, 404, { 'cache-control': 'public, max-age=0, s-maxage=60' });
}

export function createSsrHandler({
  loadProduct = loadPublicProduct,
  listProducts = listIndexableProducts,
  env = process.env,
} = {}) {
  return async function handle(request) {
    const requestUrl = new URL(request.url);
    const origin = configuredOrigin(requestUrl, env);

    if (requestUrl.pathname === '/robots.txt') {
      return new Response([
        'User-agent: *',
        'Allow: /',
        'Disallow: /admin',
        'Disallow: /account',
        'Disallow: /checkout',
        'Disallow: /order/',
        `Sitemap: ${origin}/sitemap.xml`,
        '',
      ].join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
    }

    if (requestUrl.pathname === '/sitemap.xml') {
      try {
        const products = await listProducts({ env });
        const { productPathForServer, productSeoForServer } = await renderer();
        const urls = products.filter((product) => productSeoForServer(product, origin).indexable).map((product) => {
          const lastmod = product.updatedAt ? `<lastmod>${xmlEscape(new Date(product.updatedAt).toISOString())}</lastmod>` : '';
          return `<url><loc>${xmlEscape(`${origin}${productPathForServer(product)}`)}</loc>${lastmod}</url>`;
        });
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`;
        return new Response(xml, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' } });
      } catch (error) {
        return new Response(`Sitemap unavailable: ${error.message}`, { status: 503, headers: { 'content-type': 'text/plain', 'retry-after': '300' } });
      }
    }

    const legacy = requestUrl.pathname.match(/^\/product\/(\d+)\/?$/);
    const canonical = requestUrl.pathname.match(/^\/products\/(\d+)(?:\/([^/]+))?\/?$/);
    const match = legacy || canonical;
    if (!match) return notFound(origin);

    let product;
    try {
      product = await loadProduct(Number(match[1]), { env });
    } catch (error) {
      return response('<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>Service unavailable | WELMES</title></head><body><h1>Service unavailable</h1></body></html>', 503, { 'cache-control': 'no-store', 'retry-after': '60' });
    }
    if (!product) return notFound(origin);

    const { renderProductApp, productPathForServer, productSeoForServer, productSeoHeadForServer } = await renderer();
    const canonicalPath = productPathForServer(product);
    if (legacy || requestUrl.pathname.replace(/\/$/, '') !== canonicalPath) {
      return response('', 301, { location: `${origin}${canonicalPath}`, 'cache-control': 'public, max-age=3600' });
    }

    const seo = productSeoForServer(product, origin);
    const app = renderProductApp(product, `${requestUrl.pathname}${requestUrl.search}`);
    let html = await template();
    html = html.replace(/<!--default-head-start-->[\s\S]*?<!--default-head-end-->\s*<!--ssr-head-->/, productSeoHeadForServer(product, origin));
    html = html.replace('<!--ssr-outlet-->', app);
    const bootstrapProduct = { ...product };
    delete bootstrapProduct.originalPrice;
    delete bootstrapProduct.wholesalePrice;
    delete bootstrapProduct.setOptions;
    html = html.replace('</head>', `<script>window.__WELMES_SSR_PRODUCT__=${safeJson(bootstrapProduct)}</script></head>`);
    return response(html, 200, {
      'cache-control': seo.indexable
        ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600'
        : 'private, no-store',
    });
  };
}

export const handleSsrRequest = createSsrHandler();
