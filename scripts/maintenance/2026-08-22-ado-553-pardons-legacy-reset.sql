-- ============================================================================
-- ADO-553: Reset legacy-GPT-enriched backfill pardons for Claude-agent re-enrichment
-- Run by hand in the Supabase SQL Editor on PROD ONLY. Never deployed.
-- (Safe no-op on TEST: the backfill cohort only exists on PROD.)
-- Written 2026-08-22. Revised same day per Codex review (bounded window, manual COMMIT).
--
-- CONTEXT: The 2026-08-19 backfill (ADO-550) inserted 25 pardons on PROD at
-- ~04:03 UTC on 2026-08-20. The legacy Perplexity/GPT phases in
-- pardons-tracker.yml (removed by ADO-553) then enriched them: prompt_version
-- stayed NULL (the Claude agent always writes 'v1.1'), research_status
-- 'complete' + is_public=true were set by legacy code. Because legacy GPT
-- stamped enriched_at, the Claude agent's candidate query (enriched_at IS NULL)
-- skips these rows forever. This script restores them to scraped state so the
-- agent's next runs research + enrich them properly.
--
-- MECHANIC: null-fields-first. receipts_timeline/source_urls are NOT NULL ->
-- reset to '[]', never NULL. Rows with prompt_version = 'locked' (manually
-- written, e.g. Jan 6) are excluded by the prompt_version IS NULL predicate,
-- and so is anything the agent already enriched ('v1.1').
-- ============================================================================

-- STEP 1 - AUDIT (run first, keep the output).
-- Expect ~25 rows: legacy rows show prompt_version NULL + research_status 'complete'.
SELECT id, recipient_name, prompt_version, research_status,
       enriched_at IS NOT NULL AS has_enriched_at,
       is_public, needs_review, corruption_level, created_at
FROM pardons
WHERE created_at >= '2026-08-20T00:00:00Z'
  AND created_at <  '2026-08-21T00:00:00Z'
ORDER BY id;

-- STEP 2 - RESET the legacy-touched rows to scraped state.
-- Bounded to the backfill window (2026-08-20 UTC) so pardons scraped on any
-- later day are never touched. prompt_version IS NULL = no agent provenance
-- (excludes 'v1.1' agent rows and 'locked' protected rows).
BEGIN;

UPDATE pardons
SET
  -- agent candidacy + provenance
  enriched_at        = NULL,
  prompt_version     = NULL,
  enrichment_meta    = NULL,
  -- legacy GPT editorial copy (goes dark immediately)
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
WHERE created_at >= '2026-08-20T00:00:00Z'
  AND created_at <  '2026-08-21T00:00:00Z'
  AND prompt_version IS NULL;

-- STEP 3 - SANITY CHECK while the transaction is still open.
-- The UPDATE's row count (shown by the SQL Editor) should match the number of
-- prompt_version-NULL rows from STEP 1 (~24-25). This query should return the
-- same rows, all pending/hidden/unenriched:
SELECT id, recipient_name, research_status, is_public,
       enriched_at IS NULL AS awaiting_agent
FROM pardons
WHERE created_at >= '2026-08-20T00:00:00Z'
  AND created_at <  '2026-08-21T00:00:00Z'
ORDER BY id;

-- STEP 4 - DECIDE. Run ONE of these two lines by itself:
-- If the counts and rows look right:
--   COMMIT;
-- If anything looks wrong:
--   ROLLBACK;

-- STEP 5 (outside SQL): let the daily pardons agent cron (20:00 UTC) pick them
-- up, or fire the PROD trigger manually. The agent processes up to 20 per run,
-- so 25 rows = 2 runs. Afterwards verify: prompt_version = 'v1.1' on all rows,
-- tone-system voice in summary_spicy, and colors on the pardons page (AC3/AC4).
