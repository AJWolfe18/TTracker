-- Migration 133: drop the stale agent_model default on the SCOTUS and Pardons run logs (ADO-626).
--
-- 090/094 created agent_model TEXT NOT NULL DEFAULT 'claude-opus-4-6'. The agent never sent the
-- field, so every row claimed Opus 4.6 whatever model actually ran. The prompts now send the real ID.
-- Dropping only the default would make a run that forgets the field fail its first insert, so NOT NULL
-- goes too: a missed field now leaves NULL (admin shows '-'), never a wrong model and never a failed run.
-- Idempotent: DROP DEFAULT / DROP NOT NULL are no-ops when already dropped. Order-independent vs the prompt.
-- Expected result: information_schema.columns shows column_default NULL, is_nullable YES on both tables.
-- Rollback: ALTER COLUMN agent_model SET DEFAULT 'claude-opus-4-6' on both tables (and SET NOT NULL
--           only if no NULL rows exist).

ALTER TABLE public.scotus_enrichment_log ALTER COLUMN agent_model DROP DEFAULT;
ALTER TABLE public.scotus_enrichment_log ALTER COLUMN agent_model DROP NOT NULL;
ALTER TABLE public.pardons_enrichment_log ALTER COLUMN agent_model DROP DEFAULT;
ALTER TABLE public.pardons_enrichment_log ALTER COLUMN agent_model DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
