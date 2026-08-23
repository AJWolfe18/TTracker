-- ============================================================================
-- ADO-553 (follow-up): Reset the 5 pardons enriched under the stale v1.0 prompt
-- Run by hand in the Supabase SQL Editor on PROD ONLY. Never deployed.
-- Written 2026-08-23.
--
-- CONTEXT: The 2026-08-23 06:09 UTC manual agent run re-enriched the first 5
-- reset rows (ids 119-123) BEFORE the v1.1 prompt sync reached main (PR #126),
-- so they carry prompt_version 'v1' (v1.0 spec: no connection-investigation
-- protocol, no review_reason, 5/run batch). AC3 requires 'v1.1' on the whole
-- backfill cohort. This script re-queues exactly those 5 rows.
--
-- RUN ORDER: only AFTER PR #126 is merged to main (otherwise the next agent
-- run just writes 'v1' again). The remaining 15 cohort rows are already
-- pending and need no SQL.
--
-- MECHANIC: null-fields-first, same as 2026-08-22 script.
-- receipts_timeline/source_urls are NOT NULL -> reset to '[]', never NULL.
-- ============================================================================

-- STEP 1 - AUDIT (run first, keep the output).
-- Expect exactly 5 rows, all prompt_version 'v1':
-- 119 Travis Henry, 120 Timothy S. Smith (needs_review), 121 Nathaniel Newton Jr.,
-- 122 Joseph Klecko, 123 Jamal Lewis.
SELECT id, recipient_name, prompt_version, research_status,
       enriched_at, is_public, needs_review, corruption_level
FROM pardons
WHERE id IN (119, 120, 121, 122, 123)
ORDER BY id;

-- STEP 2 - RESET the 5 rows to scraped state.
-- prompt_version = 'v1' guard means a re-run of this script after the agent
-- has redone them at 'v1.1' is a no-op (0 rows).
BEGIN;

UPDATE pardons
SET
  -- agent candidacy + provenance
  enriched_at        = NULL,
  prompt_version     = NULL,
  enrichment_meta    = NULL,
  -- v1.0-prompt editorial copy (goes dark immediately)
  crime_description        = NULL,
  primary_connection_type  = NULL,
  secondary_connection_types = NULL,
  corruption_level         = NULL,
  corruption_reasoning     = NULL,
  trump_connection_detail  = NULL,
  donation_amount_usd      = NULL,
  receipts_timeline        = '[]'::jsonb,   -- NOT NULL column
  summary_neutral          = NULL,
  summary_spicy            = NULL,
  why_it_matters           = NULL,
  pattern_analysis         = NULL,
  source_urls              = '[]'::jsonb,   -- NOT NULL column
  -- back to scraper defaults (hides the rows until the agent publishes them)
  research_status          = 'pending',
  is_public                = false,
  needs_review             = false
WHERE id IN (119, 120, 121, 122, 123)
  AND prompt_version = 'v1';

-- STEP 3 - SANITY CHECK while the transaction is still open.
-- UPDATE row count should be 5. Same rows, all pending/hidden/unenriched:
SELECT id, recipient_name, research_status, is_public,
       enriched_at IS NULL AS awaiting_agent
FROM pardons
WHERE id IN (119, 120, 121, 122, 123)
ORDER BY id;

-- STEP 4 - DECIDE. Run ONE of these two lines by itself:
-- If the counts and rows look right:
--   COMMIT;
-- If anything looks wrong:
--   ROLLBACK;

-- STEP 5 (outside SQL): fire the PROD pardons trigger (or wait for the 20:00
-- UTC cron). With the v1.1 prompt on main the agent does 20/run, so one run
-- covers these 5 + the 15 still-pending cohort rows. Afterwards verify:
-- prompt_version = 'v1.1' on all 24 cohort rows, tone-system voice in
-- summary_spicy, colors on the pardons page (AC3/AC4).
