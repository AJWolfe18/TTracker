-- ADO-600 AC 1: what does PROD's ingest RPC write, and which article columns exist? READ-ONLY.
-- Run on PROD in the Supabase SQL Editor ("Run without RLS" if asked); copy the one result cell back.
-- Expected: one row, column "result", a JSON object starting with "columns".
SELECT jsonb_pretty(jsonb_build_object(
  'columns', (
    SELECT jsonb_object_agg(c.column_name, jsonb_build_object('type', c.data_type, 'nullable', c.is_nullable, 'default', c.column_default))
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'articles'
      AND c.column_name IN ('feed_id', 'opinion_flag', 'metadata', 'content', 'content_type', 'excerpt')
  ),
  'feed_id_fk', (
    SELECT jsonb_agg(pg_get_constraintdef(oid))
    FROM pg_constraint
    WHERE conrelid = 'public.articles'::regclass AND contype = 'f' AND pg_get_constraintdef(oid) ILIKE '%feed_id%'
  ),
  'function_writes', (
    SELECT jsonb_agg(jsonb_build_object(
      'signature', p.oid::regprocedure::text,
      'stores_content', position('left(p_content, 5000)' IN p.prosrc) > 0,
      'writes_feed_id', p.prosrc ~ 'feed_id\s*,' AND p.prosrc ~ 'p_feed_id::bigint',
      'writes_opinion_flag', p.prosrc ~ 'opinion_flag',
      'writes_metadata', p.prosrc ~ 'metadata\s*,',
      'grants', (SELECT jsonb_agg(r.rolname) FROM pg_roles r WHERE has_function_privilege(r.oid, p.oid, 'EXECUTE') AND r.rolname IN ('anon', 'authenticated', 'service_role'))
    ))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_article_and_enqueue_jobs'
  ),
  'last_30_days', (
    -- to_jsonb(a) so the query still runs if a column is missing on PROD
    SELECT jsonb_build_object(
      'articles', count(*),
      'feed_id_set', count(*) FILTER (WHERE to_jsonb(a) ->> 'feed_id' IS NOT NULL),
      'opinion_true', count(*) FILTER (WHERE to_jsonb(a) ->> 'opinion_flag' = 'true'),
      'metadata_set', count(*) FILTER (WHERE coalesce(to_jsonb(a) -> 'metadata', '{}'::jsonb) NOT IN ('{}'::jsonb, 'null'::jsonb)),
      'content_set', count(*) FILTER (WHERE to_jsonb(a) ->> 'content' IS NOT NULL)
    )
    FROM public.articles a
    WHERE a.created_at > now() - interval '30 days'
  )
))::text AS result;
