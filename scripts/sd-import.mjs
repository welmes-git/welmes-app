#!/usr/bin/env node
/**
 * Superdelivery(スーパーデリバリー) → WELMES 상품 자동 등록 스크립트
 *
 * 사용법:
 *   npm run import:sd -- <상품URL>                # 상품 1개 등록 (/p/r/pd_p/…)
 *   npm run import:sd -- <목록URL>                # 그 페이지의 상품 전부 등록
 *   npm run import:sd -- <목록URL> --all         # 페이지네이션 따라가며 일괄 등록
 *   옵션: --pages=N (기본 5), --limit=N (기본 300), --active (inactive 대신 active 등록)
 *
 * 필수 .env.local (git 제외): SD_EMAIL, SD_PASSWORD, WELMES_ADMIN_EMAIL, WELMES_ADMIN_PASSWORD
 * 필수 .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * 사전 준비: supabase/migrations/20260912_sd_source.sql 를 Supabase SQL Editor에서 1회 실행
 *
 * 로그인은 Cloudflare Turnstile CAPTCHA 때문에 실제 브라우저(headful)로 자동 처리하고
 * 세션은 scripts/.sd-session.json 에 저장 · 재사용. 세션이 살아있으면 창 없이(headless) 동작.
 * 가격 규칙: WELMES 판매가 = 슈퍼딜리버리 卸単価 × MARGIN, 등록 상태는 기본 inactive(관리자 검토 후 활성화).
 */
import fs from 'node:fs';

// dynamic import: 이 환경에서 node_modules 로딩이 수십 초 걸릴 수 있어 시작 배너를 먼저 찍는다
console.log('🚀 슈퍼딜리버리 → WELMES 상품 등록 시작 (모듈 로딩 중, 잠시만 기다려주세요)...');
const { chromium } = await import('playwright');
const { createClient } = await import('@supabase/supabase-js');

// ── 설정 ─────────────────────────────────────────────────────────────
const MARGIN = 1.2;             // 卸単価 × 1.2 → WELMES 회원 판매가(wholesale)
const ORIGINAL_FALLBACK = 1.5;  // 参考上代(정가)가 오픈프라이스일 때: 単価 × 1.5
const DEFAULT_STOCK = 50;       // 재고 표기가 '有り'일 때의 기본값
const DELAY_MS = 700;           // 페이지 간 예의 지연
const SESSION_FILE = 'scripts/.sd-session.json';

// .env.local(비밀번호, git 제외) → .env(공개 VITE_ 값) 순으로 로드. 먼저 읽힌 값이 우선
for (const file of ['.env.local', '.env']) {
  if (!fs.existsSync(file)) continue;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// ── CLI 인자 ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const urlArg = args.find(a => !a.startsWith('--'));
const opt = (name, def) => { const m = args.find(a => a.startsWith(`--${name}=`)); return m ? m.split('=')[1] : def; };
const FOLLOW_ALL = args.includes('--all');
const MAX_PAGES = Number(opt('pages', 5));
const MAX_PRODUCTS = Number(opt('limit', 300));
const IMPORT_ACTIVE = args.includes('--active');
if (!urlArg) { console.error('사용법: npm run import:sd -- <상품 또는 목록 URL> [--all] [--pages=N] [--limit=N]'); process.exit(1); }

// ── 카테고리 매핑 (슈퍼딜리버리 ジャンル → WELMES category) ────────────
const CATEGORY_RULES = [
  ['Makeup',      /メイク|口紅|アイシャドウ|ファンデ|化粧品|ネイル|マスカラ/],
  ['Fragrance',   /香水|フレグランス/],
  ['Body/Hair',   /シャンプー|ボディ|入浴|石鹸|せっけん|リンス|トリートメント|歯磨き|口腔|ハンドクリーム/],
  ['Beauty Tools', /美容機器|ドライヤー|ブラシ|マッサージ|シェーバー/],
  ['Skincare',    /化粧水|乳液|美容液|クリーム|スキンケア|洗顔|パック|フェイスマスク|日焼け|UV|クレンジング/],
  ['Health Food', /サプリ|健康食品|食品|菓子|飲料|酒|コーヒー|茶|フード/],
];
const mapCategory = (genreText) => {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(genreText)) return cat;
  return 'Health Food'; // 폼은 서플리먼트 특화 — 기본값
};

