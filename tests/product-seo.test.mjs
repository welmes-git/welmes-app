import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProductSeo,
  escapeHtmlAttribute,
  isProductIndexable,
  renderProductSeoHead,
  safeJsonLd,
} from '../src/lib/productSeo.ts';

const product = {
  id: 167,
  name: 'ビオレ UV アクアリッチ 70g',
  nameEn: 'Biore UV Aqua Rich Watery Essence SPF50+ PA++++ 70g',
  nameEnStatus: 'auto_approved',
  seoSlug: 'biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167',
  seoTitle: 'Biore UV Aqua Rich Watery Essence 70g Wholesale | WELMES',
  seoDescription: 'Biore UV Aqua Rich Watery Essence in a 70g format with SPF50+ and PA++++.',
  searchAliases: [], jan: '4901301413246',
  brand: 'Biore', category: 'Sun Care', subcategory: 'Sunscreen',
  image: '/image.jpg', images: ['/image.jpg'], originalPrice: 1000, wholesalePrice: 700,
  discount: 30, tags: [], rating: 4.8, reviews: 12, description: '', stock: 5,
  status: 'active', setOptions: [],
};

test('approved active product has bounded metadata and one clean canonical', () => {
  const seo = buildProductSeo(product, 'https://shop.example.com/path');
  assert.equal(seo.indexable, true);
  assert.equal(seo.robots, 'index,follow');
  assert.ok(seo.title.length <= 70);
  assert.ok(seo.description.length <= 160);
  assert.equal(seo.canonical, `https://shop.example.com/products/${product.id}/${product.seoSlug}`);
  const head = renderProductSeoHead(seo);
  assert.equal((head.match(/rel="canonical"/g) || []).length, 1);
  assert.match(head, /property="og:title"/);
  assert.match(head, /name="twitter:card"/);
});

test('inactive, review-required, missing-slug and Japanese names are noindex', () => {
  for (const candidate of [
    { ...product, status: 'inactive' },
    { ...product, nameEnStatus: 'review_required' },
    { ...product, seoSlug: undefined },
    { ...product, nameEn: 'ビオレ 70g' },
  ]) {
    assert.equal(isProductIndexable(candidate), false);
    assert.equal(buildProductSeo(candidate, 'https://welmes.example').robots, 'noindex,nofollow');
  }
});

test('Product JSON-LD uses verified GTIN and real ratings but never emits an Offer or price', () => {
  const seo = buildProductSeo(product, 'https://welmes.example');
  const json = JSON.stringify(seo.jsonLd);
  assert.match(json, /"gtin13":"4901301413246"/);
  assert.match(json, /"aggregateRating"/);
  assert.doesNotMatch(json, /"offers"|"price"|700|1000/i);

  const withoutReviews = buildProductSeo({ ...product, reviews: 0, rating: 0 }, 'https://welmes.example');
  assert.doesNotMatch(JSON.stringify(withoutReviews.jsonLd), /aggregateRating/);
});

test('head rendering escapes attributes and JSON-LD script breakers', () => {
  assert.equal(escapeHtmlAttribute('A & "B" <C>'), 'A &amp; &quot;B&quot; &lt;C&gt;');
  assert.doesNotMatch(safeJsonLd({ value: '</script><!--' }), /<\/script>/);
  const seo = buildProductSeo({ ...product, seoTitle: 'A & "B" <C>' }, 'https://welmes.example');
  const head = renderProductSeoHead(seo);
  assert.match(head, /A &amp; &quot;B&quot;/);
  assert.doesNotMatch(head, /<C>|&lt;C&gt;/);
});
