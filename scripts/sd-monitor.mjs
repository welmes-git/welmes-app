#!/usr/bin/env node
/**
 * 슈퍼딜리버리 수집 상품 모니터링 — 가격/재고 변동 감지 → 자동 반영 + 변동 로그 + 관리자 알림
 *
 * 사용법:
 *   npm run monitor:sd                  # sd_product_id 있는 상품 전체 체크
 *   npm run monitor:sd -- --dry-run     # DB 변경 없이 감지 결과만 출력
 *   npm run monitor:sd -- --limit=50    # 마지막 체크가 오래된 상품부터 50개만
 *   npm run monitor:sd -- --ids=12,34   # 특정 WELMES 상품 id만
 *
 * 필수 .env.local: SD_EMAIL, SD_PASSWORD, WELMES_ADMIN_EMAIL, WELMES_ADMIN_PASSWORD
 * 사전 준비: supabase/migrations/20260915_sd_monitor.sql 을 Supabase SQL Editor에서 1회 실행
 *
 * 감지: price_up/price_down(세트 卸단가 변동), sold_out(재고 0), restock(재고 회복),
 *       not_trading(미거래/가격 비공개 전환), missing(상품 페이지 소실)
 * 반영: 가격·재고는 즉시 자동 갱신, 품절/미거래/소실 → inactive 자동 전환,
 *       재고 회복은 알림만 보내고 inactive 유지(관리자 확인 후 활성화).
 *       모든 변동은 sd_product_changes에 기록되고 관리자 전원에게 알림(notifications)이 전송된다.
 * 감시: sd_watchlist — 수집 당시 품절/미거래로 등록 못 한 상품. 재입고(가격 정보 등장)를
 *       확인하면 자동 등록(inactive)하고 관리자에게 product_registered 알림을 보낸다.
 * 세션: sd-import.mjs 와 동일 — scripts/.sd-session.json 재사용, 만료 시 headful 로그인 창.
 */
console.log('🚀 슈퍼딜리버리 상품 모니터링 시작 (모듈 로딩 중, 잠시만 기다려주세요)...');
const { chromium } = await import('playwright');
const { createClient } = await import('@supabase/supabase-js');
import {
  loadEnvFiles, createSupabase, createSdSession, parseProductPage,
  buildProduct, insertProduct, loadOfficialSources, buildEnrichmentOptions, buildTranslationOptions, BASE,
} from './lib/sd-core.mjs';

loadEnvFiles();

// ── CLI 인자 ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT = args.find(a => a.startsWith('--limit=')) ? Number(args.find(a => a.startsWith('--limit=')).split('=')[1]) : Infinity;
const IDS_ARG = args.find(a => a.startsWith('--ids='));
const IDS = IDS_ARG ? IDS_ARG.split('=')[1].split(',').map(Number).filter(Boolean) : null;
const NO_ENRICH = args.includes('--no-enrich');   // 재입고 자동등록 시 영문명 큐잉 비활성화
const NO_TRANSLATE = args.includes('--no-translate'); // 재입고 자동등록 시 설명 번역 큐잉 비활성화
const ENRICH_PROVIDER = args.find(a => a.startsWith('--provider=')) ? args.find(a => a.startsWith('--provider=')).split('=')[1] : 'gemini';

const supabase = createSupabase(createClient);

// 변동 유형 → notifications.type 매핑
const NOTE_TYPE = {
  price_up: 'product_price_change', price_down: 'product_price_change',
  sold_out: 'product_sold_out', not_trading: 'product_sold_out',
  restock: 'product_restock', missing: 'product_missing',
};

// ── 관리자 로그인 & 알림 대상 ────────────────────────────────────────
console.log(`📦 WELMES 관리자 로그인...`);
const { error: authErr } = await supabase.auth.signInWithPassword({ email: process.env.WELMES_ADMIN_EMAIL, password: process.env.WELMES_ADMIN_PASSWORD });
if (authErr) { console.error(`❌ WELMES 로그인 실패: ${authErr.message}`); process.exit(1); }
const { data: adminRows } = await supabase.from('members').select('id').eq('is_admin', true);
const adminIds = (adminRows ?? []).map(r => r.id);
console.log(`✅ WELMES 로그인 성공 — 알림 대상 관리자 ${adminIds.length}명`);

