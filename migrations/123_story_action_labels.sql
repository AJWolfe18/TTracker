-- ============================================================================
-- Migration 123: action labels on stories (ADO-594 S1, PRD section 14)
-- ============================================================================
-- WHAT: three nullable columns on stories:
--   action_label        did | said | coverage      (what the news is)
--   action_actor        trump | administration | ally | other   (whose action)
--   action_label_source agent | backfill | human   (who wrote the label)
-- plus the ONE door for human labels, set_story_action_label(), and a trigger
-- that keeps a human label from being overwritten by any other write (the
-- Stories agent, the backfill, a plain PATCH). The trigger restores the label
-- fields and lets the rest of the write through; it never fails the write.
-- v_tracker_stories exposes action_label and action_actor (appended columns).
--
-- Nothing reads the labels yet: S2 (Stories agent writes them), S3 (backfill),
-- S4 (main-line rule v2) and S6 (Did/Said display) build on this. Applying it
-- changes nothing visible.
--
-- APPLY: paste the whole file into the Supabase SQL Editor (TEST, later PROD).
-- Idempotent: safe to re-run. One transaction; if anything errors, run
-- ROLLBACK; alone before retrying. Last statement is a read-only check whose
-- first column is `labeled_stories` (0 on a fresh apply).
-- ROLLBACK (manual): DROP TRIGGER stories_action_label_lock ON public.stories;
--   DROP FUNCTION public.set_story_action_label(bigint, text, text, boolean);
--   DROP FUNCTION public.stories_action_label_lock();
--   re-run migration 113 PART E (v_tracker_stories without the label columns);
--   ALTER TABLE public.stories DROP COLUMN action_label, DROP COLUMN action_actor,
--     DROP COLUMN action_label_source;
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- PART A: columns + value checks
-- ----------------------------------------------------------------------------
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS action_label TEXT;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS action_actor TEXT;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS action_label_source TEXT;

ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_action_label_check;
ALTER TABLE public.stories ADD CONSTRAINT stories_action_label_check
  CHECK (action_label IS NULL OR action_label IN ('did', 'said', 'coverage'));

ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_action_actor_check;
ALTER TABLE public.stories ADD CONSTRAINT stories_action_actor_check
  CHECK (action_actor IS NULL OR action_actor IN ('trump', 'administration', 'ally', 'other'));

ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_action_label_source_check;
ALTER TABLE public.stories ADD CONSTRAINT stories_action_label_source_check
  CHECK (action_label_source IS NULL OR action_label_source IN ('agent', 'backfill', 'human'));

-- A label always carries its source. The trigger below fills 'agent' when a
-- writer sends a label without one (or clears the source), so this check can
-- never fail an enrichment PATCH; it is a backstop if the trigger is disabled.
ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS stories_action_label_has_source;
ALTER TABLE public.stories ADD CONSTRAINT stories_action_label_has_source
  CHECK (action_label IS NULL OR action_label_source IS NOT NULL);

COMMENT ON COLUMN public.stories.action_label IS
  'ADO-594: did | said | coverage - what the news in this story is (PRD 14.2). NULL = not labeled yet (treated as did by the display, and by rule v1.3 until S4).';
COMMENT ON COLUMN public.stories.action_actor IS
  'ADO-594: trump | administration | ally | other - whose action or words it is (PRD 14.2). Different job from primary_actor (free text).';
COMMENT ON COLUMN public.stories.action_label_source IS
  'ADO-594: agent | backfill | human - who wrote the label. human is set ONLY by set_story_action_label(); trigger stories_action_label_lock keeps any other write from changing a human label.';

-- ----------------------------------------------------------------------------
-- PART B: the lock trigger
-- ----------------------------------------------------------------------------
-- Scalar variables only (no %ROWTYPE): the SQL Editor's RLS helper mangles
-- %ROWTYPE declarations (memory: migration 100 gotcha).
CREATE OR REPLACE FUNCTION public.stories_action_label_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin boolean := COALESCE(current_setting('app.label_admin', true), '') = 'on';
BEGIN
  IF NOT v_admin THEN
    IF TG_OP = 'UPDATE' THEN
      IF OLD.action_label_source = 'human' OR NEW.action_label_source = 'human' THEN
        NEW.action_label        := OLD.action_label;
        NEW.action_actor        := OLD.action_actor;
        NEW.action_label_source := OLD.action_label_source;
      END IF;
    ELSIF NEW.action_label_source = 'human' THEN
      -- INSERT claiming a human label without the door: drop the label part.
      NEW.action_label        := NULL;
      NEW.action_actor        := NULL;
      NEW.action_label_source := NULL;
    END IF;
  END IF;

  -- A label written without a source is an agent write (PRD 14.7 step 6).
  IF NEW.action_label IS NOT NULL AND NEW.action_label_source IS NULL THEN
    NEW.action_label_source := 'agent';
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.stories_action_label_lock() IS
  'ADO-594 S1: keeps a human action label. Without app.label_admin=on (set only by set_story_action_label), an UPDATE that touches a human-labeled row, or tries to make one, gets its three label fields restored; the rest of the write goes through. Also fills action_label_source=agent when a label arrives without a source.';

