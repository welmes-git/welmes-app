// scripts/lib/sd-core.mjs
/**
 * Superdelivery 스크립트 공용 코어 — sd-import.mjs / sd-monitor.mjs 가 공유한다.
 * - .env 로딩, Supabase 클라이언트, Turnstile 로그인 세션(headful 1회 → headless 재사용)
 * - 상품 페이지 파싱(parseProductPage): 세트 가격·재고·이미지·breadcrumb
 * - 카테고리 매핑(관리자 화면 19그룹 라벨), 상품명 기반 브랜드 추론, 업체 브랜드 목록 로드
 * 순수 로직/유틸만 두고 CLI 플로우와 Supabase 쓰기는 각 스크립트가 담당한다.
 */
import fs from 'node:fs';
import { enqueueEnrichmentForProduct } from './product-name-enrichment.mjs';

// ── 설정 ─────────────────────────────────────────────────────────────
export const MARGIN = 1.1;             // 卸単価 × 1.1 → WELMES 회원 판매가(wholesale)
export const ORIGINAL_FALLBACK = 1.5;  // 参考上代(정가)가 오픈프라이스일 때: 単価 × 1.5
export const DEFAULT_STOCK = 50;       // 재고 표기가 '有り'일 때의 기본값
export const DELAY_MS = 700;           // 페이지 간 예의 지연
export const BASE = 'https://www.superdelivery.com';
export const SESSION_FILE = 'scripts/.sd-session.json';

// .env.local(비밀번호, git 제외) → .env(공개 VITE_ 값) 순으로 로드. 먼저 읽힌 값이 우선
export function loadEnvFiles() {
  for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      // dotenv's common single/double-quoted form, without trying to interpret
      // escapes (credentials must be passed byte-for-byte).
      const value = m[2].trim();
      process.env[m[1]] = (/^(["']).*\1$/.test(value)) ? value.slice(1, -1) : value;
    }
  }
}

// supabase-js는 기본 fetch에 타임아웃이 없어 네트워크 이상 시 무한 대기 → 45초 타임아웃 적용
export function createSupabase(createClient) {
  const sbFetch = (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(45_000) });
  return createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, { global: { fetch: sbFetch } });
}