// ── 대상 상품 조회 (sd_product_id 있는 것, 마지막 체크 오래된 순) ────
let query = supabase.from('products_admin')
  .select('id, name, wholesale_price, original_price, stock, status, set_options, sd_product_id, sd_last_checked_at')
  .not('sd_product_id', 'is', null);
if (IDS) query = query.in('id', IDS);
const { data: rows, error: qErr } = await query.order('sd_last_checked_at', { ascending: true, nullsFirst: true });
if (qErr) { console.error(`❌ 상품 조회 실패: ${qErr.message} — 20260915_sd_monitor.sql 마이그레이션 확인`); process.exit(1); }
const products = LIMIT === Infinity ? rows : rows.slice(0, LIMIT);
console.log(`🎯 대상 상품 ${products.length}개${DRY_RUN ? ' (dry-run — DB 미변경)' : ''}`);

// ── 스크래퍼 세션 ────────────────────────────────────────────────────
const sd = await createSdSession(chromium);
let page = sd.page();
await sd.ensure();
page = sd.page(); // ensure()가 재로그인하면 컨텍스트가 교체되므로 다시 받는다
console.log(`✅ 슈퍼딜리버리 세션 확인 완료\n`);

let checked = 0, changedProducts = 0, errors = 0;
const stats = { price_up: 0, price_down: 0, sold_out: 0, restock: 0, not_trading: 0, missing: 0 };

