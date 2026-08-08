-- ============================================================================
-- Migration 106: Judge verdict memory (ADO-539)
-- ============================================================================
-- Problem: the candidate RPC has no verdict memory — the Gaza pair 13257/13295 was
-- judged uncertain 6x, Blanche pairs 6x/4x (2026-08-05 analysis on the ADO-539 card).
-- Fix: skip pairs whose latest LIVE, SETTLED verdict (dry_run=false; includes
-- source='manual', includes verdict='unmerge' — a human unmerge is an authoritative
-- "keep separate") is NEWER than the latest article_story.matched_at on either side.
-- A new article attaching to either story reopens the pair.
-- "Settled" excludes merge verdicts that were decided but never executed (merged=false,
-- e.g. the run cap of 10) — those are deferred to the next run by design and must NOT
-- be suppressed. See the predicate comment below.
-- Rollback: re-run migration 100 PART D (restores the previous function body).
-- Idempotent: CREATE OR REPLACE + IF NOT EXISTS. Same arity → ACLs preserved,
-- no re-grant needed; NOTIFY included anyway (harmless).

-- Partial index so the NOT EXISTS probe is cheap. LEAST/GREATEST are immutable on
-- bigint. Heartbeat rows (both ids NULL) are excluded by the predicate.
CREATE INDEX IF NOT EXISTS idx_judge_log_pair_live
  ON public.clustering_judge_log (
    LEAST(story_id_a, story_id_b),
    GREATEST(story_id_a, story_id_b),
    created_at DESC
  )
  WHERE dry_run = false AND story_id_a IS NOT NULL AND story_id_b IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_clustering_judge_candidates(
  p_min_sim   DOUBLE PRECISION DEFAULT 0.83,
  p_days      INT DEFAULT 7,
  p_max_pairs INT DEFAULT 30
)
RETURNS TABLE (
  story_id_a       BIGINT,
  story_id_b       BIGINT,
  headline_a       TEXT,
  headline_b       TEXT,
  centroid_sim     DOUBLE PRECISION,
  shared_entities  TEXT[],
  shared_slugs     TEXT[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  WITH stopwords AS (
    SELECT ARRAY[
      'US-TRUMP','US-BIDEN','LOC-USA','ORG-WHITE-HOUSE','ORG-DEM','ORG-GOP',
      'ORG-CONGRESS','ORG-SENATE','ORG-HOUSE','ORG-SUPREME-COURT','ORG-DOJ',
      'ORG-FBI','LOC-WASHINGTON'
    ]::text[] AS words
  ),
  recent AS (
    SELECT id, primary_headline, centroid_embedding_v1,
           COALESCE(top_entities, ARRAY[]::text[]) AS top_entities,
           COALESCE(topic_slugs, ARRAY[]::text[])  AS topic_slugs
    FROM stories
    WHERE status = 'active'
      AND merged_into_story_id IS NULL
      AND centroid_embedding_v1 IS NOT NULL
      AND first_seen_at >= NOW() - (p_days || ' days')::interval
  )
  -- CROSS JOIN stopwords so sw.words is a text[] COLUMN reference: `e <> ALL(sw.words)` is the
  -- array-comparison form. (`e <> ALL((SELECT words FROM stopwords))` reads the subquery as a set of
  -- rows — each a text[] — giving `text <> text[]` "operator does not exist".)
  SELECT
    a.id AS story_id_a,
    b.id AS story_id_b,
    a.primary_headline AS headline_a,
    b.primary_headline AS headline_b,
    (1 - (a.centroid_embedding_v1 <=> b.centroid_embedding_v1))::double precision AS centroid_sim,
    -- shared non-stopword entities (context only)
    ARRAY(
      SELECT e FROM unnest(a.top_entities) e
      WHERE e = ANY(b.top_entities) AND e <> ALL(sw.words)
    ) AS shared_entities,
    -- shared topic slugs (context only)
    ARRAY(
      SELECT s FROM unnest(a.topic_slugs) s
      WHERE s = ANY(b.topic_slugs)
    ) AS shared_slugs
  FROM recent a
  JOIN recent b ON a.id < b.id
  CROSS JOIN stopwords sw
  WHERE (1 - (a.centroid_embedding_v1 <=> b.centroid_embedding_v1)) >= p_min_sim
    -- ADO-539 verdict memory: skip pairs with a live verdict newer than the latest
    -- membership change on either side. (a.id < b.id from the join, so LEAST/GREATEST
    -- on the log row normalizes stored order — manual rows may store either order.)
    AND NOT EXISTS (
      SELECT 1
      FROM clustering_judge_log l
      WHERE l.dry_run = false
        AND l.story_id_a IS NOT NULL AND l.story_id_b IS NOT NULL
        AND LEAST(l.story_id_a, l.story_id_b) = a.id
        AND GREATEST(l.story_id_a, l.story_id_b) = b.id
        -- Only SETTLED verdicts create memory. A 'merge' logged with merged=false was
        -- decided but NOT executed (run cap of 10 hit, or merge_stories returned ok:false)
        -- — the prompt defers those to the next run on purpose. Suppressing them would
        -- turn "deferred" into "silently dropped", since a failed merge leaves
        -- article_story.matched_at untouched and so nothing would ever reopen the pair.
        -- keep / uncertain / unmerge always settle; an executed merge tombstones the loser,
        -- which the merged_into_story_id filter already excludes.
        AND (l.verdict <> 'merge' OR l.merged = true)
        -- >= not >: on timestamp equality (same-transaction writes) the verdict must
        -- SUPPRESS — a stuck pair reopens on the next real article; a resurfaced pair
        -- could re-merge a human unmerge. Prefer suppression on ambiguity.
        AND l.created_at >= COALESCE(
          (SELECT max(m.matched_at) FROM article_story m
           WHERE m.story_id = a.id OR m.story_id = b.id),
          '-infinity'::timestamptz
        )
    )
  ORDER BY
    -- prioritise pairs that also share concrete signal, then by raw similarity
    (CASE WHEN EXISTS (
        SELECT 1 FROM unnest(a.top_entities) e
        WHERE e = ANY(b.top_entities) AND e <> ALL(sw.words)
      ) OR (a.topic_slugs && b.topic_slugs) THEN 0 ELSE 1 END),
    centroid_sim DESC
  LIMIT p_max_pairs;
$$;

COMMENT ON FUNCTION public.get_clustering_judge_candidates(DOUBLE PRECISION, INT, INT) IS
  'ADO-533/539: last-N-day active story pairs with centroid cosine >= p_min_sim, capped. Recall-first (entity/slug are context). Verdict memory (539): pairs with a live verdict newer than the latest article_story.matched_at on either side are skipped until membership changes. No embedding egress. service_role only.';

NOTIFY pgrst, 'reload schema';
