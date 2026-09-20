import { loadPublicProduct, listIndexableProducts } from './catalog.mjs';

function xmlEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
}
function originFor(env) {
  return new URL(env.PUBLIC_SITE_URL || env.VITE_PUBLIC_SITE_URL || 'https://welmes.com').origin;
}
function htmlResponse(body, status = 200, headers = {}) {
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
  return htmlResponse(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Product Not Found | WELMES</title><meta name="robots" content="noindex,nofollow"><link rel="canonical" href="${origin}/products"></head><body><main><h1>Product not found</h1><p>The requested product does not exist.</p><a href="/products">Browse products</a></main></body></html>`, 404, {
    'cache-control': 'public, max-age=0, s-maxage=60',
  });
}
function pageHtml({ app, head, product }) {
  const bootstrap = { ...product };
  delete bootstrap.originalPrice;
  delete bootstrap.wholesalePrice;
  delete bootstrap.setOptions;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">${head}<link rel="stylesheet" href="/assets/app.css"><script>window.__WELMES_SSR_PRODUCT__=${safeJson(bootstrap)}</script><script type="module" src="/assets/app.js"></script></head><body><div id="root">${app}</div></body></html>`;
}

export function createVercelSsrHandler({
  renderProductApp,
  productPathForServer,
  productSeoForServer,
  productSeoHeadForServer,
  loadProduct = loadPublicProduct,
  listProducts = listIndexableProducts,
  env = process.env,
}) {
  return async function handle(request) {
    const requestUrl = new URL(request.url);
    const origin = originFor(env);

    if (requestUrl.pathname === '/robots.txt') {
      return new Response([
        'User-agent: *', 'Allow: /', 'Disallow: /admin', 'Disallow: /account',
        'Disallow: /checkout', 'Disallow: /order/', `Sitemap: ${origin}/sitemap.xml`, '',
      ].join('\n'), {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });
    }

    if (requestUrl.pathname === '/sitemap.xml') {
      try {
        const products = await listProducts({ env });
        const urls = products
          .filter((product) => productSeoForServer(product, origin).indexable)
          .map((product) => {
            const lastmod = product.updatedAt
              ? `<lastmod>${xmlEscape(new Date(product.updatedAt).toISOString())}</lastmod>` : '';
            return `<url><loc>${xmlEscape(`${origin}${productPathForServer(product)}`)}</loc>${lastmod}</url>`;
          });
        return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`, {
          headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' },
        });
      } catch (error) {
        return new Response(`Sitemap unavailable: ${error.message}`, {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '300' },
        });
      }
    }

    const legacy = requestUrl.pathname.match(/^\/product\/(\d+)\/?$/);
    const canonical = requestUrl.pathname.match(/^\/products\/(\d+)(?:\/([^/]+))?\/?$/);
    const match = legacy || canonical;
    if (!match) return notFound(origin);

    let product;
    try {
      product = await loadProduct(Number(match[1]), { env });
    } catch {
      return htmlResponse('<!doctype html><html><head><meta name="robots" content="noindex,nofollow"><title>Service unavailable | WELMES</title></head><body><h1>Service unavailable</h1></body></html>', 503, {
        'cache-control': 'no-store', 'retry-after': '60',
      });
    }
    if (!product) return notFound(origin);

    const canonicalPath = productPathForServer(product);
    if (legacy || requestUrl.pathname.replace(/\/$/, '') !== canonicalPath) {
      return htmlResponse('', 301, {
        location: `${origin}${canonicalPath}`, 'cache-control': 'public, max-age=3600',
      });
    }

    const seo = productSeoForServer(product, origin);
    const app = renderProductApp(product, `${requestUrl.pathname}${requestUrl.search}`);
    return htmlResponse(pageHtml({
      app,
      head: productSeoHeadForServer(product, origin),
      product,
    }), 200, {
      'cache-control': seo.indexable
        ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600'
        : 'private, no-store',
    });
  };
}
