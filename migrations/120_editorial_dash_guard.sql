-- Migration: 120_editorial_dash_guard.sql
-- ADO-580 AC 1: no em or en dash in any editorial column of stories, scotus_cases,
-- executive_orders, pardons. Prompt rules (tone-system.json bannedPatterns) did not hold:
-- 8 of 13 SCOTUS outputs on September 1, 2026 carried em dashes. This is the mechanical guard.
--
-- Rule (public.strip_dashes):
--   em dash, with or without spaces around it  -> ' - '   ("X—Y", "X — Y" -> "X - Y")
--   en dash between two digits                  -> '-'     ("6–3" -> "6-3", "2019–2020" -> "2019-2020")
--   any other en dash                           -> ' - '
--   Only spaces and tabs next to the dash are absorbed; line breaks are kept.
--   ' - ' is the form the compliant agent outputs already use.
-- Verbatim quote fields (scotus_cases.evidence_quotes / evidence_anchors) are NOT touched:
-- they must match the source text.
--
-- Parts: A) the function, B) one BEFORE INSERT OR UPDATE OF <editorial columns> trigger per
-- table, C) a one-time rewrite of existing rows (only rows that contain a dash).
-- Side effects of C: updated_at moves on the rewritten pardons / scotus_cases /
-- executive_orders rows (their updated_at triggers); the stories review-flag trigger re-runs
-- on the rewritten stories. Nothing is published or unpublished.
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and C only matches rows with a dash.

-- A) The rewrite, for text and for jsonb (receipts_timeline, action_section)
CREATE OR REPLACE FUNCTION public.strip_dashes(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p IS NULL OR p !~ '[—–]' THEN p
    ELSE regexp_replace(
           regexp_replace(
             regexp_replace(p, '[ \t]*—[ \t]*', ' - ', 'g'),
             '([0-9])[ \t]*–[ \t]*([0-9])', '\1-\2', 'g'),
           '[ \t]*–[ \t]*', ' - ', 'g')
  END
$$;

-- jsonb: rewrite the text form. The dashes only ever sit inside string values, so the JSON
-- structure is untouched.
CREATE OR REPLACE FUNCTION public.strip_dashes(p jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p IS NULL OR p::text !~ '[—–]' THEN p
    ELSE public.strip_dashes(p::text)::jsonb
  END
$$;

-- B) Triggers
CREATE OR REPLACE FUNCTION public.stories_strip_dashes()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.summary_neutral := public.strip_dashes(NEW.summary_neutral);
  NEW.summary_spicy   := public.strip_dashes(NEW.summary_spicy);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.scotus_cases_strip_dashes()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.summary_spicy      := public.strip_dashes(NEW.summary_spicy);
  NEW.why_it_matters     := public.strip_dashes(NEW.why_it_matters);
  NEW.who_wins           := public.strip_dashes(NEW.who_wins);
  NEW.who_loses          := public.strip_dashes(NEW.who_loses);
  NEW.holding            := public.strip_dashes(NEW.holding);
  NEW.dissent_highlights := public.strip_dashes(NEW.dissent_highlights);
  NEW.practical_effect   := public.strip_dashes(NEW.practical_effect);
  NEW.media_says         := public.strip_dashes(NEW.media_says);
  NEW.actually_means     := public.strip_dashes(NEW.actually_means);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.executive_orders_strip_dashes()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.summary                := public.strip_dashes(NEW.summary);
  NEW.section_what_they_say  := public.strip_dashes(NEW.section_what_they_say);
  NEW.section_what_it_means  := public.strip_dashes(NEW.section_what_it_means);
  NEW.section_reality_check  := public.strip_dashes(NEW.section_reality_check);
  NEW.section_why_it_matters := public.strip_dashes(NEW.section_why_it_matters);
  NEW.action_reasoning       := public.strip_dashes(NEW.action_reasoning);
  NEW.action_section         := public.strip_dashes(NEW.action_section);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.pardons_strip_dashes()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  NEW.crime_description       := public.strip_dashes(NEW.crime_description);
  NEW.corruption_reasoning    := public.strip_dashes(NEW.corruption_reasoning);
  NEW.trump_connection_detail := public.strip_dashes(NEW.trump_connection_detail);
  NEW.summary_neutral         := public.strip_dashes(NEW.summary_neutral);
  NEW.summary_spicy           := public.strip_dashes(NEW.summary_spicy);
  NEW.why_it_matters          := public.strip_dashes(NEW.why_it_matters);
  NEW.pattern_analysis        := public.strip_dashes(NEW.pattern_analysis);
  NEW.post_pardon_notes       := public.strip_dashes(NEW.post_pardon_notes);
  NEW.receipts_timeline       := public.strip_dashes(NEW.receipts_timeline);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS strip_editorial_dashes ON public.stories;
CREATE TRIGGER strip_editorial_dashes
  BEFORE INSERT OR UPDATE OF summary_neutral, summary_spicy ON public.stories
  FOR EACH ROW EXECUTE FUNCTION public.stories_strip_dashes();

DROP TRIGGER IF EXISTS strip_editorial_dashes ON public.scotus_cases;
CREATE TRIGGER strip_editorial_dashes
  BEFORE INSERT OR UPDATE OF summary_spicy, why_it_matters, who_wins, who_loses, holding,
    dissent_highlights, practical_effect, media_says, actually_means ON public.scotus_cases
  FOR EACH ROW EXECUTE FUNCTION public.scotus_cases_strip_dashes();

DROP TRIGGER IF EXISTS strip_editorial_dashes ON public.executive_orders;
CREATE TRIGGER strip_editorial_dashes
  BEFORE INSERT OR UPDATE OF summary, section_what_they_say, section_what_it_means,
    section_reality_check, section_why_it_matters, action_reasoning, action_section
  ON public.executive_orders
  FOR EACH ROW EXECUTE FUNCTION public.executive_orders_strip_dashes();

DROP TRIGGER IF EXISTS strip_editorial_dashes ON public.pardons;
CREATE TRIGGER strip_editorial_dashes
  BEFORE INSERT OR UPDATE OF crime_description, corruption_reasoning, trump_connection_detail,
    summary_neutral, summary_spicy, why_it_matters, pattern_analysis, post_pardon_notes,
    receipts_timeline ON public.pardons
  FOR EACH ROW EXECUTE FUNCTION public.pardons_strip_dashes();

-- The trigger functions are internal: nobody calls them directly.
REVOKE EXECUTE ON FUNCTION public.stories_strip_dashes(), public.scotus_cases_strip_dashes(),
  public.executive_orders_strip_dashes(), public.pardons_strip_dashes() FROM PUBLIC, anon, authenticated;

-- C) One-time rewrite of existing rows. Setting a column to itself fires the trigger above,
-- which does the rewrite; the WHERE keeps it to rows that contain a dash.
UPDATE public.stories SET summary_neutral = summary_neutral
 WHERE summary_neutral ~ '[—–]' OR summary_spicy ~ '[—–]';

