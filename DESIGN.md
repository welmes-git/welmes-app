---
version: 1
name: WELMES-design-system
description: 일본 화장품·건강식품 B2B 도매 마켓플레이스. 순백 캔버스 위 완전 무채색 UI — 색은 오직 상품 사진에서만 나온다. 올리브영의 촘촘한 상품 그리드 밀도에 Faire식 도매 정보 구조(가격 게이팅·세트 단가)를 얹었다. 강조색 없음: 위계는 타이포 굵기·크기·여백으로만 만든다.
---

# WELMES DESIGN.md

AI 코딩 에이전트와 사람이 함께 읽는 기준 문서. 화면을 만들거나 고칠 때 **먼저 이 파일을 읽고**, 여기 없는 색·크기·간격을 새로 만들지 않는다.

레퍼런스 출처: 상품 그리드 밀도는 올리브영 / 무채색 커머스 문법은 29CM·MUSINSA·Nike / 도매 정보 구조와 가격 게이팅은 **Faire**(실제 마크업 확인, 2026-09-12).

---

## 1. 비주얼 테마

순백 캔버스, 무채색 크롬, 사진이 주인공.

- **UI에 브랜드 색을 두지 않는다.** 버튼·배지·배경·가격 어디에도 채도가 없다. 화면의 채도는 100% 상품 패키지 사진에서 나온다.
- 위계는 **굵기(400/500/700/800) · 크기 · 여백**으로만 만든다. 색으로 강조하고 싶어지면, 그건 타이포가 약하다는 뜻이다.
- 장식 금지: 그라데이션, 글로우, 일러스트 아이콘, 알약형 컬러 배지, 드롭섀도우 남발.
- 밀도는 촘촘하게, 섹션 사이는 넉넉하게. "위는 열리고 아래는 빽빽하게."

---

## 2. 컬러

```css
--canvas:          #FFFFFF;  /* 페이지 바탕. 기본값 */
--surface-sunken:  #F5F4F4;  /* 이미지 플레이스홀더, 테이블 헤더, 섹션 구분 바탕 */
--surface-raised:  #FFFFFF;  /* 카드. 바탕과 같고 보더로만 구분 */

--ink-900:         #141414;  /* CTA 채움, 최상위 강조 숫자 */
--ink-700:         #333333;  /* 본문·상품명·가격·별 아이콘 (Faire text-primary와 동일) */
--ink-500:         #6C6A6A;  /* 브랜드명, 보조 설명, 비활성 탭 (Faire border-subdued와 동일) */
--ink-300:         #A8A6A6;  /* 취소선 원가, 플레이스홀더 */

--line:            #E5E3E3;  /* 1px 헤어라인 보더 */
--line-strong:     #C9C6C6;  /* 인풋·스텝퍼 보더, 아웃라인 버튼 */
--line-control:    #DADADA;  /* 상품 타일 x-small 버튼 보더 (Faire 실측) */

--on-ink:          #FFFFFF;  /* ink-900 위의 글자 */
```

### 채도가 허용되는 유일한 자리

기능적 경고에만 쓴다. **상품 그리드·가격·프로모션에는 절대 쓰지 않는다.**

```css
--signal-error:    #C0392B;  /* 폼 검증 실패, 품절, 결제 실패 */
--signal-ok:       #1E7F4F;  /* 승인 완료, 주문 성공 */
```

> 할인율·세일·베스트는 **색이 아니라 굵기**로 표시한다. `33%`는 빨강이 아니라 `--ink-900` + weight 800.

### 다크 모드

고객 화면은 라이트 전용. 관리자 화면만 추후 다크 지원. 다크를 넣을 때는 위 토큰을 반전시키되 `--ink-700`↔`#E8E8E8`, `--line`↔`#2C2C2C` 식으로 역할을 유지한다.

---

## 3. 타이포그래피

### 패밀리

```css
font-sans:  Graphik, 'Hanken Grotesk', Pretendard, system-ui, sans-serif;  /* UI 전부 */
font-serif: Nantes, Newsreader, Pretendard, Georgia, serif;               /* 큰 제목 전용 (Faire display) */
font-jp:    'Pretendard JP', Pretendard, sans-serif;                        /* 일본어 상품명 전용 */
font-logo:  'Cormorant Garamond', Georgia, serif;                         /* WELMES 로고만 */
```

