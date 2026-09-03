-- ============================================================================
-- Migration 114: social_posts ledger + social_state watermark (ADO-572)
-- ============================================================================
-- WHY: social automation v1 (docs/features/growth/prd-social-automation.md)
-- drafts one post per alarm-5 story / EO / pardon, Josh approves in the admin
-- Social tab, and the poster (ADO-573) publishes approved rows. The ledger is
-- the idempotency boundary: UNIQUE (platform, entity_type, entity_id) means a
-- re-run after a crash can never draft or post the same thing twice.
--
-- DESIGN:
--   social_posts   one row per (platform, entity) ever; status is the queue
--   social_state   key/value; the drafter's per-type watermarks live here so
--                  every run only looks at rows updated since the last run
--
-- ACCESS: service_role only. RLS is ON with no policies and no anon grants -
-- migration 046's default privileges already revoke anon on new tables, and
-- the admin dashboard reads/writes through the password-gated admin-social
-- edge function (service key), same as pipeline_skips.
--
-- WATERMARK SEED = now(): only items that change AFTER go-live get drafted.
-- Seeding 1970 would flood the queue with every historical alarm-5 item.
-- A deliberate backfill uses `node scripts/social/draft-posts.js --since <iso>`.
--
-- IDEMPOTENT: safe to re-run. DEPENDENCIES: set_updated_at() (migration 001).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.social_posts (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform     TEXT NOT NULL CHECK (platform IN ('facebook', 'bluesky', 'x', 'threads')),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('story', 'eo', 'scotus', 'pardon', 'digest')),
  entity_id    TEXT NOT NULL,   -- TEXT on purpose: EO ids are VARCHAR on PROD, INTEGER on TEST (migration 108 drift)
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected', 'posted', 'failed')),
  copy         TEXT NOT NULL,
  link_url     TEXT NOT NULL,
  image_url    TEXT,
  post_id      TEXT,
  post_url     TEXT,
  error        TEXT,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at  TIMESTAMPTZ,
  posted_at    TIMESTAMPTZ,
  UNIQUE (platform, entity_type, entity_id)
);

-- Queue reads: WHERE status IN (...) ORDER BY id DESC (cursor on id).
CREATE INDEX IF NOT EXISTS social_posts_status_id_idx
  ON public.social_posts (status, id DESC);

DROP TRIGGER IF EXISTS trg_social_posts_set_updated_at ON public.social_posts;
CREATE TRIGGER trg_social_posts_set_updated_at
  BEFORE UPDATE ON public.social_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_posts FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.social_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.social_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_state FROM anon, authenticated;

-- Per-type watermarks (ISO timestamps). See WATERMARK SEED note above.
INSERT INTO public.social_state (key, value) VALUES
  ('draft_watermark_story',  to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  ('draft_watermark_eo',     to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
  ('draft_watermark_pardon', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE public.social_posts IS 'ADO-572: social post ledger. One row per (platform, entity) ever; status drives the approve/post queue. service_role only.';
COMMENT ON TABLE public.social_state IS 'ADO-572: social automation key/value state (drafter watermarks). service_role only.';

NOTIFY pgrst, 'reload schema';
