# 상품 설명 수동 번역 인계 문서

기준 시점: 2026-10-01 00:45 (KST)

상품 설명(일본어)을 EN/ZH/KO로 직접 번역해 운영 Supabase에 반영하는 작업의 인계 문서입니다. AI API는 호출하지 않고, 번역문을 사람이(또는 세션의 AI가) 작성해 기존 검증·쓰기 경로(`validateTranslations` → enqueue/claim/complete RPC)로만 반영합니다.

## 현재 상태

| 항목 | 개수 |
|---|---|
| 작업 시작 시 설명 번역 대상 | 5,766 |
| 반영 완료 | 2,911 |
| 남은 대상 (`status`의 `targets`) | 2,855 |
| └ 설명이 비어 있어 항상 건너뜀 | 23 |
| └ 아직 번역 안 됨 (`blocked`) | 2,832 |

- 남은 2,832개는 전부 `inactive` 상품이고 `description_i18n_status = pending`입니다. 활성 상품은 모두 처리됐습니다.
- 남은 상품 목록: [`docs/description-i18n-remaining.tsv`](description-i18n-remaining.tsv)
  - 컬럼: `id, sd_product_id, status, description_i18n_status, brand, name, first_missing_segment`
  - 다시 만들려면: `node scripts/manual-desc-i18n.mjs status --list=docs/description-i18n-remaining.tsv` (읽기 전용)
- 별도로 남겨 둔 것 (이번 작업 이전부터 있던 항목이라 손대지 않음):
  - 활성 상품 설명 `review_required` 149개, 실패 행 4개
  - 상품명 `review_required` 2개: #28 (SK-II 마스크, ZH 누락), #89 (Biore 세안제, EN 누락)

## 도구와 파일

작업 디렉터리: `app/`. 자격 증명은 스크립트가 `.env.local`에서 직접 읽습니다.

- `scripts/manual-desc-i18n.mjs`: 세그먼트/번역 메모리(TM) 도구 (아직 커밋 안 됨)
  - `export`: 미번역 세그먼트를 `scripts/.i18n/desc/seg-NNN.src.tsv`로 다시 만들고 번호를 001부터 다시 매김. 현재 파일이 남아 있는 동안은 실행하지 말 것.
  - `import <json>`: 세그먼트별 가드 검사 후 3개 언어가 모두 통과한 항목만 `tm.json`에 저장.
  - `apply [--ids=] [--limit=] [--dry-run]`: 모든 세그먼트가 TM에 있는 상품만 렌더링해 `auto_approved`일 때 반영.
  - `status [--list=<file>]`: 개수만 출력(쓰기 없음). `--list`로 남은 상품 TSV 출력.
- `scripts/.i18n/` 는 gitignore 대상이라 이 PC에만 있습니다. 다른 PC에서 이어 하려면 이 폴더를 복사해야 합니다.
  - `desc/tm.json`: 번역 메모리 (약 7,250 항목)
  - `desc/segments.json`: 세그먼트 원문 메타
  - `desc/seg-NNN.src.tsv`: 번역할 원문 (`segId<TAB>type<TAB>ja`)
  - `desc/seg-NNN.json`: 번역 결과 (`{ segId: { en, zh, ko } }`)
  - `desc/gen/rNNN.py`: `seg-NNN.json`을 만드는 생성 스크립트 (헬퍼 `T() j() title() rel() spec()`; 예시는 `gen/r097.py`)
  - `desc/step.sh NNN`: import → 누락 id 출력 → apply → 다음 `.src.tsv` 출력
  - `desc/missing.sh NNN`: TM에 없는 세그먼트 id 출력

## 이어서 하는 방법

1. 다음 파일은 `seg-098.src.tsv`, 마지막은 `seg-190.src.tsv`입니다. (seg-001~097 완료)
2. `.src.tsv`를 읽고 `gen/rNNN.py`를 작성 → `python3 scripts/.i18n/desc/gen/rNNN.py && scripts/.i18n/desc/step.sh NNN`
3. `⚠`(가드 거부)나 `MISSING` 항목은 해당 `seg-NNN.json`을 고쳐 다시 import.
4. 190까지 끝나면 `status` 확인. `blocked`가 남아 있으면 `export` 후 seg-001부터 다시.
5. 모두 끝나면 `scripts/.i18n/desc-stats.mjs`, `desc-seg.mjs`, `desc-sample.mjs`, `desc-q3.mjs` 임시 파일 삭제.

## 번역 규칙

- 숫자·단위는 원문 그대로. 전각 `．`, `％`/`%` 구분도 유지. 숫자를 말로, 말을 숫자로 바꾸지 않음.
- 조수사(`5枚`, `2本`, `4個`, `1本1本` 등)는 원문 그대로 둠.
- 결과물에 가나 금지. 원문에 없는 효능·주장 추가 금지.
- 브랜드는 각 시장의 공식 표기 사용. 이미 TM에 있는 표기는 그대로 재사용 (`gen/*.py`에서 grep).
- 詰替 → Refill / 替换装 / 리필용, 本体 → (EN 생략) / 正装 / 본품
- 렌더링 형식 (가드 통과에 필요):
  - 제목: `【brand】name【cat】`
  - 관련어 줄: `{title} {body} Related words: {cat} {brand} products` / `相关词： … 商品一览` / `관련 키워드: … 상품 목록`
  - 규격 줄: `{cap} Case size: … Case weight: … Units per case: … {title} Distributor: …` / `箱规尺寸：… 箱重：… 每箱入数：… 销售商：` / `케이스 사이즈: … 케이스 중량: … 케이스 입수: … 판매원: `
  - `JAN: `, `Product name: `(`品名：`/`품명: `), `URL: ` 줄도 같은 방식
- `name_en`은 건드리지 않음. 비활성 상품 노출 정책도 바꾸지 않음.

## 가드 거부 시 대처

| 사유 | 대처 |
|---|---|
| `number_mismatch` | 원문 숫자를 빠짐없이 유지 (예: `単3` → `size-3 (AA)`, ZH `单3`) |
| `unit_mismatch` | 숫자 뒤에 g/l/m으로 시작하는 단어가 오면 단위로 오인됨. `2 levels`→`2 steps`, `10 layers`→`10-layer`, `PEG-5 glyceryl`→`Glyceryl … PEG-5`. ZH `袋`도 단위로 취급되므로 ﾎｳ는 `份` |
| `delimiter_added` | 성분(ing) 번역에 `、,，：` 금지. `with`, `&`, `/` 사용 |
| `length_out_of_bounds` | 1~4자 원문은 EN도 짧게 (`毛` → `Hair`) |
| `not_hangul` | KO에 한글이 없으면 거부. 라틴 문자만 있는 성분은 ` 성분`/` 소재` 붙이기 |
| `kana_remaining` | 가나를 모두 번역 |
