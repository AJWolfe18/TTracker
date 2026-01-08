-- =============================================================================
-- Migration 027: RSS Feed Tracking Schema
-- =============================================================================
-- Purpose: Add feed-level tracking, metrics, compliance, and error logging
-- Author: TrumpyTracker DevOps
-- Date: 2025-10-25
-- Environment: TEST (apply here first, then PROD after validation)
-- Prerequisites: Pre-flight checklist passed
-- Estimated Time: 5-10 seconds
-- Rollback: See 08_ROLLBACK_PROCEDURES.sql
--
-- ⚠️ RUNTIME ARCHITECTURE NOTE:
-- Worker = Deno (Supabase Edge Functions) - NOT Node.js
-- - Avoid Node-only dependencies (fs, child_process, etc.)
-- - Use Deno stdlib or web standard APIs only
-- - Handler must call metrics RPCs: record_feed_success(), record_feed_error()
-- - Use p_run_at parameter in enqueue_fetch_job() for scheduled polling
--
-- =============================================================================

-- Verification: Confirm we're in TEST
DO $$
BEGIN
  RAISE NOTICE 'Applying Migration 027 in database: %', current_database();
  RAISE NOTICE 'Timestamp: %', NOW();
END $$;

-- =============================================================================
-- PART 1: Add feed_id columns to existing tables
-- =============================================================================

-- 1A) Articles: track which feed sourced each article
ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS feed_id BIGINT;

RAISE NOTICE '✓ Added articles.feed_id column';

-- 1B) Job queue: track which feed each job belongs to
ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS feed_id BIGINT;

RAISE NOTICE '✓ Added job_queue.feed_id column';

-- =============================================================================
-- PART 2: Fix index conflicts
-- =============================================================================

-- Drop full-table unique index (prevents re-queueing same feed after completion)
-- The partial index (ux_job_queue_payload_hash_active) is the correct dedupe
-- ⚠️ CRITICAL NOTE: Do NOT recreate job_queue_type_payload_hash_key in future migrations
--    The partial index allows re-queueing completed jobs, which is essential for RSS polling

DROP INDEX IF EXISTS public.job_queue_type_payload_hash_key;

RAISE NOTICE '✓ Dropped conflicting full-table index (if existed)';

-- =============================================================================
-- PART 3: Add foreign key constraints with proper delete behavior
-- =============================================================================

-- Articles: SET NULL on feed deletion (keep article, lose feed attribution)
-- Rationale: Historical articles should persist even if feed is retired
ALTER TABLE public.articles
  DROP CONSTRAINT IF EXISTS articles_feed_id_fkey,
  ADD CONSTRAINT articles_feed_id_fkey
    FOREIGN KEY (feed_id) REFERENCES public.feed_registry(id) ON DELETE SET NULL;

RAISE NOTICE '✓ Added articles.feed_id foreign key (ON DELETE SET NULL)';

-- Job queue: SET NULL on feed deletion (job continues, loses feed context)
-- Rationale: In-flight jobs should complete even if feed is disabled
ALTER TABLE public.job_queue
  DROP CONSTRAINT IF EXISTS job_queue_feed_id_fkey,
  ADD CONSTRAINT job_queue_feed_id_fkey
    FOREIGN KEY (feed_id) REFERENCES public.feed_registry(id) ON DELETE SET NULL;

RAISE NOTICE '✓ Added job_queue.feed_id foreign key (ON DELETE SET NULL)';

-- =============================================================================
-- PART 4: Add tracking columns to feed_registry
-- =============================================================================

ALTER TABLE public.feed_registry
  ADD COLUMN IF NOT EXISTS last_response_time_ms INTEGER,
  ADD COLUMN IF NOT EXISTS consecutive_successes INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;

COMMENT ON COLUMN public.feed_registry.last_response_time_ms IS 
  'Latest fetch duration in milliseconds. Used for performance monitoring.';

COMMENT ON COLUMN public.feed_registry.consecutive_successes IS 
  'Count of successful fetches since last error. Reset to 0 on any failure. Used by scheduler.';

