# WELMES 상품 자동화 — 수집 · 가격 반영 · 품절 처리

> 슈퍼딜리버리(スーパーデリバリー)에서 상품을 수집하고, 공급사의 가격변동·품절을
> 감지해 WELMES 스토어에 자동 반영하는 시스템 정리 문서.
> 최종 업데이트: 2026-09-14

---

## 1. 시스템 구성

```
scripts/
├── lib/sd-core.mjs        # 공용 코어 — env 로딩, Supabase 클라이언트, 로그인 세션,
│                          #   상품 페이지 파싱, 카테고리 매핑, 브랜드 추론
├── sd-import.mjs          # 수집 — 슈퍼딜리버리 → WELMES 상품 등록
├── sd-monitor.mjs         # 감시 — 가격/재고 변동 감지 → 자동 반영 + 로그 + 알림
├── com.welmes.sd-monitor.plist  # 매일 오전 자동 실행 (launchd)
└── .sd-session.json       # 슈퍼딜리버리 세션 캐시 (git 제외)
```

**필수 환경설정** (`.env.local`, git 제외)

```
SD_EMAIL=<슈퍼딜리버리 이메일>
SD_PASSWORD=<슈퍼딜리버리 비밀번호>
WELMES_ADMIN_EMAIL=<WELMES 관리자 이메일>
WELMES_ADMIN_PASSWORD=<WELMES 관리자 비밀번호>
```

**필수 마이그레이션** (Supabase SQL Editor에서 1회 실행)

| 파일 | 내용 |
|---|---|
| `20260912_sd_source.sql` | `sd_product_id` (중복 방지용 원본 상품 ID) |
| `20260914_sd_dealer.sql` | `sd_dealer_id` / `sd_dealer_name` (공급업체 추적) |
| `20260915_sd_monitor.sql` | `sd_last_checked_at`, 변동 로그 테이블 `sd_product_changes`, 알림 payload + 상품 알림 타입 |
| `20260916_sd_watchlist.sql` | 감시 목록 테이블 `sd_watchlist` + `product_registered` 알림 타입 |

---

## 2. 상품 수집 자동화 (`npm run import:sd`)

### 명령어

```bash
npm run import:sd -- <상품URL>                    # 상품 1개 등록 (/p/r/pd_p/…)
npm run import:sd -- <목록URL>                    # 그 페이지의 상품 전부 등록
npm run import:sd -- <목록URL> --all              # 페이지네이션 끝까지 전부 등록
npm run import:sd -- <목록URL> --brand=小林製薬   # 브랜드 refine 후 전부 등록 (--all 자동)
```

옵션: `--pages=N` (최대 페이지 수, 기본 무제한) · `--limit=N` (최대 상품 수) · `--active` (active 등록, 기본 inactive)

### 등록 시 자동 처리

| 항목 | 규칙 |
|---|---|
| **가격** | 卸単価(세트 총액) × **1.1** = 회원 판매가. 参考上代 없으면 × 1.5를 정가로. *(마진 변경: `scripts/lib/sd-core.mjs`의 `MARGIN`)* |
| **브랜드** | ① `--brand` 옵션 → ② 상품 페이지 명시적 브랜드 링크 → ③ **상품명 기반 추론**(업체 브랜드 목록 → DB 기존 브랜드, 긴 이름 우선) → ④ 업체명 |
| **신규 브랜드** | DB에 없던 브랜드도 그대로 등록 — 관리자 대시보드 브랜드 추천 목록에 자동 반영 |
| **카테고리** | 상품명·장르·설명 키워드 매칭 → 사이트 실제 19그룹/서브 라벨과 정확히 일치하는 값만 기입 |
| **업체 정보** | breadcrumb에서 업체 ID/업체명 추출 → `sd_dealer_id` / `sd_dealer_name` (웹 노출 없음, 관리자 편집 모달에서만 보임) |
| **이미지** | CDN 원본 최대 8장 → Supabase Storage 업로드 |
| **중복** | `sd_product_id` 기준 자동 skip |
| **상태** | 기본 `inactive` (관리자 검토 후 활성화). `--active` 시 즉시 활성 |
| **품절 상품** | ① 가격(세트) 정보가 보이는 품절 → **재고 0으로 등록** (기본 inactive라 웹 노출 없음, 재입고 시 모니터가 자동 active). ② 품절로 가격 정보까지 숨겨진 상품 → **감시 목록(`sd_watchlist`)에 등록**하고 넘어감 (아래 3장 참고) |

---

## 3. 변동 감지 & 자동 반영 (`npm run monitor:sd`)

수집된 상품(`sd_product_id` 보유)을 슈퍼디리버리에서 다시 읽어 DB와 비교한다.

```bash
npm run monitor:sd                  # 전체 체크 (마지막 체크 오래된 순)
npm run monitor:sd -- --dry-run     # DB 변경 없이 감지 결과만 출력
npm run monitor:sd -- --limit=50    # 50개만
npm run monitor:sd -- --ids=12,34   # 특정 상품만
```

