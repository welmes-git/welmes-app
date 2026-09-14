#!/usr/bin/env node
/**
 * Superdelivery(スーパーデリバリー) → WELMES 상품 자동 등록 스크립트
 *
 * 사용법:
 *   npm run import:sd -- <상품URL>                # 상품 1개 등록 (/p/r/pd_p/…)
 *   npm run import:sd -- <목록URL>                # 그 페이지의 상품 전부 등록
 *   npm run import:sd -- <목록URL> --all          # 페이지네이션 끝까지 전부 등록
 *   npm run import:sd -- <목록URL> --brand=小林製薬  # 브랜드 refine 후 전부 등록
 *
 * 옵션:
 *   --brand=名前   브랜드 refine (목록 페이지의 브랜드 refine 링크 중 이름 일치 항목)
 *   --pages=N      최대 페이지 수 (기본 무제한)
 *   --limit=N      최대 상품 수 (기본 무제한)
 *   --active       inactive 대신 active 등록
 *
 * 필수 .env.local (git 제외): SD_EMAIL, SD_PASSWORD, WELMES_ADMIN_EMAIL, WELMES_ADMIN_PASSWORD
 * 필수 .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * 사전 준비: supabase/migrations/20260912_sd_source.sql + 20260914_sd_dealer.sql + 20260915_sd_monitor.sql
 *           + 20260916_sd_watchlist.sql 를 Supabase SQL Editor에서 1회 실행
 *
 * 로그인은 Cloudflare Turnstile CAPTCHA 때문에 실제 브라우저(headful)로 자동 처리하고
 * 세션은 scripts/.sd-session.json 에 저장 · 재사용. 세션이 살아있으면 창 없이(headless) 동작.
 * 가격 규칙: WELMES 판매가 = 슈퍼딜리버리 卸単価 × MARGIN, 등록 상태는 기본 inactive(관리자 검토 후 활성화).
 * 파싱/세션/카테고리 등 공통 로직은 scripts/lib/sd-core.mjs (sd-monitor.mjs 와 공유).
 * 품절·미거래로 등록 못 한 상품은 sd_watchlist 에 기록 — sd-monitor.mjs 가 재입고 시 자동 등록.
 */

// dynamic import: 이 환경에서 node_modules 로딩이 수십 초 걸릴 수 있어 시작 배너를 먼저 찍는다
console.log('🚀 슈퍼딜리버리 → WELMES 상품 등록 시작 (모듈 로딩 중, 잠시만 기다려주세요)...');
const { chromium } = await import('playwright');
const { createClient } = await import('@supabase/supabase-js');
import {
  loadEnvFiles, createSupabase, createSdSession, parseProductPage,
  buildProduct, insertProduct, BASE, DELAY_MS,
} from './lib/sd-core.mjs';

loadEnvFiles();

// ── CLI 인자 ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const urlArg = args.find(a => !a.startsWith('--'));
const opt = (name, def) => { const m = args.find(a => a.startsWith(`--${name}=`)); return m ? m.split('=')[1] : def; };
const BRAND = opt('brand', '');
const FOLLOW_ALL = args.includes('--all') || Boolean(BRAND); // --brand 지정 시 자동 전체 페이지
const MAX_PAGES = opt('pages') ? Number(opt('pages')) : Infinity;
const MAX_PRODUCTS = opt('limit') ? Number(opt('limit')) : Infinity;
const IMPORT_ACTIVE = args.includes('--active');
if (!urlArg) { console.error('사용법: npm run import:sd -- <상품 또는 목록 URL> [--brand=名前] [--pages=N] [--limit=N] [--active]'); process.exit(1); }

// DB 기존 브랜드 — 상품명 기반 추론의 2차 후보이자 신규 브랜드 판정 기준. WELMES 로그인 후 로드.
let KNOWN_BRANDS = [];

// ── Supabase 등록 (upload/insert/buildProduct 는 sd-core 공용) ───────
const supabase = createSupabase(createClient);

/**
 * 품절/미거래로 등록 못한 상품을 감시 목록에 등록한다 — sd-monitor.mjs가
 * 매일 재입고(가격·세트 정보 등장)를 확인하고 자동 등록한다.
 * sd_watchlist 테이블(20260916_sd_watchlist.sql)이 없으면 조용히 건너뛴다.
 */
async function addWatchlist(parsed) {
  try {
    const { error } = await supabase.from('sd_watchlist')
      .upsert({ sd_product_id: parsed.sdId, name: parsed.name }, { onConflict: 'sd_product_id' });
    if (error) throw error;
    console.log(`  👁 감시 목록 등록 — 재입고되면 자동 등록됩니다`);
  } catch (e) {
    if (!String(e.message).includes('sd_watchlist')) console.log(`  ⚠ 감시 등록 실패: ${e.message}`);
  }
}

/**
 * 파싱 결과(parsed) → 등록용 상품 객체. 브랜드 결정 우선순위:
 *   1. --brand 옵션 (브랜드 refine으로 좁힌 목록이면 신뢰 가능)
 *   2. 상품 페이지의 명시적 브랜드 링크(word=/br=)
 *   3. 상품명 기반 추론 — 업체 브랜드 목록(업체 페이지에서 1회 로드·캐시) → DB 기존 브랜드 (긴 이름 우선 매칭)
 *   4. 출기업 breadcrumb (업체명 — 브랜드는 아니지만 이전 동작 유지)
 */
// → sd-core.mjs 의 buildProduct(page, parsed, { brandOption, knownBrands, status }) 로 공용화됨

