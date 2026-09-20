import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeProductImages } from '../scripts/lib/sd-core.mjs';

const MAIN = '13157333';
// 실제 페이지에서 관찰된 CDN 경로 형태
const mainJpg = '//c.superdelivery.com/ip/n/sa/600/600/www.superdelivery.com/product_image/013/157/333/13157333_1000.jpg';
const mainWebp = '//c.superdelivery.com/ip/n/sap/600/600/www.superdelivery.com/product_image/013/157/333/13157333_1000.jpg.webp';
const mainJpg2 = '//c.superdelivery.com/ip/n/sa/600/600/www.superdelivery.com/product_image/013/157/333/13157333_1001.jpg';
// この企業の関連商品 / よく一緒にチェックされている商品 (recommend-img) — 다른 SD ID
const relatedA = '//c.superdelivery.com/ip/n/sa/300/300/www.superdelivery.com/product_image/013/157/332/13157332_s_1000.jpg';
const relatedB = '//c.superdelivery.com/ip/n/sap/300/300/www.superdelivery.com/product_image/013/157/331/13157331_s_1000.jpg.webp';

test('keeps only images whose filename matches this product SD ID', () => {
  const images = normalizeProductImages([mainJpg, relatedA, relatedB], MAIN);
  assert.deepEqual(images, ['https://c.superdelivery.com/ip/n/sa/600/600/www.superdelivery.com/product_image/013/157/333/13157333_1000.jpg']);
});

test('excludes recommended/related-product images (this is the reported bug)', () => {
  const images = normalizeProductImages([relatedA, relatedB], MAIN);
  assert.deepEqual(images, []);
});

test('dedupes webp/jpg and CDN transform-prefix variants, preferring the non-webp original', () => {
  // webp가 먼저 와도 원본 jpg를 최종 보존
  const images = normalizeProductImages([mainWebp, mainJpg], MAIN);
  assert.equal(images.length, 1);
  assert.match(images[0], /13157333_1000\.jpg$/);
  assert.doesNotMatch(images[0], /\.webp/);
});

test('keeps multiple distinct images for the same product', () => {
  const images = normalizeProductImages([mainJpg, mainJpg2, mainWebp], MAIN);
  assert.equal(images.length, 2);
  assert.match(images[0], /13157333_1000\.jpg$/);
  assert.match(images[1], /13157333_1001\.jpg$/);
});

test('preserves document order of images', () => {
  const images = normalizeProductImages([mainJpg2, mainJpg], MAIN);
  assert.match(images[0], /13157333_1001\.jpg$/);
  assert.match(images[1], /13157333_1000\.jpg$/);
});

test('ignores non-product-image URLs (icons, banners, empty strings)', () => {
  const images = normalizeProductImages([
    '//c.superdelivery.com/img/guide/icon_search.svg',
    '',
    'data:image/gif;base64,AAAA',
    mainJpg,
  ], MAIN);
  assert.deepEqual(images, ['https://c.superdelivery.com/ip/n/sa/600/600/www.superdelivery.com/product_image/013/157/333/13157333_1000.jpg']);
});

test('without sdId, still collects product images and dedupes (no ID filter)', () => {
  const images = normalizeProductImages([mainWebp, mainJpg, relatedA], null);
  // ID 필터가 없으면 관련상품도 통과하지만, 중복 제거/정규화는 동작
  assert.equal(images.length, 2);
  assert.match(images[0], /13157333_1000\.jpg$/);
  assert.match(images[1], /13157332_s_1000\.jpg$/);
});
