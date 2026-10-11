-- Migration 129: routine_heartbeats - one row per run for routines that have no run-level log (ADO-624).
--
-- Why: scripts/monitoring/alert-routine-silence.js alerts when a Claude routine stops writing log rows.
-- SCOTUS and Pardons already write a run row on every run (scotus_/pardons_enrichment_log). The EO
-- log is per-order (eo_id NOT NULL) and the Election front agent has no log table, so a quiet day
-- leaves no trace and a dead routine looks the same as a quiet one. Each of those two routines now
-- inserts one row here at the start of every run, empty runs included.
--
-- Writers: EO agent (curl POST, routine 'eo'), front agent via scripts/fronts/front-agent-db.js
-- heartbeat (routine 'fronts'). Reader: the silence check (newest row per routine, limit=1).
-- Service role only: RLS on, no anon/authenticated grant. About 500 rows a year; no cleanup needed.
--
-- Seed: one row per routine stamped now, so the silence check (which reads this table once the
-- ADO-624 script is on main) does not report "no log row at all" before each routine's first run
-- with the new prompt. Apply this migration on PROD shortly before or after the PR merges.
--
-- Idempotent (IF NOT EXISTS; the seed inserts only into an empty table).
-- Rollback: DROP TABLE IF EXISTS public.routine_heartbeats;

CREATE TABLE IF NOT EXISTS public.routine_heartbeats (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    routine TEXT NOT NULL CHECK (routine ~ '^[a-z_]{1,40}$'),
    run_id TEXT CHECK (run_id IS NULL OR length(run_id) <= 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routine_heartbeats_routine_created_at
    ON public.routine_heartbeats (routine, created_at DESC);

ALTER TABLE public.routine_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routine_heartbeats FROM anon, authenticated;

INSERT INTO public.routine_heartbeats (routine, run_id)
SELECT r, 'migration-129-seed'
  FROM unnest(ARRAY['eo', 'fronts']) AS r
 WHERE NOT EXISTS (SELECT 1 FROM public.routine_heartbeats);

NOTIFY pgrst, 'reload schema';