for (const row of products) {
  const url = `${BASE}/p/r/pd_p/${row.sd_product_id}/`;

  // 접속 — 네트워크 오류는 일시적일 수 있으니 1회 재시도, 그래도 실패하면 소실로 판정하지 않고 스킵
  let resp = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      break;
    } catch (e) {
      if (attempt === 1) console.log(`⚠ [${row.id}] 접속 실패 — 스킵 (${e.message})`);
    }
  }
  if (!resp) { errors++; continue; }
  if (String(page.url()).includes('login')) {
    await sd.ensure();
    page = sd.page();
    resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  // domcontentloaded 직후에는 세트표가 아직 안 그려질 수 있다 — import와 동일하게 대기 후 파싱
  await page.waitForTimeout(1500);

  // 페이지 소실 — 404 응답 또는 상품 URL에서 벗어난 리다이렉트
  const gone = resp.status() === 404 || !/pd_p\/\d+/.test(page.url());
  let parsed = gone ? null : await parseProductPage(page, url);

  // 세트/가격을 못 읽었으면 일시적 렌더링 지연·세션 이슈일 수 있다 — 세션 확인 + 재시도 3회 후 판정
  if (parsed?.error) {
    for (let attempt = 0; attempt < 3 && parsed?.error; attempt++) {
      await page.waitForTimeout(3000);
      await sd.ensure();
    page = sd.page();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(2500);
      if (!/pd_p\/\d+/.test(page.url())) break; // 소실 판정은 gone 로직이 담당
      const reparsed = await parseProductPage(page, page.url());
      if (!reparsed.error) parsed = reparsed;
    }
  }
  checked++;

  // ── 변동 감지 ──────────────────────────────────────────────────────
  const changes = []; // { type, old, new }
  const updates = { sd_last_checked_at: new Date().toISOString() };

  if (gone) {
    // A missing supplier page is not purchasable inventory. Zeroing stock also
    // gives the recovery path a reliable 0→N signal if the page later returns.
    if (row.stock !== 0) updates.stock = 0;
    if (row.status === 'active') {
      changes.push({ type: 'missing', old: { status: 'active', stock: row.stock }, new: { status: 'inactive', stock: 0, sdProductPage: url } });
      updates.status = 'inactive';
    }
  } else if (parsed.error) {
    // No visible wholesale price means the item cannot be purchased right now.
    if (row.stock !== 0) updates.stock = 0;
    if (row.status === 'active') {
      changes.push({ type: 'not_trading', old: { status: 'active', stock: row.stock }, new: { status: 'inactive', stock: 0, note: parsed.error.message } });
      updates.status = 'inactive';
    }
  } else {
    // 가격 — DB의 대표 세트(S1)와 비교
    const newS1 = parsed.setOptions[0];
    const oldS1 = (row.set_options ?? []).find(s => s.id === newS1.id) ?? (row.set_options ?? [])[0];
    if (oldS1 && oldS1.wholesalePrice !== newS1.wholesalePrice) {
      changes.push({
        type: newS1.wholesalePrice > oldS1.wholesalePrice ? 'price_up' : 'price_down',
        old: { wholesale: oldS1.wholesalePrice, original: oldS1.originalPrice },
        new: { wholesale: newS1.wholesalePrice, original: newS1.originalPrice },
      });
    }
    // 세트 구성·가격 전체 갱신 (JSONB 키 순서가 재배열되므로 필드 단위 비교)
    const setsChanged =
      (row.set_options?.length ?? -1) !== parsed.setOptions.length ||
      parsed.setOptions.some((s, i) => {
        const o = row.set_options?.[i];
        return !o || o.id !== s.id || o.description !== s.description
          || o.unitsPerSet !== s.unitsPerSet || o.wholesalePrice !== s.wholesalePrice
          || o.originalPrice !== s.originalPrice;
      });
    if (setsChanged) {
      updates.set_options = parsed.setOptions;
      updates.wholesale_price = newS1.wholesalePrice;
      updates.original_price = newS1.originalPrice;
      updates.discount = parsed.discount;
    }
    // 재고 — 0Crossing 만 알림, 수치 변동은 조용히 갱신
    if (row.stock > 0 && parsed.stock === 0) {
      changes.push({ type: 'sold_out', old: { stock: row.stock }, new: { stock: 0 } });
      updates.status = 'inactive';
    } else if (row.stock === 0 && parsed.stock > 0) {
      changes.push({ type: 'restock', old: { stock: 0, status: row.status }, new: { stock: parsed.stock, status: row.status } });
      // Never override an administrator's inactive choice. A restock notification
      // is created below; activation remains an explicit admin action.
    }
    if (row.stock !== parsed.stock) updates.stock = parsed.stock;
  }

  const hasChange = changes.length > 0;
  if (!hasChange && Object.keys(updates).length === 1) {
    console.log(`· [${row.id}] ${row.name.slice(0, 40)} — 변동 없음`);
    continue;
  }
  changedProducts += hasChange ? 1 : 0;
  for (const c of changes) stats[c.type]++;

  const icon = { price_up: '🔺 가격 인상', price_down: '🔻 가격 인하', sold_out: '⛔ 품절', restock: '♻️ 재고 회복', not_trading: '🚫 거래 중단', missing: '❓ 소실' };
  for (const c of changes) {
    const detail = c.old.wholesale != null
      ? `¥${c.old.wholesale} → ¥${c.new.wholesale}`
      : c.type === 'restock' ? `재고 ${c.new.stock}`
      : '';
    console.log(`${icon[c.type]} [${row.id}] ${row.name.slice(0, 40)}${detail ? ` — ${detail}` : ''}`);
  }
  if (!hasChange) console.log(`· [${row.id}] ${row.name.slice(0, 40)} — 재고 수치 갱신 (${row.stock} → ${updates.stock})`);

  if (DRY_RUN) continue;

  // ── 반영: 상품 갱신 → 변동 로그 → 관리자 알림 ─────────────────────
  const { error: uErr } = await supabase.from('products_admin').update(updates).eq('id', row.id);
  if (uErr) { errors++; console.log(`  ✗ DB 갱신 실패: ${uErr.message}`); continue; }

  if (hasChange) {
    const { error: cErr } = await supabase.from('sd_product_changes').insert(
      changes.map(c => ({ product_id: row.id, change_type: c.type, old_value: c.old, new_value: c.new }))
    );
    if (cErr) console.log(`  ⚠ 변동 로그 실패: ${cErr.message}`);
    if (adminIds.length && !cErr) {
      const notifications = adminIds.flatMap(member_id => changes.map(c => ({
        member_id,
        type: NOTE_TYPE[c.type],
        payload: {
          productId: row.id,
          productName: row.name,
          oldWholesale: c.old.wholesale ?? null,
          newWholesale: c.new.wholesale ?? null,
          oldStock: c.old.stock ?? null,
          newStock: c.new.stock ?? null,
        },
      })));
      const { error: nErr } = await supabase.from('notifications').insert(notifications);
      if (nErr) console.log(`  ⚠ 알림 전송 실패: ${nErr.message} — notifications_type_check 제약 확인`);
    }
  }

  // 스로틀 방지 — 60개마다 휴식 (SD가 장기 연속 요청 시 회원가 정보를 빼고 응답함)
  if (checked % 60 === 0) {
    console.log(`⏳ ${checked}개 처리 — 스로틀 방지 휴식 90초`);
    await page.waitForTimeout(90_000);
  }
  await page.waitForTimeout(3000);
}

