import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSsrHandler } from './runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);
const fixture = {
  id: 167,
  name: 'ビオレ UV アクアリッチ ウォータリーエッセンス 70g',
  nameEn: 'Biore UV Aqua Rich Watery Essence SPF50+ PA++++ 70g',
  nameEnStatus: 'auto_approved',
  seoSlug: 'biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167',
  seoTitle: 'Biore UV Aqua Rich Watery Essence 70g Wholesale | WELMES',
  seoDescription: 'Biore UV Aqua Rich Watery Essence in a 70g format with SPF50+ and PA++++.',
  searchAliases: ['Biore Aqua Rich Essence'],
  jan: '4901301413246',
  updatedAt: '2026-09-20T00:00:00.000Z',
  brand: 'Biore', category: 'Sun Care', subcategory: 'Sunscreen',
  image: '/products/product1.jpg', images: ['/products/product1.jpg'],
  originalPrice: 0, wholesalePrice: 0, discount: 0, tags: [], rating: 0, reviews: 0,
  description: 'Japanese sunscreen essence in a 70g format.', stock: 10, status: 'active', setOptions: [],
};
const inactiveFixture = {
  ...fixture,
  id: 168,
  nameEn: 'Biore Pending Product 50ml',
  nameEnStatus: 'review_required',
  seoSlug: 'biore-pending-product-50ml-168',
  status: 'inactive',
};
const handler = createSsrHandler({
  env: { ...process.env, PUBLIC_SITE_URL: process.env.PUBLIC_SITE_URL || `http://127.0.0.1:${port}` },
  loadProduct: async (id) => Number(id) === fixture.id ? fixture : Number(id) === inactiveFixture.id ? inactiveFixture : null,
  listProducts: async () => [fixture],
});

const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/products/product')) {
      const file = path.resolve(root, 'dist/client', `.${url.pathname}`);
      if (!file.startsWith(path.resolve(root, 'dist/client'))) throw new Error('invalid path');
      const data = await fs.readFile(file);
      res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
      return;
    }
    const result = await handler(new Request(url, { method: req.method }));
    res.writeHead(result.status, Object.fromEntries(result.headers));
    res.end(req.method === 'HEAD' ? undefined : Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(error.stack || error.message);
  }
});
server.listen(port, '127.0.0.1', () => console.log(`WELMES SSR preview http://127.0.0.1:${port}`));
