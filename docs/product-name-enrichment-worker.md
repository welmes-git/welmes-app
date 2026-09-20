# Product Name Enrichment Worker

Task 5 adds an independent, resumable worker.

Task 6 wires auto-registration into the same pipeline: `sd-import.mjs` (new
collection) and `sd-monitor.mjs` (watchlist restock) both call the shared
`insertProduct(supabase, product, { enrichment })` path. On a successful,
non-duplicate insert it enqueues one job via `enqueue_product_name_enrichment`
using the shared pure builder `buildEnrichmentJob`. Duplicates never create a
job, and a queue/API failure is counted separately but never rolls back the
completed product insert. Products stay `inactive` on registration regardless of
name confidence; the worker's completion RPC only updates the `name_en_*` fields.
Disable queuing per run with `--no-enrich`; choose the model provider with
`--provider=<gemini|openai|anthropic|qwen|deepseek>`.

## Prerequisites

Apply these migrations in order:

1. `supabase/migrations/20260919_product_name_enrichment.sql`
2. `supabase/migrations/20260920_product_name_enrichment_worker.sql`

Required `.env.local` values:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
WELMES_ADMIN_EMAIL=...
WELMES_ADMIN_PASSWORD=...
GEMINI_API_KEY=...
```

`GEMINI_API_KEY` must be a Gemini Developer API key created for the billed/free-tier project in Google AI Studio. Do not use a Google One/AI Pro token or OAuth credential in this field, and never prefix it with `VITE_`.

## Commands

```bash
# No DB: one live provider/evidence smoke test using a fixture
npm run enrich:names -- --fixture=first

# Preview an explicit product without queue/product mutations
npm run enrich:names -- --ids=167 --dry-run

# Enqueue only; useful before a scheduled worker run
npm run enrich:names -- --ids=167,168 --enqueue-only

# Enqueue explicit products and process only those product IDs
npm run enrich:names -- --ids=167,168 --limit=2

# Process already queued work
npm run enrich:names -- --limit=10

# Force a new job while preserving any human-approved public name
npm run enrich:names -- --ids=167 --force

# Generation-only diagnostic; these results cannot auto-approve
npm run enrich:names -- --fixture=first --no-grounding
```

Options: `--provider`, `--model`, `--ids`, `--limit` (1–50), `--lease` (30–1800 seconds), `--max-attempts` (1–10), `--priority`, `--worker-id`, `--dry-run`, `--enqueue-only`, `--force`, and `--no-grounding`.

## Safety and state transitions

- Queue claims use `FOR UPDATE SKIP LOCKED` and expiring leases.
- Job input contains an immutable product/official-source snapshot, JAN (when collected), grounding strategy, and SHA-256 input hash.
- A changed snapshot/model/prompt/grounding strategy does not complete an old job.
- Re-enqueuing the same completed or active input is idempotent unless `--force` is supplied.
- HTTP 408/409/429/5xx and timeouts are requeued with bounded exponential backoff.
- Authentication/validation/input-hash errors fail immediately.
- `human_approved` product names are never overwritten by worker completion.
- Only verified official-domain evidence can produce `auto_approved`.
- If official grounding is unavailable or cannot be verified, the worker makes a generation-only fallback call and records the result as `generated` + `review_required`; it is never presented as an official name.
- Review-required candidates are stored in the admin-only run payload; they do **not** replace the public `products.name_en` or SEO fields.
- The worker never changes `products.status`, price, stock, images, or supplier metadata.

## Official evidence policy

An evidence URL is fetched only over HTTPS and only when its current host is a registered official domain or a trusted provider grounding redirect. Every redirect target is DNS-checked, must remain on an allowed evidence path, and private/local addresses are blocked. The response must be HTML and is capped at 1 MB. Evidence is marked official only when:

1. The final hostname exactly matches or is a subdomain of an active `brand_official_sources.official_domain`, and
2. The page matches the product by JAN, model code, or sufficient title/body product-name tokens.

The migration seeds only the current Biore/Kao pilot aliases. Add other brands and their verified manufacturer domains through an admin-controlled process before expecting automatic approval.

## Operational notes

- A worker invocation processes one claimed batch and exits; scheduling is added separately.
- `--dry-run` with IDs still reads Supabase and calls the configured AI provider, but performs no queue claim, insert, run update, or product update.
- Keep the default product storefront status policy unchanged: Task 5 name approval does not activate an inactive product.
- For brands with registered official domains, a failed official grounding attempt is followed by a generation-only call. Audit usage, latency, and estimated cost are the sum of both calls.
- `--enqueue-only` requires `--ids`; this prevents an option typo from accidentally processing the existing queue.
