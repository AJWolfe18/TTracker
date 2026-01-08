-- ============================================================================
-- ROLLBACK PROCEDURES - Emergency Use Only
-- ============================================================================
-- Purpose: Reverse RSS v2 deployment if critical issues arise
-- Author: Josh (PM) + Claude
-- Date: October 25, 2025
-- Environment: TEST
-- ⚠️ WARNING: This drops tables and columns - use only in emergency

-- ============================================================================
-- WHEN TO USE THIS ROLLBACK
-- ============================================================================
--
-- Use if:
-- - Critical bugs in RPCs causing data corruption
-- - Performance issues blocking production
-- - Need to revert to stable state quickly
--
-- Do NOT use for:
-- - Minor bugs (fix forward instead)
-- - Cosmetic issues
-- - Individual feed problems (deactivate feed instead)
--
-- ============================================================================

-- ============================================================================
-- SECTION 1: Document current state (run BEFORE rollback)
-- ============================================================================

-- Backup counts for verification
SELECT 
  'Pre-rollback state' as checkpoint,
  NOW() as timestamp,
  (SELECT COUNT(*) FROM articles WHERE feed_id IS NOT NULL) as mapped_articles,
  (SELECT COUNT(*) FROM feed_metrics) as metrics_rows,
  (SELECT COUNT(*) FROM feed_errors) as error_logs,
  (SELECT COUNT(*) FROM feed_compliance_rules) as compliance_rules,
  (SELECT COUNT(*) FROM job_queue WHERE feed_id IS NOT NULL) as jobs_with_feed_id;

-- Export critical data to staging (optional but recommended)
CREATE TABLE IF NOT EXISTS admin.rollback_backup_article_feed_map AS
SELECT id, feed_id, created_at
FROM articles
WHERE feed_id IS NOT NULL;

COMMENT ON TABLE admin.rollback_backup_article_feed_map IS 
  'Emergency backup of article→feed mappings before rollback. DROP after confirming stability.';

-- ============================================================================
-- SECTION 2: Disable feeds (stop new jobs)
-- ============================================================================

-- Mark all feeds inactive (prevents new jobs during rollback)
UPDATE public.feed_registry 
SET is_active = FALSE
WHERE is_active = TRUE
RETURNING id, feed_name, 'Deactivated for rollback' as status;

-- Wait 30 seconds for active jobs to complete
-- (Manual step - do NOT run DROP statements until workers idle)

-- ============================================================================
-- SECTION 3: Drop triggers (order matters)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_job_queue_sync_feed_id ON public.job_queue;
DROP FUNCTION IF EXISTS public._job_queue_sync_feed_id();

-- ============================================================================
-- SECTION 4: Drop views
-- ============================================================================

DROP VIEW IF EXISTS admin.feed_cost_attribution;
DROP VIEW IF EXISTS admin.feed_activity_hints;
DROP VIEW IF EXISTS admin.feed_health_overview;

-- ============================================================================
-- SECTION 5: Drop functions (RPCs)
-- ============================================================================

-- Drop both signatures of enqueue_fetch_job
DROP FUNCTION IF EXISTS public.enqueue_fetch_job(bigint, text, jsonb, timestamptz, text);
DROP FUNCTION IF EXISTS public.enqueue_fetch_job(text, jsonb, text);

-- Drop metrics RPCs
DROP FUNCTION IF EXISTS public.record_feed_error(bigint, text);
DROP FUNCTION IF EXISTS public.record_feed_not_modified(bigint, integer);
DROP FUNCTION IF EXISTS public.record_feed_success(bigint, integer);
DROP FUNCTION IF EXISTS public._ensure_today_metrics(bigint);

-- ============================================================================
-- SECTION 6: Drop indexes
-- ============================================================================

DROP INDEX IF EXISTS public.ix_feed_metrics_date;
DROP INDEX IF EXISTS public.ix_feed_errors_created_at;
DROP INDEX IF EXISTS public.ix_feed_errors_feed_time;
DROP INDEX IF EXISTS public.ix_job_queue_feed_id_null;
DROP INDEX IF EXISTS public.ix_job_queue_next_active_by_feed;
DROP INDEX IF EXISTS public.ix_job_queue_feed_id;
DROP INDEX IF EXISTS public.ix_articles_feed_id;

-- Re-create the blocking index (if your old system depended on it)
-- CREATE UNIQUE INDEX job_queue_type_payload_hash_key ON public.job_queue (job_type, payload_hash);

