-- ADO-597: why does PROD store NO articles.content (0 rows non-null; TEST stores it)? READ-ONLY.
-- Run on PROD in the Supabase SQL Editor; copy the one result cell back.
-- Shows: every upsert_article_and_enqueue_jobs version on PROD (definition), every trigger on
-- articles (a BEFORE trigger could null content), and the content column's privileges/default.
SELECT jsonb_pretty(jsonb_build_object(
  'upsert_functions', (
    SELECT jsonb_agg(jsonb_build_object('signature', p.oid::regprocedure::text, 'definition', pg_get_functiondef(p.oid)))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'upsert_article_and_enqueue_jobs'
  ),
  'article_triggers', (
    SELECT jsonb_agg(jsonb_build_object('trigger', t.tgname, 'enabled', t.tgenabled, 'function', t.tgfoid::regprocedure::text,
                                        'function_body', pg_get_functiondef(t.tgfoid)))
    FROM pg_trigger t
    WHERE t.tgrelid = 'public.articles'::regclass AND NOT t.tgisinternal
  ),
  'content_column', (
    SELECT jsonb_build_object('type', c.data_type, 'default', c.column_default, 'generated', c.is_generated)
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'articles' AND c.column_name = 'content'
  ),
  -- pg_cron may not be installed; query_to_xml runs the query only when cron.job exists
  'scheduled_jobs', CASE
    WHEN to_regclass('cron.job') IS NULL THEN to_jsonb('pg_cron not installed'::text)
    ELSE to_jsonb(query_to_xml('SELECT jobname, schedule, left(command, 400) AS command FROM cron.job', false, false, '')::text)
  END
))::text AS result;
