# Product SEO and publication operations

## Deployment prerequisites

1. Apply migrations in timestamp order through `20260922_product_publication_seo.sql`.
2. Set server-only `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and canonical `PUBLIC_SITE_URL` in Vercel. Do not prefix secrets with `VITE_`.
3. Run `npm test`, `npm run lint`, `npm run build`, and `npm run test:ssr`.
4. Verify an anonymous REST request to `products` is denied while `products_public` succeeds without price, set pricing, SD or dealer columns.

## Search launch checklist

- Request a canonical product with `curl` and confirm HTTP 200 contains one title, description, robots, canonical, OG/Twitter tags, visible English summary and three JSON-LD blocks.
- Confirm `/product/{id}` and stale slugs return HTTP 301 to the stored slug.
- Confirm an unknown ID returns HTTP 404 and inactive/review-pending products return `noindex,nofollow`.
- Confirm `sitemap.xml` contains only active `auto_approved`/`human_approved` products and every URL equals the page canonical.
- Confirm anonymous HTML and bootstrap JSON contain no wholesale/original price or set pricing. Product JSON-LD must not contain `Offer` or `price` while prices require an approved login.
- Run representative URLs through Google Rich Results Test. Product identity, image, brand, SKU and validated GTIN should be present; Merchant Listing eligibility is intentionally unavailable without public price/Offer.
- Add the exact `PUBLIC_SITE_URL` property in Google Search Console, submit `/sitemap.xml`, inspect one URL, then request indexing only after redirects and canonical checks pass.

## Four-week naming pilot

`product_publication_settings.auto_publish_enabled` defaults to false. Keep it false for at least 28 days. Administrators record audited auto-approved samples in `product_name_quality_samples`, including whether the candidate was correct without edits and error codes.

Monitor `product_name_pilot_metrics` and `product_name_queue_health` for:

- auto-approval precision (required >= 99% by default),
- administrator edit rate (required <= 1%),
- review-required rate (required <= 20%),
- estimated API cost,
- p95 latency,
- queued age, expired leases and attempts.

Only after the time, sample-size and quality thresholds pass should an administrator set `auto_publish_enabled=true`. `auto_publish_eligible_products(limit)` rechecks every threshold transactionally before activating any product. Manual activation is also blocked until the English name is approved.

## Incident response

- Disable `auto_publish_enabled` immediately on a naming regression.
- Do not force backfill past a requeued/failed batch cursor; drain queued jobs first and inspect audit runs.
- Set affected products inactive; they disappear from sitemap and become noindex on the next uncached response.
- Purge the product and sitemap CDN cache after correcting a canonical slug, status or SEO description.