// ── Playwright 세션 ──────────────────────────────────────────────────
const BASE = 'https://www.superdelivery.com';

/** Turnstile 자동 로그인. 세션 만료 시에만 호출 — headful 창이 뜬다. */
async function loginHeadful() {
  console.log('🔑 세션 만료 — 로그인 브라우저를 띄웁니다 (Turnstile 자동 처리, 최대 90초)...');
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/p/do/clickMemberLogin`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[name="identification"]', process.env.SD_EMAIL);
  await page.fill('input[name="password"]', process.env.SD_PASSWORD);
  await page.click('.turnstile-form input[type="submit"]');
  // turnstile_manager.js: 검증 완료 or 최대 10초 후 자동 제출. 간혹 체크박스가 뜨면 클릭 시도.
  try {
    await page.waitForURL(u => !String(u).includes('clickMemberLogin') && !String(u).includes('login.do'), { timeout: 90_000 });
  } catch {
    try { await page.frameLocator('.cf-turnstile iframe').locator('body').click({ timeout: 5_000 }); } catch {}
    await page.waitForURL(u => !String(u).includes('clickMemberLogin') && !String(u).includes('login.do'), { timeout: 30_000 });
  }
  if (String(page.url()).includes('login')) throw new Error('로그인 실패 — 아이디/비밀번호 또는 Turnstile 확인 필요');
  await ctx.storageState({ path: SESSION_FILE });
  console.log('✅ 로그인 성공, 세션 저장');
  await browser.close();
}

/** 저장된 세션으로 headless 컨텍스트. 유효하지 않으면 재로그인 후 재생성. */
async function getScraperContext() {
  if (!fs.existsSync(SESSION_FILE)) await loginHeadful();
  let ctx = await chromium.launch({ headless: true }).then(b => b.newContext({ storageState: SESSION_FILE }));
  return { browser: ctx.browser(), ctx };
}

const isLoggedInPage = (page) =>
  page.locator('.com-name, #header-nav .nav-history').first().isVisible().catch(() => false);

// ── 상품 페이지 파싱 ─────────────────────────────────────────────────
async function extractProduct(page, productUrl) {
  const sdId = productUrl.match(/pd_p\/(\d+)/)?.[1] ?? null;
  const data = await page.evaluate(() => {
    const clean = (s) => s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();

    // 상품명(h1) — 'NEW' 배지 등 잡문자 제거
    const h1 = document.querySelector('h1')?.innerText ?? '';
    const name = clean(h1.replace(/^\s*NEW\s*/i, '')).split('\n')[0].trim();

    // 세트 표 — tr이 레이아웃 조각으로 쪼개져 있어, 표 전체를 줄 단위로 읽어
    // 'S번호' 줄 마커 기준으로 세트별 텍스트 블록을 재조립한다
    const tableEl = document.querySelector('table.set-list');
    const setBlocks = [];
    if (tableEl) {
      for (const raw of tableEl.innerText.split('\n')) {
        const t = raw.trim();
        if (!t) continue;
        const m = t.match(/^(S\d+)(?![0-9])(.*)$/);
        if (m) setBlocks.push((m[1] + ' ' + m[2].trim()).trim());
        else if (setBlocks.length) setBlocks[setBlocks.length - 1] += ' ' + t;
      }
    }

    // 브랜드·장르 — .brand-genre 블록 안 링크만 사용 (헤더 메가메뉴 오염 방지).
    // 브랜드 있으면 word= 링크, 없으면 출시기업 breadcrumb(「…（すべてのジャンル）」> 장르들)
    const crumbLinks = [...document.querySelectorAll('.brand-genre a[href*="/p/do/dpsl/"], .brand-genre a[href*="/p/do/psl/"]')]
      .map(a => ({ text: a.innerText.trim(), isBrand: a.href.includes('word=') }));
    let brand = '';
    const genres = [];
    for (const c of crumbLinks) {
      if (c.isBrand) { brand = c.text; continue; }
      if (c.text.includes('すべてのジャンル')) { brand = brand || c.text.replace(/（すべてのジャンル）/, '').trim(); continue; }
      if (c.text) genres.push(c.text);
    }

    // 이미지 — 갤러리 썸네일에서 CDN 전체 경로 수집 (.webp 중복 제거, https 정규화)
    const imgs = [...document.querySelectorAll('.detail-modal-thum-box img, #product_image_detail img, img')]
      .flatMap(img => [img.getAttribute('src') || '', img.getAttribute('data-src') || '', img.getAttribute('srcset') || ''])
      .map(s => s.match(/c\.superdelivery\.com\/[^\s"')]*product_image\/[^\s"')]+/)?.[0] || '')
      .filter(Boolean);
    const seen = new Set(); const images = [];
    for (const p of imgs) {
      const key = p.replace(/\.webp$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      images.push(`https:${key}`);
    }

    // 상품설명 — 본문 설명 + 세트 표를 제외한 물류/규격 정보
    const parts = [];
    const more = document.querySelector('.product-more-txt');
    if (more) parts.push(clean(more.innerText));
    const info = document.querySelector('.info-list-wrap');
    if (info) {
      const clone = info.cloneNode(true);
      clone.querySelectorAll('table.set-list, script, style').forEach(e => e.remove());
      const t = clean(clone.innerText);
      if (t) parts.push(t);
    }
    const description = parts.join('\n\n').slice(0, 5000);

    const isNotTrading = !!document.querySelector('.product-information-box.not-trading');
    return { name, setBlocks, brand, genres, images, description, isNotTrading };
  });

  // 세트 블록 텍스트 → SetOption 변환 (라벨·콜론·금액 사이에 개행/탭이 끼므로 \s 허용)
  const setOptions = [];
  let stock = DEFAULT_STOCK, jan = null;
  for (const block of data.setBlocks) {
    const id = block.match(/^S\d+/)?.[0];
    if (!id) continue;
    // 가격 형식: "卸単価 ¥627 ¥595 1セット（6点）：¥3,486" — 세트 총액이 （N点） 뒤에 온다.
    // 세트 총액이 없으면 마지막 ¥(개당 세抜 단가) × 수량으로 계산.
    const yen = [...block.matchAll(/¥\s*([\d,]+)/g)].map(m => Number(m[1].replace(/,/g, '')));
    const setTotalM = block.match(/(\d+)\s*点\s*[）)]\s*[：:]?\s*¥\s*([\d,]+)/);
    const unitsPerSet = Number(setTotalM?.[1] ?? block.match(/(\d+)\s*点/)?.[1] ?? 1);
    const sdSetTotal = setTotalM
      ? Number(setTotalM[2].replace(/,/g, ''))
      : (yen[yen.length - 1] ?? 0) * unitsPerSet;
    if (!sdSetTotal) continue;
    const openPrice = block.match(/参考上代\s*[：:]?\s*¥\s*([\d,]+)/)?.[1];
    const refPrice = openPrice ? Number(openPrice.replace(/,/g, '')) : null;
    const desc = (block.match(/^S\d+\s+(.+?)(?=\s*JAN|\s*参考上代|\s*卸単価|$)/)?.[1] || '')
      .replace(/JAN\s*[：:]\s*\d+/g, '').trim() || `Set ${id}`;
    const wholesale = Math.round(sdSetTotal * MARGIN);
    const original = refPrice ? refPrice * unitsPerSet : Math.round(wholesale * ORIGINAL_FALLBACK);
    setOptions.push({ id, description: desc, unitsPerSet, wholesalePrice: wholesale, originalPrice: original });
    jan ??= block.match(/JAN\s*[：:]\s*(\d{8,13})/)?.[1] ?? null;
    const rest = block.match(/残り\s*(\d+)/);
    if (/(なし|切れ)/.test(block)) stock = Math.min(stock, 0);
    else if (rest) stock = Math.min(stock, Number(rest[1]));
  }

  if (!setOptions.length) {
    return { sdId, error: data.isNotTrading
      ? '미거래 업체 — 도매가(卸単価) 비공개. 거래 신청 후 등록 가능'
      : '세트/가격 정보 없음 (품절 또는 비공개)' };
  }

  const s1 = setOptions[0];
  const discount = s1.originalPrice > s1.wholesalePrice ? Math.round((1 - s1.wholesalePrice / s1.originalPrice) * 100) : 0;
  // ProductCard/ProductDetail render tags as marketing badges (Sale/Best/New/Hot only) —
  // genre, JAN code, and source name aren't marketing tags and rendered as raw gray badges.
  const tags = discount > 0 ? ['Sale'] : [];

  return {
    sdId,
    name: data.name,
    nameEn: data.name, // 일본어 원명 그대로 — 관리자 화면에서 영문명 수정 권장
    brand: data.brand || 'Unknown',
    category: mapCategory(data.genres.join(' ')),
    image: data.images[0] || '',
    images: data.images,
    originalPrice: s1.originalPrice,
    wholesalePrice: s1.wholesalePrice,
    discount,
    tags,
    description: data.description,
    stock,
    status: IMPORT_ACTIVE ? 'active' : 'inactive',
    setOptions,
  };
}

// ── 이미지 업로드 & Supabase 등록 ────────────────────────────────────
// supabase-js는 기본 fetch에 타임아웃이 없어 네트워크 이상 시 무한 대기 → 45초 타임아웃 적용
const sbFetch = (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(45_000) });
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { global: { fetch: sbFetch } });

async function uploadImages(images) {
  const urls = [];
  for (const src of images.slice(0, 8)) {
    try {
      const res = await fetch(src, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = (src.match(/\.(jpe?g|png|gif|webp)/i)?.[1] || 'jpg').toLowerCase();
      const path = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from('product-images').upload(path, buf, { contentType: res.headers.get('content-type') || `image/${ext}` });
      if (error) throw error;
      urls.push(supabase.storage.from('product-images').getPublicUrl(path).data.publicUrl);
    } catch (e) {
      console.warn(`   ⚠ 이미지 실패 ${src.slice(-40)}: ${e.message}`);
    }
  }
  return urls;
}

async function importProduct(p) {
  // 중복 체크
  const { data: dup } = await supabase.from('products').select('id').eq('sd_product_id', p.sdId).maybeSingle();
  if (dup) return { skipped: true };

  const images = await uploadImages(p.images);
  const row = {
    name: p.name, name_en: p.nameEn, brand: p.brand, category: p.category,
    image: images[0] || p.image, images,
    original_price: p.originalPrice, wholesale_price: p.wholesalePrice, discount: p.discount,
    tags: p.tags, description: p.description, stock: p.stock, status: p.status,
    set_options: p.setOptions, sd_product_id: p.sdId,
  };
  const { data, error } = await supabase.from('products').insert([row]).select('id').single();
  if (error) {
    if (String(error.message).includes('sd_product_id'))
      throw new Error(`sd_product_id 컬럼 없음 — Supabase SQL Editor에서 supabase/migrations/20260912_sd_source.sql 실행 후 재시도 (${error.message})`);
    throw new Error(error.message);
  }
  return { id: data.id, images: images.length };
}

// ── 목록 → 상품 URL 수집 ─────────────────────────────────────────────
async function collectProductUrls(page, listingUrl) {
  const urls = new Set();
  const visited = new Set();
  let current = listingUrl;
  for (let n = 0; n < MAX_PAGES; n++) {
    await page.goto(current, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2500);
    const found = await page.$$eval('a[href*="/p/r/pd_p/"]', as => [...new Set(as.map(a => a.getAttribute('href')))]);
    found.forEach(h => urls.add(new URL(h, BASE).href));
    console.log(`   목록 ${n + 1}: 상품 ${found.length}개 (누적 ${urls.size})`);
    if (!FOLLOW_ALL) break;
    // 次へ / 숫자 페이지 링크 → 다음 페이지
    const next = await page.$$eval('a', as => {
      const n = as.find(a => a.innerText.trim() === '次へ');
      return n ? n.getAttribute('href') : null;
    });
    if (!next) break;
    current = new URL(next, BASE).href;
    if (visited.has(current)) break;
    visited.add(current);
  }
  return [...urls].slice(0, MAX_PRODUCTS);
}

// ── 메인 ─────────────────────────────────────────────────────────────
const mainUrl = new URL(urlArg, BASE).href;
const isProductUrl = /pd_p\/\d+/.test(mainUrl);

console.log(`📦 WELMES 관리자 로그인...`);
const { error: authErr } = await supabase.auth.signInWithPassword({ email: process.env.WELMES_ADMIN_EMAIL, password: process.env.WELMES_ADMIN_PASSWORD });
if (authErr) { console.error(`❌ WELMES 로그인 실패: ${authErr.message}`); process.exit(1); }
console.log(`✅ WELMES 로그인 성공`);

let { browser, ctx } = await getScraperContext();
let page = await ctx.newPage();

/** 세션 만료 시 재로그인하고 새 컨텍스트 반환 */
async function ensureSession() {
  await page.goto(`${BASE}/p/do/shoppingCart`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  if (String(page.url()).includes('login') || !(await isLoggedInPage(page))) {
    await loginHeadful();
    await browser.close();
    ({ browser, ctx } = await getScraperContext());
    page = await ctx.newPage();
  }
}
await ensureSession();
console.log(`✅ 슈퍼딜리버리 세션 확인 완료`);

const productUrls = isProductUrl ? [mainUrl] : await collectProductUrls(page, mainUrl);
console.log(`🎯 대상 상품 ${productUrls.length}개${FOLLOW_ALL && !isProductUrl ? ` (최대 ${MAX_PAGES}페이지, ${MAX_PRODUCTS}개 제한)` : ''}`);

let ok = 0, skip = 0, fail = 0;
for (const u of productUrls) {
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1200);
  if (String(page.url()).includes('login')) { await ensureSession(); await page.goto(u, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200); }

  const p = await extractProduct(page, u);
  if (p.error) { fail++; console.log(`✗ [SD ${p.sdId}] ${p.error}`); continue; }
  try {
    const r = await importProduct(p);
    if (r.skipped) { skip++; console.log(`↷ [SD ${p.sdId}] 이미 등록됨 — skip: ${p.name.slice(0, 40)}`); }
    else { ok++; console.log(`✓ [SD ${p.sdId}] ${p.name.slice(0, 50)} → 등록 (#${r.id}, ¥${p.wholesalePrice}, 이미지 ${r.images}, ${p.status})`); }
  } catch (e) {
    fail++; console.log(`✗ [SD ${p.sdId}] ${p.name?.slice(0, 40) || ''} — ${e.message}`);
    if (e.message.includes('sd_product_id')) { console.log('\n마이그레이션 실행 후 재시도하세요.'); break; }
  }
  await page.waitForTimeout(DELAY_MS);
}

console.log(`\n📊 완료: 등록 ${ok} / skip ${skip} / 실패 ${fail}`);
await browser.close();