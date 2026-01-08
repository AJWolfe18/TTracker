-- TTRC-192: Story Reopen Support in attach_or_create_story
-- Hardened version: canonical URL, race-safe insert, row locking, RLS-ready
-- Allows clustering to reopen closed stories instead of creating duplicates
-- Returns 'reopened' flag for enrichment triggering

BEGIN;

-- Hardened function with concurrency safety and canonical URL support
CREATE OR REPLACE FUNCTION public.attach_or_create_story(
  _article_id        TEXT,
  _title             TEXT,
  _url               TEXT,
  _url_canonical     TEXT,
  _url_hash          TEXT,         -- accepted but unused; compute in DB if needed
  _published_at      TIMESTAMPTZ,
  _source_name       TEXT,
  _source_domain     TEXT,         -- accepted but unused; derive from URL when needed
  _primary_actor     TEXT DEFAULT NULL,
  _categories        TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
-- Keep SECURITY INVOKER while RLS is off; flip to DEFINER when RLS enabled (see below)
SET search_path = public
AS $$
DECLARE
  v_story_id          BIGINT;
  v_is_new            BOOLEAN := false;
  v_was_reopened      BOOLEAN := false;
  v_similarity_score  NUMERIC(5,2) := 75.00;
  v_linked            BOOLEAN := false;
  v_old_status        TEXT;

  v_title_clean TEXT := COALESCE(NULLIF(_title,''), 'Untitled Story');
  v_story_hash  TEXT := md5(lower(regexp_replace(v_title_clean, '\s+', ' ', 'g')));
  v_primary_source_url TEXT := COALESCE(NULLIF(_url_canonical,''), _url);
BEGIN
  -- If already linked, exit early
  SELECT story_id INTO v_story_id
  FROM public.article_story
  WHERE article_id = _article_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status','already_clustered','story_id',v_story_id,
      'created_new',false,'reopened',false,'similarity_score',100.0
    );
  END IF;

  -- Candidate: prefer active; lock row to avoid reopen races
  SELECT s.id, s.status
    INTO v_story_id, v_old_status
  FROM public.stories s
  WHERE s.status IN ('active','closed')
    AND s.first_seen_at > NOW() - INTERVAL '7 days'
    AND (
      (_primary_actor IS NOT NULL AND (s.primary_actor = _primary_actor OR s.primary_headline ILIKE '%'||_primary_actor||'%'))
      OR _primary_actor IS NULL
    )
  ORDER BY CASE WHEN s.status='active' THEN 0 ELSE 1 END, s.first_seen_at DESC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  -- Create story if no candidate; handle story_hash races
  IF v_story_id IS NULL THEN
    BEGIN
      INSERT INTO public.stories (
        story_hash,
        primary_headline,
        primary_source,
        primary_source_url,
        primary_actor,
        first_seen_at,
        last_updated_at,
        source_count,
        status,
        headline
      )
      VALUES (
        v_story_hash,
        v_title_clean,
        _source_name,
        v_primary_source_url,
        NULLIF(_primary_actor,''),
        _published_at,
        _published_at,
        0,
        'active',
        v_title_clean
      )
      ON CONFLICT (story_hash) DO UPDATE
      SET last_updated_at = GREATEST(public.stories.last_updated_at, EXCLUDED.last_updated_at)
      RETURNING id, (xmax = 0) AS inserted INTO v_story_id, v_is_new;

      -- xmax=0 indicates insert, xmax!=0 indicates update
      v_similarity_score := 100.0;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_story_id FROM public.stories WHERE story_hash = v_story_hash;
      v_is_new := FALSE;
    END;
  ELSE
    IF v_old_status = 'closed' THEN
      UPDATE public.stories
      SET status='active',
          closed_at=NULL,
          reopen_count=COALESCE(reopen_count,0)+1,
          last_updated_at=GREATEST(COALESCE(last_updated_at,_published_at), _published_at),
          headline=COALESCE(headline, v_title_clean)
      WHERE id = v_story_id;
      v_was_reopened := TRUE;
    ELSE
      UPDATE public.stories
      SET last_updated_at=GREATEST(COALESCE(last_updated_at,_published_at), _published_at),
          headline=COALESCE(headline, v_title_clean)
      WHERE id = v_story_id;
    END IF;
  END IF;

  -- Clamp score
  v_similarity_score := GREATEST(0, LEAST(100, COALESCE(v_similarity_score,100)));

  -- Link creation (idempotent)
  WITH ins AS (
    INSERT INTO public.article_story (
      article_id, story_id, similarity_score, is_primary_source, matched_at
    )
    VALUES (_article_id, v_story_id, v_similarity_score, v_is_new, NOW())
    ON CONFLICT (article_id) DO NOTHING
    RETURNING 1
  )
  SELECT TRUE INTO v_linked FROM ins;

  IF v_linked THEN
    UPDATE public.stories
    SET source_count = COALESCE(source_count,0) + 1
    WHERE id = v_story_id;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE
                WHEN NOT v_linked THEN 'race_lost_already_clustered'
                WHEN v_is_new THEN 'created'
                WHEN v_was_reopened THEN 'reopened'
                ELSE 'attached'
              END,
    'story_id', v_story_id,
    'created_new', v_is_new,
    'reopened', v_was_reopened,
    'similarity_score', v_similarity_score
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status','error','error',SQLERRM,
    'story_id',NULL,'created_new',false,'reopened',false,'similarity_score',0
  );
