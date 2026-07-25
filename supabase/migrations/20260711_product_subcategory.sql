-- ═══════════════════════════════════════════════════════════════════════════
-- WELMES — Add subcategory to products
--
-- The admin product form only offered the original 6 flat categories, none of
-- which covered most of the 19-group mega menu (Nail, Food, Fashion, Home
-- Living, etc.) added later. This adds a `subcategory` column so admins can
-- classify products by top-level group AND sub-group, matching the mega menu.
-- Run this in the Supabase SQL Editor (or via `supabase db push`).
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.products
  add column if not exists subcategory text;