const statLine = Object.entries(stats).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(' / ') || '변동 없음';
console.log(`\n📊 변동 체크 완료: ${checked}개 / 변동 상품 ${changedProducts} (${statLine}) / 오류 ${errors}${DRY_RUN ? ' — dry-run이라 DB 미변경' : ''}`);

// ── 감시 목록: 품절/미거래로 미등록된 상품 — 재입고 시 자동 등록 ─────
// 등록 조건: 세트/가격 정보가 다시 보이는 것. 등록 상태는 import 기본 규칙대로
// inactive(관리자 검토 후 활성화). 페이지가 소실된 상품은 감시에서 제거한다.
const { data: watchRows } = await supabase.from('sd_watchlist').select('*').order('last_checked_at', { ascending: true, nullsFirst: true });
const watchlist = watchRows ?? [];
if (!watchlist.length) { console.log(`👁 감시 목록 비어 있음 — 종료`); await sd.close(); process.exit(0); }
if (!DRY_RUN) console.log(`👁 감시 목록 ${watchlist.length}개 — 재입고 확인 중...`);

// 브랜드 추론용 DB 기존 브랜드
const { data: wBrandRows } = await supabase.from('products_admin').select('brand');
const knownBrands = [...new Set((wBrandRows ?? []).map(r => r.brand).filter(Boolean))];

// 재입고 자동등록도 sd-import와 동일한 영문명 enrichment 파이프라인을 사용한다.
const OFFICIAL_SOURCES = NO_ENRICH ? [] : await loadOfficialSources(supabase);
const ENRICHMENT = buildEnrichmentOptions({
  enabled: !NO_ENRICH,
  officialSources: OFFICIAL_SOURCES,
  provider: ENRICH_PROVIDER,
  env: process.env,
});
if (!DRY_RUN && !NO_ENRICH) console.log(`🌐 공식 도메인 레지스트리 ${OFFICIAL_SOURCES.length}행 로드 — 재입고 영문명 자동 큐잉 활성화 (provider: ${ENRICH_PROVIDER})`);

const TRANSLATION = buildTranslationOptions({
  enabled: !NO_TRANSLATE,
  provider: ENRICH_PROVIDER,
  env: process.env,
});
if (!DRY_RUN && !NO_TRANSLATE) console.log('🌏 재입고 상품 설명 다국어 번역 자동 큐잉 활성화 (EN/ZH/KO)');

