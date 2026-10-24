-- Three front definition edits (October 24, 2026, ADO-592). Run on PROD in the SQL Editor (TEST already has them).
-- Same edits the Fronts tab would make; done as SQL so they land before the first PROD all-fronts
-- run (October 25, 9:00 AM CT): the agent never re-judges a story it has already declined.
--   1. RFK Jr.'s HHS: Josh decided the abortion pill (October 24, 2026). FDA/HHS actions on the pill
--      belong; court fights over state bans and mail access with no FDA/HHS decision at issue do not.
--      The sweep guard stays (keywords cannot tell an FDA action from a lawsuit), so the agent decides.
--   2. Hegseth's Pentagon: names the Quantico "warrior ethos" gathering (TEST spot check miss).
--   3. Trump Corruption: family crypto income while in office counts on its own (TEST spot check miss).
-- One guarded block: each UPDATE must change exactly 1 row (matched on slug AND on the old text still
-- being there), or the whole block rolls back and changes nothing. A second run raises on the first
-- statement and changes nothing.
--
-- Result: one row per front (first column: slug), each showing edited = true.

DO $$
DECLARE n int;
BEGIN
  UPDATE public.events
     SET agent_definition = replace(agent_definition,
       $o$**Pending Josh (do not decide):** whether the abortion pill (mifepristone) belongs on this front at all. Until he decides, decline every mifepristone or abortion-pill story with `uncertain: true` and a rationale that starts with `borderline rfk-hhs: abortion pill pending`.$o$,
       $n$**Abortion pill (Josh, October 24, 2026):** a mifepristone or abortion-pill story belongs when the FDA, HHS or Kennedy acts on the pill (the safety review, a label or prescribing-rule change such as ending telehealth or mail prescriptions, a generic approval, an order to the agencies), or when a court or Congress acts on one of those agency decisions. Decline lawsuits over state bans and mail access when no FDA or HHS decision is the subject, and abortion stories that are not about the pill. The keyword sweep never files these stories, so each one is your call.$n$)
   WHERE slug = 'rfk-hhs'
     AND position('borderline rfk-hhs: abortion pill pending' in agent_definition) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'rfk-hhs: expected 1 row with the pending-pill paragraph, got %. Nothing changed.', n; END IF;

  UPDATE public.events
     SET agent_definition = replace(agent_definition,
       $o$the rename to the Department of War, the culture rules)$o$,
       $n$the rename to the Department of War, the culture rules, the Quantico "warrior ethos" gathering of generals and admirals)$n$)
   WHERE slug = 'hegseth-pentagon'
     AND position('the rename to the Department of War, the culture rules)' in agent_definition) > 0;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'hegseth-pentagon: expected 1 row with the old culture-rules text, got %. Nothing changed.', n; END IF;

  UPDATE public.events
     SET agent_definition = replace(agent_definition,
       $o$or when the checks on all this are removed (inspectors general fired, ethics and anti-corruption units disbanded, FCPA enforcement paused).$o$,
       $n$or when the checks on all this are removed (inspectors general fired, ethics and anti-corruption units disbanded, FCPA enforcement paused). Income the family's crypto ventures (World Liberty Financial, the memecoin, their stablecoin and token deals) bring in while Trump is in office counts on its own, even when no official act is named.$n$)
   WHERE slug = 'trump-corruption'
     AND position('FCPA enforcement paused).' in agent_definition) > 0
     AND position('counts on its own, even when no official act is named' in agent_definition) = 0;
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'trump-corruption: expected 1 row with the old checks sentence, got %. Nothing changed.', n; END IF;
END $$;

SELECT slug,
       CASE slug
         WHEN 'rfk-hhs'          THEN position('Abortion pill (Josh, October 24, 2026)' in agent_definition) > 0
         WHEN 'hegseth-pentagon' THEN position('Quantico "warrior ethos"' in agent_definition) > 0
         WHEN 'trump-corruption' THEN position('counts on its own, even when no official act is named' in agent_definition) > 0
       END AS edited
  FROM public.events
 WHERE slug IN ('rfk-hhs', 'hegseth-pentagon', 'trump-corruption')
 ORDER BY slug;
