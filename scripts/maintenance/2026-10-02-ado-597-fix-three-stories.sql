-- ADO-597 Bug 1: correct 3 PROD stories the Stories agent got wrong (run stories-2026-10-03T02-45-12.322Z).
-- Run on PROD in the Supabase SQL Editor, ONLY with Josh's OK. One DO block: all-or-nothing.
--
--   16294  summary_spicy said the memo "loosened-up traffic stops"; the memo TIGHTENS them.
--   16291  summary_neutral added first names + party labels not in the one-sentence WaPo blurb;
--          summary_spicy added an unsourced line about the Senate majority.
--   16287  top_entities / entity_counter carried ORG-DHS; the Guardian source never mentions DHS.
--
-- Same path as an admin edit (admin-update-story): UPDATE stories, then one admin.content_history
-- row per changed text field (the audit trail). clock_timestamp() keeps the history rows in a stable
-- order inside one transaction (now() would give them all the same time).
-- Undo limit: admin Undo always reverts the NEWEST history row and logs the undo as a new row, so a
-- second Undo re-applies the first. That means Undo restores 16294 summary_spicy and 16291
-- summary_spicy only; the old 16291 summary_neutral is kept in admin.content_history.old_value and
-- would need a manual UPDATE to bring back. (Same as an admin edit that saves two fields.)
-- top_entities / entity_counter get NO history row on purpose: undo_content_change writes the old
-- value back as text, which a text[] / jsonb column rejects, so a history row would only break Undo.
--   Triggers that fire: story_review_flag_trigger (can only SET needs_review; every new summary
--   is over 50 chars, so it stays false), strip_editorial_dashes (no em or en dashes in the new
--   copy, so no rewrite), trg_stories_search (search_vector refresh). The new copy has no apostrophes.
--
-- Guards: each story must still hold the bad text (so a later agent rewrite or a manual fix is
-- never clobbered) and each UPDATE must hit exactly 1 row, else the whole block raises and rolls back.

DO $$
DECLARE
  v_rows int;
  v_old_spicy text;
  v_old_neutral text;
  v_new_16294_spicy text := 'ICE has finally written rules that ban high-speed car chases and tighten its traffic stops, after agents fired their guns in more than a dozen vehicle encounters since last year. At least four people are dead and several more wounded. The memo reads like a response to a body count, and the policy only arrived once the shootings piled up.';
  v_new_16291_neutral text := 'Talarico and Paxton, the two contenders in a heated Texas Senate race, have launched dueling ads. Both spots are intended to address perceived vulnerabilities.';
  v_new_16291_spicy text := 'Talarico and Paxton are trading ads in a heated Texas Senate race, each one aimed at patching a weak spot. Standard campaign season, with the usual spin on both sides.';
BEGIN
  -- 16294: spicy summary
  v_old_spicy := (SELECT summary_spicy FROM public.stories WHERE id = 16294);
  IF v_old_spicy IS NULL OR position('loosened-up traffic stops' IN v_old_spicy) = 0 THEN
    RAISE EXCEPTION '16294: bad text not found (already fixed or rewritten). Nothing changed.';
  END IF;
  UPDATE public.stories SET summary_spicy = v_new_16294_spicy WHERE id = 16294;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '16294: expected 1 row, got %', v_rows; END IF;
  INSERT INTO admin.content_history (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, change_source)
  VALUES ('story', '16294', 'summary_spicy', v_old_spicy, v_new_16294_spicy, 'admin', clock_timestamp(), 'admin');

  -- 16291: neutral + spicy summaries
  v_old_neutral := (SELECT summary_neutral FROM public.stories WHERE id = 16291);
  v_old_spicy   := (SELECT summary_spicy   FROM public.stories WHERE id = 16291);
  IF v_old_neutral IS NULL OR position('Democrat James Talarico' IN v_old_neutral) = 0
     OR v_old_spicy IS NULL OR position('Senate majority' IN v_old_spicy) = 0 THEN
    RAISE EXCEPTION '16291: bad text not found (already fixed or rewritten). Nothing changed.';
  END IF;
  UPDATE public.stories
     SET summary_neutral = v_new_16291_neutral,
         summary_spicy   = v_new_16291_spicy
   WHERE id = 16291;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '16291: expected 1 row, got %', v_rows; END IF;
  INSERT INTO admin.content_history (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, change_source)
  VALUES ('story', '16291', 'summary_neutral', v_old_neutral, v_new_16291_neutral, 'admin', clock_timestamp(), 'admin');
  INSERT INTO admin.content_history (entity_type, entity_id, field_name, old_value, new_value, changed_by, changed_at, change_source)
  VALUES ('story', '16291', 'summary_spicy', v_old_spicy, v_new_16291_spicy, 'admin', clock_timestamp(), 'admin');

  -- 16287: drop ORG-DHS from top_entities and entity_counter (order of the rest kept)
  UPDATE public.stories
     SET top_entities   = array_remove(top_entities, 'ORG-DHS'),
         entity_counter = entity_counter - 'ORG-DHS'
   WHERE id = 16287
     AND top_entities @> ARRAY['ORG-DHS'];
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION '16287: expected 1 row with ORG-DHS, got % (already fixed?)', v_rows; END IF;

  RAISE NOTICE 'ADO-597: 16294, 16291, 16287 corrected.';
END
$$;

-- Verify (read-only): expect no 'loosened', no 'Democrat James', no 'majority', no ORG-DHS.
SELECT id,
       position('loosened' IN summary_spicy) > 0                       AS still_loosened,
       position('Democrat James' IN summary_neutral) > 0               AS still_party_names,
       position('majority' IN summary_spicy) > 0                       AS still_majority,
       top_entities, entity_counter, needs_review
  FROM public.stories
 WHERE id IN (16287, 16291, 16294)
 ORDER BY id;