// ── 브랜드 refine ────────────────────────────────────────────────────
// 업체(도매) 페이지 왼쪽 「ブランド/シリーズ」 refine 링크(/p/do/dpsl/ID/?…&br=名前) 중
// --brand=名前 와 일치하는 링크를 찾아 그 URL로 목록을 좁힌다.
async function resolveBrandUrl(page, listingUrl, brand) {
  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(2000);
  const links = await page.$$eval('.refine-search-list a[href*="br="]', as =>
    as.map(a => ({ text: a.innerText.trim(), href: a.getAttribute('href') }))
  );
  const hit = links.find(l => l.text === brand)
    ?? links.find(l => l.text.includes(brand) || brand.includes(l.text));
  if (!hit) {
    console.error(`❌ 브랜드 "${brand}" 를 찾을 수 없습니다. 이 업체의 브랜드 목록:`);
    for (const l of links) console.log(`   - ${l.text}`);
    process.exit(1);
  }
  console.log(`🏷 브랜드 "${hit.text}" refine 적용`);
  return new URL(hit.href, BASE).href;
}

// ── 목록 → 상품 URL 수집 (기본 무제한 페이지네이션) ──────────────────
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
    if (urls.size >= MAX_PRODUCTS) break;
    if (!FOLLOW_ALL) break;
    // 次へ 링크 → 다음 페이지
    const next = await page.$$eval('a', as => {
      const n = as.find(a => a.innerText.trim() === '次へ');
      return n ? n.getAttribute('href') : null;
    });
    if (!next) break;
    current = new URL(next, BASE).href;
    if (visited.has(current)) break;
    visited.add(current);
  }
  return [...urls].slice(0, MAX_PRODUCTS === Infinity ? undefined : MAX_PRODUCTS);
}

// ── 메인 ─────────────────────────────────────────────────────────────
const mainUrl = new URL(urlArg, BASE).href;
const isProductUrl = /pd_p\/\d+/.test(mainUrl);

console.log(`📦 WELMES 관리자 로그인...`);
const { error: authErr } = await supabase.auth.signInWithPassword({ email: process.env.WELMES_ADMIN_EMAIL, password: process.env.WELMES_ADMIN_PASSWORD });
if (authErr) { console.error(`❌ WELMES 로그인 실패: ${authErr.message}`); process.exit(1); }
console.log(`✅ WELMES 로그인 성공`);

// DB 기존 브랜드 로드 — 상품명 기반 추론 2차 후보. brand는 free text라
// 여기 없던 브랜드가 추론되면 그대로 insert 되어 아래 목록에도 추가된다.
const { data: brandRows } = await supabase.from('products').select('brand');
KNOWN_BRANDS = [...new Set((brandRows ?? []).map(r => r.brand).filter(Boolean))];
console.log(`🏷 DB 기존 브랜드 ${KNOWN_BRANDS.length}개 로드`);

const sd = await createSdSession(chromium);
const page = sd.page();
await sd.ensure();
console.log(`✅ 슈퍼딜리버리 세션 확인 완료`);

let listingUrl = mainUrl;
if (BRAND && !isProductUrl) listingUrl = await resolveBrandUrl(page, mainUrl, BRAND);

const productUrls = isProductUrl ? [mainUrl] : await collectProductUrls(page, listingUrl);
console.log(`🎯 대상 상품 ${productUrls.length}개${BRAND ? ` (브랜드: ${BRAND})` : ''}${isFinite(MAX_PAGES) || isFinite(MAX_PRODUCTS) ? ` (제한: 페이지 ${isFinite(MAX_PAGES) ? MAX_PAGES : '∞'}, 상품 ${isFinite(MAX_PRODUCTS) ? MAX_PRODUCTS : '∞'})` : ''}`);

let ok = 0, skip = 0, fail = 0;
for (const u of productUrls) {
  await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(1200);
  if (String(page.url()).includes('login')) { await sd.ensure(); await page.goto(u, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200); }

  const parsed = await parseProductPage(page, u);
  if (parsed.error) {
    fail++;
    console.log(`✗ [SD ${parsed.sdId}] ${parsed.error.message}`);
    // 품절/미거래 상품도 놓치지 않도록 감시 목록에 등록 — 재입고 시 자동 등록
    await addWatchlist(parsed);
    continue;
  }
  const p = await buildProduct(page, parsed, { brandOption: BRAND, knownBrands: KNOWN_BRANDS, status: IMPORT_ACTIVE ? 'active' : 'inactive' });
  try {
    const r = await insertProduct(supabase, p);
    if (r.skipped) { skip++; console.log(`↷ [SD ${p.sdId}] 이미 등록됨 — skip: ${p.name.slice(0, 40)}`); }
    else {
      ok++;
      console.log(`✓ [SD ${p.sdId}] ${p.name.slice(0, 50)} → 등록 (#${r.id}, ¥${p.wholesalePrice}, 이미지 ${r.images}, ${p.status})`);
      if (p.brand && p.brand !== 'Unknown' && !KNOWN_BRANDS.includes(p.brand)) {
        KNOWN_BRANDS.push(p.brand);
        console.log(`  🆕 신규 브랜드 등록: ${p.brand} — 관리자 대시보드 브랜드 목록에 자동 반영`);
      }
    }
  } catch (e) {
    fail++; console.log(`✗ [SD ${p.sdId}] ${p.name?.slice(0, 40) || ''} — ${e.message}`);
    if (e.message.includes('sd_product_id')) { console.log('\n마이그레이션 실행 후 재시도하세요.'); break; }
  }
  await page.waitForTimeout(DELAY_MS);
}

console.log(`\n📊 완료: 등록 ${ok} / skip ${skip} / 실패 ${fail}`);
await sd.close();
