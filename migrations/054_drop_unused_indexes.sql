-- Migration 054: Drop Verified Unused Indexes (TTRC-376)
-- Purpose: Remove indexes for deprecated/experimental/dormant features
-- Evidence: Job queue deprecated per TTRC-369; merge/split dormant since Oct 2025
--
-- IMPORTANT: Rollback CREATE statements are at the bottom of this file

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- ============================================================================
-- Job Queue System (DEPRECATED per TTRC-369) - 10 indexes
-- Evidence: rss-e2e-test.yml line 23: "DISABLED: Uses superseded job-queue-worker"
-- Verification: rss-tracker-supabase.js has zero job_queue references
-- ============================================================================
DROP INDEX IF EXISTS public.idx_job_queue_runnable;
DROP INDEX IF EXISTS public.idx_job_queue_pending;
DROP INDEX IF EXISTS public.idx_job_queue_pending_run_at;
DROP INDEX IF EXISTS public.idx_job_queue_processing;
DROP INDEX IF EXISTS public.idx_job_queue_retry;
DROP INDEX IF EXISTS public.idx_queue_pending;
DROP INDEX IF EXISTS public.ix_job_queue_pending_run;
DROP INDEX IF EXISTS public.ix_job_queue_processed_at;
DROP INDEX IF EXISTS public.ix_job_queue_processing_started_at;
DROP INDEX IF EXISTS public.ix_job_queue_status_completed_at;

-- ============================================================================
-- Geo Feature (NEVER DEPLOYED) - 2 indexes
-- Evidence: No workflows reference geo fields; only test files
-- ============================================================================
DROP INDEX IF EXISTS public.ix_articles_geo_state;
DROP INDEX IF EXISTS public.ix_articles_geo_country;

-- ============================================================================
-- Experimental Features (NEVER DEPLOYED) - 2 indexes
-- Evidence: Created in migration 022 but never populated or used
-- ============================================================================
DROP INDEX IF EXISTS public.ix_articles_text_simhash;
DROP INDEX IF EXISTS public.ix_articles_title_tfidf_hnsw;

-- ============================================================================
-- Dormant Merge/Split Feature (USER APPROVED) - 7 indexes
-- Evidence: Last used Oct 2025, no GitHub workflow triggers these
-- ============================================================================
DROP INDEX IF EXISTS public.idx_story_merge_actions_source;
DROP INDEX IF EXISTS public.idx_story_merge_actions_target;
DROP INDEX IF EXISTS public.idx_story_merge_actions_merged_at;
DROP INDEX IF EXISTS public.idx_story_split_actions_original;
DROP INDEX IF EXISTS public.idx_story_split_actions_split_at;
DROP INDEX IF EXISTS public.idx_story_split_actions_new_ids_gin;
DROP INDEX IF EXISTS public.idx_stories_merged_into;

COMMIT;

-- ============================================================================
-- ROLLBACK SECTION (Run these to recreate dropped indexes if needed)
-- ============================================================================
/*
-- Job Queue indexes (if reviving job queue system)
CREATE INDEX idx_job_queue_runnable ON public.job_queue USING btree (job_type, run_at, id) WHERE ((processed_at IS NULL) AND (status = 'pending'::text));
CREATE INDEX idx_job_queue_pending ON public.job_queue USING btree (status, created_at) WHERE (status = 'pending'::text);
CREATE INDEX idx_job_queue_pending_run_at ON public.job_queue USING btree (status, run_at);
CREATE INDEX idx_job_queue_processing ON public.job_queue USING btree (status, started_at) WHERE (status = 'processing'::text);
CREATE INDEX idx_job_queue_retry ON public.job_queue USING btree (next_retry_at);
CREATE INDEX idx_queue_pending ON public.job_queue USING btree (run_after, created_at) WHERE (status = 'pending'::text);
CREATE INDEX ix_job_queue_pending_run ON public.job_queue USING btree (run_at, id) WHERE (status = 'pending'::text);
CREATE INDEX ix_job_queue_processed_at ON public.job_queue USING btree (processed_at);
CREATE INDEX ix_job_queue_processing_started_at ON public.job_queue USING btree (status, started_at) WHERE ((processed_at IS NULL) AND (status = 'processing'::text));
CREATE INDEX ix_job_queue_status_completed_at ON public.job_queue USING btree (status, completed_at);

-- Geo indexes (if implementing geo feature)
CREATE INDEX ix_articles_geo_state ON public.articles USING btree (((geo ->> 'state'::text)));
CREATE INDEX ix_articles_geo_country ON public.articles USING btree (((geo ->> 'country'::text)));

-- Experimental indexes (unlikely to need)
CREATE INDEX ix_articles_text_simhash ON public.articles USING btree (text_simhash) WHERE (text_simhash IS NOT NULL);
CREATE INDEX ix_articles_title_tfidf_hnsw ON public.articles USING hnsw (title_tfidf_vector vector_cosine_ops) WITH (m='12', ef_construction='64');

-- Merge/Split indexes (if reviving feature)
CREATE INDEX idx_story_merge_actions_source ON public.story_merge_actions USING btree (source_story_id);
CREATE INDEX idx_story_merge_actions_target ON public.story_merge_actions USING btree (target_story_id);
CREATE INDEX idx_story_merge_actions_merged_at ON public.story_merge_actions USING btree (merged_at DESC);
CREATE INDEX idx_story_split_actions_original ON public.story_split_actions USING btree (original_story_id);
CREATE INDEX idx_story_split_actions_split_at ON public.story_split_actions USING btree (split_at DESC);
CREATE INDEX idx_story_split_actions_new_ids_gin ON public.story_split_actions USING gin (new_story_ids);
CREATE INDEX idx_stories_merged_into ON public.stories USING btree (merged_into_story_id) WHERE (merged_into_story_id IS NOT NULL);
*/
