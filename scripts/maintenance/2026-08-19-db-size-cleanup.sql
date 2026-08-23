-- ============================================================================
-- DB SIZE CLEANUP — run by hand in the Supabase SQL Editor (PROD and/or TEST)
-- Written 2026-08-19. Safe on both environments; nothing here is schema DDL.
--
-- WHY THIS IS SAFE (verified against code on test branch @ 81ddf65):
--   * Clustering only ever compares against stories in lifecycle_state
--     ('emerging','growing','stable','stale') — see find_similar_stories
--     (migration 101) and candidate-generation.js. Embeddings/centroids on
--     closed/archived stories are never read by anything.
--   * articles.content is read ONLY at ingest + enrichment time
--     (enrich-stories-inline.js), and only for stories still enrichable.
--     The public site serves articles.excerpt, never content
--     (stories-detail edge function). Enrichment falls back to excerpt
--     if content is null, so even a rare story reopening degrades softly.
--   * Log tables (pipeline_skips, enrichment/judge logs, job_queue) are
--     observability only; retention windows below keep recent history.
--
-- RUN ORDER: Part 1 (look), Part 2 (delete/null), Part 3 (VACUUM FULL).
-- Part 3 is what actually shrinks the reported database size — plain
-- deletes/updates leave the space inside the files. VACUUM FULL takes an
-- exclusive lock per table (seconds to ~a minute each at this scale) and
-- temporarily needs disk equal to the table being rewritten — run tables
-- one at a time, biggest last, during a quiet hour.
-- ============================================================================


-- ============================================================================
-- PART 1 — DIAGNOSTICS (read-only; run first, sanity-check the counts)
-- ============================================================================

-- 1a. Where the bytes are (table + indexes + TOAST)
SELECT c.relname AS table_name,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid))       AS heap,
       pg_size_pretty(pg_indexes_size(c.oid))        AS indexes,
       pg_size_pretty(COALESCE(pg_total_relation_size(c.reltoastrelid), 0)) AS toast,
       s.n_live_tup, s.n_dead_tup
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY pg_total_relation_size(c.oid) DESC;

-- 1b. How much Part 2 will reclaim (estimates)
SELECT
  (SELECT count(*) FROM stories
    WHERE centroid_embedding_v1 IS NOT NULL
      AND lifecycle_state NOT IN ('emerging','growing','stable','stale')
      AND last_updated_at < now() - interval '30 days')            AS dead_story_centroids,
  (SELECT count(*) FROM articles a
    WHERE (a.embedding_v1 IS NOT NULL OR a.content IS NOT NULL)
      AND a.published_at < now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM article_story ast
        JOIN stories s ON s.id = ast.story_id
        WHERE ast.article_id = a.id
          AND s.lifecycle_state IN ('emerging','growing','stable','stale')))
                                                                    AS strippable_articles,
  (SELECT count(*) FROM pipeline_skips
    WHERE created_at < now() - interval '60 days')                  AS old_pipeline_skips,
  (SELECT count(*) FROM job_queue
    WHERE created_at < now() - interval '30 days')                  AS old_job_queue_rows;


-- ============================================================================
-- PART 2 — RECLAIM (each statement independent; run top to bottom)
-- ============================================================================

-- 2a. Null centroids on stories clustering can never match again
--     (~6 KB/row; on TEST this is most of the 14K stories)
UPDATE stories
SET centroid_embedding_v1 = NULL
WHERE centroid_embedding_v1 IS NOT NULL
  AND lifecycle_state NOT IN ('emerging','growing','stable','stale')
  AND last_updated_at < now() - interval '30 days';

-- 2b. Strip embedding + scraped content from articles whose every linked
--     story is closed (or that link to no story at all), older than 30 days.
--     excerpt is kept — that's what the site serves.
--     (~11 KB/row combined; the single biggest win)
UPDATE articles a
SET embedding_v1 = NULL,
    content = NULL
WHERE (a.embedding_v1 IS NOT NULL OR a.content IS NOT NULL)
  AND a.published_at < now() - interval '30 days'
  AND NOT EXISTS (
    SELECT 1 FROM article_story ast
    JOIN stories s ON s.id = ast.story_id
    WHERE ast.article_id = a.id
      AND s.lifecycle_state IN ('emerging','growing','stable','stale'));

-- 2c. Log retention
DELETE FROM pipeline_skips        WHERE created_at < now() - interval '60 days';
DELETE FROM clustering_judge_log  WHERE created_at < now() - interval '60 days';
DELETE FROM stories_enrichment_log WHERE created_at < now() - interval '90 days';

-- 2d. job_queue is legacy (TTRC-266 moved the pipeline inline; rss-enqueue
--     is deprecated and only created orphaned jobs). Old rows are inert.
DELETE FROM job_queue WHERE created_at < now() - interval '30 days';

-- NOT touched on purpose:
--   * political_entries — v1 historical record, still referenced by
--     admin-supabase.html; small anyway.
--   * scotus_opinions — full opinion text feeds SCOTUS enrichment; small.
--   * run_stats, story_merge_audit, feed_registry — tiny.


-- ============================================================================
-- PART 3 — ACTUALLY SHRINK THE FILES (run one line at a time, quiet hour)
-- Each takes an exclusive lock on its table for the duration (seconds/table
-- at this scale) and rewrites indexes too. Needs temporary free disk equal
-- to the table's size. Re-run the Part 1a query afterward to see the drop.
-- ============================================================================

VACUUM FULL ANALYZE pipeline_skips;
VACUUM FULL ANALYZE clustering_judge_log;
VACUUM FULL ANALYZE stories_enrichment_log;
VACUUM FULL ANALYZE job_queue;
VACUUM FULL ANALYZE stories;
VACUUM FULL ANALYZE articles;
