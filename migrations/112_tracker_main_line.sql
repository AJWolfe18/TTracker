-- Migration: 112_tracker_main_line.sql
-- Purpose: The Tracker's curation layer (ADO-554, Epic ADO-543) — the "main line"
--   inclusion rule from PRD §12's locked anchor principle, plus the tracker_pin
--   override promised by the homepage design (rev 6, 2026-08-18).
--
--   A) tracker_pin       — per-entry force_show/force_hide across all four sources.
--                          Hand-curation is OPTIONAL: the rule below decides the
--                          main line; a pin only ever corrects a single row.
--   B) v_tracker_stories — the spine's stories read path, with main_line computed
--                          server-side:
--                            pin override            → force_show in, force_hide out
--                            no published front      → effective alarm 5 (loose end;
--                                                      v1.1 bar, see CASE comment)
--                            front member            → front opening (earliest member)
--                                                      OR alarm 5
--                                                      OR alarm >= 4 setting a new
--                                                      front peak (escalation)
--                          Routine developments on a front drop OFF the main line
--                          and live on the front's own page (ADO-548).
--
-- EO/SCOTUS/pardon rows have no front membership today, so their main-line rule
-- (loose end: alarm 5, plus pins) is applied by the frontend from the same
-- tracker_pin table — no views needed for them.
--
-- Apply manually via the Supabase SQL Editor (NOT apply-migrations.js).
-- DEPENDENCIES: migration 111 (events/story_event), set_updated_at() (migration 001).
--
-- SECURITY: migration 046 auto-revokes anon on new tables — explicit GRANTs below.
-- Pin EXISTENCE is public curation data by definition (a force_show row renders
-- publicly), so anon gets a SELECT policy — but only on source/entity_id/pin
-- (column-level grant): the note column is an admin breadcrumb and stays
-- private. Writes stay service_role-only (no anon or authenticated write
-- policies). The view is security_invoker so anon reads
-- through it inherit the RLS publish gates from migration 111 — an UNPUBLISHED
-- front's members still count as loose ends for anon, which is the intended
-- behavior (a draft front must not change the public main line).

-- ============================================================================
-- PART A: tracker_pin — per-entry main-line override, all four sources
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tracker_pin (
  source     TEXT NOT NULL
             CONSTRAINT tracker_pin_source_check
             CHECK (source IN ('stories', 'eos', 'scotus', 'pardons')),
  -- TEXT on purpose: EO ids are VARCHAR on PROD ('eo_<ts>_<suffix>') and INTEGER
  -- on TEST (known drift, migration 108); stories/SCOTUS/pardons are numeric.
  -- One table for all four sources beats four ALTER TABLEs and gives the admin
  -- one place to list every pin (ADO-547 editor).
  entity_id  TEXT NOT NULL,
  pin        TEXT NOT NULL
             CONSTRAINT tracker_pin_pin_check
             CHECK (pin IN ('force_show', 'force_hide')),
  note       TEXT,                                     -- optional admin breadcrumb (why pinned)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, entity_id)
);

COMMENT ON TABLE public.tracker_pin IS
  'ADO-554: per-entry Tracker main-line override (force_show | force_hide) across stories/eos/scotus/pardons. Optional hand-curation on top of the rule in v_tracker_stories — never required for the main line to work. Written by admin (service_role); ADO-547 ships the editor.';

DROP TRIGGER IF EXISTS trg_tracker_pin_set_updated_at ON public.tracker_pin;
CREATE TRIGGER trg_tracker_pin_set_updated_at
  BEFORE UPDATE ON public.tracker_pin
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tracker_pin ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tracker_pin_anon_select" ON public.tracker_pin;
CREATE POLICY "tracker_pin_anon_select" ON public.tracker_pin
  FOR SELECT TO anon
  USING (true);

-- Column-level anon grant: the frontend needs source/entity_id/pin only.
-- `note` is an ADMIN breadcrumb (why pinned) and must not be publicly
-- readable (AI review blocker on PR #127). REVOKE first so a re-run (or a DB
-- that applied the earlier table-wide grant) converges to columns-only.
REVOKE SELECT ON public.tracker_pin FROM anon;
-- updated_at included: the frontend orders newest-first (deterministic
-- truncation if pins ever outgrow the fetch cap), and ORDER BY needs SELECT
-- privilege on the column.
GRANT SELECT (source, entity_id, pin, updated_at) ON public.tracker_pin TO anon;
GRANT ALL ON public.tracker_pin TO service_role;

-- ============================================================================
-- PART B: v_tracker_stories — spine read path with server-computed main_line
-- ============================================================================

