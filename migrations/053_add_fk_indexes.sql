-- Migration 053: Add FK Indexes for openai_usage (TTRC-376)
-- Purpose: Add missing foreign key indexes (linter recommendations)
-- Risk: None - brief lock during creation, sub-second for small table

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';  -- Safe margin for larger tables

CREATE INDEX IF NOT EXISTS idx_openai_usage_article_id
  ON public.openai_usage(article_id);

CREATE INDEX IF NOT EXISTS idx_openai_usage_story_id
  ON public.openai_usage(story_id);

COMMIT;
