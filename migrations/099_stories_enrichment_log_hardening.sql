-- Migration: 099_stories_enrichment_log_hardening.sql
-- Purpose: Additive hardening for stories_enrichment_log (098), per Codex PR review (2026-07-03, PR #103).
-- All changes are additive/non-breaking — 098 is left unchanged since it's already applied on TEST.
-- Idempotent: safe to re-run. Verified zero existing heartbeat rows (story_id IS NULL) and zero
-- negative duration_ms values on TEST at authoring time, but the dedup/normalize steps below run
-- regardless so this is also safe to apply to PROD's not-yet-existing table without assumptions.

-- duration_ms should never be negative; a bad value would skew monitoring/alerting.
-- Wrapped for idempotency (no "ADD CONSTRAINT IF NOT EXISTS" in Postgres) and to normalize any
-- pre-existing bad values before validating, rather than failing the migration outright.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stories_enrichment_log_duration_ms_nonneg'
      AND conrelid = 'stories_enrichment_log'::regclass
  ) THEN
    UPDATE stories_enrichment_log
    SET duration_ms = NULL
    WHERE duration_ms < 0;

    ALTER TABLE stories_enrichment_log
      ADD CONSTRAINT stories_enrichment_log_duration_ms_nonneg
      CHECK (duration_ms IS NULL OR duration_ms >= 0) NOT VALID;

    ALTER TABLE stories_enrichment_log
      VALIDATE CONSTRAINT stories_enrichment_log_duration_ms_nonneg;
  END IF;
END $$;

-- De-duplicate any existing heartbeat rows (story_id IS NULL) per run_id before enforcing
-- uniqueness below — a retried/duplicate heartbeat write would otherwise look like two
-- separate healthy empty runs instead of one, undermining the "last completed row" health signal.
WITH ranked AS (
  SELECT ctid,
         ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY created_at DESC, ctid DESC) AS rn
  FROM stories_enrichment_log
  WHERE story_id IS NULL
),
to_delete AS (
  SELECT ctid FROM ranked WHERE rn > 1
)
DELETE FROM stories_enrichment_log l
USING to_delete d
WHERE l.ctid = d.ctid;

-- Enforce one heartbeat row per run_id. Not built CONCURRENTLY: this table is brand new
-- (near-zero rows on TEST, doesn't exist yet on PROD), so there's no meaningful lock-contention
-- risk today, and CONCURRENTLY cannot run inside a transaction block - since migrations here are
-- applied manually via the Supabase SQL Editor, we don't control whether the session wraps
-- multi-statement scripts in one, so it's safer not to depend on it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stories_enrichment_log_run_heartbeat_unique
    ON stories_enrichment_log (run_id)
    WHERE story_id IS NULL;

-- Per-run lookups/drill-down (e.g. "show me every row from run X") would otherwise seq-scan.
CREATE INDEX IF NOT EXISTS idx_stories_enrichment_log_run_id_created_at
    ON stories_enrichment_log (run_id, created_at DESC);
