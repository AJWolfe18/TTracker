-- =============================================================================
-- Migration 027: RSS Feed Tracking Schema (FIXED for Supabase)
-- =============================================================================
-- Purpose: Add feed-level tracking, metrics, compliance, and error logging
-- Date: 2025-10-28
-- Environment: TEST

-- Verification: Confirm we're in TEST
DO $$
BEGIN
  RAISE NOTICE 'Applying Migration 027 in database: %', current_database();
  RAISE NOTICE 'Timestamp: %', NOW();
END $$;

-- =============================================================================
-- PART 1: Add feed_id columns to existing tables
-- =============================================================================

ALTER TABLE public.articles
  ADD COLUMN IF NOT EXISTS feed_id BIGINT;

ALTER TABLE public.job_queue
  ADD COLUMN IF NOT EXISTS feed_id BIGINT;

DO $$ BEGIN RAISE NOTICE '✓ Added feed_id columns'; END $$;

-- =============================================================================
-- PART 2: Fix index conflicts
-- =============================================================================

-- Drop the UNIQUE constraint (which will also drop the backing index)
ALTER TABLE public.job_queue
  DROP CONSTRAINT IF EXISTS job_queue_type_payload_hash_key;

DO $$ BEGIN RAISE NOTICE '✓ Dropped conflicting full-table unique constraint (if existed)'; END $$;

-- =============================================================================
-- PART 3: Add foreign key constraints with proper delete behavior
-- =============================================================================

ALTER TABLE public.articles
  DROP CONSTRAINT IF EXISTS articles_feed_id_fkey,
  ADD CONSTRAINT articles_feed_id_fkey
    FOREIGN KEY (feed_id) REFERENCES public.feed_registry(id) ON DELETE SET NULL;

ALTER TABLE public.job_queue
  DROP CONSTRAINT IF EXISTS job_queue_feed_id_fkey,
  ADD CONSTRAINT job_queue_feed_id_fkey
    FOREIGN KEY (feed_id) REFERENCES public.feed_registry(id) ON DELETE SET NULL;

DO $$ BEGIN RAISE NOTICE '✓ Added foreign key constraints'; END $$;

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

DO $$ BEGIN RAISE NOTICE '✓ Added tracking columns to feed_registry'; END $$;

-- =============================================================================
-- PART 5: Create new tables for metrics, errors, and compliance
-- =============================================================================

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

CREATE TABLE IF NOT EXISTS public.feed_errors (
  id BIGSERIAL PRIMARY KEY,
  feed_id BIGINT NOT NULL REFERENCES public.feed_registry(id) ON DELETE CASCADE,
  error_message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.feed_errors IS
  'RSS feed error log. Truncated to 500 chars per error. Recommend nightly cleanup: DELETE WHERE created_at < NOW() - INTERVAL ''30 days''.';

CREATE TABLE IF NOT EXISTS public.feed_compliance_rules (
  feed_id BIGINT PRIMARY KEY REFERENCES public.feed_registry(id) ON DELETE CASCADE,
  source_name TEXT,
  allow_full_text BOOLEAN NOT NULL DEFAULT FALSE,
  max_chars INTEGER NOT NULL DEFAULT 1200,
  notes TEXT
);

COMMENT ON TABLE public.feed_compliance_rules IS
  'Per-feed content usage rules for copyright compliance. Default: excerpts only (1200 chars). Set allow_full_text=true only for sources that explicitly permit full-text storage.';

COMMENT ON COLUMN public.feed_compliance_rules.source_name IS
  'Display name for admin UI. NOT used for joins (use feed_id FK). Allows feed renames without breaking compliance rules.';

DO $$ BEGIN RAISE NOTICE '✓ Created feed_metrics, feed_errors, feed_compliance_rules tables'; END $$;

-- =============================================================================
-- PART 6: Create indexes for performance
-- =============================================================================

CREATE INDEX IF NOT EXISTS ix_articles_feed_id
  ON public.articles(feed_id);

CREATE INDEX IF NOT EXISTS ix_job_queue_feed_id
  ON public.job_queue(feed_id);

CREATE INDEX IF NOT EXISTS ix_job_queue_next_active_by_feed
  ON public.job_queue (feed_id, run_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_job_queue_feed_id_null
  ON public.job_queue (created_at)
  WHERE feed_id IS NULL AND processed_at IS NULL;

COMMENT ON INDEX public.ix_job_queue_feed_id_null IS
  'Tracks legacy jobs created before Migration 027. Use in dashboard: SELECT COUNT(*) FROM job_queue WHERE feed_id IS NULL AND processed_at IS NULL. Target: 0 after Edge Function migration complete.';

CREATE INDEX IF NOT EXISTS ix_feed_errors_feed_time
  ON public.feed_errors (feed_id, created_at);

CREATE INDEX IF NOT EXISTS ix_feed_errors_created_at
  ON public.feed_errors(created_at);

COMMENT ON INDEX public.ix_feed_errors_created_at IS
  'Supports nightly cleanup query: DELETE FROM feed_errors WHERE created_at < NOW() - INTERVAL ''30 days''.';

DO $$ BEGIN RAISE NOTICE '✓ Created all indexes'; END $$;

-- =============================================================================
-- PART 7: Payload→column sync trigger (transition helper)
-- =============================================================================

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

DO $$ BEGIN RAISE NOTICE '✓ Created payload→column sync trigger'; END $$;

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
  RAISE NOTICE '1. Run backfill script (map articles to feeds)';
  RAISE NOTICE '2. Review backfill results before applying UPDATE';
  RAISE NOTICE '3. Proceed to Migration 028 (RPCs)';
  RAISE NOTICE '';
END $$;
