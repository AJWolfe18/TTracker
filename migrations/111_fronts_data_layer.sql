-- Migration: 111_fronts_data_layer.sql
-- Purpose: Fronts (events) data layer per PRD §6 (ADO-546, Epic ADO-543 Wave 1).
--   A) events        — one row per front (editorial container; public copy says "front")
--   B) event_updates — one row per editorial update (the approval-gated timeline entries)
--   C) story_event   — story→front membership; story_id is the SOLE PK (one front per
--                      story, Josh 2026-08-17), mirroring article_story's article_id-only PK
--   D) v_event_stats — derived stats view; NOTHING derived is ever stored on the tables
--
-- Apply manually via the Supabase SQL Editor on TEST (NOT apply-migrations.js).
-- DEPENDENCY: requires set_updated_at() from migration 001 (present on TEST and PROD).
--
-- SECURITY NOTE: migration 046 auto-revokes anon on new tables, so all three tables get an
-- explicit GRANT SELECT TO anon (the exact miss that once blinded the frontend to
-- SCOTUS/Pardons). RLS enforces the editorial gates at the DB level, mirroring migration
-- 056 (pardons is_public): anon only sees published fronts, approved updates on published
-- fronts, and memberships of published fronts. service_role bypasses RLS (admin edge
-- functions + agents read/write drafts). The view uses security_invoker=true so anon
-- reads through it inherit those same RLS gates and the security advisor stays clean.
--
-- Controlled vocabularies (PRD §6.6) are enforced with CHECK constraints. No data seeding
-- here — seed fronts are Josh's call post-apply (likely via the ADO-547 admin UI).

-- ============================================================================
-- PART A: events — one row per front
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,                -- presentation only; never a join key
  name          TEXT NOT NULL,                       -- "The Epstein Files"
  dek           TEXT,                                -- one-paragraph standing summary
  alarm_level   SMALLINT NOT NULL DEFAULT 3
                CONSTRAINT events_alarm_level_check CHECK (alarm_level BETWEEN 0 AND 5),
  tier          TEXT NOT NULL DEFAULT 'standard'
                CONSTRAINT events_tier_check CHECK (tier IN ('flagship', 'major', 'standard')),
  lifecycle     TEXT NOT NULL DEFAULT 'open'
                CONSTRAINT events_lifecycle_check CHECK (lifecycle IN ('open', 'dormant', 'resolved')),
  publish_state TEXT NOT NULL DEFAULT 'draft'
                CONSTRAINT events_publish_state_check CHECK (publish_state IN ('draft', 'review', 'published')),
  published_at  TIMESTAMPTZ,                         -- null until published
  started_at    TIMESTAMPTZ,                         -- editorial start of the arc
  resolved_at   TIMESTAMPTZ,                         -- set when lifecycle → resolved
  created_by    TEXT NOT NULL DEFAULT 'human'
                CONSTRAINT events_created_by_check CHECK (created_by IN ('agent', 'human')),
  enrichment_meta JSONB,                             -- AI provenance
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.events IS
  'ADO-546: one row per front (public copy says "front"; schema keeps the neutral events naming). Editorial container above stories — fronts own editorial content only; article membership stays on stories. No stored counters: v_event_stats derives everything.';
COMMENT ON COLUMN public.events.slug IS 'Presentation only — never a join key. Joins always use id.';
COMMENT ON COLUMN public.events.alarm_level IS 'Editorial alarm 0-5, set by human. This is what DISPLAYS everywhere; v_event_stats.peak_alarm (derived) serves the rubric/admin QA only and never renders publicly (PRD §6.5).';
COMMENT ON COLUMN public.events.lifecycle IS 'open (default) | dormant (no approved update in 90 days, set by job) | resolved (terminal, set by hand only).';
COMMENT ON COLUMN public.events.publish_state IS 'Editorial gate: draft | review | published. Only published is publicly visible (enforced by RLS).';

