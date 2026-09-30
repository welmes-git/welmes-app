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
 *   --active       inactive 대신 active 등록 (dry-run에서는 미적용)
 *   --dry-run      페이지 파싱·상품 변환까지만 수행 (DB/Storage 변경 없음)
 *   --enrich       영문명 AI enrichment 작업 큐잉 (기본 OFF)
 *   --translate    설명 다국어 AI 번역 작업 큐잉 (기본 OFF)
 *   --reverse      수집한 목록을 역순으로 등록 (so=newly 목록이면 최신 상품이 마지막 = WELMES 최상단)
 *   --url-file=P   수집 URL 목록 파일. 파일이 있으면 목록 수집을 건너뛰고 재사용,
 *                  없으면 수집 후 저장 → 중단 후 재실행해도 같은 순서로 이어서 진행
 *   --retries=N    가격표 미표시·로그아웃 시 재시도 횟수 (기본 2)
 *   (이미 등록된 SD 상품은 페이지를 열지 않고 사전 제외)
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
  buildProduct, insertProduct, loadOfficialSources, buildEnrichmentOptions, buildTranslationOptions, BASE, DELAY_MS,
  loadAndParseProduct, orderProductUrls, filterUnregisteredUrls, parseUrlListFile,
} from './lib/sd-core.mjs';
const fs = await import('node:fs');

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
const DRY_RUN = args.includes('--dry-run');
// AI 번역 큐잉은 기본 OFF (등록만 하고 번역은 나중에 수동 처리). 필요할 때만 --enrich / --translate 로 opt-in.
// --no-enrich / --no-translate 는 하위 호환용으로 계속 허용(항상 OFF 우선).
const NO_ENRICH = !args.includes('--enrich') || args.includes('--no-enrich');          // 영문명 enrichment 큐잉
const NO_TRANSLATE = !args.includes('--translate') || args.includes('--no-translate'); // 설명 다국어 번역 큐잉
const ENRICH_PROVIDER = opt('provider', 'gemini'); // 영문명 생성 AI 공급자 (--enrich/--translate 시에만 사용)
const REVERSE = args.includes('--reverse');
const URL_FILE = opt('url-file', '');
const RETRIES = Number(opt('retries', 2));
if (!Number.isInteger(RETRIES) || RETRIES < 0 || RETRIES > 5) { console.error('--retries 는 0~5 정수'); process.exit(1); }
if (!urlArg) { console.error('사용법: npm run import:sd -- <상품 또는 목록 URL> [--brand=名前] [--pages=N] [--limit=N] [--active] [--enrich] [--translate] [--provider=gemini] [--dry-run]'); process.exit(1); }

// Never navigate an authenticated scraper to an arbitrary host supplied on the
// command line. It would not receive Superdelivery cookies (host-scoped), but it
// could still feed attacker-controlled data into product creation.
const inputUrl = new URL(urlArg, BASE);
if (inputUrl.protocol !== 'https:' || !['superdelivery.com', 'www.superdelivery.com'].includes(inputUrl.hostname)) {
  console.error(`❌ Superdelivery URL만 허용됩니다: ${inputUrl.href}`);
  process.exit(1);
}

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
    // --reverse / --url-file 은 목록 끝까지 알아야 하므로 --limit 로 수집을 자르지 않는다
    if (!REVERSE && !URL_FILE && urls.size >= MAX_PRODUCTS) break;
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
  return [...urls];
}

// ── 메인 ─────────────────────────────────────────────────────────────
const mainUrl = inputUrl.href;
const isProductUrl = /pd_p\/\d+/.test(mainUrl);

console.log(`📦 WELMES 관리자 로그인...`);
const { error: authErr } = await supabase.auth.signInWithPassword({ email: process.env.WELMES_ADMIN_EMAIL, password: process.env.WELMES_ADMIN_PASSWORD });
if (authErr) { console.error(`❌ WELMES 로그인 실패: ${authErr.message}`); process.exit(1); }
console.log(`✅ WELMES 로그인 성공`);

// DB 기존 브랜드 로드 — 상품명 기반 추론 2차 후보. brand는 free text라
// 여기 없던 브랜드가 추론되면 그대로 insert 되어 아래 목록에도 추가된다.
const { data: brandRows } = await supabase.from('products_admin').select('brand');
KNOWN_BRANDS = [...new Set((brandRows ?? []).map(r => r.brand).filter(Boolean))];
console.log(`🏷 DB 기존 브랜드 ${KNOWN_BRANDS.length}개 로드`);

