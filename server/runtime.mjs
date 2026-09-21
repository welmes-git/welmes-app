import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPublicProduct, listIndexableProducts } from './catalog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let templatePromise;
let rendererPromise;

// The renderer is the Vite-built SSR bundle, loaded at RUNTIME on purpose.
//
// It must never be inlined by a bundler. Vite's SSR build leaves `react-dom/server`
// as an external ESM import, which Node resolves correctly; but if a bundler
// (esbuild, as used to package Vercel Functions) re-bundles that CJS module into
// ESM, its internal `require('util')` becomes a "Dynamic require of \"util\" is
// not supported" error thrown at module-init time — taking down every SSR route
// with FUNCTION_INVOCATION_FAILED before any handler code runs.
//
// Building the specifier as a runtime value keeps it un-analyzable, so bundlers
// leave the import alone and Node loads the real file from disk (Vercel ships it
// via the `includeFiles: "dist/**"` entry in vercel.json).
//
// `here` moves when this module is bundled into a function, so dist/ is searched
// rather than assumed at a fixed depth.
const DIST_CANDIDATES = [
  path.resolve(here, '../dist'),
  path.resolve(here, './dist'),
  path.resolve(here, '../../dist'),
  path.resolve(process.cwd(), 'dist'),
];

async function distDir() {
  for (const candidate of DIST_CANDIDATES) {
    try {
      await fs.access(path.join(candidate, 'server/entry-server.js'));
      return candidate;
    } catch { /* try the next candidate */ }
  }
  throw new Error(`Built SSR bundle not found. Looked in: ${DIST_CANDIDATES.join(', ')}`);
}

function template() {
  templatePromise ??= distDir().then((dir) => fs.readFile(path.join(dir, 'client/index.html'), 'utf8'));
  return templatePromise;
}
function renderer() {
  rendererPromise ??= distDir().then((dir) => import(pathToFileURL(path.join(dir, 'server/entry-server.js')).href));
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
