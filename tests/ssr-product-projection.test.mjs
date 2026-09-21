import test from 'node:test';
import assert from 'node:assert/strict';
import { publicRowToProduct } from '../server/catalog.mjs';

// Regression coverage for a production incident: enabling SSR made every product
// page show untranslated Japanese and "no set options", because the page kept
// using the SSR payload instead of the data the client later fetched.

test('the SSR projection carries the i18n columns', () => {
  const product = publicRowToProduct({
    id: 222,
    name: '【指定医薬部外品】 ビオレガード 薬用消毒スプレーアルファ 本体 350 ml',
    name_en: '【指定医薬部外品】 ビオレガード 薬用消毒スプレーアルファ 本体 350 ml',
    name_i18n: { en: 'Biore Guard Medicated Disinfectant Spray Alpha 350 ml', ko: '비오레가드 …', zh: '碧柔Guard …' },
    description: '【商品説明】…',
    description_i18n: { en: { overview: 'By washing …' }, ko: { overview: '…' } },
    status: 'active',
  });
  // Without these, server-rendered HTML — what crawlers index — is raw Japanese.
  assert.deepEqual(Object.keys(product.nameI18n).sort(), ['en', 'ko', 'zh']);
  assert.equal(product.nameI18n.en, 'Biore Guard Medicated Disinfectant Spray Alpha 350 ml');
  assert.deepEqual(Object.keys(product.descriptionI18n).sort(), ['en', 'ko']);
});

test('the SSR projection still withholds prices and set options', () => {
  const product = publicRowToProduct({ id: 1, name: 'x', status: 'active' });
  // These must never reach an unauthenticated page.
  assert.equal(product.originalPrice, 0);
  assert.equal(product.wholesalePrice, 0);
  assert.deepEqual(product.setOptions, []);
});

test('missing i18n columns degrade to undefined rather than throwing', () => {
  const product = publicRowToProduct({ id: 2, name: 'ビオレ', status: 'active' });
  assert.equal(product.nameI18n, undefined);
  assert.equal(product.descriptionI18n, undefined);
  assert.equal(product.nameEn, 'ビオレ'); // falls back to the Japanese name
});

// Mirrors the selection ProductDetail performs. The SSR product is a placeholder
// that must lose to the fetched product, which alone carries set options/prices.
function selectProduct({ storeProducts, ssrProduct, productId }) {
  const fetched = storeProducts.find((p) => p.id === productId);
  const placeholder = ssrProduct && ssrProduct.id === productId ? ssrProduct : undefined;
  return fetched ?? placeholder;
}

test('the fetched product wins over the SSR placeholder once it arrives', () => {
  const ssrProduct = { id: 222, name: 'ja', setOptions: [], wholesalePrice: 0 };
  const fetched = { id: 222, name: 'ja', setOptions: [{ id: 'S1', unitsPerSet: 18 }], wholesalePrice: 16200 };

  // before the fetch: placeholder prevents a "not found" flash
  assert.equal(selectProduct({ storeProducts: [], ssrProduct, productId: 222 }), ssrProduct);

  // after the fetch: the real product must win, or set options stay empty forever
  const chosen = selectProduct({ storeProducts: [fetched], ssrProduct, productId: 222 });
  assert.equal(chosen, fetched);
  assert.equal(chosen.setOptions.length, 1);
  assert.equal(chosen.wholesalePrice, 16200);
});

test('an unrelated SSR product never substitutes for the requested one', () => {
  const ssrProduct = { id: 999, name: 'other' };
  assert.equal(selectProduct({ storeProducts: [], ssrProduct, productId: 222 }), undefined);
});
