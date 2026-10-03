-- ADO-597: thin-source diagnostics (READ-ONLY). Run on PROD in the Supabase SQL Editor.
-- One SELECT, one row, one jsonb cell (the editor shows only the last result).
--
-- Egress rule: aggregates only. content and excerpt are measured with length() and never selected.
--
-- Definitions:
--   excerpt = left(content, 500) at ingest (upsert_article_and_enqueue_jobs), and the August 19, 2026
--   DB-size cleanup nulled content on old closed-story articles but KEPT excerpt. So
--   length(excerpt) < 500 means the article's whole stored text was under 500 characters,
--   at any date, even where content is now null. That is the "thin" test used throughout.
--   content_len = 5000 is the ingest cap (fetch_feed.js default; PROD has no feed_compliance_rules).
--   A story is thin when every article attached to it is thin.

SELECT jsonb_pretty(jsonb_build_object(

  -- 1) Per source, articles published in the last 30 days
  'by_source_30d', (
    SELECT jsonb_agg(x ORDER BY (x->>'articles')::int DESC)
    FROM (
      SELECT jsonb_build_object(
        'source', a.source_name,
        'articles', count(*),
        'pct_thin', round(100.0 * avg((coalesce(length(a.excerpt), 0) < 500)::int), 1),
        'median_excerpt_len', percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(length(a.excerpt), 0))::int,
        'median_content_len', percentile_cont(0.5) WITHIN GROUP (ORDER BY length(a.content))::int,
        'max_content_len', max(length(a.content)),
        'pct_at_5k_cap', round(100.0 * avg((coalesce(length(a.content), 0) >= 5000)::int), 1),
        'content_null', count(*) FILTER (WHERE a.content IS NULL)
      ) AS x
      FROM articles a
      WHERE a.published_at >= now() - interval '30 days'
      GROUP BY a.source_name
    ) s
  ),

  -- 2) Trend: % thin by month (12 months) for the three blurb feeds and everything else
  'pct_thin_by_month', (
    SELECT jsonb_agg(x ORDER BY x->>'month', x->>'source')
    FROM (
      SELECT jsonb_build_object(
        'month', to_char(date_trunc('month', a.published_at), 'YYYY-MM'),
        'source', CASE WHEN a.source_name IN ('NYT Politics', 'PBS NewsHour Politics', 'WaPo Politics')
                       THEN a.source_name ELSE '(all other feeds)' END,
        'articles', count(*),
        'pct_thin', round(100.0 * avg((coalesce(length(a.excerpt), 0) < 500)::int), 1),
        'median_excerpt_len', percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(length(a.excerpt), 0))::int
      ) AS x
      FROM articles a
      WHERE a.published_at >= date_trunc('month', now()) - interval '11 months'
      GROUP BY date_trunc('month', a.published_at),
               CASE WHEN a.source_name IN ('NYT Politics', 'PBS NewsHour Politics', 'WaPo Politics')
                    THEN a.source_name ELSE '(all other feeds)' END
    ) s
  ),

  -- 3) Share of stories that are thin-source, by month the story was first seen (12 months)
  'thin_stories_by_month', (
    SELECT jsonb_agg(x ORDER BY x->>'month')
    FROM (
      SELECT jsonb_build_object(
        'month', to_char(date_trunc('month', st.first_seen_at), 'YYYY-MM'),
        'stories', count(*),
        'thin', count(*) FILTER (WHERE st.max_len < 500),
        'pct_thin', round(100.0 * avg((st.max_len < 500)::int), 1),
        'published', count(*) FILTER (WHERE st.published),
        'published_thin', count(*) FILTER (WHERE st.published AND st.max_len < 500),
        'single_article', count(*) FILTER (WHERE st.n_articles = 1),
        'single_article_thin', count(*) FILTER (WHERE st.n_articles = 1 AND st.max_len < 500)
      ) AS x
      FROM (
        SELECT s.id, s.first_seen_at,
               (s.summary_neutral IS NOT NULL) AS published,
               count(ast.article_id) AS n_articles,
               max(coalesce(length(a.excerpt), 0)) AS max_len
        FROM stories s
        JOIN article_story ast ON ast.story_id = s.id
        JOIN articles a ON a.id = ast.article_id
        WHERE s.first_seen_at >= date_trunc('month', now()) - interval '11 months'
        GROUP BY s.id, s.first_seen_at, s.summary_neutral IS NOT NULL
      ) st
      GROUP BY date_trunc('month', st.first_seen_at)
    ) m
  ),

  -- 4) Stories agent log, last 90 days (log retention): review-flag rate by week
  'agent_log_by_week', (
    SELECT jsonb_agg(x ORDER BY x->>'week')
    FROM (
      SELECT jsonb_build_object(
        'week', to_char(date_trunc('week', l.created_at), 'YYYY-MM-DD'),
        'completed', count(*) FILTER (WHERE l.status = 'completed'),
        'needs_manual_review', count(*) FILTER (WHERE l.needs_manual_review),
        'notes_thin', count(*) FILTER (WHERE l.notes ILIKE '%thin%')
      ) AS x
      FROM stories_enrichment_log l
      WHERE l.story_id IS NOT NULL
      GROUP BY date_trunc('week', l.created_at)
    ) w
  ),

  -- 5) Active feeds (context for the per-source numbers)
  'feeds', (
    SELECT jsonb_agg(jsonb_build_object('id', f.id, 'source', f.source_name, 'url', f.feed_url, 'active', f.is_active) ORDER BY f.id)
    FROM feed_registry f
  )
))::text AS result;