-- security_invoker: anon reads hit the underlying tables' own RLS/grants.
-- Anon holds SELECT on stories (046 re-grant), events/story_event (111,
-- publish-gated), tracker_pin (above), so the joins resolve.
CREATE OR REPLACE VIEW public.v_tracker_stories
WITH (security_invoker = true) AS
WITH front_members AS (
  -- One row per member story of a PUBLISHED front, with the two front-relative
  -- facts the rule needs: membership order (opening = first) and the peak
  -- effective alarm among EARLIER members. Ordering is (first_seen_at, id) —
  -- the same axis the spine pages on. The publish predicate is explicit for
  -- service_role parity; for anon the RLS on events/story_event already
  -- enforces it, so both roles compute identical main_line values.
  --
  -- The window runs over the SAME active/enriched story set the view exposes
  -- (Codex P1 on PR #127): merge_stories leaves story_event pointing at
  -- archived tombstones, and a hidden member must not hold member_seq 1 (the
  -- visible first member would never flag as the opening) or feed its alarm
  -- into front_prior_peak (suppressing real escalations).
  SELECT
    se.story_id,
    se.event_id,
    e.name AS front_name,
    e.slug AS front_slug,
    ROW_NUMBER() OVER w AS member_seq,
    MAX(
      COALESCE(
        s.alarm_level,
        CASE s.severity
          WHEN 'critical' THEN 5
          WHEN 'severe'   THEN 4
          WHEN 'moderate' THEN 3
          WHEN 'minor'    THEN 2
        END,
        2
      )
    ) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS front_prior_peak
  FROM public.story_event se
  JOIN public.events  e ON e.id = se.event_id AND e.publish_state = 'published'
  JOIN public.stories s ON s.id = se.story_id
                       AND s.status = 'active'
                       AND s.summary_neutral IS NOT NULL
  WINDOW w AS (PARTITION BY se.event_id ORDER BY s.first_seen_at, s.id)
)
SELECT
  s.id,
  s.primary_headline,
  s.first_seen_at,
  s.alarm_level,
  s.severity,
  fm.event_id     AS front_id,
  fm.front_name,
  fm.front_slug,
  (fm.member_seq = 1)                                  AS front_opening,
  p.pin                                                AS tracker_pin,
  a.alarm_eff,
  CASE
    WHEN p.pin = 'force_show' THEN TRUE
    WHEN p.pin = 'force_hide' THEN FALSE
    -- Loose end (no published front): alarm 5 only (rule v1.1, Josh
    -- August 23, 2026). Fronts are the organizing layer — an unfiled alarm-4
    -- story usually means "not filed yet", not "main line". The 4+ bar drowned
    -- the line because enrichment rates ~67% of stories 4+ (severity
    -- saturation, same disease as the pre-agent EO pipeline); a BLS-class
    -- alarm-4 loose end reaches the main line via filing or a force_show pin
    -- until severity calibration lands.
    WHEN fm.story_id IS NULL THEN a.alarm_eff >= 5
    -- Front member: opening, or escalation (alarm 5, or a new front peak at 4+).
    ELSE fm.member_seq = 1
      OR a.alarm_eff = 5
      OR (a.alarm_eff >= 4 AND a.alarm_eff > COALESCE(fm.front_prior_peak, 0))
  END AS main_line
FROM public.stories s
CROSS JOIN LATERAL (
  -- Effective alarm: alarm_level, else the migration-064 severity mapping,
  -- else 2 — the SAME fallback as the frontend adapters and v_event_stats.
  SELECT COALESCE(
    s.alarm_level,
    CASE s.severity
      WHEN 'critical' THEN 5
      WHEN 'severe'   THEN 4
      WHEN 'moderate' THEN 3
      WHEN 'minor'    THEN 2
    END,
    2
  )::smallint AS alarm_eff
) a
LEFT JOIN front_members fm ON fm.story_id = s.id
LEFT JOIN public.tracker_pin p ON p.source = 'stories' AND p.entity_id = s.id::text
-- The spine's base predicates, baked in (published, term scoping stays client-side):
WHERE s.status = 'active' AND s.summary_neutral IS NOT NULL;

COMMENT ON VIEW public.v_tracker_stories IS
  'ADO-554: the Tracker spine''s stories read path. main_line implements PRD §12''s anchor principle (rule v1.1): pins override, loose ends need effective alarm 5, front members make the main line only as the front''s opening, at alarm 5, or on a new front peak at 4+. Tight columns on purpose — never widen to content/embedding (egress rule).';

GRANT SELECT ON public.v_tracker_stories TO anon;
GRANT SELECT ON public.v_tracker_stories TO service_role;

-- Refresh PostgREST's schema cache so the table/view are immediately queryable.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION (run after applying)
-- ============================================================================
-- 1. Empty pin table, view resolves:
--    SELECT count(*) FROM tracker_pin;
--    SELECT count(*) FROM v_tracker_stories;                  -- = active enriched stories
--    SELECT count(*) FROM v_tracker_stories WHERE main_line;  -- <= previous count
-- 2. Rule sanity on a seeded front (after ADO-554 seeding):
--    SELECT id, primary_headline, alarm_eff, front_name, front_opening, main_line
--    FROM v_tracker_stories WHERE front_id IS NOT NULL
--    ORDER BY front_id, first_seen_at;
--    -- expect: member_seq 1 rows main_line = true; alarm_eff <= prior peak and < 5 rows false
-- 3. Pin override: INSERT INTO tracker_pin VALUES ('stories', '<id>', 'force_hide');
--    → that row's main_line flips false; DELETE the pin, it flips back.
-- 4. Anon read (PostgREST anon key) returns rows — not 401/42501:
--    curl -s "https://wnrjrywpcadwutfykflu.supabase.co/rest/v1/v_tracker_stories?select=id,main_line&limit=1" \
--      -H "apikey: <ANON_KEY>" -H "Authorization: Bearer <ANON_KEY>"
--    (repeat for tracker_pin — expect [])
-- 5. Re-run this whole file — must be a no-op (idempotent).