Faire의 Graphik·Nantes는 유료 라이선스라 무료 대체 서체(Hanken Grotesk·Newsreader, Google Fonts)를 쓴다. 목록 맨 앞의 Graphik·Nantes는 라이선스 파일을 `@font-face`로 추가하면 자동으로 적용되게 둔 자리다. 두 서체 모두 한글·가나가 없어 해당 글자는 Pretendard로 표시된다. `font-serif`(굵기 400)는 Faire display 자리에만 쓴다: 메인 섹션 제목 Weekly Best Sellers·New Arrivals·Popular Brands(22/32, Faire pageHeaderSerif), 검색 결과 제목·사업자 회원 전용 띠(30/38), 가입 배너 제목(38/50), 메인 히어로 제목(52/64).

**사이트 기본 언어는 영어다.** UI 문구는 영어로 쓰고 나머지 10개 언어는 `src/locales/*/translation.json`로 번역한다 (`fallbackLng: 'en'`).

일본어 상품명에는 반드시 `.font-jp`를 준다 — Pretendard로 일본어를 렌더하면 한자 자형이 한국식으로 나온다. `ProductCard`는 상품명에 가나·한자가 있으면 자동으로 붙인다.

숫자가 세로로 줄 서는 곳(가격, 수량, 합계, 테이블)은 Tailwind의 `tabular-nums` 유틸리티를 쓴다.

### 스케일

| 토큰 | 크기/굵기/자간 | 용도 |
|---|---|---|
| `display-lg` | 30px / 800 / -0.02em | 페이지 최상단 타이틀 |
| `display-md` | 22px / 800 / -0.01em | 상품 상세 상품명 |
| `heading` | 17px / 800 / -0.01em | 섹션 제목 ("인기 상품") |
| `subheading` | 15px / 700 | 카드 가격, 소계 |
| `body` | 13px / 400 / 1.6 | 본문 |
| `product-name` | 12.5px / 500 / 1.45 | 카드 상품명 (2줄 고정) |
| `meta` | 11.5px / 400 | 브랜드명, 별점, 재고 |
| `label` | 11px / 700 / 0.02em | 버튼 라벨, 배지, 테이블 헤더(대문자) |
| `micro` | 10px / 600 | 세트 구성 보조설명 |

제목을 키우고 싶은 충동을 누른다. Faire·Airbnb 모두 H1이 28px 안팎이다 — **사진이 무게를 지탱하므로 타이포로 힘주지 않는다.**

---

## 4. 컴포넌트

### 상품 카드 (핵심)

faire.com 상품 타일을 **실측**해 그대로 옮겼다 (2026-09-13, 1440px 화면·타일 217px, `getComputedStyle`). 구조·치수를 바꾸지 않는다.

```
[이미지 1:1]        ← 배지 top-left 8px · (로그인 시) 찜 top-right 8px
[8px]
가격   18/26 medium  ← 잠김이면 통화기호만 선명, 숫자 blur 8px
[2px]
상품명 14/20 medium  ← 1줄 말줄임
브랜드 14/20 regular ← #333 (회색 아님)
[12px]
[도매가 확인하기 →]  ← 34px 슬롯
```

- **이미지**: `aspect-ratio: 1`, `object-fit: cover`, radius **4px**, **보더 없음**. 이미지 위에 `rgba(0,0,0,.02)` 오버레이를 깔아 흰 배경 패키지샷을 페이지와 구분한다.
- **배지**: `top/left 8px`, 12px/16px medium, `--ink-700`, 흰 바탕 + **흰색 1px 보더**(보이지 않음), radius 4px, 패딩 `3px 3px`(모바일) / `3px 7px`(lg), 최소 22px(실측 높이 24px). 문구는 `New` `Best` `Sale` `Hot` 화이트리스트 + 품절.
- **찜하기**: Faire처럼 **로그인한 사용자에게만** 표시. 24px 흰 원, 아이콘 `--ink-700`, 선택 시 `--ink-900` 채움.
- **별점 없음.** Faire 타일에 없다.
- **CTA 버튼 (x-small secondary)**: 높이 34px, `1px solid --line-control(#DADADA)`, radius 4px, 패딩·gap 8px, 12px/16px regular 좌측 정렬. 폭은 내용만큼(뷰포트 361px 미만은 꽉 채움). 화살표 12px는 **타일 폭 180px 이상일 때만** (`.tile-cta` 컨테이너 쿼리).
- 타일 바닥의 34px 슬롯 하나에 상태별 내용만 바뀐다 — 잠김: 잠금해제 버튼 / 승인+빠른담기: 담기 버튼 / 그 외: 재고 텍스트. 어떤 상태에서도 바닥선이 같다.
- 글자 자간 0.15px (Faire 동일). 서체는 Graphik 대신 Pretendard.