-- ============================================================================
-- PART B: event_updates — one row per editorial update
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.event_updates (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id       BIGINT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  headline       TEXT NOT NULL,
  body           TEXT,
  happened_at    TIMESTAMPTZ NOT NULL,               -- when the development occurred
  sort_key       BIGINT NOT NULL DEFAULT 0,          -- explicit ordering; breaks happened_at ties
  significance   TEXT NOT NULL DEFAULT 'minor'
                 CONSTRAINT event_updates_significance_check CHECK (significance IN ('major', 'minor')),
  approval_state TEXT NOT NULL DEFAULT 'pending'
                 CONSTRAINT event_updates_approval_state_check CHECK (approval_state IN ('pending', 'approved', 'rejected')),
  decided_at     TIMESTAMPTZ,                        -- the human gate
  decided_by     TEXT
                 CONSTRAINT event_updates_decided_by_check CHECK (decided_by IS NULL OR decided_by IN ('agent', 'human')),
  was_edited     BOOLEAN NOT NULL DEFAULT FALSE,     -- human changed the draft before approving
  created_by     TEXT NOT NULL
                 CONSTRAINT event_updates_created_by_check CHECK (created_by IN ('agent', 'human')),
  enrichment_meta JSONB,                             -- provenance only, never queried
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.event_updates IS
  'ADO-546: one row per editorial update on a front. AI-drafted, human-approved (approval_state is the mandatory gate). was_edited makes draft quality measurable (PRD §7.3).';
COMMENT ON COLUMN public.event_updates.enrichment_meta IS
  'Provenance only (model, prompt version, source story ids) — never queried. Canonical update↔story membership lives in story_event.event_update_id.';
COMMENT ON COLUMN public.event_updates.sort_key IS 'Explicit ordering; breaks happened_at ties. Higher sorts newer.';

-- Timeline read path: updates of a front, newest first, sort_key breaking ties.
CREATE INDEX IF NOT EXISTS idx_event_updates_event_timeline
  ON public.event_updates (event_id, happened_at DESC, sort_key DESC);

-- Approval queue (admin load metric alerts on pending count; queue stays small).
CREATE INDEX IF NOT EXISTS idx_event_updates_pending
  ON public.event_updates (created_at DESC)
  WHERE approval_state = 'pending';

-- ============================================================================
-- PART C: story_event — story→front membership (one front per story)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.story_event (
  story_id        BIGINT PRIMARY KEY REFERENCES public.stories(id) ON DELETE CASCADE,
  event_id        BIGINT NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  event_update_id BIGINT REFERENCES public.event_updates(id) ON DELETE SET NULL,  -- set when folded into an update
  assigned_by     TEXT NOT NULL
                  CONSTRAINT story_event_assigned_by_check CHECK (assigned_by IN ('agent', 'human')),
  confidence      NUMERIC
                  CONSTRAINT story_event_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reassigned_at   TIMESTAMPTZ,                       -- null unless a human moved it
  reassigned_from_event_id BIGINT REFERENCES public.events(id) ON DELETE SET NULL  -- the front the agent originally chose
);

COMMENT ON TABLE public.story_event IS
  'ADO-546: story→front membership. story_id is the SOLE primary key (one front per story — hard constraint, Josh 2026-08-17), mirroring article_story (PK article_id alone): assignment is idempotent and race-safe by construction. Relaxing later is a migration.';
COMMENT ON COLUMN public.story_event.reassigned_from_event_id IS
  'The front the agent originally chose, kept when a human reassigns — this is what makes assignment precision measurable (PRD §7.3).';

-- View aggregation + "stories of this front" reads.
CREATE INDEX IF NOT EXISTS idx_story_event_event_id
  ON public.story_event (event_id);

-- "Developments folded into this update" reads.
CREATE INDEX IF NOT EXISTS idx_story_event_event_update_id
  ON public.story_event (event_update_id)
  WHERE event_update_id IS NOT NULL;

-- ============================================================================
-- PART D: updated_at triggers (reuses set_updated_at() from migration 001)
-- ============================================================================

DROP TRIGGER IF EXISTS trg_events_set_updated_at ON public.events;
CREATE TRIGGER trg_events_set_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_event_updates_set_updated_at ON public.event_updates;
CREATE TRIGGER trg_event_updates_set_updated_at
  BEFORE UPDATE ON public.event_updates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- PART E: RLS — DB-level editorial gates (mirrors migration 056 pardons pattern)
-- ============================================================================

ALTER TABLE public.events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_event   ENABLE ROW LEVEL SECURITY;

-- Drop-then-create for idempotency (CREATE POLICY has no IF NOT EXISTS).
DROP POLICY IF EXISTS "events_anon_select"        ON public.events;
DROP POLICY IF EXISTS "event_updates_anon_select" ON public.event_updates;
DROP POLICY IF EXISTS "story_event_anon_select"   ON public.story_event;

-- Anon sees published fronts only (PRD §6.6: draft/review are not publicly visible).
CREATE POLICY "events_anon_select" ON public.events
  FOR SELECT TO anon
  USING (publish_state = 'published');

-- Anon sees approved updates on published fronts only.
CREATE POLICY "event_updates_anon_select" ON public.event_updates
  FOR SELECT TO anon
  USING (
    approval_state = 'approved'
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id AND e.publish_state = 'published'
    )
  );

