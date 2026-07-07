-- Migration: 100_clustering_judge.sql
-- Purpose: Infrastructure for the Clustering Judge agent (ADO-533).
--   A) clustering_judge_log — one row per Judge verdict (audit + admin "Judge" tab + gold-set training data)
--   B) stories.merged_into_story_id + status='merged_into' — tombstone/redirect for merged losers (never delete)
--   C) merge_stories(p_loser_id, p_survivor_id) — server-side merge machinery (repoint + recompute + tombstone)
--   D) get_clustering_judge_candidates(...) — last-7-day story-pair candidate generator (no embedding egress)
--
-- Applied to TEST first (Supabase SQL Editor / MCP), then PR to PROD.
--
-- REUSE NOTE (B): stories.merged_into_story_id and status='merged_into' were originally defined by the
-- retired TTRC-231 merge system in migrations 025 + 027, but those migrations were NEVER applied to TEST
-- (column + story_merge_actions table are absent as of 2026-07-05). This migration re-declares that exact
-- DDL idempotently so TEST/PROD converge without drift. story_merge_actions is intentionally NOT recreated:
-- clustering_judge_log is the audit surface for the new system.
--
-- SECURITY NOTE (C/D): merge_stories and get_clustering_judge_candidates are SECURITY DEFINER with a locked
-- search_path; EXECUTE is revoked from PUBLIC/anon/authenticated and granted only to service_role (the Judge
-- agent's key), following the migration 095/096 hardening pattern so the security advisor stays clean.
-- clustering_judge_log has RLS enabled and NO anon grant — the admin "Judge" tab reads it via a
-- service_role edge function (admin-judge-log), mirroring the Skips tab, so anon exposure is unnecessary
-- (avoids the migration-046 "new table invisible to frontend" gotcha by not depending on anon at all).

-- ============================================================================
-- PART A: clustering_judge_log
-- ============================================================================

CREATE TABLE IF NOT EXISTS clustering_judge_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL CHECK (source IN ('inline', 'judge-agent')),
  story_id_a BIGINT,                    -- nullable: heartbeat rows
  story_id_b BIGINT,                    -- nullable: heartbeat + audit rows
  headline_a TEXT,                      -- snapshot (survives later merges/edits)
  headline_b TEXT,                      -- snapshot
  verdict TEXT CHECK (verdict IN ('merge', 'keep', 'uncertain')),  -- nullable: heartbeat rows
  confidence NUMERIC CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  rationale TEXT,
  centroid_sim NUMERIC,                 -- decision-time similarity (context/debugging)
  merged BOOLEAN NOT NULL DEFAULT FALSE,-- whether a merge was actually executed (forced false in dry-run)
  dry_run BOOLEAN NOT NULL DEFAULT FALSE,
  run_id TEXT
);

COMMENT ON TABLE clustering_judge_log IS
  'ADO-533: one row per Clustering Judge verdict (merge/keep/uncertain) plus run-level heartbeat rows. Audit trail for the admin Judge tab and gold-set training data. Losers are tombstoned not deleted, so headline snapshots keep bad merges reviewable/reversible.';
COMMENT ON COLUMN clustering_judge_log.story_id_a IS 'NULL on run-level heartbeat rows (0 candidates found)';
COMMENT ON COLUMN clustering_judge_log.merged IS 'TRUE only when merge_stories actually ran; always FALSE in dry-run mode';
COMMENT ON COLUMN clustering_judge_log.dry_run IS 'TRUE when the run was dry-run (verdicts logged, no merges executed)';

-- Most-recent-first for the admin tab / monitoring
CREATE INDEX IF NOT EXISTS idx_clustering_judge_log_created_at
  ON clustering_judge_log (created_at DESC);

-- Filter by verdict + source (admin tab facets)
CREATE INDEX IF NOT EXISTS idx_clustering_judge_log_verdict_source
  ON clustering_judge_log (verdict, source, created_at DESC);

-- Per-run drill-down
CREATE INDEX IF NOT EXISTS idx_clustering_judge_log_run_id
  ON clustering_judge_log (run_id, created_at DESC);

-- One heartbeat row per run (mirrors stories_enrichment_log 099 hardening).
CREATE UNIQUE INDEX IF NOT EXISTS idx_clustering_judge_log_run_heartbeat_unique
  ON clustering_judge_log (run_id)
  WHERE story_id_a IS NULL AND story_id_b IS NULL;

-- RLS on: service_role bypasses it (agent + edge function writes/reads work); anon/authenticated get nothing.
ALTER TABLE clustering_judge_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- PART B: stories tombstone/redirect (reuse of 025/027 DDL, idempotent)
-- ============================================================================

-- merged_into_story_id: points at the survivor when this story was merged away.
ALTER TABLE stories
  ADD COLUMN IF NOT EXISTS merged_into_story_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_merged_into_story'
      AND conrelid = 'stories'::regclass
  ) THEN
    ALTER TABLE stories
      ADD CONSTRAINT fk_merged_into_story
        FOREIGN KEY (merged_into_story_id)
        REFERENCES stories(id)
        ON DELETE SET NULL
        DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stories_merged_into
  ON stories (merged_into_story_id)
  WHERE merged_into_story_id IS NOT NULL;

