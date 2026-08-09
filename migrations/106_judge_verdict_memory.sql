-- ============================================================================
-- Migration 106: Judge verdict memory (ADO-539)
-- ============================================================================
-- Problem: the candidate RPC has no verdict memory — the Gaza pair 13257/13295 was
-- judged uncertain 6x, Blanche pairs 6x/4x (2026-08-05 analysis on the ADO-539 card).
-- Fix: skip pairs whose latest LIVE, SETTLED verdict (dry_run=false; includes
-- source='manual', includes verdict='unmerge' — a human unmerge is an authoritative
-- "keep separate") has an evidence snapshot NEWER than the latest
-- article_story.matched_at on either side.
-- A new article attaching to either story reopens the pair.
-- "Settled" excludes merge verdicts that were decided but never executed (merged=false,
-- e.g. the run cap of 10) — those are deferred to the next run by design and must NOT
-- be suppressed. See the predicate comment below.
-- Rollback: re-run migration 100 PART D (restores the previous function body; DROP the
-- membership_seen_at-returning version first, then re-grant — 100 PART D includes grants).
-- Idempotent: DROP IF EXISTS + CREATE + explicit re-grant DO-block + IF NOT EXISTS.

-- Evidence snapshot (Codex review rounds 2+3, PR #113): the predicate must compare against
-- the membership state the verdict actually SAW, not the verdict INSERT time. created_at is
-- stamped minutes later, after model deliberation — an article attaching in that window
-- would get matched_at < created_at and look "covered" by a verdict that never saw it,
-- wrongly suppressing the pair until yet another article attaches.
-- Round 3: evidence_as_of is a DB-ISSUED WATERMARK, not an agent clock reading. The RPC
-- returns membership_seen_at = GREATEST of both stories' max(matched_at) as of the candidate
-- fetch, and the agent echoes it back verbatim into this column. Comparing matched_at to
-- matched_at keeps the comparison inside one clock family (the RSS runners that stamp
-- matched_at) — an agent sandbox clock running a few seconds fast could otherwise stamp an
-- "evidence time" ahead of a real subsequent attach and recreate the unseen-article
-- suppression. Residual risk is only inter-runner NTP skew, which predates this feature.
-- Nullable on purpose: manual/legacy rows fall back to created_at via COALESCE below
-- (a human verdict is made looking at current membership, so insert time ≈ read time).
ALTER TABLE public.clustering_judge_log
  ADD COLUMN IF NOT EXISTS evidence_as_of timestamptz;

COMMENT ON COLUMN public.clustering_judge_log.evidence_as_of IS
  'ADO-539: membership watermark the verdict was judged against — the candidate RPC''s membership_seen_at (DB-computed GREATEST of both stories'' max article_story.matched_at), echoed back by the agent. Verdict memory compares LEAST(COALESCE(evidence_as_of, created_at), created_at) against current matched_at; an article attaching after the watermark reopens the pair.';

-- Output row type changes below (adds membership_seen_at), so CREATE OR REPLACE is not
-- allowed — DROP first. ACLs die with the function; PART: re-grant explicitly below.
DROP FUNCTION IF EXISTS public.get_clustering_judge_candidates(DOUBLE PRECISION, INT, INT);

-- Partial index so the NOT EXISTS probe is cheap. LEAST/GREATEST are immutable on
-- bigint. Heartbeat rows (both ids NULL) are excluded by the predicate.
CREATE INDEX IF NOT EXISTS idx_judge_log_pair_live
  ON public.clustering_judge_log (
    LEAST(story_id_a, story_id_b),
    GREATEST(story_id_a, story_id_b),
    created_at DESC
  )
  WHERE dry_run = false AND story_id_a IS NOT NULL AND story_id_b IS NOT NULL;

CREATE FUNCTION public.get_clustering_judge_candidates(
  p_min_sim   DOUBLE PRECISION DEFAULT 0.83,
  p_days      INT DEFAULT 7,
  p_max_pairs INT DEFAULT 30
)
RETURNS TABLE (
  story_id_a         BIGINT,
  story_id_b         BIGINT,
  headline_a         TEXT,
  headline_b         TEXT,
  centroid_sim       DOUBLE PRECISION,
  shared_entities    TEXT[],
  shared_slugs       TEXT[],
  -- DB-issued membership watermark: the newest matched_at across BOTH stories as of this
  -- fetch. The agent echoes it into clustering_judge_log.evidence_as_of untouched (never
  -- generates its own timestamp). '-infinity' when neither story has members — echoing
  -- that back preserves the pre-fix suppression semantics for empty stories.
  membership_seen_at TIMESTAMPTZ
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
    -- last_matched is computed ONCE PER STORY here, not per pair. The pair join below is
    -- O(n^2), so a correlated `max(matched_at)` inside it would run n^2/2 aggregate probes
    -- on article_story every Judge run; hoisting it makes that n.
    SELECT s.id, s.primary_headline, s.centroid_embedding_v1,
           COALESCE(s.top_entities, ARRAY[]::text[]) AS top_entities,
           COALESCE(s.topic_slugs, ARRAY[]::text[])  AS topic_slugs,
           COALESCE(lm.last_matched, '-infinity'::timestamptz) AS last_matched
    FROM stories s
    LEFT JOIN LATERAL (
      SELECT max(m.matched_at) AS last_matched
      FROM article_story m
      WHERE m.story_id = s.id
    ) lm ON TRUE
    WHERE s.status = 'active'
      AND s.merged_into_story_id IS NULL
      AND s.centroid_embedding_v1 IS NOT NULL
      AND s.first_seen_at >= NOW() - (p_days || ' days')::interval
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
    ) AS shared_slugs,
    GREATEST(a.last_matched, b.last_matched) AS membership_seen_at
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
        -- GREATEST of the two per-story maxima == max over both stories' membership.
        -- COALESCE: evidence_as_of is the membership watermark the verdict was judged
        -- against — the candidate RPC's membership_seen_at, echoed back by the agent;
        -- created_at is the verdict INSERT, minutes of deliberation later. Comparing
        -- against the watermark means an article attaching mid-deliberation
        -- (matched_at newer than the watermark) REOPENS the pair instead of being
        -- silently covered by a verdict that never saw it. matched_at-to-matched_at
        -- stays inside one clock family, so agent-clock skew cannot fake coverage.
        -- NULL (manual/legacy/degraded rows) → created_at.
        -- LEAST clamp: the value still transits an LLM echo — honest values are always
        -- <= created_at, so clamping is free, and it bounds any mangled/hallucinated
        -- future timestamp at the pre-fix created_at behavior instead of letting a bad
        -- echo pin the pair shut indefinitely.
        AND LEAST(COALESCE(l.evidence_as_of, l.created_at), l.created_at)
              >= GREATEST(a.last_matched, b.last_matched)
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
  'ADO-533/539: last-N-day active story pairs with centroid cosine >= p_min_sim, capped, plus membership_seen_at (DB watermark the agent echoes into evidence_as_of). Recall-first (entity/slug are context). Verdict memory (539): a pair is skipped while a live SETTLED verdict (dry_run=false, and either not a merge or an executed one) has an evidence watermark (LEAST(COALESCE(evidence_as_of, created_at), created_at)) newer than the latest article_story.matched_at on either side; a new article attaching reopens it. Merge verdicts logged with merged=false (run cap hit / merge_stories ok:false) are deliberately NOT memory - they are deferred for retry. No embedding egress. service_role only.';

-- Re-lock the freshly created function (ACLs were dropped with the old one; CREATE grants
-- EXECUTE to PUBLIC by default — migration 095/096 pattern, by name+pronargs).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'get_clustering_judge_candidates' AND p.pronargs = 3
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
