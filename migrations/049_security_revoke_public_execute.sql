-- TTRC-326 Follow-up: Security hardening for update_story_latest_article_published_at
-- AI code review flagged: SECURITY DEFINER functions get PUBLIC execute by default in Postgres
-- Must explicitly REVOKE to ensure only service_role can call it

-- Revoke default PUBLIC execute permission
REVOKE EXECUTE ON FUNCTION public.update_story_latest_article_published_at(BIGINT, TIMESTAMPTZ) FROM PUBLIC;

-- Confirm only service_role has execute (already granted in 048, but explicit for clarity)
-- No-op if already granted, but documents intent
GRANT EXECUTE ON FUNCTION public.update_story_latest_article_published_at(BIGINT, TIMESTAMPTZ)
TO service_role;

COMMENT ON FUNCTION public.update_story_latest_article_published_at IS
  'Atomically updates latest_article_published_at using GREATEST. Returns updated value. SECURITY DEFINER with fixed search_path. Execute restricted to service_role only.';