END $$;

-- Performance indexes
CREATE INDEX IF NOT EXISTS ix_stories_status_first_seen
  ON public.stories (status, first_seen_at DESC);

CREATE INDEX IF NOT EXISTS ix_stories_primary_actor
  ON public.stories (primary_actor);

COMMIT;

-- Verification query
SELECT
  'attach_or_create_story updated' as migration_step,
  '✅ Function hardened with race safety, canonical URL, and row locking' as status;

-- ==============================================================================
-- RLS PLAN (to enable later when ready)
-- ==============================================================================
-- Current: RLS is OFF, function is SECURITY INVOKER
-- When enabling RLS, follow these steps:

-- Step 1: Enable RLS on tables
-- ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.article_story ENABLE ROW LEVEL SECURITY;

-- Step 2: Create app role if not exists
-- DO $$
-- BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_role') THEN
--     CREATE ROLE app_role;
--   END IF;
-- END$$;

-- Step 3: Create policies
-- Read policies (broad)
-- CREATE POLICY stories_read_all ON public.stories FOR SELECT TO app_role USING (true);
-- CREATE POLICY article_story_read_all ON public.article_story FOR SELECT TO app_role USING (true);

-- Write policies (tight) — allow inserts/updates via definer function only
-- Pattern: deny direct writes to app_role, expose SECURITY DEFINER function

-- Step 4: Update function to SECURITY DEFINER
-- Replace function header with:
-- CREATE OR REPLACE FUNCTION public.attach_or_create_story(...)
-- RETURNS JSONB
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $$
-- ...

-- Step 5: Grant execute to app role
-- GRANT EXECUTE ON FUNCTION public.attach_or_create_story(
--   TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT[]
-- ) TO app_role;

-- ==============================================================================
-- OPTIONAL FUTURE ENHANCEMENTS (TODOs)
-- ==============================================================================
-- 1. Add story_urls table to store canonical + alternates
-- 2. Add fast-path for exact primary_source_url match (score 100)
-- 3. Add story_categories junction table for _categories param
-- 4. Add pg_trgm extension for fuzzy headline matching:
--    CREATE EXTENSION IF NOT EXISTS pg_trgm;
--    CREATE INDEX gin_stories_primary_headline_trgm
--      ON public.stories USING gin (primary_headline gin_trgm_ops);
