-- Migration: 104_manual_merge_source.sql
-- Purpose: ADO-537 — admin-initiated ("manual") story merges, logged to clustering_judge_log so the
--   admin Judge tab shows them alongside agent verdicts. The merge itself reuses the hardened
--   merge_stories RPC (migrations 100/101/102) via a new password-gated service_role edge function
--   (admin-judge-merge); no new merge machinery is added here.
--
-- NOTE ON NUMBERING: 103 is reserved by the approved ADO-531 backfill plan
--   (docs/features/clustering-judge/backfill-plan.md — judge_backfill_state + 5-arg candidate RPC).
--   ADO-537 ships first, so it takes 104. Apply order between 103/104 does not matter — they touch
--   different objects except the source CHECK, which 103 must extend ADDITIVELY (keep 'manual').
--
-- Applied to TEST first (Supabase SQL Editor), then PROD alongside the admin-judge-merge edge function.
--
-- ⚠️ DEPLOY ORDER: apply THIS MIGRATION BEFORE deploying the admin-judge-merge edge function to an env.
--   If the function ships first, a manual merge still SUCCEEDS but its clustering_judge_log insert
--   violates the old source CHECK — the merge executes with no Judge-tab record (only story_merge_audit
--   and judge_run_merge_count capture it, and the UI shows only a soft log_error warning).

-- Extend the allowed sources: 'manual' = merge executed from the admin Judge tab (ADO-537).
-- The inline CHECK in migration 100's CREATE TABLE was auto-named clustering_judge_log_source_check.
ALTER TABLE clustering_judge_log DROP CONSTRAINT IF EXISTS clustering_judge_log_source_check;
ALTER TABLE clustering_judge_log
  ADD CONSTRAINT clustering_judge_log_source_check
    CHECK (source IN ('inline', 'judge-agent', 'manual'));

COMMENT ON COLUMN clustering_judge_log.source IS
  'inline = RSS clustering path; judge-agent = scheduled Clustering Judge agent; manual = admin Judge tab merge (ADO-537)';

-- ============================================================================
-- VERIFICATION (run separately AFTER applying; read-only)
-- ============================================================================
-- 1) CHECK now includes manual:
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'clustering_judge_log_source_check';
--    -- expect: CHECK ((source = ANY (ARRAY['inline'::text, 'judge-agent'::text, 'manual'::text])))
-- 2) Existing rows still valid (constraint added without NOT VALID, so this must return 0):
--    SELECT COUNT(*) FROM clustering_judge_log
--    WHERE source NOT IN ('inline', 'judge-agent', 'manual');