let registered = 0, stillOut = 0, watchGone = 0, watchErrors = errors, enrichQueued = 0, enrichFailed = 0;
for (const w of watchlist) {
  const url = `${BASE}/p/r/pd_p/${w.sd_product_id}/`;
  let wResp = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      wResp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      break;
    } catch (e) {
      if (attempt === 1) console.log(`⚠ [SD ${w.sd_product_id}] 접속 실패 — 스킵 (${e.message})`);
    }
  }
  if (!wResp) { watchErrors++; continue; }
  if (String(page.url()).includes('login')) {
    await sd.ensure();
    page = sd.page();
    wResp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  const gone = wResp.status() === 404 || !/pd_p\/\d+/.test(page.url());
  if (gone) {
    watchGone++;
    console.log(`❓ [SD ${w.sd_product_id}] 페이지 소실 — 감시 해제 (${w.name?.slice(0, 40) || ''})`);
    if (!DRY_RUN) await supabase.from('sd_watchlist').delete().eq('id', w.id);
    continue;
  }

  const wParsedRaw = await parseProductPage(page, url);
  // 일시적 렌더링 지연·세션 이슈 보호 — 세션 확인 + 재시도 3회
  let wParsed = wParsedRaw;
  for (let attempt = 0; attempt < 3 && wParsed.error; attempt++) {
    await page.waitForTimeout(3000);
    await sd.ensure();
    page = sd.page();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(2500);
    if (!/pd_p\/\d+/.test(page.url())) break;
    const wReparsed = await parseProductPage(page, page.url());
    if (!wReparsed.error) wParsed = wReparsed;
  }
  if (wParsed.error) {
    stillOut++;
    if (!DRY_RUN) await supabase.from('sd_watchlist').update({ last_checked_at: new Date().toISOString() }).eq('id', w.id);
    await page.waitForTimeout(1200);
    continue;
  }

  // 재입고 — 자동 등록 (등록 상태는 import 기본 규칙대로 inactive — 관리자 검토 후 활성화)
  if (DRY_RUN) {
    registered++;
    console.log(`♻️ [SD ${w.sd_product_id}] 재입고 감지 — 자동 등록 대상 (${wParsed.name.slice(0, 40)})`);
    continue;
  }
  try {
    const p = await buildProduct(page, wParsed, { knownBrands, status: 'inactive' });
    const r = await insertProduct(supabase, p, { enrichment: ENRICHMENT, translation: TRANSLATION });
    if (r.skipped) {
      console.log(`↷ [SD ${w.sd_product_id}] 이미 등록됨 — 감시 해제`);
      await supabase.from('sd_watchlist').delete().eq('id', w.id);
    } else {
      registered++;
      console.log(`✓ [SD ${w.sd_product_id}] 재입고 감지 — 자동 등록 (#${r.id}, ¥${p.wholesalePrice}, inactive — 검토 후 활성화)`);
      // 영문명 enrichment 큐잉 — 등록 성공이 우선, 실패는 별도 집계
      if (r.enrichment) {
        if (r.enrichment.enqueued) { enrichQueued++; console.log(`  🌐 영문명 작업 큐잉 (run ${String(r.enrichment.runId).slice(0, 8)}, grounding: ${r.enrichment.grounding ? 'on' : 'off'})`); }
        else if (r.enrichment.error) { enrichFailed++; console.log(`  ⚠ 영문명 큐잉 실패 (등록은 유지): ${r.enrichment.error}`); }
      }
      await supabase.from('sd_watchlist').delete().eq('id', w.id);
      if (adminIds.length) {
        const { error: nErr } = await supabase.from('notifications').insert(adminIds.map(member_id => ({
          member_id,
          type: 'product_registered',
          payload: { productId: r.id, productName: p.name, wholesalePrice: p.wholesalePrice },
        })));
        if (nErr) console.log(`  ⚠ 알림 전송 실패: ${nErr.message} — 20260916_sd_watchlist.sql 마이그레이션 확인`);
      }
    }
  } catch (e) {
    watchErrors++;
    console.log(`✗ [SD ${w.sd_product_id}] 자동 등록 실패 — ${e.message}`);
  }
  await page.waitForTimeout(1200);
}

// 감시 행별 last_checked_at은 루프 안에서 갱신됨
await sd.close();
console.log(`👁 감시 완료: 자동 등록 ${registered} / 여전히 품절 ${stillOut} / 소실 제거 ${watchGone} / 오류 ${watchErrors}${!NO_ENRICH && !DRY_RUN ? ` | 영문명 큐잉 ${enrichQueued} / 큐잉 실패 ${enrichFailed}` : ''}`);
process.exit(0);