### 가격 게이팅 — 비승인 바이어

WELMES는 승인된 사업자에게만 도매가를 연다. **가격 영역을 비우지 않는다.**

```html
<!-- 잠김: 통화 기호는 선명하게, 숫자만 블러 -->
<div class="flex items-baseline gap-[2px]">
  <span class="price-currency">¥</span>
  <span class="price-blurred blur-sm select-none" aria-hidden="true">XX,XXX</span>
</div>
<a class="btn-secondary btn-xs">도매가 확인하기 →</a>
```

- 통화 기호(`¥`)는 **블러하지 않는다.** 가격이 존재한다는 사실은 보여주고 값만 감춘다.
- 블러 처리된 숫자는 `aria-hidden="true"` + `select-none` — 스크린리더와 복사에서 제외.
- CTA와 하단 슬롯 규격은 위 상품 카드 참고.

상태별 문구:
| 상태 | 가격 영역 | 하단 슬롯 | i18n 키 |
|---|---|---|---|
| 비로그인 | 블러 | `Unlock wholesale price →` | `products.unlockPrice` |
| 로그인·승인대기 | 블러 | `Price visible after approval` (비활성) | `products.pendingPrice` |
| 승인 완료 | 실제 가격 | 담기 버튼 또는 재고 텍스트 | `productDetail.chooseSet` 등 |

### 버튼

| 종류 | 스타일 |
|---|---|
| Primary | `--ink-900` 채움 / `--on-ink` 글자 / radius 8px / 높이 44px / weight 700 |
| Secondary | 흰 바탕 / `1.5px solid --ink-900` / `--ink-900` 글자 / 같은 치수 |
| X-Small (카드 안) | 흰 바탕 / `1px solid --line-strong` / `--ink-700` / 높이 28px / radius 6px / 글자 좌측 정렬 |
| Ghost | 보더 없음 / `--ink-500` / hover 시 `--ink-900` |

hover는 밝기 변화가 아니라 **보더 굵기나 배경 `--surface-sunken`** 으로 표현한다.

### 세트 주문 테이블 (상품 상세)

도매의 핵심 화면. 지금 구조를 유지하되 그림자를 걷어낸다.

- 컨테이너 `1px solid --line` + radius 10px, 그림자 없음.
- 헤더 행 `--surface-sunken` + `label` 토큰 대문자.
- 선택된 행은 색이 아니라 **`--surface-sunken` 바탕 + 좌측 2px `--ink-900` 스트라이프**로 표시.
- 수량 스텝퍼: `−` `값` `+` 가 붙은 한 덩어리, 보더 `--line-strong`, 높이 28px.
- 합계 금액은 `display-md`, 숫자는 tabular-nums. 수량이 바뀌면 숫자만 부드럽게 교체한다(자릿수 플립).

### 관리자 콘솔

고객 화면과 같은 토큰을 쓰되 더 조용하게.

- 스탯 카드: 흰 바탕 + `1px solid --line`, **배경색 없음**, radius 10px, 패딩 16px.
- 상태 표시는 채움 배지가 아니라 **6px 점 + 글자**. 승인=`--signal-ok`, 보류=`--signal-error`, 대기=`--ink-500`.
- 테이블 행 높이 44px, 구분선 `--line`, 금액 열 우측 정렬 + tabular-nums.

---

## 5. 레이아웃

### 간격 체계 (4px 기준)

`2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`

### 상품 그리드 (Faire 실측)

```
grid-cols-2   (모바일)
md:grid-cols-4
lg:grid-cols-5
xl:grid-cols-6
gap-x: 8px   gap-y: 24px
```

가로 간격은 좁고 **세로 간격은 3배 넓다.** 이 비대칭이 "촘촘하지만 답답하지 않은" 느낌을 만든다. 같은 값으로 맞추지 말 것.

- 콘텐츠 폭은 **Faire 실측**: 최대 1920px까지 화면을 채우고, 좌우 패딩 16px(lg 미만) / 48px(1024px 이상). 헤더·푸터·전체 폭 페이지는 모두 `.page-container` 하나를 쓴다. 결제·마이페이지 같은 폼 페이지만 960px/640px 가운데 정렬.
- 상품 그리드는 `.product-grid`(2/4/5/6열). 필터 사이드바가 있는 목록은 한 단계씩 적게(2/3/4/5/6), 페이지당 60개(3·4·5·6열 모두 빈칸 없이 채워짐).
- 섹션 사이 수직 여백 64px, 섹션 제목과 콘텐츠 사이 20px.
- 열 수가 줄 때 행을 재배치하지 않는다 — **열 개수만 줄인다.**