### 감지 유형별 처리

| 감지 | 조건 | 자동 반영 | 변동 로그 | 관리자 알림 |
|---|---|---|---|---|
| 🔺 가격 인상 / 🔻 가격 인하 | 세트 卸단가 변동 (첫 세트 기준) | 판매가·정가·할인율·세트 구성 **즉시 갱신** | ✅ | ✅ `product_price_change` |
| ⛔ 품절 | 재고 0 (残り 0 / 품절 표기) | 재고 0 + **status `inactive` 자동 전환** | ✅ | ✅ `product_sold_out` |
| ♻️ 재고 회복 | 재고 0 → N | 재고 갱신 + **status `active` 자동 복귀** | ✅ | ✅ `product_restock` |
| 🚫 거래 중단 | 미거래 전환 / 도매가 비공개 | **status `inactive`** | ✅ | ✅ `product_sold_out` |
| ❓ 페이지 소실 | 404 / 리다이렉트 | **status `inactive`** | ✅ (미확인 건 재알림 없음) | ✅ `product_missing` |
| (재고 수치 변동) | 0-crossing 아님 | 재고 수치만 조용히 갱신 | — | — |

- 가격·재고는 **관리자 승인 없이 즉시 반영**된다 (승인 대기 방식 아님).
- 모든 변동은 `sd_product_changes` 테이블에 before/after와 함께 기록되고,
  관리자(is_admin 전원)의 알림 벨에 표시된다.
- `--dry-run`으로 실제 반영 전 감지 결과를 미리 확인 가능.

### 감시 목록 — 품절로 등록 못 한 상품 (`sd_watchlist`)

수집 당시 품절/미거래로 등록되지 못한 상품(세트·가격 정보가 아예 숨겨진 경우)은
수집 스크립트가 `sd_watchlist`에 자동 기록한다. 모니터는 매일 이 목록을 다시 확인해:

| 상태 | 처리 |
|---|---|
| 재입고 (가격·세트 정보 등장) | **자동 등록** (inactive) + 관리자에게 `품절 상품 자동 등록` 알림 → 검토 후 활성화 |
| 여전히 품절 | 감시 유지, 마지막 확인 시각만 갱신 |
| 페이지 소실 (404) | 감시 목록에서 제거 |
| 다른 경로로 이미 등록됨 | 감시 목록에서 제거 |

### 관리자 대시보드에서의 확인

- 상품 목록: 변동이 있는 상품 행에 배지 표시 (`Price ↑` `Price ↓` `Sold out` `Restock` `Not trading` `Missing`)
- 필터: `Supplier changes (N)` 선택 시 변동 상품만 보기
- 행의 초록 ✓ 버튼: 해당 상품 변동을 "확인함"으로 처리 (배지 사라짐)
- 헤더 알림 벨: 「공급가 변동: 상품명 ¥627 → ¥595」 형태의 알림 표시

---

## 4. 매일 오전 자동 실행 (launchd)

```bash
# 등록 (매일 10:00 실행)
cp scripts/com.welmes.sd-monitor.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.welmes.sd-monitor.plist

# 해제
launchctl unload ~/Library/LaunchAgents/com.welmes.sd-monitor.plist
rm ~/Library/LaunchAgents/com.welmes.sd-monitor.plist

# 수동 즉시 실행 / 로그
launchctl start com.welmes.sd-monitor
tail -50 scripts/.sd-monitor.log
```

---

## 5. 주의사항

- **세션/재로그인**: 슈퍼딜리버리(클라우드플레어)가 연속 스크래핑을 봇으로 판단해
  약 90개 요청마다 세션을 끊는다 — 만료를 감지하면 모니터가 자동 재로그인(headful 창)한다.
  - 매일 자동 실행은 `--limit=80` (오래된 체크 순) — 전체 227개가 약 3일 주기로 커버되고
    세션 수명 안에 끝나 **로그인 창은 하루 0~1회** (10:00 시작 직후).
  - 전체 일괄 스캔(`npm run monitor:sd`)은 세션을 2~3번 갱신하므로 로그인 창이 2~3번 뜬다 —
    화면 앞에 있을 때 실행할 것.
- **속도**: 상품당 약 4.5초 + 60개마다 90초 휴식 (스로틀 방지). 196개 ≒ 17분.
- **마이그레이션 선행**: 컬럼/테이블이 없으면 import·monitor 모두 실패하며 안내 메시지 출력.
- **브랜드/카테고리 오판**: 상품명 기반 추론은 보조 수단 — 관리자 화면에서 수정 가능하며
  카테고리 라벨은 사이트 메뉴(`src/config/categoryMenu.ts` + `en/translation.json`)와
  정확히 일치하는 값만 스크립트가 기입한다.
