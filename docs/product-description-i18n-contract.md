# Product Description i18n — Shared Contract

Single source of truth for the multilingual product-description pipeline.
All tracks (DB migration, translation worker, frontend) MUST conform to this.

Last updated: 2026-09-21

## Scope and policy

- Target languages (initial): **EN, ZH, KO**. Source language is Japanese (`ja`),
  stored as-is in `products.description` and always used as the ultimate fallback.
- **Auto-publish** translations (no human gate), BUT with hard guards against
  distortion of ingredients/numbers/units. Admins can edit after the fact.
- Reuse the product-name enrichment worker pattern (queue table + lease-based
  claim + bounded retry/backoff + RPCs). Translation is a **separate** queue and
  table; it never blocks or mutates name enrichment.
- Registration must never fail because translation enqueue failed (mirror the
  name-enrichment "insert succeeds even if the queue/API is down" guarantee).

## Canonical section template

Defined in code by `DESCRIPTION_SECTION_TEMPLATE` (`scripts/lib/sd-core.mjs`).
Every product is normalized to these keys, in this order:

| order | key        | ja label       | notes                                  |
|-------|------------|----------------|----------------------------------------|
| 1     | `overview` | 商品説明       | main description body                  |
| 2     | `usage`    | 使用方法       | split out of the overview body         |
| 3     | `size`     | サイズ・容量   | volume/size                            |
| 4     | `spec`     | 規格           | ingredients / specs (distortion-guarded) |
| 5     | `shipping` | 出荷           | lead time                              |

Unknown source labels are kept as `extras` (key = `null`) after the template
sections; they are translated too but rendered after the known sections.

## `products.description_i18n` (jsonb)

Keyed by language, then by canonical section key. `extras` is an ordered array
that preserves unknown-label sections.

```jsonc
{
  "en": {
    "overview": "By washing, it draws out the beauty of bare skin. …",
    "usage": "Lather an appropriate amount (about 2–3 cm) with water …",
    "size": "130g",
    "spec": "Ingredients: isopropyl methylphenol*, dipotassium glycyrrhizinate* …",
    "shipping": "About 3 weeks",
    "extras": [ { "label": "原産国", "value": "Japan" } ]
  },
  "zh": { "overview": "…", "usage": "…", "size": "130g", "spec": "…", "shipping": "…", "extras": [] },
  "ko": { "overview": "…", "usage": "…", "size": "130g", "spec": "…", "shipping": "…", "extras": [] }
}
```

Rules:
- A language key is present only when a completed translation exists for it.
- Section keys within a language are present only when the source had that section.
- Values are plain text with `\n` line breaks (same convention as `description`).
- Section labels are NOT stored per language — the frontend renders localized
  labels from i18n using the canonical key (see i18n keys below).

## Frontend mapping

- `Product.descriptionI18n?: Record<string, DescriptionI18n>` where
  `DescriptionI18n = { overview?, usage?, size?, spec?, shipping?, extras?: {label,value}[] }`.
- `rowToProduct`: `descriptionI18n: (row.description_i18n as ...) || undefined`.
- `productToRow`: `if (p.descriptionI18n !== undefined) row.description_i18n = p.descriptionI18n ?? null`.
- `ProductDetail`: pick `descriptionI18n[i18n.language]`; for each template key in
  order, render localized label + value; fall back to `description` (ja) when the
  current language has no translation.

### i18n label keys (add to every locale)

```
productDetail.section.overview
productDetail.section.usage
productDetail.section.size
productDetail.section.spec
productDetail.section.shipping
```

## Queue: `product_description_translation_runs`

Mirror of `product_name_enrichment_runs`. One run = one (product, target-language-set)
translation job. Columns (same lease/retry machinery):

- `id uuid pk`, `product_id bigint`, `sd_product_id text`
- `provider text` (gemini/openai/anthropic/qwen/deepseek), `model text`
- `prompt_version text`, `input_hash text` (SHA-256 of source sections + langs + prompt)
- `target_langs text[]` (e.g. `{en,zh,ko}`)
- `source_payload jsonb` (immutable snapshot: `{ sections: [{key,label,value}], sourceLang: 'ja' }`)
- `result_payload jsonb`, `validation_payload jsonb`
- `status` in `queued|running|succeeded|review_required|failed|skipped`
- `attempt`, `max_attempts`, `priority`, `available_at`, `lease_owner`,
  `lease_expires_at`, timestamps, token/cost/latency columns.
- `products.description_i18n_status` in `pending|auto_approved|review_required|failed|human_locked`
  (+ `description_i18n_generated_at`, `description_i18n_manual_locked boolean`).

RPCs (admin-only, `security definer`):
- `enqueue_product_description_translation(product_id, provider, model, prompt_version, input_hash, target_langs, source_payload, priority, max_attempts, force) -> uuid`
- `claim_product_description_translations(worker_id, limit, lease_seconds, product_ids) -> setof runs`
- `complete_product_description_translation(run_id, worker_id, translations jsonb, status, result_payload, validation_payload, tokens/cost/latency) -> text`
  - `translations` shape: `{ en: {overview,...,extras}, zh:{...}, ko:{...} }`
  - merges into `products.description_i18n` (never overwrites a `human_locked` product)
- `fail_product_description_translation(run_id, worker_id, error_message, retry_delay_seconds, terminal) -> text`

## Translation payload (worker ↔ provider)

Provider is asked to translate each section value into each target language,
returning JSON that maps `lang -> { sectionKey -> translatedValue }`. The worker
supplies the canonical sections; the provider must NOT reorder or invent sections.

Result contract (per language):
```jsonc
{
  "en": { "overview": "...", "usage": "...", "size": "...", "spec": "...", "shipping": "...",
          "extras": ["Japan"] },   // extras aligned by index to source extras
  "zh": { ... }, "ko": { ... }
}
```

## Distortion guards (auto-publish safety)

Applied by a pure function before accepting a translation (unit-tested):

1. **Numbers/units preserved**: every number token and unit (g, ml, mL, cm, mm,
   %, SPF, PA+, 個, 枚, 本, 週間, etc.) present in the source `size`/`spec`
   sections MUST appear unchanged in the translation. Mismatch → `review_required`.
2. **Ingredient count parity**: for `spec`, the count of ingredient list items
   (split on `、`/`,`) must be within a small tolerance; large divergence →
   `review_required`.
3. **No empty translation** for a non-empty source section → `review_required`.
4. **Length sanity**: translated section not absurdly longer/shorter than source
   (bounded ratio) → `review_required`.
5. A `review_required` result is stored in the run payload and does NOT publish
   into `description_i18n`; admins review/patch it.

## Non-goals (explicitly out of scope for now)

- JAN-based regeneration of descriptions from manufacturer data (separate future task).
- Translating all 11 UI languages (only EN/ZH/KO first).
- Changing product status/price/stock/images (translation touches only i18n fields).
