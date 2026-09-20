# WELMES English Product Name — Provider Evaluation

Last reviewed: 2026-09-19. Official source links and machine-readable rates are in `scripts/fixtures/product-name-provider-catalog.json`.

## Evaluation contract

All providers receive the same Japanese source name, description, brand, category, and optional JAN. They must return the same JSON contract: `candidateName`, `seoTitle`, `seoDescription`, `searchAliases`, and `warnings`.

Two tracks must be reported separately:

1. **Generation-only:** all five providers; compares name quality without web evidence.
2. **Grounded:** only providers with a verified built-in search tool. A citation is still evidence to review, not proof that a page is the manufacturer source.

Provider claims such as `sourceType: "official"` are ignored. The adapter sets `grounded` only when the API response contains HTTPS citations. A generated result without evidence cannot cross the 0.85 automatic-approval threshold.

## Current candidates

| Provider | Evaluation model | Structured output | Built-in grounding used | List token price / 1M | Position |
|---|---|---|---|---|---|
| Google | `gemini-3.8-flash` | JSON Schema | Google Search | $0.75 input / $3.75 output | Primary grounded pilot candidate |
| OpenAI | `gpt-5.6-luna` | JSON Schema | Web search | $0.20 / $1.20 | Grounded challenger; low base token price |
| Anthropic | `claude-sonnet-5` | JSON Schema | Web search | $2 / $10 | Quality challenger; must justify higher cost |
| Alibaba Qwen | `qwen3.8-flash` | JSON object | Not used in fair track | CNY 1.094 / 3.427 on Singapore international endpoint | Low-cost generation challenger |
| DeepSeek | `deepseek-flash` | JSON object | Not documented in first-party API | Peak $0.30 / $1.20; off-peak $0.15 / $0.60 | Low-cost generation challenger |

A representative 1,000-input/250-output-token call, excluding search, is approximately:

- Gemini: **$0.00169**
- OpenAI: **$0.00050**
- Anthropic: **$0.00450**
- Qwen: **CNY 0.00195** (do not convert to USD without an explicit accounting exchange rate)
- DeepSeek: **$0.00060 peak / $0.00030 off-peak**

Search charges can dominate token charges. The current official pages state Gemini 3.x includes 5,000 Search grounding requests/month before $14/1,000 requests; OpenAI and Anthropic list $10/1,000 web searches plus model token charges. One model call can issue more than one search request.

## Recommendation before live results

Use **Gemini 3.8 Flash as the first grounded pilot**, because generation, JSON Schema, URL context, and Google Search grounding are available in one API and the current free grounding allowance is enough for the existing catalogue pilot. Do not select it permanently from feature sheets alone.

Run all five providers over the 30-item fixture. Select by this order:

1. Zero unsupported claims and zero lost/added brand, model, shade, size, count, SPF/PA facts.
2. Highest human-acceptable name rate and reference similarity.
3. Lowest review-required rate in the grounded track.
4. p95 latency and cost per **accepted** name, not raw token price.

Qwen and DeepSeek can be excellent low-cost generators, but under the current evidence policy their outputs remain `generated` until a separate official-source resolver supplies evidence. They should not auto-approve names solely because their wording looks plausible.

## Running the benchmark

Set only the keys you intend to evaluate in `.env.local`:

```text
GEMINI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
QWEN_API_KEY=...
DEEPSEEK_API_KEY=...
```

Optional pinned model overrides are `GEMINI_MODEL`, `OPENAI_NAME_MODEL`, `ANTHROPIC_NAME_MODEL`, `QWEN_NAME_MODEL`, and `DEEPSEEK_NAME_MODEL`. `QWEN_CNY_TO_USD` is optional; without it Qwen costs stay in CNY.

```bash
npm run eval:naming:check
npm run eval:naming -- --providers=all --limit=3 --output=/tmp/welmes-generation.json
npm run eval:naming -- --providers=gemini,openai,anthropic --grounding --limit=3 --output=/tmp/welmes-grounded.json
# Expand to all 30 only after the smoke run succeeds
npm run eval:naming -- --providers=all --output=/tmp/welmes-generation-30.json
```

The evaluator reports quality-pass count, automatic approvals, confidence, reference similarity, p50/p95 latency, estimated USD cost where available, and deterministic error categories.

## Known limitations

- No provider credentials were present when this module was implemented, so current accuracy and latency rankings are **not measured yet**.
- The curated fixture is a regression/evaluation seed, not a legal assertion that every reference string is a manufacturer-registered global name. Human review should add official URLs over time.
- Built-in search citations still require official-domain/JAN verification in Task 5.
- Paid-tier data processing terms and desired data region must be reviewed before production. Do not use free tiers that permit training on submitted data for production supplier content.
- Prices and aliases change. Pin production model IDs and update the provider catalog before procurement decisions.