UPDATE public.scotus_cases SET summary_spicy = summary_spicy
 WHERE concat_ws(' ', summary_spicy, why_it_matters, who_wins, who_loses, holding,
                 dissent_highlights, practical_effect, media_says, actually_means) ~ '[—–]';

UPDATE public.executive_orders SET summary = summary
 WHERE concat_ws(' ', summary, section_what_they_say, section_what_it_means, section_reality_check,
                 section_why_it_matters, action_reasoning, action_section::text) ~ '[—–]';

UPDATE public.pardons SET summary_spicy = summary_spicy
 WHERE concat_ws(' ', crime_description, corruption_reasoning, trump_connection_detail,
                 summary_neutral, summary_spicy, why_it_matters, pattern_analysis,
                 post_pardon_notes, receipts_timeline::text) ~ '[—–]';

-- VERIFY (read-only): every count must be 0.
SELECT 'stories' AS t, count(*) FROM public.stories
 WHERE summary_neutral ~ '[—–]' OR summary_spicy ~ '[—–]'
UNION ALL
SELECT 'scotus_cases', count(*) FROM public.scotus_cases
 WHERE concat_ws(' ', summary_spicy, why_it_matters, who_wins, who_loses, holding,
                 dissent_highlights, practical_effect, media_says, actually_means) ~ '[—–]'
UNION ALL
SELECT 'executive_orders', count(*) FROM public.executive_orders
 WHERE concat_ws(' ', summary, section_what_they_say, section_what_it_means, section_reality_check,
                 section_why_it_matters, action_reasoning, action_section::text) ~ '[—–]'
UNION ALL
SELECT 'pardons', count(*) FROM public.pardons
 WHERE concat_ws(' ', crime_description, corruption_reasoning, trump_connection_detail,
                 summary_neutral, summary_spicy, why_it_matters, pattern_analysis,
                 post_pardon_notes, receipts_timeline::text) ~ '[—–]';
