-- ============================================================================
-- ADO-553: Reset legacy-GPT-enriched backfill pardons for Claude-agent re-enrichment
-- Run by hand in the Supabase SQL Editor on PROD ONLY. Never deployed, never on TEST.
-- Written 2026-08-22.
--
-- CONTEXT: The 2026-08-19 backfill (ADO-550) inserted 25 pardons on PROD. The
-- legacy Perplexity/GPT phases in pardons-tracker.yml (removed by ADO-553) then
-- enriched them: prompt_version stayed NULL (the Claude agent always writes
-- 'v1.1'), research_status/'complete' + is_public=true were set by legacy code.
-- Because legacy GPT stamped enriched_at, the Claude agent's candidate query
-- (enriched_at IS NULL) skips these rows forever. This script restores them to
-- scraped state so the agent's next run researches + enriches them properly.
--
-- MECHANIC: null-fields-first (the prevent-update trigger blocks re-enrichment
-- PATCHes when prompt_version doesn't increase; clearing everything first makes
-- the agent's write a fresh enrichment). receipts_timeline/source_urls are
-- NOT NULL -> reset to '[]', never NULL.
-- ============================================================================

-- STEP 1 - AUDIT (run first, screenshot/keep the output).
-- Expect ~25 rows: legacy rows show prompt_version NULL + research_status 'complete'.
-- Any row with prompt_version 'v1.1' was already agent-enriched - the reset
-- below leaves those alone.
SELECT id, recipient_name, prompt_version, research_status,
       enriched_at IS NOT NULL AS has_enriched_at,
       is_public, needs_review, corruption_level
FROM pardons
WHERE created_at >= '2026-08-19'
ORDER BY id;

-- STEP 2 - RESET the legacy-touched rows to scraped state.
-- Targets ONLY the backfill cohort (created_at window) with no agent provenance
-- (prompt_version IS NULL). Agent-enriched rows (prompt_version = 'v1.1') untouched.
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
WHERE created_at >= '2026-08-19'
  AND prompt_version IS NULL;

-- Sanity: row count should match the legacy rows from STEP 1 (~24-25).
-- If it doesn't, ROLLBACK and stop.
SELECT count(*) AS reset_candidates_remaining
FROM pardons
WHERE created_at >= '2026-08-19' AND enriched_at IS NULL;

COMMIT;

-- STEP 3 - VERIFY: all cohort rows now pending + hidden + unenriched.
SELECT id, recipient_name, research_status, is_public,
       enriched_at IS NULL AS awaiting_agent
FROM pardons
WHERE created_at >= '2026-08-19'
ORDER BY id;

-- STEP 4 (outside SQL): let the daily pardons agent cron (20:00 UTC) pick them
-- up, or fire the PROD trigger manually. The agent processes up to 20 per run,
-- so 25 rows = 2 runs. Afterwards verify: prompt_version = 'v1.1' on all rows,
-- tone-system voice in summary_spicy, and colors on the pardons page (AC3/AC4).
