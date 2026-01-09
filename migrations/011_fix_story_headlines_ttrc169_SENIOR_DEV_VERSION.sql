-- FIX FOR TTRC-169: NULL Story Headlines + Type-Safe attach_or_create_story
-- Senior Dev Review Applied - Fixes critical BIGINT type mismatch
-- Run in TEST first; then in PROD during a low-traffic window.

BEGIN;

-- 1) Headline backfill: ensure NO story has a NULL headline.
UPDATE public.stories
SET headline = COALESCE(primary_headline, 'Untitled Story')
WHERE headline IS NULL;

-- 2) Function: attach_or_create_story (type-safe for BIGINT stories.id)
CREATE OR REPLACE FUNCTION public.attach_or_create_story(
  _article_id        TEXT,
  _title             TEXT,
  _url               TEXT,
  _url_canonical     TEXT,
  _url_hash          TEXT,
  _published_at      TIMESTAMPTZ,
  _source_name       TEXT,
  _source_domain     TEXT,
  _primary_actor     TEXT DEFAULT NULL,
  _categories        TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_story_id          BIGINT;           -- CRITICAL: stories.id is BIGINT not TEXT!
  v_is_new            BOOLEAN := false;
  v_similarity_score  NUMERIC(5,2) := 75.00;
  v_status            TEXT;
  v_linked            BOOLEAN := false;
BEGIN
  -- If already linked, exit early
  SELECT story_id INTO v_story_id
  FROM public.article_story
  WHERE article_id = _article_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_clustered',
      'story_id', v_story_id,
      'created', false,
      'similarity_score', 100.0
    );
  END IF;

  -- Find candidate stories (NULL-safe actor matching)
  SELECT s.id
  INTO v_story_id
  FROM public.stories s
  WHERE s.status = 'active'
    AND s.first_seen_at > NOW() - INTERVAL '7 days'
    AND (
      (_primary_actor IS NOT NULL AND (
          s.primary_actor = _primary_actor
          OR s.primary_headline ILIKE '%' || _primary_actor || '%'
      ))
      OR (_primary_actor IS NULL)
    )
  ORDER BY s.first_seen_at DESC
  LIMIT 1;

  -- Create story if no candidate
  IF v_story_id IS NULL THEN
    INSERT INTO public.stories (
      -- id omitted - let database generate BIGSERIAL
      headline,
      primary_headline,
      primary_url,
      primary_source,
      primary_actor,
      first_seen_at,
      last_seen_at,
      article_count,
      status
    ) VALUES (
      COALESCE(NULLIF(_title, ''), 'Untitled Story'),
      COALESCE(NULLIF(_title, ''), 'Untitled Story'),
      _url,
      _source_name,
      NULLIF(_primary_actor, ''),
      _published_at,
      _published_at,
      0,  -- Start at 0, increment only if link succeeds
      'active'
    ) RETURNING id INTO v_story_id;

    v_is_new := true;
    v_similarity_score := 100.0;
  ELSE
    -- Update existing story metadata
    UPDATE public.stories
    SET
      last_seen_at = GREATEST(COALESCE(last_seen_at, _published_at), _published_at),
      headline = COALESCE(headline, COALESCE(NULLIF(_title, ''), 'Untitled Story'))
    WHERE id = v_story_id;
  END IF;

  -- Clamp score to valid range
  v_similarity_score := GREATEST(0, LEAST(100, COALESCE(v_similarity_score, 100)));

  -- Create link with concurrency safety
  WITH ins AS (
    INSERT INTO public.article_story (
      article_id,
      story_id,
      similarity_score,
      is_primary,
      matched_at
    )
    VALUES (
      _article_id,
      v_story_id,
      v_similarity_score,
      v_is_new,
      NOW()
    )
    ON CONFLICT (article_id) DO NOTHING
    RETURNING 1
  )
  SELECT TRUE INTO v_linked FROM ins;

  -- Only increment count if link was actually created
  IF v_linked THEN
    UPDATE public.stories
    SET article_count = COALESCE(article_count, 0) + 1
    WHERE id = v_story_id;
  END IF;

  RETURN jsonb_build_object(
    'status', CASE
                WHEN NOT v_linked THEN 'race_lost_already_clustered'
                WHEN v_is_new THEN 'created'
                ELSE 'attached'
              END,
    'story_id', v_story_id,
    'created', v_is_new,
    'similarity_score', v_similarity_score
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'status', 'error',
    'error', SQLERRM,
    'story_id', NULL,
    'created', false,
    'similarity_score', 0
  );
END $$;

-- 3) Verification
SELECT 
  COUNT(*) AS total_stories,
  COUNT(headline) AS stories_with_headline,
  COUNT(*) - COUNT(headline) AS stories_missing_headline,
  COUNT(CASE WHEN headline = 'Untitled Story' THEN 1 END) AS untitled_stories
FROM public.stories
WHERE first_seen_at > NOW() - INTERVAL '7 days';

-- 4) Type verification
SELECT 
  'Data Type Check' as check_name,
  data_type,
  CASE 
    WHEN data_type = 'bigint' THEN '✅ Correct - BIGINT as documented'
    ELSE '❌ ERROR - Expected BIGINT but got ' || data_type
  END as status
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'stories'
  AND column_name = 'id';

COMMIT;

-- Post-migration notes:
-- This fixes:
-- 1. NULL headlines in stories table
-- 2. Type mismatch (stories.id is BIGINT, not TEXT)
-- 3. Concurrent worker race conditions
-- 4. Inaccurate article_count increments
-- 5. NULL-unsafe actor matching