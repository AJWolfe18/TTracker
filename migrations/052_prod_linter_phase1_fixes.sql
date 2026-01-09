-- Migration 052: PROD Linter Phase 1 Fixes (TTRC-366)
-- Fixes function_search_path_mutable warnings + drops verified duplicate indexes
-- Extension-owned functions excluded
-- RLS policy changes excluded (handled in Phase 2 if needed)

--------------------------------------------------------------------------------
-- TXN 1: SECURITY FIXES (function search_path)
--------------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Part A: Application functions (from TEST audit with verified signatures)
ALTER FUNCTION public._ensure_today_metrics(p_feed_id bigint) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public._job_queue_sync_feed_id() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.acquire_feed_lock(feed_id_param integer) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.attach_or_create_story(
  _article_id text,
  _title text,
  _url text,
  _url_canonical text,
  _url_hash text,
  _published_at timestamp with time zone,
  _source_name text,
  _source_domain text,
  _primary_actor text,
  _categories text[]
) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.block_political_entries_writes() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.check_columns_exist(table_name text, column_names text[]) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.claim_and_start_job(p_job_type text, p_stale_minutes integer) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.cleanup_old_jobs() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.count_runnable_fetch_jobs() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.diagnose_job_queue() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.enqueue_clustering_job() SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.enqueue_fetch_job(
  p_feed_id bigint,
  p_job_type text,
  p_payload jsonb,
  p_run_at timestamp with time zone,
  p_payload_hash text
) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.enqueue_fetch_job(p_type text, p_payload jsonb) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.find_similar_stories(
  query_embedding vector,
  match_limit integer,
  min_similarity double precision
) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.finish_job(p_job_id bigint, p_status text, p_result jsonb, p_error text) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.finish_job(p_job_id bigint, p_success boolean, p_error_message text) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.get_daily_openai_spend(target_date date) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.get_embedding_similarities(
  p_query_embedding double precision[],
  p_story_ids bigint[]
) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.get_monthly_openai_spend() SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.get_story_candidates(
  article_embedding vector,
  article_entity_ids text[],
  article_published_at timestamp with time zone,
  time_window_hours integer,
  ann_limit integer,
  max_total integer
) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.get_unclustered_articles(limit_count integer) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.hamming_distance_bigint(a bigint, b bigint) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.increment_budget_with_limit(
  day_param date,
  amount_usd numeric,
  call_count integer,
  daily_limit numeric
) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.increment_story_entities(p_story_id bigint, p_entity_ids text[]) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.job_queue_sync_legacy_type() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.pg_proc_check(proc_name text) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.prevent_enriched_at_update() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.recompute_story_centroids() SET search_path = pg_catalog, public, extensions;

-- Fixed signatures (verified from TEST audit):
ALTER FUNCTION public.record_feed_error(p_feed_id bigint, p_error text) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.record_feed_not_modified(p_feed_id bigint, p_duration_ms integer) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.record_feed_success(p_feed_id bigint, p_duration_ms integer) SET search_path = pg_catalog, public, extensions;

ALTER FUNCTION public.release_feed_lock(feed_id_param integer) SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.reset_stuck_jobs() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.set_updated_at() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.trigger_enqueue_clustering() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.update_story_lifecycle_states() SET search_path = pg_catalog, public, extensions;
ALTER FUNCTION public.update_updated_at_column() SET search_path = pg_catalog, public, extensions;

-- Part A-2: Functions that may only exist in PROD (optional; safe no-op in TEST)
DO $$
BEGIN
  BEGIN
    ALTER FUNCTION public.upsert_article_and_enqueue_jobs(
      p_url text,
      p_title text,
      p_content text,
      p_published_at timestamp with time zone,
      p_feed_id text,
      p_source_name text,
      p_source_domain text,
      p_content_type text,
      p_is_opinion boolean,
      p_metadata jsonb
    ) SET search_path = pg_catalog, public, extensions;
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'Skipping missing function: public.upsert_article_and_enqueue_jobs(...)';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER FUNCTION public.list_runnable_fetch_jobs()
      SET search_path = pg_catalog, public, extensions;
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'Skipping missing function: public.list_runnable_fetch_jobs()';
  END;
END $$;

DO $$
BEGIN
  BEGIN
    ALTER FUNCTION public.reset_stuck_jobs(p_timeout_minutes integer)
      SET search_path = pg_catalog, public, extensions;
  EXCEPTION WHEN undefined_function THEN
    RAISE NOTICE 'Skipping missing function: public.reset_stuck_jobs(integer)';
  END;
END $$;

COMMIT;

--------------------------------------------------------------------------------
-- TXN 2: PERFORMANCE FIXES (drop verified duplicate indexes)
-- Note: non-concurrent drops require an ACCESS EXCLUSIVE-ish lock on the index;
-- lock_timeout keeps this from hanging. If it fails, this txn rolls back ONLY itself.
--------------------------------------------------------------------------------
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DROP INDEX IF EXISTS public.idx_article_story_story;          -- duplicate of ix_article_story_story_id
DROP INDEX IF EXISTS public.idx_articles_published;           -- duplicate of idx_articles_published_at
DROP INDEX IF EXISTS public.idx_job_queue_stale_processing;   -- duplicate of ix_job_queue_processing_started_at

COMMIT;