---

## 6. 깊이

**그림자는 시스템 전체에 1단계만 존재한다.**

```css
--shadow-hover: 0 1px 2px rgba(20,20,20,.04), 0 4px 12px -4px rgba(20,20,20,.10);
```

- 기본 상태의 카드·테이블·패널은 **그림자 없음.** 구분은 `1px solid --line`으로만.
- 위 그림자는 드롭다운/모달과 버튼 hover에만 쓴다. 상품 타일은 그림자를 쓰지 않는다.
- radius는 4(배지·상품 이미지·타일 버튼) · 6(작은 버튼) · 8(버튼) · 10(패널) 네 단계만.

---

## 7. Do / Don't

**Do**
- 상품 사진을 흰 배경으로 정규화하고, 사진이 화면의 유일한 색이 되게 한다.
- 할인·베스트·신상을 굵기와 위치로 구분한다.
- 잠긴 가격도 자리를 차지하게 해 레이아웃을 고정한다.
- 일본어 상품명에 `font-jp`를 준다.
- 숫자 열에 `tabular-nums`를 준다.

**Don't**
- 코랄·핑크 등 브랜드 강조색을 도입하지 않는다. (명시적으로 반려된 방향)
- 알약형 컬러 배지 + 드롭섀도우 + 14px 이상 라운드 조합을 쓰지 않는다. 장난감처럼 보인다.
- 그라데이션 도형이나 일러스트를 상품 이미지 자리에 넣지 않는다.
- 별점을 노란색으로 칠하지 않는다.
- 스크래핑한 카테고리명·JAN코드·소스명을 `tags`에 넣어 배지로 렌더하지 않는다. (과거 실제 사고)
- 페이지마다 hex를 하드코딩하지 않는다. 반드시 위 토큰을 쓴다.

---

## 8. 반응형

| 구간 | 폭 | 변화 |
|---|---|---|
| Mobile | < 768px | 그리드 2열, 메가메뉴는 시트로, 세트 테이블은 카드 레이아웃으로 전환, 상세 CTA는 하단 고정 바 |
| Tablet | 768–1024px | 그리드 4열, 필터는 상단 칩 |
| Desktop | 1024–1440px | 그리드 5열, 필터 사이드바 노출 |
| Wide | > 1440px | 그리드 6열, 콘텐츠 1920px까지 늘어남 |

터치 타깃 최소 44×44px. 상품 타일 버튼은 34px이지만 타일 전체가 링크이므로 예외.

---

## 9. 에이전트 프롬프트 가이드

이 프로젝트에서 UI를 만들 때 쓰는 요약:

> 순백 배경(#FFFFFF), 완전 무채색 UI. 텍스트 #333333, 강조 텍스트 #141414, 보조 #6C6A6A, 보더 #E5E3E3.
> 브랜드 강조색 없음 — 위계는 굵기와 여백으로만. 별점 아이콘도 #333333.
> 상품 그리드는 2/4/5/6열, gap-x 8px · gap-y 24px. 상품 타일은 Faire 실측값 그대로: 이미지 1:1 radius 4px 보더 없음 + 2% 오버레이, 배지 12px 흰 바탕, 가격 18px · 상품명/브랜드 14px, 버튼 34px #DADADA 보더.
> 그림자는 드롭다운·모달에만 1단계.
> 비승인 바이어에게는 통화기호만 남기고 숫자를 blur 처리한 뒤 "도매가 확인하기 →" 아웃라인 버튼을 단다.
> 폰트는 Pretendard, 일본어 상품명만 `.font-jp`(Pretendard JP). 숫자는 tabular-nums.

### 구현 현황

- [x] 토큰을 `src/index.css` CSS 변수 + `tailwind.config.js`로 이관 (`ink-900/700/500/300`, `line`, `line-strong`, `canvas`, `sunken`, `signal-error/ok`, `shadow-hover`)
- [x] `ProductCard.tsx` 를 위 카드 규격으로 재작성
- [x] 상품 그리드 간격을 `gap-x-2 gap-y-6` 으로 통일
- [x] `ProductDetail.tsx` 세트 테이블 그림자 제거 · 선택 행 스트라이프 (Header도 완료)
- [ ] 페이지에 하드코딩된 `#4a90e2` / `#ff4d6d` 전량 제거
- [ ] 관리자 화면 스탯 카드 · 상태 점 표기 적용