// 브랜드 공식 도메인 레지스트리 — 영문명 enrichment grounding 근거 검증에 사용.
// (테이블 미적용 시 빈 배열 반환 → generated 경로로만 처리, 수집은 계속)
const OFFICIAL_SOURCES = NO_ENRICH ? [] : await loadOfficialSources(supabase);
const ENRICHMENT = buildEnrichmentOptions({
  enabled: !NO_ENRICH,
  officialSources: OFFICIAL_SOURCES,
  provider: ENRICH_PROVIDER,
  env: process.env,
});
if (!NO_ENRICH) console.log(`🌐 공식 도메인 레지스트리 ${OFFICIAL_SOURCES.length}행 로드 — 영문명 자동 큐잉 활성화 (provider: ${ENRICH_PROVIDER})`);
else console.log('⏭ 영문명 AI enrichment 큐잉 OFF (켜려면 --enrich)');

const TRANSLATION = buildTranslationOptions({
  enabled: !NO_TRANSLATE,
  provider: ENRICH_PROVIDER,
  env: process.env,
});
if (!NO_TRANSLATE) console.log('🌏 상품 설명 다국어 번역 자동 큐잉 활성화 (EN/ZH/KO)');
else console.log('⏭ 설명 AI 번역 큐잉 OFF (켜려면 --translate)');

const sd = await createSdSession(chromium);
let page = sd.page();
await sd.ensure();
// ensure() may replace the browser/context when the cached session expired.
page = sd.page();
console.log(`✅ 슈퍼딜리버리 세션 확인 완료${DRY_RUN ? ' (dry-run — DB/Storage 미변경)' : ''}`);

let listingUrl = mainUrl;
if (BRAND && !isProductUrl) listingUrl = await resolveBrandUrl(page, mainUrl, BRAND);

// 수집 목록: --url-file 이 있으면 재사용(순서 고정), 없으면 수집 후 저장
let collected;
if (isProductUrl) collected = [mainUrl];
else if (URL_FILE && fs.existsSync(URL_FILE)) {
  const saved = parseUrlListFile(fs.readFileSync(URL_FILE, 'utf8'));
  collected = saved.urls;
  console.log(`📂 URL 목록 재사용: ${URL_FILE} (${collected.length}개, 수집 ${saved.collectedAt ?? '?'}, 출처 ${saved.source ?? '?'})`);
} else {
  collected = await collectProductUrls(page, listingUrl);
  if (URL_FILE) {
    fs.writeFileSync(URL_FILE, JSON.stringify({ source: listingUrl, collectedAt: new Date().toISOString(), urls: collected }, null, 1));
    console.log(`💾 URL 목록 저장: ${URL_FILE} (${collected.length}개, 수집 순서 그대로)`);
  }
}
const ordered = orderProductUrls(collected, { reverse: REVERSE });
if (REVERSE) console.log('🔃 --reverse: 목록 마지막 상품부터 등록 (최신 상품이 마지막 = 최상단)');

// 이미 등록된 SD 상품은 페이지를 열지 않고 제외 — 5천 개 규모 재개 시 수 시간 절약
const registeredIds = new Set();
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase.from('products_admin').select('sd_product_id').not('sd_product_id', 'is', null).range(from, from + 999);
  if (error) { console.error(`❌ 기존 등록 상품 조회 실패: ${error.message}`); process.exit(1); }
  for (const r of data ?? []) registeredIds.add(String(r.sd_product_id));
  if (!data || data.length < 1000) break;
}
const unregistered = filterUnregisteredUrls(ordered, registeredIds);
const preSkipped = ordered.length - unregistered.length;
// --limit 은 등록 순서(역순 적용·기등록 제외 후) 기준으로 처리 개수를 제한한다
const productUrls = unregistered.slice(0, MAX_PRODUCTS === Infinity ? undefined : MAX_PRODUCTS);
console.log(`🎯 대상 상품 ${productUrls.length}개 (수집 ${ordered.length}, 기등록 사전 제외 ${preSkipped})${BRAND ? ` (브랜드: ${BRAND})` : ''}${isFinite(MAX_PAGES) || isFinite(MAX_PRODUCTS) ? ` (제한: 페이지 ${isFinite(MAX_PAGES) ? MAX_PAGES : '∞'}, 상품 ${isFinite(MAX_PRODUCTS) ? MAX_PRODUCTS : '∞'})` : ''}`);