COMMENT ON COLUMN stories.merged_into_story_id IS
  'ADO-533 (orig TTRC-231): survivor story id if this story was merged away; loser keeps status=merged_into (tombstone/redirect, never deleted).';

-- Extend the status CHECK to allow 'merged_into' (current valid set on TEST: active/closed/archived).
ALTER TABLE stories
  DROP CONSTRAINT IF EXISTS stories_status_check;

ALTER TABLE stories
  ADD CONSTRAINT stories_status_check
    CHECK (status IN ('active', 'closed', 'archived', 'merged_into'));

COMMENT ON CONSTRAINT stories_status_check ON stories IS
  'Valid status values: active, closed, archived, merged_into';

-- ============================================================================
-- PART C: merge_stories(p_loser_id, p_survivor_id)
-- ============================================================================
-- Atomic (function body runs in one transaction). Idempotent-safe: a second call with the same
-- already-merged loser is a no-op that returns skipped=true. Never deletes the loser story row.
--
-- Steps:
--   1. Validate (distinct ids, both exist, survivor is a live target, loser not already merged).
--   2. Repoint article_story loser -> survivor (skip any article already on survivor, then drop leftovers).
--   3. Recompute survivor centroid_embedding_v1 = AVG(member article embedding_v1)  [server-side; no egress].
--   4. Rebuild survivor entity_counter (jsonb {id:count}) + top_entities (top-5) from member articles.
--   5. Recount source_count; widen first_seen_at (min) / last_updated_at (max) across the union.
--   6. Tombstone loser: status='merged_into', merged_into_story_id=survivor.

CREATE OR REPLACE FUNCTION public.merge_stories(
  p_loser_id BIGINT,
  p_survivor_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
  -- Scalar variables (NOT stories%ROWTYPE) so the Supabase SQL Editor's "Enable RLS" helper can't
  -- mis-detect a ROWTYPE variable as a new table and inject ALTER TABLE ... ENABLE RLS into the body.
  v_loser_status      TEXT;
  v_loser_merged      BIGINT;
  v_loser_first_seen  TIMESTAMPTZ;
  v_loser_last_upd    TIMESTAMPTZ;
  v_surv_status       TEXT;
  v_surv_merged       BIGINT;
  v_moved   INT := 0;
  v_new_count INT := 0;
BEGIN
  -- 1. Validate
  IF p_loser_id IS NULL OR p_survivor_id IS NULL OR p_loser_id = p_survivor_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_ids');
  END IF;

  SELECT status, merged_into_story_id, first_seen_at, last_updated_at
    INTO v_loser_status, v_loser_merged, v_loser_first_seen, v_loser_last_upd
    FROM stories WHERE id = p_loser_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'loser_not_found');
  END IF;

  SELECT status, merged_into_story_id
    INTO v_surv_status, v_surv_merged
    FROM stories WHERE id = p_survivor_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'survivor_not_found');
  END IF;

  -- Already merged (idempotent no-op) — do not double-merge or reopen a tombstone.
  IF v_loser_status = 'merged_into' OR v_loser_merged IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'loser_already_merged',
                              'survivor_id', v_loser_merged);
  END IF;
  IF v_surv_status = 'merged_into' OR v_surv_merged IS NOT NULL THEN
    -- Refuse to merge into a tombstone; caller should target the ultimate survivor.
    RETURN jsonb_build_object('ok', false, 'reason', 'survivor_is_merged',
                              'survivor_points_to', v_surv_merged);
  END IF;

  -- 2. Repoint article_story loser -> survivor.
  -- article_story is UNIQUE(article_id) (ux_article_story_unique), so an article lives on exactly one
  -- story and there is normally no conflict; the NOT EXISTS guard + cleanup delete keep it safe even if
  -- that invariant is ever violated.
  UPDATE article_story a
  SET story_id = p_survivor_id
  WHERE a.story_id = p_loser_id
    AND NOT EXISTS (
      SELECT 1 FROM article_story b
      WHERE b.story_id = p_survivor_id AND b.article_id = a.article_id
    );
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  -- Drop any loser links that couldn't move (article already on survivor).
  DELETE FROM article_story WHERE story_id = p_loser_id;

  -- 3 + 4. Recompute survivor centroid + entity_counter + top_entities from its (now-merged) members.
  WITH sa AS (
    SELECT a.embedding_v1
    FROM article_story asg
    JOIN articles a ON a.id = asg.article_id
    WHERE asg.story_id = p_survivor_id AND a.embedding_v1 IS NOT NULL
  ),
  ctr AS (
    SELECT AVG(embedding_v1) AS exact_centroid FROM sa
  ),
  ent_counts AS (
    SELECT (ent->>'id') AS entity_id, COUNT(*)::int AS cnt
    FROM article_story asg
    JOIN articles a ON a.id = asg.article_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.entities, '[]'::jsonb)) ent
    WHERE asg.story_id = p_survivor_id
      AND (ent->>'id') IS NOT NULL AND (ent->>'id') <> ''
    GROUP BY (ent->>'id')
  ),
  counter AS (
    SELECT
      COALESCE(jsonb_object_agg(entity_id, cnt), '{}'::jsonb) AS counter_json,
      COALESCE(ARRAY(
        SELECT entity_id FROM ent_counts
        ORDER BY cnt DESC, entity_id ASC
        LIMIT 5
      ), ARRAY[]::text[]) AS top5
    FROM ent_counts
  )
  UPDATE stories s
  SET centroid_embedding_v1 = COALESCE((SELECT exact_centroid FROM ctr), s.centroid_embedding_v1),
      entity_counter        = (SELECT counter_json FROM counter),
      top_entities          = (SELECT top5 FROM counter),
      first_seen_at         = LEAST(s.first_seen_at, v_loser_first_seen),
      last_updated_at       = GREATEST(s.last_updated_at, v_loser_last_upd)
  WHERE s.id = p_survivor_id;

  -- 5. Recount source_count from actual member rows.
  SELECT COUNT(*)::int INTO v_new_count FROM article_story WHERE story_id = p_survivor_id;
  UPDATE stories SET source_count = v_new_count WHERE id = p_survivor_id;

  -- 6. Tombstone the loser (redirect, never delete).
  UPDATE stories
  SET status = 'merged_into',
      merged_into_story_id = p_survivor_id
  WHERE id = p_loser_id;

  RETURN jsonb_build_object(
    'ok', true,
    'skipped', false,
    'loser_id', p_loser_id,
    'survivor_id', p_survivor_id,
    'articles_moved', v_moved,
    'survivor_source_count', v_new_count
  );