-- Anon sees memberships of published fronts only.
CREATE POLICY "story_event_anon_select" ON public.story_event
  FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = event_id AND e.publish_state = 'published'
  ));

-- NO authenticated policies, NO anon write policies — writes are service_role only
-- (admin edge functions + agents; service_role bypasses RLS).

-- ============================================================================
-- PART F: grants (migration 046 auto-revokes anon on new tables — explicit re-grant)
-- ============================================================================

GRANT SELECT ON public.events        TO anon;
GRANT SELECT ON public.event_updates TO anon;
GRANT SELECT ON public.story_event   TO anon;

GRANT ALL ON public.events        TO service_role;
GRANT ALL ON public.event_updates TO service_role;
GRANT ALL ON public.story_event   TO service_role;

-- ============================================================================
-- PART G: v_event_stats — derived stats (PRD §6.5). Nothing derived is stored.
-- ============================================================================

-- security_invoker: anon reads through the view hit the tables' own RLS/grants
-- (and the security advisor doesn't flag a definer view). Anon already holds
-- SELECT on stories + article_story (migration 046), so the joins resolve.
CREATE OR REPLACE VIEW public.v_event_stats
WITH (security_invoker = true) AS
WITH members AS (
  SELECT
    se.event_id,
    COUNT(*)::int AS story_count,
    MAX(s.last_updated_at) AS last_activity_at,
    -- Derived peak alarm across member stories: alarm_level, falling back to the
    -- legacy severity mapping from migration 064 (critical→5, severe→4,
    -- moderate→3, minor→2), then 2 — same fallback as the frontend adapters.
    MAX(COALESCE(
      s.alarm_level,
      CASE s.severity
        WHEN 'critical' THEN 5
        WHEN 'severe'   THEN 4
        WHEN 'moderate' THEN 3
        WHEN 'minor'    THEN 2
      END,
      2
    ))::smallint AS peak_alarm
  FROM public.story_event se
  JOIN public.stories s ON s.id = se.story_id
  GROUP BY se.event_id
),
sources AS (
  -- Article membership across member stories. Matches the house convention that
  -- stories.source_count = COUNT(article_story rows) (merge_stories recount).
  SELECT
    se.event_id,
    COUNT(*)::int AS source_count
  FROM public.story_event se
  JOIN public.article_story ast ON ast.story_id = se.story_id
  GROUP BY se.event_id
),
updates AS (
  -- Approved-only: the public timeline shows approved updates, and both the
  -- dormancy rule (§6.6: "no approved update in 90 days") and the stale-fronts
  -- metric (§7.3) are defined against approved updates.
  SELECT
    eu.event_id,
    (COUNT(*) FILTER (WHERE eu.approval_state = 'approved'))::int AS update_count,
    MAX(eu.happened_at) FILTER (WHERE eu.approval_state = 'approved') AS last_approved_at
  FROM public.event_updates eu
  GROUP BY eu.event_id
)
SELECT
  e.id AS event_id,
  COALESCE(m.story_count, 0)    AS story_count,
  COALESCE(src.source_count, 0) AS source_count,
  COALESCE(u.update_count, 0)   AS update_count,
  m.last_activity_at,
  m.peak_alarm,
  CASE
    WHEN u.last_approved_at IS NOT NULL
    THEN FLOOR(EXTRACT(EPOCH FROM (NOW() - u.last_approved_at)) / 86400)::int
  END AS days_since_update
FROM public.events e
LEFT JOIN members m   ON m.event_id   = e.id
LEFT JOIN sources src ON src.event_id = e.id
LEFT JOIN updates u   ON u.event_id   = e.id;

COMMENT ON VIEW public.v_event_stats IS
  'ADO-546: derived front stats (PRD §6.5) — story_count, source_count (article_story rows across member stories), update_count (approved only), last_activity_at (max member story last_updated_at), peak_alarm (derived from member stories; rubric/admin QA only, events.alarm_level is what displays), days_since_update (whole days since last approved update''s happened_at; NULL when none). Nothing derived is ever stored.';

GRANT SELECT ON public.v_event_stats TO anon;
GRANT SELECT ON public.v_event_stats TO service_role;

-- ============================================================================
-- PART H: cross-field integrity (Codex review P1/P2 on PR #119)
-- Guarded ALTERs so this section also converges a database that applied an
-- earlier revision of this file (TEST). No %ROWTYPE, no SELECT INTO.
-- ============================================================================

DO $$
BEGIN
  -- P2: a published front must carry its publish timestamp.
  -- (Unpublishing may keep the old published_at — history is allowed.)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'events_published_at_check'
                   AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_published_at_check
      CHECK (publish_state <> 'published' OR published_at IS NOT NULL);
  END IF;

  -- Same class as P2: resolved fronts must carry resolved_at (PRD §6.1
  -- "set when lifecycle → resolved").
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'events_resolved_at_check'
                   AND conrelid = 'public.events'::regclass) THEN
    ALTER TABLE public.events
      ADD CONSTRAINT events_resolved_at_check
      CHECK (lifecycle <> 'resolved' OR resolved_at IS NOT NULL);
  END IF;

  -- P2: decision fields travel with decided states — pending rows carry no
  -- decision provenance; approved/rejected rows must carry both (queue-latency
  -- metric decided_at - created_at, §7.3, depends on this).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'event_updates_decided_check'
                   AND conrelid = 'public.event_updates'::regclass) THEN
    ALTER TABLE public.event_updates
      ADD CONSTRAINT event_updates_decided_check
      CHECK (
        (approval_state = 'pending'  AND decided_at IS NULL     AND decided_by IS NULL)
        OR
        (approval_state <> 'pending' AND decided_at IS NOT NULL AND decided_by IS NOT NULL)
      );
  END IF;

  -- P1 support: unique target so a composite FK can reference (id, event_id).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'event_updates_id_event_unique'
                   AND conrelid = 'public.event_updates'::regclass) THEN
    ALTER TABLE public.event_updates
      ADD CONSTRAINT event_updates_id_event_unique UNIQUE (id, event_id);
  END IF;

  -- P1: a story's event_update_id must point at an update of the SAME front.
  -- This composite FK exists purely for that consistency check; the original
  -- single-column FK keeps the ON DELETE SET NULL behavior (a composite
  -- ON DELETE SET NULL (col) form would need PG15-only syntax). On update
  -- deletion the single-column FK nulls event_update_id first, which satisfies
  -- this FK (MATCH SIMPLE). Reassigning a story to another front without
  -- clearing its update link is now rejected — by design.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'story_event_update_same_event_fkey'
                   AND conrelid = 'public.story_event'::regclass) THEN
    ALTER TABLE public.story_event
      ADD CONSTRAINT story_event_update_same_event_fkey
      FOREIGN KEY (event_update_id, event_id)
      REFERENCES public.event_updates (id, event_id);
  END IF;
END $$;

-- Refresh PostgREST's schema cache so the new tables/view are immediately
-- queryable via the REST API (the anon-read verification below depends on it).
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION (run after applying; also see the PR body checklist)
-- ============================================================================
-- 1. Tables exist, empty:
--    SELECT count(*) FROM events; SELECT count(*) FROM event_updates; SELECT count(*) FROM story_event;
-- 2. View resolves (expect 0 rows):
--    SELECT * FROM v_event_stats;
-- 3. Vocabulary CHECKs reject bad values (expect ERROR, then clean up nothing — it never inserts):
--    INSERT INTO events (slug, name, tier) VALUES ('x-check', 'x', 'mega');  -- must fail events_tier_check
-- 4. Anon read (PostgREST with anon key) returns [] — not 401/42501:
--    curl -s "https://wnrjrywpcadwutfykflu.supabase.co/rest/v1/events?select=id&limit=1" \
--      -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--    (repeat for event_updates, story_event, v_event_stats)
-- 5. Re-run this whole file — must be a no-op (idempotent).