let ok = 0, skip = preSkipped, fail = 0, enrichQueued = 0, enrichFailed = 0, translateQueued = 0, translateFailed = 0;
let retriedOk = 0, relogins = 0, n = 0;
const failKinds = {};
for (const u of productUrls) {
  n++;
  if (n % 50 === 0) console.log(`⏱ 진행 ${n}/${productUrls.length} — 등록 ${ok} / 실패 ${fail} / 재시도 성공 ${retriedOk} / 재로그인 ${relogins}`);
  let loaded;
  try {
    loaded = await loadAndParseProduct(sd, u, { retries: RETRIES, log: console.log });
  } catch (e) {
    fail++; failKinds.load_error = (failKinds.load_error ?? 0) + 1;
    console.log(`✗ [SD ${u.match(/pd_p\/(\d+)/)?.[1]}] 페이지 로드 실패: ${e.message.split('\n')[0]}`);
    page = sd.page();
    continue;
  }
  page = loaded.page;
  relogins += loaded.relogins;
  const parsed = loaded.parsed;
  if (!parsed.error && loaded.attempts > 1) retriedOk++;
  if (parsed.error) {
    failKinds[parsed.error.kind] = (failKinds[parsed.error.kind] ?? 0) + 1;
    if (!loaded.loggedIn) console.log(`  ⚠ 재시도 후에도 로그아웃 상태 — 품절 판정 신뢰 불가`);
    fail++;
    console.log(`✗ [SD ${parsed.sdId}] ${parsed.error.message}`);
    // 품절/미거래 상품도 놓치지 않도록 감시 목록에 등록 — 재입고 시 자동 등록
    if (!DRY_RUN) await addWatchlist(parsed);
    else console.log(`  ↳ dry-run: 감시 목록에는 기록하지 않음`);
    continue;
  }
  // Publication is centrally gated: every newly collected product starts
  // inactive regardless of --active. It can be activated only after its English
  // name is approved (and automated publication additionally passes the pilot gate).
  const p = await buildProduct(page, parsed, { brandOption: BRAND, knownBrands: KNOWN_BRANDS, status: 'inactive' });
  if (IMPORT_ACTIVE) console.log('  ↷ --active ignored: naming/publication gate requires initial inactive status');
  if (DRY_RUN) {
    // Mirror insertProduct's duplicate decision without uploading or inserting.
    const { data: dup, error: dupErr } = await supabase.from('products_admin').select('id').eq('sd_product_id', p.sdId).maybeSingle();
    if (dupErr) {
      fail++;
      console.log(`✗ [SD ${p.sdId}] 중복 확인 실패: ${dupErr.message}`);
    } else if (dup) {
      skip++;
      console.log(`↷ [SD ${p.sdId}] 이미 등록됨 (#${dup.id}) — dry-run skip: ${p.name.slice(0, 40)}`);
    } else {
      ok++;
      console.log(`◇ [SD ${p.sdId}] 등록 예정: ${p.name.slice(0, 50)} (¥${p.wholesalePrice}, 이미지 ${p.images.length}, ${p.status})`);
    }
    await page.waitForTimeout(DELAY_MS);
    continue;
  }
  try {
    const r = await insertProduct(supabase, p, { enrichment: ENRICHMENT, translation: TRANSLATION });
    if (r.skipped) { skip++; console.log(`↷ [SD ${p.sdId}] 이미 등록됨 — skip: ${p.name.slice(0, 40)}`); }
    else {
      ok++;
      console.log(`✓ [SD ${p.sdId}] ${p.name.slice(0, 50)} → 등록 (#${r.id}, ¥${p.wholesalePrice}, 이미지 ${r.images}, ${p.status})`);
      // 영문명 enrichment 큐잉 결과 — 등록은 이미 성공했으므로 실패는 별도 집계만 한다
      if (r.enrichment) {
        if (r.enrichment.enqueued) { enrichQueued++; console.log(`  🌐 영문명 작업 큐잉 (run ${String(r.enrichment.runId).slice(0, 8)}, grounding: ${r.enrichment.grounding ? 'on' : 'off'})`); }
        else if (r.enrichment.error) { enrichFailed++; console.log(`  ⚠ 영문명 큐잉 실패 (등록은 유지): ${r.enrichment.error}`); }
      }
      // 설명 번역 큐잉 결과 — 마찬가지로 실패해도 등록은 유지
      if (r.translation) {
        if (r.translation.queued) { translateQueued++; console.log(`  🌏 설명 번역 작업 큐잉 (run ${String(r.translation.id).slice(0, 8)})`); }
        else if (r.translation.reason && r.translation.reason !== 'no_translatable_sections') { translateFailed++; console.log(`  ⚠ 설명 번역 큐잉 실패 (등록은 유지): ${r.translation.reason}`); }
      }
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

console.log(`\n🔍 실패 유형: ${JSON.stringify(failKinds)} | 재시도로 복구 ${retriedOk} | 재로그인 ${relogins}`);
console.log(`📊 완료${DRY_RUN ? ' (dry-run — 미등록)' : ''}: ${DRY_RUN ? '등록 예정' : '등록'} ${ok} / skip ${skip} / 실패 ${fail}${!NO_ENRICH && !DRY_RUN ? ` | 영문명 큐잉 ${enrichQueued} / 큐잉 실패 ${enrichFailed}` : ''}${!NO_TRANSLATE && !DRY_RUN ? ` | 번역 큐잉 ${translateQueued} / 큐잉 실패 ${translateFailed}` : ''}`);
await sd.close();
