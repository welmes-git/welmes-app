import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const port = 4197;
let child;

test.before(async () => {
  child = spawn(process.execPath, ['server/preview.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), PUBLIC_SITE_URL: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSR preview startup timed out')), 10_000);
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('WELMES SSR preview')) { clearTimeout(timer); resolve(); }
    });
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`SSR preview exited ${code}`)); });
  });
});

test.after(() => child?.kill('SIGTERM'));

const origin = `http://127.0.0.1:${port}`;
const slug = 'biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167';

test('canonical product URL returns complete server HTML without private price fields', async () => {
  const response = await fetch(`${origin}/products/167/${slug}`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1[^>]*>/);
  assert.match(html, /Biore UV Aqua Rich Watery Essence/);
  assert.match(html, /<title>Biore UV Aqua Rich/);
  assert.match(html, new RegExp(`<link rel="canonical" href="${origin}/products/167/${slug}">`));
  assert.match(html, /property="og:title"/);
  assert.match(html, /type="application\/ld\+json"/);
  assert.match(html, /Biore UV Aqua Rich Watery Essence in a 70g format/);
  assert.doesNotMatch(html, /wholesalePrice|originalPrice|setOptions|"offers"|"price"/i);
});

test('legacy and incorrect slug routes return permanent canonical redirects', async () => {
  for (const url of [`${origin}/product/167`, `${origin}/products/167/wrong`]) {
    const response = await fetch(url, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), `${origin}/products/167/${slug}`);
  }
});

test('unknown product returns a real HTTP 404 with noindex', async () => {
  const response = await fetch(`${origin}/products/999/missing`, { redirect: 'manual' });
  assert.equal(response.status, 404);
  assert.match(await response.text(), /noindex,nofollow/);
});


test('inactive review-required product is rendered noindex and excluded from sitemap', async () => {
  const response = await fetch(`${origin}/products/168/biore-pending-product-50ml-168`);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  const sitemap = await (await fetch(`${origin}/sitemap.xml`)).text();
  assert.doesNotMatch(sitemap, /products\/168/);
});
test('sitemap and robots expose only canonical crawl routes', async () => {
  const sitemap = await fetch(`${origin}/sitemap.xml`);
  assert.equal(sitemap.status, 200);
  const xml = await sitemap.text();
  assert.match(xml, new RegExp(`${origin}/products/167/${slug}`));
  assert.doesNotMatch(xml, /\/product\/167/);

  const robots = await fetch(`${origin}/robots.txt`);
  assert.equal(robots.status, 200);
  const text = await robots.text();
  assert.match(text, /Disallow: \/admin/);
  assert.match(text, new RegExp(`Sitemap: ${origin}/sitemap.xml`));
});
