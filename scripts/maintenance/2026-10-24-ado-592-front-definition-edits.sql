-- Three front definition edits (October 24, 2026, ADO-592). Run on PROD in the SQL Editor (TEST already has them).
-- Same edits the Fronts tab would make; done as SQL so they land before the first PROD all-fronts
-- run (October 25, 9:00 AM CT): the agent never re-judges a story it has already declined.
--   1. RFK Jr.'s HHS: Josh decided the abortion pill (October 24, 2026). FDA/HHS actions on the pill
--      belong; court fights over state bans and mail access with no FDA/HHS decision at issue do not.
--      The sweep guard stays (keywords cannot tell an FDA action from a lawsuit), so the agent decides.
--   2. Hegseth's Pentagon: names the Quantico "warrior ethos" gathering (TEST spot check miss).
--   3. Trump Corruption: family crypto income while in office counts on its own (TEST spot check miss).
-- One guarded block: each front must be the only row with its slug, hold its exact old sentence once
-- and not yet hold the new one, or the whole block rolls back and changes nothing. A second run raises
-- on the first front and changes nothing. Each front is backed up first (merge_tag 'ado-592-defs-1024').
--
-- Result: one row (first column: rfk_hhs_edited), every *_edited true. pill_pending_declines counts
-- stories the agent already declined under the old "abortion pill pending" rule: 0 before the first
-- run. If it is above 0 (pasted after a run), those stories need a separate, reviewed re-queue.

DO $$
DECLARE
  c_tag CONSTANT TEXT := 'ado-592-defs-1024';
  r RECORD;
  e RECORD;
  n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('rfk-hhs',
     $o$**Pending Josh (do not decide):** whether the abortion pill (mifepristone) belongs on this front at all. Until he decides, decline every mifepristone or abortion-pill story with `uncertain: true` and a rationale that starts with `borderline rfk-hhs: abortion pill pending`.$o$,
     $n$**Abortion pill (Josh, October 24, 2026):** a mifepristone or abortion-pill story belongs when the FDA, HHS or Kennedy acts on the pill (the safety review, a label or prescribing-rule change such as ending telehealth or mail prescriptions, a generic approval, an order to the agencies), or when a court or Congress acts on one of those agency decisions. Decline lawsuits over state bans and mail access when no FDA or HHS decision is the subject, and abortion stories that are not about the pill. The keyword sweep never files these stories, so each one is your call.$n$),
    ('hegseth-pentagon',
     $o$the rename to the Department of War, the culture rules)$o$,
     $n$the rename to the Department of War, the culture rules, the Quantico "warrior ethos" gathering of generals and admirals)$n$),
    ('trump-corruption',
     $o$or when the checks on all this are removed (inspectors general fired, ethics and anti-corruption units disbanded, FCPA enforcement paused).$o$,
     $n$or when the checks on all this are removed (inspectors general fired, ethics and anti-corruption units disbanded, FCPA enforcement paused). Income the family's crypto ventures (World Liberty Financial, the memecoin, their stablecoin and token deals) bring in while Trump is in office counts on its own, even when no official act is named.$n$)
  ) AS t(slug, old_text, new_text)
  LOOP
    SELECT count(*) INTO n FROM public.events WHERE slug = r.slug;
    IF n <> 1 THEN RAISE EXCEPTION '%: expected exactly 1 front with this slug, got %. Nothing changed.', r.slug, n; END IF;

    -- the exact old sentence, exactly once, and the new text not already there (the Trump Corruption
    -- edit keeps its old sentence, so without that last check a second run would append it twice)
    SELECT * INTO e FROM public.events ev
     WHERE ev.slug = r.slug
       AND position(r.old_text IN ev.agent_definition) > 0
       AND position(r.old_text IN substr(ev.agent_definition, position(r.old_text IN ev.agent_definition) + 1)) = 0
       AND position(r.new_text IN ev.agent_definition) = 0;
    IF NOT FOUND THEN RAISE EXCEPTION '%: the exact old sentence is not there once, or the new text already is. Nothing changed.', r.slug; END IF;

    -- backup BEFORE writing (first run wins: a re-run keeps the original values)
    INSERT INTO public.front_merge_backup_events (merge_tag, event_id, slug, publish_state, published_at,
                sweep_pattern, sweep_coword, sweep_priority, sweep_summary, agent_pattern, agent_definition)
    VALUES (c_tag, e.id, e.slug, e.publish_state, e.published_at, e.sweep_pattern, e.sweep_coword,
            e.sweep_priority, e.sweep_summary, e.agent_pattern, e.agent_definition)
    ON CONFLICT (merge_tag, event_id) DO NOTHING;

    UPDATE public.events
       SET agent_definition = replace(agent_definition, r.old_text, r.new_text), updated_at = NOW()
     WHERE id = e.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 1 THEN RAISE EXCEPTION '%: expected to update 1 row, updated %. Nothing changed.', r.slug, n; END IF;
  END LOOP;
END $$;

SELECT bool_or(slug = 'rfk-hhs'          AND position('Abortion pill (Josh, October 24, 2026)' IN agent_definition) > 0) AS rfk_hhs_edited,
       bool_or(slug = 'hegseth-pentagon' AND position('Quantico "warrior ethos"' IN agent_definition) > 0)               AS hegseth_edited,
       bool_or(slug = 'trump-corruption' AND position('counts on its own, even when no official act is named' IN agent_definition) > 0) AS corruption_edited,
       (SELECT count(*) FROM public.pipeline_skips
         WHERE reason = 'agent_declined'
           AND metadata->>'rationale' ILIKE '%abortion pill pending%') AS pill_pending_declines,
       (SELECT count(*) FROM public.front_merge_backup_events WHERE merge_tag = 'ado-592-defs-1024') AS backed_up
  FROM public.events
 WHERE slug IN ('rfk-hhs', 'hegseth-pentagon', 'trump-corruption');

-- Rollback: takes out only this file's three edits (later Fronts tab edits elsewhere in a definition
-- stay), then drops the backup rows. Paste as one block; each UPDATE should report 1 row:
-- BEGIN;
-- UPDATE public.events SET agent_definition = replace(agent_definition, $n$**Abortion pill (Josh, October 24, 2026):** a mifepristone or abortion-pill story belongs when the FDA, HHS or Kennedy acts on the pill (the safety review, a label or prescribing-rule change such as ending telehealth or mail prescriptions, a generic approval, an order to the agencies), or when a court or Congress acts on one of those agency decisions. Decline lawsuits over state bans and mail access when no FDA or HHS decision is the subject, and abortion stories that are not about the pill. The keyword sweep never files these stories, so each one is your call.$n$, $o$**Pending Josh (do not decide):** whether the abortion pill (mifepristone) belongs on this front at all. Until he decides, decline every mifepristone or abortion-pill story with `uncertain: true` and a rationale that starts with `borderline rfk-hhs: abortion pill pending`.$o$) WHERE slug = 'rfk-hhs';
-- UPDATE public.events SET agent_definition = replace(agent_definition, $n$, the Quantico "warrior ethos" gathering of generals and admirals)$n$, ')') WHERE slug = 'hegseth-pentagon';
-- UPDATE public.events SET agent_definition = replace(agent_definition, $n$ Income the family's crypto ventures (World Liberty Financial, the memecoin, their stablecoin and token deals) bring in while Trump is in office counts on its own, even when no official act is named.$n$, '') WHERE slug = 'trump-corruption';
-- DELETE FROM public.front_merge_backup_events WHERE merge_tag = 'ado-592-defs-1024';
-- COMMIT;
-- (front_merge_backup_events keeps each full definition as it was, for a by-hand compare.)