-- ============================================================================
-- SECTION 7: Drop tables (cascading deletes)
-- ============================================================================

DROP TABLE IF EXISTS public.feed_compliance_rules CASCADE;
DROP TABLE IF EXISTS public.feed_errors CASCADE;
DROP TABLE IF EXISTS public.feed_metrics CASCADE;

-- ============================================================================
-- SECTION 8: Remove columns from existing tables
-- ============================================================================

-- Remove feed_id from job_queue
ALTER TABLE public.job_queue 
  DROP COLUMN IF EXISTS feed_id CASCADE;

-- Remove feed_id from articles (WARNING: loses mappings)
ALTER TABLE public.articles 
  DROP COLUMN IF EXISTS feed_id CASCADE;

-- Remove tracking columns from feed_registry
ALTER TABLE public.feed_registry
  DROP COLUMN IF EXISTS failure_count,
  DROP COLUMN IF EXISTS consecutive_successes,
  DROP COLUMN IF EXISTS last_response_time_ms;

-- ============================================================================
-- SECTION 9: Restore old function (if needed)
-- ============================================================================

-- Re-create original enqueue_fetch_job if you had a different signature
-- (Check your git history for the exact signature)
--
-- Example (adjust based on your actual old function):
-- CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(...)
-- RETURNS BIGINT AS $$
-- ...
-- $$;

-- ============================================================================
-- SECTION 10: Re-enable feeds
-- ============================================================================

-- Re-enable feeds (only after verifying system stable)
UPDATE public.feed_registry 
SET is_active = TRUE
WHERE id IN (1, 2, 3, 4, 5) -- Adjust based on your active feeds
RETURNING id, feed_name, 'Re-activated after rollback' as status;

-- ============================================================================
-- VERIFICATION: Confirm rollback success
-- ============================================================================

-- Check removed tables
SELECT 
  'Rollback verification' as category,
  table_name,
  '🛑 Still exists' as issue
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('feed_metrics', 'feed_errors', 'feed_compliance_rules');
-- Expected: 0 rows

-- Check removed columns
SELECT 
  'Rollback verification' as category,
  table_name,
  column_name,
  '🛑 Still exists' as issue
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'articles' AND column_name = 'feed_id')
    OR (table_name = 'job_queue' AND column_name = 'feed_id')
    OR (table_name = 'feed_registry' AND column_name IN ('last_response_time_ms', 'consecutive_successes', 'failure_count'))
  );
-- Expected: 0 rows

-- Check removed views
SELECT 
  'Rollback verification' as category,
  table_name,
  '🛑 Still exists' as issue
FROM information_schema.views
WHERE table_schema = 'admin'
  AND table_name IN ('feed_health_overview', 'feed_activity_hints', 'feed_cost_attribution');
-- Expected: 0 rows

-- Check removed functions
SELECT 
  'Rollback verification' as category,
  routine_name,
  '🛑 Still exists' as issue
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    '_ensure_today_metrics',
    'record_feed_success',
    'record_feed_not_modified',
    'record_feed_error'
  );
-- Expected: 0 rows

-- ============================================================================
-- POST-ROLLBACK STATUS
-- ============================================================================

SELECT 
  'System status after rollback' as category,
  (SELECT COUNT(*) FROM articles) as total_articles,
  (SELECT COUNT(*) FROM feed_registry WHERE is_active = TRUE) as active_feeds,
  (SELECT COUNT(*) FROM job_queue WHERE processed_at IS NULL) as pending_jobs;

-- ============================================================================
-- CLEANUP (OPTIONAL)
-- ============================================================================

-- Drop backup table after confirming system stable (wait 24 hours)
-- DROP TABLE IF EXISTS admin.rollback_backup_article_feed_map;

-- Drop article_feed_map staging table (if it still exists)
-- DROP TABLE IF EXISTS admin.article_feed_map;

-- ============================================================================
-- ROLLBACK COMPLETE
-- ============================================================================
--
-- ✅ Success indicators:
-- - All new tables/columns/views removed
-- - All verification queries return 0 rows
-- - Feeds re-enabled
-- - System operational
--
-- ⚠️ Post-rollback actions:
-- 1. Investigate root cause of rollback need
-- 2. Fix issues in development environment
-- 3. Test thoroughly before re-attempting deployment
-- 4. Document what went wrong in project handoff
--
-- 📝 Note: Article→feed mappings are lost. If you need to re-deploy,
--          the backfill script will re-create them from URL domains.
--
-- ============================================================================