COMMENT ON COLUMN public.feed_registry.failure_count IS 
  'Total failure count. Decremented on success (floor: 0). Used for auto-deprecation.';

RAISE NOTICE '✓ Added tracking columns to feed_registry';

-- =============================================================================
-- PART 5: Create new tables for metrics, errors, and compliance
-- =============================================================================

-- 5A) Daily metrics rollups (aggregated by feed + date)
CREATE TABLE IF NOT EXISTS public.feed_metrics (
  metric_date DATE NOT NULL,
  feed_id BIGINT NOT NULL REFERENCES public.feed_registry(id) ON DELETE CASCADE,
  fetch_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  not_modified_count INTEGER NOT NULL DEFAULT 0,
  articles_enriched INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (metric_date, feed_id)
);

COMMENT ON TABLE public.feed_metrics IS 
  'Daily rollup of RSS feed performance metrics. Populated by record_feed_* RPCs. Used for health monitoring, cost attribution, and trend analysis. Recommend monthly archival of data >90 days old.';

COMMENT ON COLUMN public.feed_metrics.not_modified_count IS 
  '304 Not Modified responses. High values indicate efficient conditional GET usage.';

RAISE NOTICE '✓ Created feed_metrics table';

-- 5B) Error log (30-day retention recommended)
CREATE TABLE IF NOT EXISTS public.feed_errors (
  id BIGSERIAL PRIMARY KEY,
  feed_id BIGINT NOT NULL REFERENCES public.feed_registry(id) ON DELETE CASCADE,
  error_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.feed_errors IS 
  'RSS feed error log. Truncated to 500 chars per error. Recommend nightly cleanup: DELETE WHERE created_at < NOW() - INTERVAL ''30 days''.';

RAISE NOTICE '✓ Created feed_errors table';

-- 5C) Compliance rules (per-feed content limits)
CREATE TABLE IF NOT EXISTS public.feed_compliance_rules (
  feed_id BIGINT PRIMARY KEY REFERENCES public.feed_registry(id) ON DELETE CASCADE,
  source_name TEXT, -- Display only, NOT used for joins (use feed_id)
  allow_full_text BOOLEAN NOT NULL DEFAULT FALSE,
  max_chars INTEGER NOT NULL DEFAULT 1200,
  notes TEXT
);

COMMENT ON TABLE public.feed_compliance_rules IS 
  'Per-feed content usage rules for copyright compliance. Default: excerpts only (1200 chars). Set allow_full_text=true only for sources that explicitly permit full-text storage.';

COMMENT ON COLUMN public.feed_compliance_rules.source_name IS 
  'Display name for admin UI. NOT used for joins (use feed_id FK). Allows feed renames without breaking compliance rules.';

RAISE NOTICE '✓ Created feed_compliance_rules table';

-- =============================================================================
-- PART 6: Create indexes for performance
-- =============================================================================

-- 6A) Basic lookup indexes
CREATE INDEX IF NOT EXISTS ix_articles_feed_id 
  ON public.articles(feed_id);

CREATE INDEX IF NOT EXISTS ix_job_queue_feed_id 
  ON public.job_queue(feed_id);

RAISE NOTICE '✓ Created basic lookup indexes';

-- 6B) Hot path: worker queries (next job to process by feed)
-- Used by: SELECT * FROM job_queue WHERE processed_at IS NULL AND feed_id = $1 ORDER BY run_at LIMIT 1
CREATE INDEX IF NOT EXISTS ix_job_queue_next_active_by_feed
  ON public.job_queue (feed_id, run_at)
  WHERE processed_at IS NULL;

RAISE NOTICE '✓ Created hot path index for worker queries';

-- 6C) Legacy debt tracking (find jobs without feed_id)
-- Used by: Dashboard query to show jobs not yet migrated to new architecture
CREATE INDEX IF NOT EXISTS ix_job_queue_feed_id_null 
  ON public.job_queue (created_at)
  WHERE feed_id IS NULL AND processed_at IS NULL;