// ── 카테고리 매핑 (상품명·장르·설명 → 관리자 화면 19그룹 라벨) ─────────
// 라벨은 src/config/categoryMenu.ts + src/locales/en/translation.json 의
// group/sub label 과 정확히 일치시킨다 — 어긋나면 관리자 편집 시 값이 리셋된다.
export const ADMIN_CATS = {
  skincare: 'Skincare', maskPack: 'Mask Pack', cleansing: 'Cleansing', sunCare: 'Sun Care',
  makeup: 'Makeup', beautyTools: 'Beauty Tools', dermoCosmetic: 'Derma Cosmetics', nail: 'Nail',
  hairCare: 'Hair Care', bodyCare: 'Body Care', fragrance: 'Fragrance', healthFood: 'Health Food',
  food: 'Food', healthGoods: 'Health · Wellness Goods', oralCare: 'Oral Care',
  hygiene: 'Hygiene Goods', fashion: 'Fashion', homeLiving: 'Home Living · Appliances', hobby: 'Hobby · Fancy',
};
// [그룹키, 서브키(선택), 키워드] — 구체적인 것부터 검사 (순서 = 우선순위)
export const CATEGORY_RULES = [
  ['fragrance', 'perfume',      /香水|フレグランス|オードトワレ|オードパフューム|パフューム/],
  ['fragrance', 'homeFragrance', /ルームフレグランス|アロマ|芳香剤|リードディフューザー|お香/],
  ['sunCare',   'sunCream',     /日焼け止め|UVカット|サンスクリーン|サンクリーム|日焼け/],
  ['sunCare',   'sunStick',     /サンスティック|スティックUV/],
  ['sunCare',   'sunSpray',     /サンスプレー|スプレーUV/],
  ['oralCare',  'toothpaste',   /歯磨き|ハミガキ|歯磨き粉|トゥースペースト/],
  ['oralCare',  'toothbrush',   /歯ブラシ|電動歯ブラシ|トゥースブラシ/],
  ['oralCare',  'afterOralCare', /マウスウォッシュ|デンタルリンス|洗口液/],
  ['nail',      'gelNail',      /ジェルネイル|ジェルマニキュア/],
  ['nail',      'basicNail',    /ネイル|マニキュア/],
  ['makeup',    'lipMakeup',    /口紅|リップスティック|リップグロス|リップクリーム(?=.*(色|カラー))/],
  ['makeup',    'eyeMakeup',    /アイシャドウ|アイライナー|マスカラ|アイブロウ|眉ペン|眉マスカラ/],
  ['makeup',    'baseMakeup',   /ファンデーション|ファンデ|コンシーラー|チーク|ベースメイク|プレイメイク|フェイスパウダー/],
  ['maskPack',  'sheetMask',    /シートマスク|フェイスマスク/],
  ['maskPack',  'facialPack',   /フェイスパック|パック(?=.*(化粧|スキン|保湿))/],
  ['cleansing', 'lipEyeRemover', /ポイントメイク落とし|リップアイリムーバー/],
  ['cleansing', 'foamGel',      /クレンジング|洗顔|メイク落とし/],
  ['skincare',  'serum',        /美容液|エッセンス|セラム|アンプル|ビューティーエッセンス/],
  ['skincare',  'toner',        /化粧水|スキンローション|フェイストナー/],
  ['skincare',  'lotion',       /乳液|エミュレション|ミスト/],
  ['skincare',  'cream',        /クリーム|オールインワン(?=.*ゲル)|ゲル(?=.*保湿)/],
  ['hairCare',  'scalpCare',    /スカルプ|頭皮/],
  ['hairCare',  'shampoo',      /シャンプー|スキャラー/],
  ['hairCare',  'hairColor',    /ヘアカラー|カラートリートメント|ヘアマニキュア|ヘアパーマ/],
  ['hairCare',  'hairEssence',  /ヘアオイル|ヘアエッセンス|ヘアミルク|ヘアワックス|ヘアバーム/],
  ['hairCare',  'treatment',    /ヘアトリートメント|コンディショナー|リンス|ヘアパック|リペア(?=.*シャンプー)/],
  ['beautyTools','faceTools',   /美顔器|美容機器|フェイスローラー|マッサージ器(?=.*顔)/],
  ['beautyTools','hairBodyTools', /ドライヤー|ヘアアイロン|シェーバー|脱毛器|ヘアブラシ|マッサージ器/],
  ['bodyCare',  'handCare',     /ハンドクリーム|ハンドミルク|ハンドセラム/],
  ['bodyCare',  'footCare',     /フットクリーム|フットケア|かかと(?=.*クリーム)/],
  ['bodyCare',  'deodorant',    /デオドラント|制汗剤|デオドラントスティック/],
  ['bodyCare',  'bodyLotion',   /ボディローション|ボディクリーム|ボディミルク|ボディオイル|ボディソープ|ボディシャンプー/],
  ['bodyCare',  'showerBath',   /入浴剤|バスソルト|バスオイル|入浴|バス(?=.*塩|.*錠)/],
  ['bodyCare',  'showerBath',   /石鹸|せっけん|ソープ(?=.*ボディ|.*洗顔)/],
  ['healthFood','vitamin',      /ビタミン|マルチビタミン/],
  ['healthFood','probiotics',   /乳酸菌|プロバイオティクス|ビフィズス菌|善玉菌|プロテイン(?=.*菌)/],
  ['healthFood','supplement',   /サプリ|サプリメント|プロテイン|酵素|コラーゲン|プラセンタ|DHA|EPA|鉄分|カルシウム|マグネシウム|亜鉛|アミノ酸|BCAA|HMB|青汁|スムージー(?=.*粉)/],
  ['healthFood','innerBeauty',  /ダイエット|インナービューティー|痩身/],
  ['food',      'snacks',       /菓子|チョコレート|スイーツ|クッキー|ビスケット|キャンディ|グミ|マシュマロ|煎餅|あられ/],
  ['food',      'drinks',       /コーヒー|紅茶|緑茶|抹茶|麦茶|ドリンク|飲料|ジュース|炭酸水|ミネラルウォーター|水(?=.*mm)/],
  ['healthGoods','massageSupport', /マッサージ(?=.*器|.*ジェル)|サポーター|テーピング/],
  ['hygiene',   'testKit',     /検査キット|テストキット|体温計|血圧計/],
  ['healthGoods','patchCare',   /絆創膏|キズパワーパッド|リペアテープ|湿布/],
  ['hygiene',   'tissuePaper',  /ティッシュ|トイレットペーパー|ウェットティッシュ|ペーパータオル|キッチンペーパー/],
  ['hygiene',   'diapers',      /おむつ|紙おむつ|パッド(?=.*失禁)/],
  ['homeLiving','cleaning',     /洗剤|柔軟剤|柔軟仕上げ剤|漂白剤|カビ取り|トイレ用クリーナー|クリーナー(?=.*洗浄)/],
  ['homeLiving','appliances',   /家電|エアコン|空気清浄機|加湿器|除湿器|炊飯器|電子レンジ|オーブン|電気ポット|空清|サーキュレーター/],
  ['homeLiving','kitchen',      /キッチン|食器|フライパン|鍋(?=.*調理)|保存容器|ラップ|ホイル/],
  ['homeLiving','interior',     /インテリア|家具|照明|ライト|ランプ|電球/],
  ['bodyCare',  'babyMom',      /ベビー|マタニティ|おしりふき/],
  ['homeLiving','babyGoods',    /キッズ/],
  ['fashion',   'fashionAccessories', /バッグ|財布|帽子|ベルト|マフラー|手袋|サングラス(?=.*ファッション)/],
  ['fashion',   'underwear',    /下着|アンダーウェア|ブラジャー(?=.*补正)/],
  ['fashion',   null,           /アパレル|レディース(?=.*服)|ワンピース|シャツ|パンツ|スカート|靴|シューズ/],
  ['hobby',     'characterGoods', /キャラクター|フィギュア/],
  ['hobby',     'stationery',   /文具|ステーショナリー|ノート|ペン(?=.*筆記)|アルバム/],
];
// 서브 라벨도 관리자 화면(en translation.json categoryMenu.*)과 정확히 일치
export const ADMIN_SUBS = {
  perfume: 'Perfume', homeFragrance: 'Home Fragrance', sunCream: 'Sun Cream', sunStick: 'Sun Stick',
  sunSpray: 'Sun Spray · Patch', toothpaste: 'Toothpaste', toothbrush: 'Toothbrushes',
  afterOralCare: 'Mouthwash · After Care', gelNail: 'Gel Nail', basicNail: 'Nail Polish',
  lipMakeup: 'Lip Makeup', eyeMakeup: 'Eye Makeup', baseMakeup: 'Base Makeup',
  sheetMask: 'Sheet Masks', facialPack: 'Facial Packs', lipEyeRemover: 'Lip & Eye Remover',
  foamGel: 'Foam · Gel', serum: 'Essence · Serum · Ampoule', toner: 'Toner', lotion: 'Lotion',
  cream: 'Cream', scalpCare: 'Scalp Care', shampoo: 'Shampoo · Scaler', hairColor: 'Hair Color · Perm',
  hairEssence: 'Hair Essence', treatment: 'Treatment · Pack', faceTools: 'Face Tools',
  hairBodyTools: 'Hair · Body Tools', handCare: 'Hand Care', footCare: 'Foot Care',
  deodorant: 'Deodorant', bodyLotion: 'Body Lotion · Cream', showerBath: 'Shower · Bath', babyMom: 'Baby · Maternity',
  vitamin: 'Vitamins', probiotics: 'Probiotics', supplement: 'Supplements',
  innerBeauty: 'Slimming · Inner Beauty', massageSupport: 'Massage · Supports',
  snacks: 'Snacks · Chocolate · Dessert', drinks: 'Water · Drinks · Coffee',
  testKit: 'Test Kits', patchCare: 'Patches · Spot Care', tissuePaper: 'Tissue · Paper',
  diapers: 'Diapers', cleaning: 'Detergent · Cleaning', appliances: 'Appliances',
  kitchen: 'Kitchen', interior: 'Interior', babyGoods: 'Baby · Kids Goods',
  fashionAccessories: 'Fashion Accessories', underwear: 'Underwear',
  characterGoods: 'Character Goods', stationery: 'Fancy · Stationery',
};