DROP TRIGGER IF EXISTS stories_action_label_lock ON public.stories;
CREATE TRIGGER stories_action_label_lock
  BEFORE INSERT OR UPDATE ON public.stories
  FOR EACH ROW EXECUTE FUNCTION public.stories_action_label_lock();

-- ----------------------------------------------------------------------------
-- PART C: the one door for human labels
-- ----------------------------------------------------------------------------
-- p_unlock = true: the label stays, its source goes back to 'agent', so the
-- next re-enrichment relabels the story. p_label/p_actor are ignored then.
-- The flag is transaction-local and switched off again right after the
-- UPDATE, so later statements in the same transaction stay protected.
CREATE OR REPLACE FUNCTION public.set_story_action_label(
  p_story_id bigint,
  p_label    text,
  p_actor    text,
  p_unlock   boolean DEFAULT false
)
RETURNS TABLE (id bigint, action_label text, action_actor text, action_label_source text)
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_rows int;
BEGIN
  IF p_story_id IS NULL THEN
    RAISE EXCEPTION 'set_story_action_label: p_story_id is required';
  END IF;
  IF NOT COALESCE(p_unlock, false) AND (p_label IS NULL OR p_actor IS NULL) THEN
    RAISE EXCEPTION 'set_story_action_label: p_label and p_actor are required unless p_unlock';
  END IF;

  PERFORM set_config('app.label_admin', 'on', true);

  IF COALESCE(p_unlock, false) THEN
    UPDATE public.stories s
       SET action_label_source = 'agent'
     WHERE s.id = p_story_id AND s.action_label_source = 'human';
  ELSE
    UPDATE public.stories s
       SET action_label = p_label,
           action_actor = p_actor,
           action_label_source = 'human'
     WHERE s.id = p_story_id;
  END IF;
  GET DIAGNOSTICS v_rows = ROW_COUNT;

  PERFORM set_config('app.label_admin', 'off', true);

  IF v_rows = 0 AND NOT COALESCE(p_unlock, false) THEN
    RAISE EXCEPTION 'set_story_action_label: story % not found', p_story_id;
  END IF;

  RETURN QUERY
    SELECT s.id, s.action_label, s.action_actor, s.action_label_source
      FROM public.stories s
     WHERE s.id = p_story_id;
END $$;

COMMENT ON FUNCTION public.set_story_action_label(bigint, text, text, boolean) IS
  'ADO-594 S1: the ONLY way to set a human action label or unlock one (p_unlock=true sets the source back to agent). Admin-only (S8); no agent prompt may call it. Not a security boundary against service-key code, same trust level as every admin write.';

REVOKE ALL ON FUNCTION public.set_story_action_label(bigint, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_story_action_label(bigint, text, text, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.stories_action_label_lock() FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- PART D: expose the two labels on the Tracker read path
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE keeps the grants; new columns are appended at the end.
-- action_label_source stays off the public view (admin detail).
CREATE OR REPLACE VIEW public.v_tracker_stories
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.primary_headline,
  s.first_seen_at,
  s.alarm_level,
  s.severity,
  e.id    AS front_id,
  e.name  AS front_name,
  e.slug  AS front_slug,
  p.pin   AS tracker_pin,
  s.main_line,
  s.action_label,
  s.action_actor
FROM public.stories s
LEFT JOIN public.story_event se ON se.story_id = s.id
LEFT JOIN public.events e ON e.id = se.event_id
                         AND e.publish_state = 'published'
LEFT JOIN public.tracker_pin p ON p.source = 'stories' AND p.entity_id = s.id::text
WHERE s.status = 'active' AND s.summary_neutral IS NOT NULL;

COMMENT ON VIEW public.v_tracker_stories IS
  'ADO-570/594: the Tracker spine''s stories read path. main_line is the STORED flag (refresh_tracker_derived), so main_line=is.true hits idx_stories_tracker_main_line as an index-only scan. Rule lives in v_tracker_main_line_rule. action_label/action_actor added by migration 123. Tight columns on purpose - never widen to content/embedding (egress rule).';

GRANT SELECT ON public.v_tracker_stories TO anon;
GRANT SELECT ON public.v_tracker_stories TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Read-only check. Expect: labeled_stories = 0, lock_trigger = 1, label_door = 1.
SELECT
  (SELECT count(*) FROM public.stories WHERE action_label IS NOT NULL) AS labeled_stories,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'stories_action_label_lock') AS lock_trigger,
  (SELECT count(*) FROM pg_proc WHERE proname = 'set_story_action_label') AS label_door;