END;
$$;

COMMENT ON FUNCTION public.merge_stories(BIGINT, BIGINT) IS
  'ADO-533: merge loser story into survivor. Repoints article_story, recomputes survivor centroid/entity_counter/top_entities/source_count server-side, widens time span, tombstones loser (status=merged_into + merged_into_story_id). Atomic, idempotent, never deletes. service_role only.';

-- ============================================================================
-- PART D: get_clustering_judge_candidates(p_min_sim, p_days, p_max_pairs)
-- ============================================================================
-- Returns candidate story pairs from the last N days for the Judge to adjudicate. Recall-first:
-- centroid cosine >= p_min_sim within the recency window is the primary gate; shared non-stopword
-- entities / topic slugs are returned as CONTEXT (and used for tie-break ordering) but are NOT a hard
-- filter. This is a deliberate deviation from plan.md Part 2's "AND >=1 shared non-stopword entity":
-- the flagship July 4th fragmentation cluster (gold set gs-199..208) shares only US-TRUMP (an
-- ENTITY_STOPWORD) / LOC-DC and has NO overlapping topic slugs, so an AND-entity gate would exclude the
-- exact case this feature exists to catch. The 7-day recency window already removes the 100+ day
-- "generic-phrasing collision" false-merge noise (plan Part 1), so centroid + recency + the LLM judge
-- (default DENY) carry precision; the cap keeps volume/cost bounded. Threshold default 0.83 (raw cosine):
-- 9 of the 10 July 4th pairs are >= 0.83; the one below (gs-204, 12145<->12148 at 0.8227) does not need to
-- surface directly because both its stories pair above 0.83 with the anchor story 12118, so all 5 fragments
-- still collapse into one survivor via merge-chaining. (Lower to ~0.82 in session 2 if live recall wants the
-- direct pair too.) No embeddings leave the DB (egress rule #11).

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
  'ADO-533: last-N-day active story pairs with centroid cosine >= p_min_sim, capped, for the Judge agent. Recall-first (entity/slug are context, not a hard gate — see migration comment). No embedding egress. service_role only.';

-- ============================================================================
-- PART E: Security lockdown (migration 095/096 pattern)
-- ============================================================================
-- Both RPCs are SECURITY DEFINER: revoke default PUBLIC/anon/authenticated EXECUTE, grant service_role.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND (
      (p.proname = 'merge_stories'                  AND p.pronargs = 2) OR
      (p.proname = 'get_clustering_judge_candidates' AND p.pronargs = 3)
    )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- ============================================================================
-- VERIFICATION (run separately AFTER applying; read-only)
-- ============================================================================
-- 1) Table + column + status exist:
--    SELECT to_regclass('public.clustering_judge_log');
--    SELECT column_name FROM information_schema.columns
--      WHERE table_name='stories' AND column_name='merged_into_story_id';
--    SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='stories_status_check';
-- 2) RPC grants locked down (expect anon=f, authenticated=f, service_role=t):
--    SELECT p.proname,
--           has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
--           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
--           has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role
--    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='public' AND p.proname IN ('merge_stories','get_clustering_judge_candidates');
-- 3) Candidate generator smoke test (should return <= 30 rows, no error):
--    SELECT story_id_a, story_id_b, round(centroid_sim::numeric,3), shared_entities, shared_slugs
--    FROM get_clustering_judge_candidates();