export const mapCategory = (text) => {
  for (const [group, sub, re] of CATEGORY_RULES) {
    if (re.test(text)) return { category: ADMIN_CATS[group], subcategory: sub ? ADMIN_SUBS[sub] : undefined };
  }
  return null;
};

// ── 브랜드 추론 (상품명 기반) ────────────────────────────────────────
// 일본 상품명은 「브랜드명 + 상품명」 구성이 대부분이라 상품명 안에 브랜드명이 포함된다.
// 긴 이름 우선 매칭 (「ロート製薬」을 「ロート」보다 먼저 잡도록), 표기 여유는
// 정규화(전각→반각·대소문자·카타카나→히라가나·공백 제거)로 흡수한다.
// brand 컬럼은 free text라 DB에 없던 신규 브랜드도 그대로 insert 되고
// 관리자 대시보드 브랜드 추천 목록(datalist)에 자동 반영된다.
const normalizeForMatch = (s) => s
  .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
  .toLowerCase()
  .replace(/[\u30A1-\u30F4]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
  .replace(/[\s\u3000]+/g, '');

export function inferBrandFromName(name, brands) {
  if (!name || !Array.isArray(brands)) return '';
  const n = normalizeForMatch(name);
  let best = '';
  for (const b of brands) {
    if (!b || b.trim().length < 2) continue;
    if (n.includes(normalizeForMatch(b)) && b.length > best.length) best = b;
  }
  return best;
}

// ── Playwright 세션 ──────────────────────────────────────────────────

/** Turnstile 자동 로그인. 세션 만료 시에만 호출 — headful 창이 뜬다. 챌린지로 폼이 늦게 뜰 수 있어 3회 재시도. */
async function loginHeadful(chromium) {
  console.log('🔑 세션 만료 — 로그인 브라우저를 띄웁니다 (Turnstile 자동 처리, 최대 90초)...');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE}/p/do/clickMemberLogin`, { waitUntil: 'domcontentloaded' });
      // Turnstile 챌린지가 폼 앞을 가로막을 수 있다 — 폼이 뜰 때까지 기다린다
      await page.waitForSelector('input[name="identification"]', { timeout: 45_000 });
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
      if (String(page.url()).includes('login')) throw new Error('로그인 후에도 login 페이지 — 아이디/비밀번호 확인');
      await ctx.storageState({ path: SESSION_FILE });
      console.log('✅ 로그인 성공, 세션 저장');
      await browser.close();
      return;
    } catch (e) {
      await browser.close().catch(() => {});
      if (attempt === 3) throw new Error(`로그인 실패 (${3}회 시도) — 아이디/비밀번호 또는 Turnstile 확인 필요: ${e.message?.slice(0, 80)}`);
      console.log(`   ⚠ 로그인 시도 ${attempt}/3 실패 — 5초 후 재시도 (${e.message?.slice(0, 60)})`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

// Logged-in-only navigation is present in the DOM even when its dropdown is
// closed. The old visibility check targeted removed/hidden selectors and
// falsely declared every saved session expired, forcing a headful login on
// every run (which then timed out under launchd).
const isLoggedInPage = async (page) =>
  !String(page.url()).includes('login')
  && await page.locator('a[href*="/logout.do"], a[href*="memberManage"]').count().then(n => n > 0).catch(() => false);

/** 저장된 세션으로 headless 컨텍스트. 유효하지 않으면 재로그인 후 재생성. */
async function getScraperContext(chromium) {
  if (!fs.existsSync(SESSION_FILE)) await loginHeadful(chromium);
  let ctx = await chromium.launch({ headless: true }).then(b => b.newContext({ storageState: SESSION_FILE }));
  return { browser: ctx.browser(), ctx };
}

/**
 * 스크래퍼 세션 — page 접근자와 세션 만료 시 재로그인(ensure)을 제공한다.
 *   const sd = await createSdSession(chromium);
 *   await sd.page().goto(...);  await sd.ensure();  await sd.close();
 */
export async function createSdSession(chromium) {
  let browser, ctx, page;
  const openContext = async () => {
    ({ browser, ctx } = await getScraperContext(chromium));
    page = await ctx.newPage();
  };
  await openContext();
  return {
    page: () => page,
    /** 세션 만료 시 재로그인하고 새 컨텍스트로 교체 */
    async ensure() {
      await page.goto(`${BASE}/p/do/shoppingCart`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
      if (String(page.url()).includes('login') || !(await isLoggedInPage(page))) {
        await loginHeadful(chromium);
        await browser.close();
        await openContext();
      }
    },
    async close() { await browser.close(); },
  };
}

// ── 상품 이미지 정규화 ───────────────────────────────────────────────
/**
 * 갤러리에서 수집한 원시 이미지 후보 문자열(src/data-src/srcset)을
 * 상품 대표 이미지 URL 목록으로 정규화한다. 순수 함수(브라우저 비의존)라
 * 단위 테스트 대상이다.
 *
 * 규칙:
 *  1) `c.superdelivery.com/…/product_image/…` CDN 경로만 추출.
 *  2) sdId가 있으면 파일명이 해당 SD ID로 시작하는 이미지만 허용 →
 *     この企業の関連商品 / よく一緒にチェックされている商品 등 추천 섹션의
 *     다른 상품 이미지를 배제(2차 방어).
 *  3) 같은 원본 이미지의 `.webp`/`.jpg` 및 CDN 변환 prefix(`sa`/`sap`) 차이는
 *     동일 이미지로 보고 중복 제거하되, 원본(non-webp) URL을 우선 보존.
 *
 * @param {string[]} candidates 원시 후보 문자열 배열
 * @param {string|null} sdId 이 상품의 SD 품번
 * @returns {string[]} `https://…` 절대 URL 목록(문서 순서 유지)
 */
export function normalizeProductImages(candidates, sdId = null) {
  const idFilter = sdId ? new RegExp(`product_image/[^\\s"')]*/${sdId}[_.]`) : null;
  const paths = (candidates || [])
    .map(s => String(s).match(/c\.superdelivery\.com\/[^\s"')]*product_image\/[^\s"')]+/)?.[0] || '')
    .filter(Boolean)
    .filter(p => !idFilter || idFilter.test(p));

  const seen = new Map();
  const images = [];
  for (const p of paths) {
    const path = p.replace(/^https?:\/\//, '').replace(/^\/\//, '');
    const sourcePath = path.match(/product_image\/.*$/)?.[0] ?? path;
    const key = sourcePath.replace(/\.webp(?=($|\?))/, '');
    const isWebp = /\.webp(?=($|\?))/.test(path);
    const url = `https://${path}`;
    if (seen.has(key)) {
      const idx = seen.get(key);
      // 원본(non-webp) URL을 우선 보존
      if (!isWebp && /\.webp(?=($|\?))/.test(images[idx])) images[idx] = url;
      continue;
    }
    seen.set(key, images.length);
    images.push(url);
  }
  return images;
}

// ── 상품 페이지 파싱 ─────────────────────────────────────────────────
/**
 * 상품 페이지(/p/r/pd_p/…)를 파싱해 세트 가격·재고·이미지·breadcrumb 등을 반환.
 * 브랜드/카테고리 결정(추가 네비게이션 필요)은 각 스크립트의 몫 — 모니터는
 * 이 함수만으로 가격/재고 비교를 한다.
 *
 * 반환: { sdId, name, setOptions, stock, jan, images, description,
 *         brandLink, dealerFallback, dealerUrl, genres, discount, error }
 * error: { kind: 'not_trading'|'no_sets', message } — 세트/가격을 못 읽은 경우
 */
export async function parseProductPage(page, productUrl) {
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
    // 명시적 브랜드 링크(word= 검색 / br= 업체 refine)와 출기업 breadcrumb fallback
    // (「…（すべてのジャンル）」)을 분리 — breadcrumb은 브랜드가 아니라 업체명이다.
    const crumbLinks = [...document.querySelectorAll('.brand-genre a[href*="/p/do/dpsl/"], .brand-genre a[href*="/p/do/psl/"]')]
      .map(a => ({ text: a.innerText.trim(), isBrand: a.href.includes('word=') || /[?&]br=/.test(a.href), href: a.href }));
    let brandLink = '';
    let dealerFallback = '';
    let dealerUrl = '';
    const genres = [];
    for (const c of crumbLinks) {
      if (c.isBrand) { brandLink = brandLink || c.text; continue; }
      if (c.text.includes('すべてのジャンル')) { dealerFallback = c.text.replace(/（すべてのジャンル）/, '').trim(); dealerUrl = c.href; continue; }
      if (c.text) genres.push(c.text);
    }

    // 이미지 — 메인 상품 갤러리(product_image_preview)에서만 CDN 경로 수집.
    // 하단 추천 섹션(この企業の関連商品 / よく一緒にチェックされている商品 /
    // 最近チェックした商品)은 `recommend-img` 클래스를 쓰므로 셀렉터에서 제외된다.
    // 과거에는 페이지 전체 `img`를 긁어 추천 상품 이미지까지 등록되는 버그가 있었다.
    // DOM에서는 원시 후보 문자열만 수집하고, 필터·정규화·중복 제거는
    // 순수 함수 normalizeProductImages()가 처리한다(단위 테스트 대상).
    const imageCandidates = [...document.querySelectorAll(
      'picture.product_image_preview img, picture.product_image_preview source, '
      + 'img.product_image_preview, source.product_image_preview, '
      + '.thum-image-box-wrapper .product_image_preview_thumbnail img, '
      + '.thum-image-box-wrapper .product_image_preview_thumbnail source, '
      + '.detail-modal-thum-box img, #product_image_detail img'
    )].flatMap(el => [el.getAttribute('src') || '', el.getAttribute('data-src') || '', el.getAttribute('srcset') || '']);

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
    return { name, setBlocks, brandLink, dealerFallback, dealerUrl, genres, imageCandidates, description, isNotTrading };
  });

  // 이미지 필터·정규화·중복 제거 (브라우저 밖 순수 로직, 단위 테스트 대상)
  data.images = normalizeProductImages(data.imageCandidates, sdId);

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
    return {
      sdId, name: data.name, setOptions: [], stock: 0, jan, images: data.images,
      description: data.description, brandLink: data.brandLink, dealerFallback: data.dealerFallback,
      dealerUrl: data.dealerUrl, genres: data.genres, discount: 0,
      error: {
        kind: data.isNotTrading ? 'not_trading' : 'no_sets',
        message: data.isNotTrading
          ? '미거래 업체 — 도매가(卸単価) 비공개. 거래 신청 후 등록 가능'
          : '세트/가격 정보 없음 (품절 또는 비공개)',
      },
    };
  }

  const s1 = setOptions[0];
  const discount = s1.originalPrice > s1.wholesalePrice ? Math.round((1 - s1.wholesalePrice / s1.originalPrice) * 100) : 0;

  return {
    sdId,
    name: data.name,
    setOptions,
    stock,
    jan,
    images: data.images,
    description: data.description,
    brandLink: data.brandLink,
    dealerFallback: data.dealerFallback,
    dealerUrl: data.dealerUrl,
    genres: data.genres,
    discount,
    error: null,
  };
}

// ── 업체 브랜드 목록 ─────────────────────────────────────────────────
// 상품 breadcrumb 의 출기업(업체) 페이지에서 브랜드 refine 링크 텍스트를 긁어
// 그 업체가 실제 취급하는 브랜드 목록으로 쓴다 — 상품명 기반 추론의 1차 후보.
// 업체당 1회만 fetch 하고 캐시. 실패해도 다음 후보(DB 기존 브랜드)로 이어진다.
const dealerBrandCache = new Map();
export async function getDealerBrands(page, dealerUrl) {
  if (!dealerUrl) return [];
  if (dealerBrandCache.has(dealerUrl)) return dealerBrandCache.get(dealerUrl);
  dealerBrandCache.set(dealerUrl, []); // 실패 반복 방지
  try {
    await page.goto(dealerUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1500);
    if (String(page.url()).includes('login')) return [];
    const brands = await page.$$eval('.refine-search-list a[href*="br="]', as =>
      as.map(a => a.innerText.trim()).filter(Boolean)
    );
    dealerBrandCache.set(dealerUrl, brands);
    if (brands.length) console.log(`   🏷 업체 브랜드 ${brands.length}개 로드 — 상품명 추론에 사용`);
    return brands;
  } catch { return []; }
}

// ── 상품 등록 (import / monitor 공용) ────────────────────────────────

/** CDN 이미지를 Supabase Storage로 업로드 (최대 8장) */
export async function uploadProductImages(supabase, images) {
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

/**
 * 등록 — sd_product_id 중복이면 skip. 성공 시 감시 목록(watchlist) 정리:
 * 수집 당시 품절/미거래로 감시 목록에 있던 상품이 다른 경로(import 재실행 등)로
 * 등록됐다면 감시할 필요가 없다. sd_watchlist 테이블이 없으면 조용히 무시.
 */
export async function insertProduct(supabase, p, options = {}) {
  const { data: dup } = await supabase.from('products_admin').select('id').eq('sd_product_id', p.sdId).maybeSingle();
  if (dup) return { skipped: true }; // 중복 상품은 enrichment job도 생성하지 않는다

  const images = await uploadProductImages(supabase, p.images);
  const row = {
    name: p.name, name_en: p.nameEn, brand: p.brand, category: p.category,
    image: images[0] || p.image, images,
    original_price: p.originalPrice, wholesale_price: p.wholesalePrice, discount: p.discount,
    tags: p.tags, description: p.description, stock: p.stock, status: p.status,
    set_options: p.setOptions, sd_product_id: p.sdId, jan: p.jan || null,
    sd_dealer_id: p.dealerId, sd_dealer_name: p.dealerName,
  };
  const { data, error } = await supabase.from('products_admin').insert([row]).select('id').single();
  if (error) {
    if (String(error.message).includes('sd_product_id'))
      throw new Error(`sd_product_id 컬럼 없음 — Supabase SQL Editor에서 supabase/migrations/20260912_sd_source.sql 실행 후 재시도 (${error.message})`);
    throw new Error(error.message);
  }
  await supabase.from('sd_watchlist').delete().eq('sd_product_id', p.sdId); // 실패해도 등록에는 지장 없음

  // 영문명 enrichment 작업 큐잉 — 등록 성공이 최우선이므로 실패해도 throw하지 않는다.
  // (성공 기준: "API 장애가 Super Delivery 수집 성공에 미치는 영향 0건")
  let enrichment = null;
  const enrichOptions = options.enrichment;
  if (enrichOptions?.enabled) {
    enrichment = await enqueueEnrichmentForProduct(
      supabase,
      {
        id: data.id,
        name: p.name,
        brand: p.brand,
        category: p.category,
        description: p.description,
        sd_product_id: p.sdId,
        jan: p.jan || null,
      },
      enrichOptions.officialSources || [],
      {
        provider: enrichOptions.provider,
        model: enrichOptions.model,
        env: enrichOptions.env,
        grounding: enrichOptions.grounding,
        priority: enrichOptions.priority,
        maxAttempts: enrichOptions.maxAttempts,
      },
    );
  }
  return { id: data.id, images: images.length, enrichment };
}

/**
 * 파싱 결과(parsed) → 등록용 상품 객체. 브랜드 결정 우선순위:
 *   1. brandOption (--brand 옵션 — 브랜드 refine으로 좁힌 목록이면 신뢰 가능)
 *   2. 상품 페이지의 명시적 브랜드 링크(word=/br=)
 *   3. 상품명 기반 추론 — 업체 브랜드 목록(업체 페이지에서 1회 로드·캐시) → DB 기존 브랜드 (긴 이름 우선 매칭)
 *   4. 출기업 breadcrumb (업체명 — 브랜드는 아니지만 이전 동작 유지)
 */
export async function buildProduct(page, parsed, { brandOption = '', knownBrands = [], status = 'inactive' } = {}) {
  const dealerBrands = await getDealerBrands(page, parsed.dealerUrl);
  const brand =
    brandOption
    || parsed.brandLink
    || inferBrandFromName(parsed.name, dealerBrands)
    || inferBrandFromName(parsed.name, knownBrands)
    || parsed.dealerFallback
    || 'Unknown';

  // 카테고리 결정: 상품명+장르 → 설명 순으로 키워드 매칭, 그래도 없으면 Health Food
  const cat = mapCategory(`${parsed.name}\n${parsed.genres.join(' ')}`)
    ?? mapCategory(parsed.description.slice(0, 800))
    ?? { category: 'Health Food', subcategory: 'Supplements' };

  // ProductCard/ProductDetail render tags as marketing badges (Sale/Best/New/Hot only) —
  // genre, JAN code, and source name aren't marketing tags and rendered as raw gray badges.
  return {
    sdId: parsed.sdId,
    jan: parsed.jan || null,
    name: parsed.name,
    nameEn: parsed.name, // 일본어 원명 그대로 — 관리자 화면에서 영문명 수정 권장
    brand,
    category: cat.category,
    subcategory: cat.subcategory,
    image: parsed.images[0] || '',
    images: parsed.images,
    originalPrice: parsed.setOptions[0].originalPrice,
    wholesalePrice: parsed.setOptions[0].wholesalePrice,
    discount: parsed.discount,
    tags: parsed.discount > 0 ? ['Sale'] : [],
    description: parsed.description,
    stock: parsed.stock,
    status,
    setOptions: parsed.setOptions,
    dealerId: parsed.dealerUrl.match(/dpsl\/(\d+)/)?.[1] ?? null,
    dealerName: parsed.dealerFallback || null,
  };
}

/**
 * 활성 브랜드 공식 도메인 레지스트리(brand_official_sources)를 로드한다.
 * enrichment worker가 grounding 근거를 검증할 때 사용한다. 테이블이 아직
 * 없거나(20260920 마이그레이션 미적용) 조회가 실패해도 수집을 막지 않도록
 * 빈 배열을 반환하고 경고만 남긴다.
 */
export async function loadOfficialSources(supabase) {
  try {
    const { data, error } = await supabase.from('brand_official_sources').select('*').eq('active', true);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.log(`  ⚠ 공식 도메인 레지스트리 로드 실패 — 영문명은 생성(generated) 경로로만 처리됩니다 (${e.message})`);
    return [];
  }
}

/**
 * insertProduct 로 넘길 enrichment 옵션 묶음을 만든다. --no-enrich 등으로
 * 비활성화하면 enabled=false 가 되어 기존 등록 동작을 그대로 유지한다.
 */
export function buildEnrichmentOptions({
  enabled = true, officialSources = [], provider = 'gemini', model = '',
  env = process.env, grounding = true, priority = 0, maxAttempts = 3,
} = {}) {
  return { enabled, officialSources, provider, model, env, grounding, priority, maxAttempts };
}
