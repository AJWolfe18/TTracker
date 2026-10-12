-- ============================================================================
-- Migration 132: post-pardon recheck rotation (ADO-524)
-- ============================================================================
-- WHY: the pardons agent checks for re-offending once, at first enrichment
-- (Step 3D). Nothing rechecks, so a recipient arrested months later still reads
-- 'quiet'. Prompt v1.4 adds Step 6.5: up to 10 rechecks per daily run, oldest
-- check first. Plan: docs/features/pardons-claude-agent/plan-524-post-pardon-recheck.md
--
-- WHAT:
--   A) pardons.post_pardon_checked_at TIMESTAMPTZ: when post-pardon news was last
--      checked. Backfilled from enriched_at (Step 3D ran at enrichment). NULL =
--      never checked (unenriched, or enriched by hand without a date).
--   B) pardons_due_for_recheck(p_limit 1-10, default 10): public, enriched
--      person pardons whose check is due. Pardoned within 180 days: due every 14
--      days; older: every 60 days. Never checked first, then oldest check, then
--      id. Excludes the Jan 6 group card (id 3, manually curated) and every group
--      card (a name search means nothing for a group). Returns the identity
--      columns the check needs plus pool_size (due rows before LIMIT).
--
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST first, then
-- PROD), BEFORE prompt v1.4 reaches that environment's branch (the prompt calls
-- the RPC). Idempotent: the backfill only fills NULLs, the RPC is CREATE OR
-- REPLACE. One transaction; if anything errors, run ROLLBACK; alone before
-- retrying. Last statement is a read-only check whose first column is
-- `checked_backfilled` (= enriched pardons; expect due_now > 0 on TEST).
-- ROLLBACK (manual): DROP FUNCTION public.pardons_due_for_recheck(integer);
--   ALTER TABLE public.pardons DROP COLUMN post_pardon_checked_at;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PART A: column + backfill
-- ----------------------------------------------------------------------------
ALTER TABLE public.pardons ADD COLUMN IF NOT EXISTS post_pardon_checked_at TIMESTAMPTZ;

COMMENT ON COLUMN public.pardons.post_pardon_checked_at IS
  'ADO-524: when the pardons agent last checked this recipient for post-pardon news (arrests, charges, investigations). Set at enrichment (Step 6) and by every recheck (Step 6.5), hit or not. Drives pardons_due_for_recheck().';

UPDATE public.pardons
   SET post_pardon_checked_at = enriched_at
 WHERE post_pardon_checked_at IS NULL
   AND enriched_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- PART B: pardons_due_for_recheck(p_limit)
-- ----------------------------------------------------------------------------
-- Every column is table-qualified (RETURNS TABLE names shadow columns, 42702).
CREATE OR REPLACE FUNCTION public.pardons_due_for_recheck(
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id                     BIGINT,
  recipient_name         TEXT,
  pardon_date            DATE,
  clemency_type          TEXT,
  conviction_district    TEXT,
  case_number            TEXT,
  offense_raw            TEXT,
  post_pardon_status     TEXT,
  post_pardon_notes      TEXT,
  post_pardon_checked_at TIMESTAMPTZ,
  pool_size              INTEGER
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p.id,
         p.recipient_name,
         p.pardon_date,
         p.clemency_type,
         p.conviction_district,
         p.case_number,
         p.offense_raw,
         p.post_pardon_status,
         p.post_pardon_notes,
         p.post_pardon_checked_at,
         COUNT(*) OVER ()::integer
    FROM public.pardons p
   WHERE p.is_public
     AND p.enriched_at IS NOT NULL
     AND p.recipient_type = 'person'
     AND p.id <> 3
     AND (p.post_pardon_checked_at IS NULL
          OR p.post_pardon_checked_at < NOW() - CASE
               WHEN p.pardon_date >= CURRENT_DATE - 180 THEN INTERVAL '14 days'
               ELSE INTERVAL '60 days'
             END)
   ORDER BY p.post_pardon_checked_at ASC NULLS FIRST, p.id
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 10);
$$;

COMMENT ON FUNCTION public.pardons_due_for_recheck(INTEGER) IS
  'ADO-524: post-pardon recheck rotation for the pardons agent (prompt v1.4 Step 6.5). Public, enriched person pardons (not id 3, no group cards) whose post_pardon_checked_at is NULL or older than 14 days (pardoned within 180 days) or 60 days (older). Never-checked first, then oldest check, then id; 1-10 rows; pool_size = due rows before LIMIT. service_role only.';

REVOKE ALL ON FUNCTION public.pardons_due_for_recheck(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pardons_due_for_recheck(INTEGER) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Read-only check. Expect: checked_backfilled = enriched pardons (every one has
-- enriched_at), unchecked_enriched = 0, due_now > 0 on a first apply (TEST
-- enrichments are months old), anon_can_execute = false.
SELECT
  (SELECT count(*) FROM public.pardons WHERE post_pardon_checked_at IS NOT NULL)::int AS checked_backfilled,
  (SELECT count(*) FROM public.pardons
    WHERE enriched_at IS NOT NULL AND post_pardon_checked_at IS NULL)::int          AS unchecked_enriched,
  (SELECT COALESCE(MAX(d.pool_size), 0) FROM public.pardons_due_for_recheck(1) d)  AS due_now,
  has_function_privilege('anon', 'public.pardons_due_for_recheck(integer)', 'execute') AS anon_can_execute;