COMMENT ON INDEX public.ix_job_queue_feed_id_null IS 
  'Tracks legacy jobs created before Migration 027. Use in dashboard: SELECT COUNT(*) FROM job_queue WHERE feed_id IS NULL AND processed_at IS NULL. Target: 0 after Edge Function migration complete.';

RAISE NOTICE '✓ Created legacy debt tracking index';

-- 6D) Error log indexes (queries + retention cleanup)
CREATE INDEX IF NOT EXISTS ix_feed_errors_feed_time 
  ON public.feed_errors (feed_id, created_at);

CREATE INDEX IF NOT EXISTS ix_feed_errors_created_at 
  ON public.feed_errors(created_at);

COMMENT ON INDEX public.ix_feed_errors_created_at IS 
  'Supports nightly cleanup query: DELETE FROM feed_errors WHERE created_at < NOW() - INTERVAL ''30 days''.';

RAISE NOTICE '✓ Created error log indexes';

-- =============================================================================
-- PART 7: Payload→column sync trigger (transition helper)
-- =============================================================================

-- Automatically sync payload->>'feed_id' to job_queue.feed_id column
-- Helps during transition period when some jobs use payload, others use column
-- Can be removed after all Edge Functions migrated to use feed_id parameter
CREATE OR REPLACE FUNCTION public._job_queue_sync_feed_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.feed_id IS NULL AND NEW.payload ? 'feed_id' THEN
    NEW.feed_id := (NEW.payload->>'feed_id')::bigint;
  END IF;
  RETURN NEW;
END$$;

DROP TRIGGER IF EXISTS trg_job_queue_sync_feed_id ON public.job_queue;
CREATE TRIGGER trg_job_queue_sync_feed_id
  BEFORE INSERT ON public.job_queue
  FOR EACH ROW EXECUTE FUNCTION public._job_queue_sync_feed_id();

COMMENT ON FUNCTION public._job_queue_sync_feed_id() IS 
  'Transition helper. Syncs payload.feed_id to job_queue.feed_id column. Remove after Edge Function migration complete.';

RAISE NOTICE '✓ Created payload→column sync trigger';

-- =============================================================================
-- VERIFICATION
-- =============================================================================

DO $$
DECLARE
  v_articles_feed_id_exists BOOLEAN;
  v_job_queue_feed_id_exists BOOLEAN;
  v_feed_metrics_exists BOOLEAN;
  v_feed_errors_exists BOOLEAN;
  v_compliance_rules_exists BOOLEAN;
BEGIN
  -- Check columns
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'articles' 
      AND column_name = 'feed_id'
  ) INTO v_articles_feed_id_exists;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'job_queue' 
      AND column_name = 'feed_id'
  ) INTO v_job_queue_feed_id_exists;

  -- Check tables
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'feed_metrics'
  ) INTO v_feed_metrics_exists;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'feed_errors'
  ) INTO v_feed_errors_exists;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_name = 'feed_compliance_rules'
  ) INTO v_compliance_rules_exists;

  -- Assertions
  IF NOT v_articles_feed_id_exists THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: articles.feed_id column not created';
  END IF;

  IF NOT v_job_queue_feed_id_exists THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: job_queue.feed_id column not created';
  END IF;

  IF NOT v_feed_metrics_exists THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: feed_metrics table not created';
  END IF;

  IF NOT v_feed_errors_exists THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: feed_errors table not created';
  END IF;

  IF NOT v_compliance_rules_exists THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: feed_compliance_rules table not created';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '==========================================';
  RAISE NOTICE '✅ Migration 027 completed successfully!';
  RAISE NOTICE '==========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '1. Run 03_BACKFILL_SCRIPT.sql (map articles to feeds)';
  RAISE NOTICE '2. Review backfill results before applying UPDATE';
  RAISE NOTICE '3. Proceed to Migration 028 (RPCs)';
  RAISE NOTICE '';
END $$;
