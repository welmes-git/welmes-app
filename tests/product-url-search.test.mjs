import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, normalizeSearch, searchableText } from '../src/lib/productSearch.ts';
import { productSlug, productPath } from '../src/lib/productUrl.ts';

const product = {
  id: 167,
  nameEn: 'Biore UV Aqua Rich Watery Essence SPF50+ PA++++ 70g',
  name: 'ビオレ UV アクアリッチ ウォータリーエッセンス 70g',
  brand: 'Biore',
  category: 'Sun Care',
  subcategory: 'Sunscreen',
  tags: ['Sale'],
  searchAliases: ['Biore Aqua Rich Essence', 'Bioré UV'],
  description: 'Japanese sunscreen essence SPF50+ PA++++ for wholesale buyers.',
  seoSlug: 'biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167',
};

// ── search ─────────────────────────────────────────────────────────────
test('search is case-insensitive', () => {
  assert.equal(matchesSearch(product, 'BIORE'), true);
  assert.equal(matchesSearch(product, 'biore'), true);
});

test('search is hyphen/underscore insensitive', () => {
  assert.equal(matchesSearch(product, 'aqua-rich'), true);
  assert.equal(matchesSearch(product, 'aqua_rich'), true);
  assert.equal(matchesSearch(product, 'aqua rich'), true);
});

test('search matches aliases (synonyms) and brand and product type', () => {
  assert.equal(matchesSearch(product, 'aqua rich essence'), true); // alias
  assert.equal(matchesSearch(product, 'sun care'), true);          // category / product type
  assert.equal(matchesSearch(product, 'sunscreen'), true);         // subcategory
  assert.equal(matchesSearch(product, 'biore'), true);             // brand
});

test('multi-token queries are AND-matched', () => {
  assert.equal(matchesSearch(product, 'biore essence'), true);
  assert.equal(matchesSearch(product, 'biore toothpaste'), false);
});

test('empty query matches everything', () => {
  assert.equal(matchesSearch(product, ''), true);
  assert.equal(matchesSearch(product, '   '), true);
});

test('searchable text includes every indexed field', () => {
  const text = searchableText(product);
  for (const token of ['biore', 'sun care', 'sunscreen', 'aqua rich essence', 'sale']) {
    assert.ok(text.includes(token), token);
  }
});

// The admin product list search routes through matchesSearch (same normalizer
// as the storefront), so admin queries fold accents and match the Japanese
// original name and brand fields too.
test('admin search matches the Japanese original name field', () => {
  assert.equal(matchesSearch(product, 'ウォータリーエッセンス'), true); // katakana from `name`
  assert.equal(matchesSearch(product, 'アクアリッチ'), true);
});

test('admin search folds accents against the brand field', () => {
  assert.equal(matchesSearch(product, 'Bioré'), true); // accented query vs "Biore" brand
});

test('normalizeSearch collapses punctuation spacing', () => {
  assert.equal(normalizeSearch('  Aqua-Rich   Essence '), 'aqua rich essence');
});

test('normalizeSearch strips accents (NFKD + combining marks)', () => {
  assert.equal(normalizeSearch('Bioré Café'), 'biore cafe');
  assert.equal(normalizeSearch('Pokémon Naïve Résumé'), 'pokemon naive resume');
});

test('normalizeSearch folds full-width / compatibility forms to ASCII', () => {
  assert.equal(normalizeSearch('ＡＱＵＡ　Ｒｉｃｈ'), 'aqua rich'); // full-width + ideographic space
});

test('normalizeSearch treats general punctuation as separators', () => {
  assert.equal(normalizeSearch('SPF50+ PA++++'), 'spf50 pa');
  assert.equal(normalizeSearch('Aqua/Rich, (Essence)!'), 'aqua rich essence');
  assert.equal(normalizeSearch('aqua_rich·essence'), 'aqua rich essence');
});

test('accented queries match unaccented product text and vice-versa', () => {
  assert.equal(matchesSearch(product, 'bioré'), true);   // accented query
  assert.equal(matchesSearch(product, 'BIORÉ UV'), true); // accented alias "Bioré UV"
});

// ── clean URL ────────────────────────────────────────────────────────────
test('productSlug prefers the stored stable slug', () => {
  assert.equal(productSlug(product), 'biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167');
});

test('productSlug derives from the name when no stored slug exists', () => {
  const noSlug = { ...product, seoSlug: undefined };
  assert.equal(productSlug(noSlug), 'biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167');
});

test('productPath builds the canonical /products/{id}/{slug} path', () => {
  assert.equal(productPath(product), '/products/167/biore-uv-aqua-rich-watery-essence-spf50-pa-70g-167');
});

test('stored slug is stable even if the display name changes', () => {
  // Editing the English name must NOT change the stored slug (URL stability).
  const renamed = { ...product, nameEn: 'Completely Different Name' };
  assert.equal(productSlug(renamed), product.seoSlug); // unchanged
});
