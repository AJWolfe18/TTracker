-- ============================================================================
-- 139: daily_check_claims - each daily health check runs once per day (ADO-645)
-- WHY: two different runs can start the RSS health check's daily checks (the
--   Netlify daily start, or GitHub's fallback run), and a late Netlify start
--   posted the same digest twice. Each check now claims its day here first; the
--   claim is atomic, so only one run a day gets it. The rules (failed and stale
--   takeover, force, fail open, slot_date): scripts/lib/daily-check-claim.js.
--   About 730 rows a year (two checks a day); no cleanup needed.
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, then PROD).
--   If asked "Run with/without RLS", choose with (the table turns RLS on).
--   Idempotent. On any error run ROLLBACK; alone before retrying.
--   HARD PREREQUISITE: apply this (TEST and PROD) BEFORE the ADO-645 code
--   ships. It only adds a table and two functions, so applying early is safe.
--   The code's backup offers to check on every scheduled run after 14:00 UTC
--   and relies on this claim to stop repeats: without it each of those runs
--   fails open (a ::warning::) and posts the digests again.
-- EXPECT: last result, one row: claims_table = 1, rls_on = true,
--   anon_can_select = false, anon_can_claim = false, service_can_claim = true,
--   service_can_finish = true.
-- ROLLBACK: first revert the ADO-645 code (see APPLY), then BEGIN;
--   DROP FUNCTION IF EXISTS public.finish_daily_check(text, date, text, text);
--   DROP FUNCTION IF EXISTS public.claim_daily_check(text, date, text, boolean);
--   DROP TABLE IF EXISTS public.daily_check_claims;
--   COMMIT; NOTIFY pgrst, 'reload schema';
--   Code still deployed keeps running without the table (it fails open), but
--   posts the digests on every scheduled run after 14:00 UTC.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.daily_check_claims (
  check_name  TEXT        NOT NULL CHECK (check_name ~ '^[a-z_]{1,40}$'),
  slot_date   DATE        NOT NULL,
  status      TEXT        NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  -- The GitHub run that holds the claim: "<run id>-<attempt>", or "local-..." for a run by hand
  run_id      TEXT        NOT NULL CHECK (length(run_id) BETWEEN 1 AND 100),
  claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  -- How many runs have held this claim; above 1 means a failed or stale run was taken over, or a forced re-run
  attempts    INTEGER     NOT NULL DEFAULT 1,
  PRIMARY KEY (check_name, slot_date)
);

COMMENT ON TABLE public.daily_check_claims IS
  'ADO-645: one row per daily health check per day, so the check runs once a day whichever run starts it (Netlify daily start, GitHub fallback, manual). Written only through claim_daily_check / finish_daily_check. service_role only.';

-- Service role only: the health check reads and writes it through the two functions below.
ALTER TABLE public.daily_check_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.daily_check_claims FROM PUBLIC, anon, authenticated;

-- Claim a check for a day. Returns one row:
--   claimed = true:  this run holds the claim and should run the check;
--   claimed = false: another run did it ('done') or is doing it ('running');
--                    holder_status / holder_run_id / holder_claimed_at describe that run.
CREATE OR REPLACE FUNCTION public.claim_daily_check(
  p_check_name TEXT,
  p_slot_date  DATE,
  p_run_id     TEXT,
  p_force      BOOLEAN DEFAULT false
)
RETURNS TABLE (claimed BOOLEAN, holder_status TEXT, holder_run_id TEXT, holder_claimed_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Longer than either check step's timeout (10 and 2 minutes in rss-health-check.yml),
  -- so only a run that is really gone is taken over
  v_stale_after CONSTANT INTERVAL := INTERVAL '30 minutes';
  v_row public.daily_check_claims;
BEGIN
  IF p_check_name IS NULL OR p_slot_date IS NULL OR p_run_id IS NULL THEN
    RAISE EXCEPTION 'claim_daily_check: check name, slot date and run id are required'
      USING ERRCODE = '22023';
  END IF;

  -- One statement, so two runs at the same moment cannot both win: the second
  -- waits on the row lock, then sees the first one's 'running' claim.
  INSERT INTO public.daily_check_claims AS c (check_name, slot_date, status, run_id)
  VALUES (p_check_name, p_slot_date, 'running', p_run_id)
  ON CONFLICT (check_name, slot_date) DO UPDATE
     SET status      = 'running',
         run_id      = EXCLUDED.run_id,
         claimed_at  = NOW(),
         finished_at = NULL,
         attempts    = c.attempts + 1
   WHERE p_force
      OR c.status = 'failed'
      OR (c.status = 'running' AND c.claimed_at < NOW() - v_stale_after)
  RETURNING c.* INTO v_row;

  IF FOUND THEN
    RETURN QUERY SELECT true, v_row.status, v_row.run_id, v_row.claimed_at;
    RETURN;
  END IF;

  -- Not ours: report who holds it
  SELECT * INTO v_row
    FROM public.daily_check_claims c
   WHERE c.check_name = p_check_name AND c.slot_date = p_slot_date;
  RETURN QUERY SELECT false, v_row.status, v_row.run_id, v_row.claimed_at;
END;
$$;

COMMENT ON FUNCTION public.claim_daily_check(text, date, text, boolean) IS
  'ADO-645: atomically claims a daily check for a day. Takes over a failed claim, a stale running claim (v_stale_after), or any claim when p_force. Returns claimed + the holder. Caller: scripts/lib/daily-check-claim.js. service_role only.';

-- Mark the run's own claim done or failed. Returns false (and changes nothing)
-- when the claim is no longer this run's, e.g. a later run took it over.
CREATE OR REPLACE FUNCTION public.finish_daily_check(
  p_check_name TEXT,
  p_slot_date  DATE,
  p_run_id     TEXT,
  p_status     TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('done', 'failed') THEN
    RAISE EXCEPTION 'finish_daily_check: status must be done or failed, got %', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.daily_check_claims c
     SET status = p_status, finished_at = NOW()
   WHERE c.check_name = p_check_name
     AND c.slot_date  = p_slot_date
     AND c.run_id     = p_run_id
     AND c.status     = 'running';
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.finish_daily_check(text, date, text, text) IS
  'ADO-645: marks the calling run''s running claim done or failed. False when the claim is not that run''s any more. Caller: scripts/lib/daily-check-claim.js. service_role only.';

REVOKE ALL ON FUNCTION public.claim_daily_check(text, date, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_daily_check(text, date, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_daily_check(text, date, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_daily_check(text, date, text, text) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Verify: the table exists with RLS on, anon cannot read it or claim, service_role can do both calls.
SELECT
  (to_regclass('public.daily_check_claims') IS NOT NULL)::int AS claims_table,
  (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.daily_check_claims')) AS rls_on,
  has_table_privilege('anon', 'public.daily_check_claims', 'SELECT') AS anon_can_select,
  has_function_privilege('anon', 'public.claim_daily_check(text, date, text, boolean)', 'EXECUTE') AS anon_can_claim,
  has_function_privilege('service_role', 'public.claim_daily_check(text, date, text, boolean)', 'EXECUTE') AS service_can_claim,
  has_function_privilege('service_role', 'public.finish_daily_check(text, date, text, text)', 'EXECUTE') AS service_can_finish;
