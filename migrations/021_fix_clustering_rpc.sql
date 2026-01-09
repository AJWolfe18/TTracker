-- Migration 021: Fix attach_or_create_story RPC to use actual clustering algorithm
-- CRITICAL: Previous RPC hardcoded score to 75.0 and matched only on actor
-- This migration implements the real scoring algorithm from scripts/rss/clustering.js

-- Drop the old stub function
DROP FUNCTION IF EXISTS attach_or_create_story(TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT[]);

-- Create improved clustering function with actual scoring
CREATE OR REPLACE FUNCTION attach_or_create_story(
  _article_id TEXT,
  _title TEXT,
  _url TEXT,
  _url_canonical TEXT,
  _url_hash TEXT,
  _published_at TIMESTAMPTZ,
  _source_name TEXT,
  _source_domain TEXT,
  _primary_actor TEXT DEFAULT NULL,
  _categories TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_story_id BIGINT;
  v_best_score NUMERIC(5,2) := 0;
  v_is_new BOOLEAN := FALSE;
  v_reopened BOOLEAN := FALSE;
  v_candidate RECORD;
  v_score NUMERIC(5,2);
  v_title_similarity NUMERIC(5,2);
  v_date_score NUMERIC(5,2);
  v_actor_score NUMERIC(5,2);
  v_hours_diff NUMERIC;
  v_story_hash TEXT;

  -- Constants from clustering.js
  c_threshold CONSTANT NUMERIC := 65.0;
  c_time_window_hours CONSTANT NUMERIC := 72.0;
BEGIN
  -- 1. Check if article already clustered
  SELECT story_id INTO v_story_id
  FROM article_story
  WHERE article_id = _article_id;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'already_clustered',
      'story_id', v_story_id,
      'created_new', false,
      'reopened', false,
      'similarity_score', 100
    );
  END IF;

  -- 2. Find candidate stories (active stories within time window)
  FOR v_candidate IN
    SELECT
      s.id,
      s.primary_headline,
      s.primary_source_url,
      s.primary_actor,
      s.first_seen_at,
      s.status
    FROM stories s
    WHERE s.status IN ('active', 'closed')
      AND s.first_seen_at > (_published_at - INTERVAL '72 hours')
      AND s.first_seen_at < (_published_at + INTERVAL '72 hours')
    ORDER BY s.first_seen_at DESC
    LIMIT 50
  LOOP
    -- Initialize score
    v_score := 0;

    -- A. URL match (30 points for exact duplicate)
    IF _url_canonical IS NOT NULL
       AND v_candidate.primary_source_url IS NOT NULL
       AND _url_canonical = v_candidate.primary_source_url THEN
      v_score := v_score + 30;
    END IF;

    -- B. Title similarity (0-45 points using basic string similarity)
    -- Using PostgreSQL's built-in similarity (requires pg_trgm extension)
    IF _title IS NOT NULL AND v_candidate.primary_headline IS NOT NULL THEN
      -- Normalize and compare (using trigram similarity as proxy for Jaro-Winkler)
      v_title_similarity := similarity(
        lower(regexp_replace(_title, '[^\w\s]', '', 'g')),
        lower(regexp_replace(v_candidate.primary_headline, '[^\w\s]', '', 'g'))
      );

      -- Convert 0-1 similarity to 0-45 point scale
      -- Using simplified curve: >0.85 = 40-45pts, 0.70-0.85 = 28-40pts, 0.50-0.70 = 15-28pts
      IF v_title_similarity > 0.85 THEN
        v_score := v_score + (40 + (v_title_similarity - 0.85) * 33)::NUMERIC(5,2);
      ELSIF v_title_similarity > 0.70 THEN
        v_score := v_score + (28 + (v_title_similarity - 0.70) * 80)::NUMERIC(5,2);
      ELSIF v_title_similarity > 0.50 THEN
        v_score := v_score + (15 + (v_title_similarity - 0.50) * 65)::NUMERIC(5,2);
      ELSE
        v_score := v_score + (v_title_similarity * 30)::NUMERIC(5,2);
      END IF;
    END IF;

    -- C. Date proximity (0-10 points)
    v_hours_diff := EXTRACT(EPOCH FROM (v_candidate.first_seen_at - _published_at)) / 3600;
    v_hours_diff := ABS(v_hours_diff);

    IF v_hours_diff <= 24 THEN
      v_date_score := 10;
    ELSIF v_hours_diff <= 48 THEN
      v_date_score := 5;
    ELSE
      v_date_score := 0;
    END IF;
    v_score := v_score + v_date_score;

    -- D. Actor match (5 points)
    IF _primary_actor IS NOT NULL
       AND v_candidate.primary_actor IS NOT NULL
       AND lower(regexp_replace(_primary_actor, '[^\w\s]', '', 'g')) =
           lower(regexp_replace(v_candidate.primary_actor, '[^\w\s]', '', 'g')) THEN
      v_score := v_score + 5;
    END IF;

    -- Track best match
    IF v_score > v_best_score THEN
      v_best_score := v_score;
      v_story_id := v_candidate.id;

      -- Check if we're reopening a closed story
      IF v_candidate.status = 'closed' AND v_score >= c_threshold THEN
        v_reopened := TRUE;
      END IF;
    END IF;
  END LOOP;

  -- 3. Create new story if no match meets threshold
  IF v_story_id IS NULL OR v_best_score < c_threshold THEN
    -- Generate story hash for uniqueness
    v_story_hash := encode(digest(_title || COALESCE(_primary_actor, ''), 'sha256'), 'hex');

    INSERT INTO stories (
      story_hash,
      primary_headline,
      primary_source_url,
      primary_source,
      primary_source_domain,
      primary_actor,
      first_seen_at,
      last_updated_at,
      source_count,
      topic_tags,
      status
    ) VALUES (
      v_story_hash,
      _title,
      _url_canonical,
      _source_name,
      _source_domain,
      _primary_actor,
      _published_at,
      _published_at,
      1,
      COALESCE(_categories, ARRAY[]::TEXT[]),
      'active'
    ) RETURNING id INTO v_story_id;

    v_is_new := TRUE;
    v_best_score := 100;
  ELSE
    -- Update existing story
    UPDATE stories
    SET
      last_updated_at = GREATEST(last_updated_at, _published_at),
      source_count = source_count + 1,
      status = CASE
        WHEN status = 'closed' AND v_reopened THEN 'active'
        ELSE status
      END
    WHERE id = v_story_id;
  END IF;

  -- 4. Create article-story link
  INSERT INTO article_story (
    article_id,
    story_id,
    similarity_score,
    is_primary_source,
    matched_at
  ) VALUES (
    _article_id,
    v_story_id,
    v_best_score,
    v_is_new,
    NOW()
  ) ON CONFLICT (article_id) DO NOTHING;

  -- 5. Return result
  RETURN jsonb_build_object(
    'status', CASE WHEN v_is_new THEN 'created' ELSE 'attached' END,
    'story_id', v_story_id,
    'created_new', v_is_new,
    'reopened', v_reopened,
    'similarity_score', v_best_score
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'attach_or_create_story failed for article %: %', _article_id, SQLERRM;
  RETURN jsonb_build_object(
    'status', 'error',
    'error', SQLERRM,
    'story_id', NULL,
    'created_new', false,
    'reopened', false,
    'similarity_score', 0
  );
END $$;

-- Enable pg_trgm extension if not already enabled (for similarity() function)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION attach_or_create_story(
  TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT[]
) TO service_role, anon, authenticated;

COMMENT ON FUNCTION attach_or_create_story IS
'Story clustering with actual similarity scoring (ported from scripts/rss/clustering.js).
Scoring: URL(30) + Title(0-45) + Date(0-10) + Actor(5) = max 90 points.
Threshold: 65 points to attach, else create new story.
Time window: ±72 hours to prevent cross-day over-clustering.';
