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
--   URLs are never rewritten (see A): URLs inside text, and jsonb strings under a
--   url / href / link key. A dash touching a URL from outside is still rewritten.
-- Verbatim quote fields (scotus_cases.evidence_quotes / evidence_anchors) are NOT touched:
-- they must match the source text.
-- October 1, 2026 (reviews): added scotus_cases.ruling_label and substantive_winner, URLs are
-- kept, and the digit rule handles chains ("4–1–4"). TEST ran the first version on
-- September 25, 2026; re-run this whole file there (safe, see Idempotent below).
--
-- Parts: A) the function, B) one BEFORE INSERT OR UPDATE OF <editorial columns> trigger per
-- table, C) a one-time rewrite of existing rows (only rows the guard would change).
-- Side effects of C: updated_at moves on the rewritten pardons / scotus_cases /
-- executive_orders rows (their updated_at triggers); the stories review-flag trigger re-runs
-- on the rewritten stories. Nothing is published or unpublished.
-- Idempotent: CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and C only matches rows the guard
-- would change (none on a second run).

-- A) The rewrite, for text and for jsonb (receipts_timeline, action_section)
-- strip_dashes_plain: the rule on a piece of text that holds no URL. The digit rule uses a
-- lookahead so the right digit stays available for the next match ("4–1–4" -> "4-1-4").
CREATE OR REPLACE FUNCTION public.strip_dashes_plain(p text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p IS NULL OR p !~ '[—–]' THEN p
    ELSE regexp_replace(
           regexp_replace(
             regexp_replace(p, '[ \t]*—[ \t]*', ' - ', 'g'),
             '([0-9])[ \t]*–[ \t]*(?=[0-9])', '\1-', 'g'),
           '[ \t]*–[ \t]*', ' - ', 'g')
  END
$$;

-- strip_dashes(text): the rule everywhere except inside URLs. A URL may legitimately contain
-- an en dash (a slug like /c–d), and rewriting it would break the link for good; the prose
-- around it is still cleaned. A URL here:
--   starts with a scheme ("https://", "http://", ...) at the start of the text or right after
--   any character that cannot be part of a scheme: whitespace, ( [ " ' < : = a dash, ...
--   ("Source:https://x.gov/c–d" and "<https://x.gov/c–d>" are kept; Codex P1 on PR #165).
--   A scheme glued to a word ("xhttps://") is read from the start of that word, never
--   from its middle;
--   stops before whitespace, ) ] " ' < > , and any em dash; an en dash stays in the URL only
--   when more URL follows it ("/c–d"), so "x.gov/b– more" still loses its dash.
-- So "(https://x.gov/a)—which" -> "(https://x.gov/a) - which",
-- "here—https://x.gov/b" -> "here - https://x.gov/b", and "https://x.gov/c–d" is kept.
-- Mechanics: mark each URL with two private-use characters, split on them, clean the odd
-- (non-URL) pieces. Text that already holds those characters is cleaned whole (never seen
-- in editorial copy).
CREATE OR REPLACE FUNCTION public.strip_dashes(p text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_open  constant text := chr(57344);  -- U+E000
  c_close constant text := chr(57345);  -- U+E001
  c_url   constant text := '[^][:space:])"''<>,—–]';
  v_parts text[];
  v_out text := '';
BEGIN
  IF p IS NULL OR p !~ '[—–]' THEN
    RETURN p;
  END IF;
  IF strpos(p, '://') = 0 OR strpos(p, c_open) > 0 OR strpos(p, c_close) > 0 THEN
    RETURN public.strip_dashes_plain(p);
  END IF;

  v_parts := regexp_split_to_array(
    regexp_replace(p,
      '(^|[^A-Za-z0-9+.-])([A-Za-z][A-Za-z0-9+.-]*://(?:' || c_url || '|–(?=' || c_url || '))+)',
      '\1' || c_open || '\2' || c_close, 'g'),
    '[' || c_open || c_close || ']');

  -- Pieces alternate: text, URL, text, URL, ..., text
  FOR i IN 1 .. coalesce(array_length(v_parts, 1), 0) LOOP
    IF i % 2 = 1 THEN
      v_out := v_out || public.strip_dashes_plain(v_parts[i]);
    ELSE
      v_out := v_out || v_parts[i];
    END IF;
  END LOOP;

  RETURN v_out;
END
$$;

-- jsonb: walk the document and rewrite strings with strip_dashes(text), so URLs inside prose
-- (or a string that is just a URL) are kept as above. Keys, numbers and the structure
-- are untouched. A string under a key that is or ends with url / href / link (plural too:
-- source_urls, links) is skipped entirely. Array elements inherit the key of their array.
CREATE OR REPLACE FUNCTION public.strip_dashes_json_walk(p jsonb, p_key text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_out jsonb;
BEGIN
  IF p IS NULL OR p::text !~ '[—–]' THEN
    RETURN p;
  END IF;

  CASE jsonb_typeof(p)
    WHEN 'object' THEN
      v_out := (SELECT coalesce(jsonb_object_agg(e.key, public.strip_dashes_json_walk(e.value, e.key)), '{}'::jsonb)
                  FROM jsonb_each(p) AS e);
      RETURN v_out;
    WHEN 'array' THEN
      v_out := (SELECT coalesce(jsonb_agg(public.strip_dashes_json_walk(a.value, p_key) ORDER BY a.ord), '[]'::jsonb)
                  FROM jsonb_array_elements(p) WITH ORDINALITY AS a(value, ord));
      RETURN v_out;
    WHEN 'string' THEN
      IF lower(coalesce(p_key, '')) ~ '(url|href|link)s?$' THEN
        RETURN p;
      END IF;
      RETURN to_jsonb(public.strip_dashes(p #>> '{}'));
    ELSE
      RETURN p;
  END CASE;
END
$$;

CREATE OR REPLACE FUNCTION public.strip_dashes(p jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT public.strip_dashes_json_walk(p, NULL)
$$;

-- A2) Self-test, before any trigger or rewrite: a wrong answer raises and the whole file rolls
-- back (the SQL Editor runs it as one transaction), so the backfill never runs on a bad rule.
DO $$
DECLARE
  r record;
  v_got text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('Source:https://x.gov/c–d',              'Source:https://x.gov/c–d'),
    ('<https://x.gov/c–d>',                   '<https://x.gov/c–d>'),
    ('See <https://x.gov/c–d>—then',          'See <https://x.gov/c–d> - then'),
    ('link=https://x.gov/c–d',                'link=https://x.gov/c–d'),
    ('https://x.gov/c–d',                     'https://x.gov/c–d'),
    ('(https://x.gov/a–b)—which',             '(https://x.gov/a–b) - which'),
    ('"https://x.gov/a–b"',                   '"https://x.gov/a–b"'),
    ('here—https://x.gov/b',                  'here - https://x.gov/b'),
    ('foo–https://x.gov/c–d',                 'foo - https://x.gov/c–d'),
    ('see https://x.gov/b– more',             'see https://x.gov/b - more'),
    ('see https://x.gov/b–c.',                'see https://x.gov/b–c.'),
    ('A — B, 6–3 and 4–1–4',                  'A - B, 6-3 and 4-1-4'),
    ('No URL: a–b',                           'No URL: a - b')
  ) AS t(input, expected) LOOP
    v_got := public.strip_dashes(r.input);
    IF v_got IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION 'strip_dashes self-test failed: % -> % (expected %)', r.input, v_got, r.expected;
    END IF;
  END LOOP;
  IF public.strip_dashes('{"source_url":"https://x.gov/c–d","note":"A—B, see:https://x.gov/e–f"}'::jsonb)
     IS DISTINCT FROM '{"source_url":"https://x.gov/c–d","note":"A - B, see:https://x.gov/e–f"}'::jsonb THEN
    RAISE EXCEPTION 'strip_dashes(jsonb) self-test failed';
  END IF;
END $$;

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
  NEW.ruling_label       := public.strip_dashes(NEW.ruling_label);
  NEW.substantive_winner := public.strip_dashes(NEW.substantive_winner);
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
    dissent_highlights, practical_effect, media_says, actually_means, ruling_label,
    substantive_winner ON public.scotus_cases
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
-- which does the rewrite. The WHERE keeps it to rows the guard would change: a dash somewhere
-- (cheap prefilter) AND strip_dashes() changes at least one column. A dash that only sits inside
-- a URL is therefore not counted and does not move updated_at.
UPDATE public.stories SET summary_neutral = summary_neutral
 WHERE (summary_neutral ~ '[—–]' OR summary_spicy ~ '[—–]')
   AND (public.strip_dashes(summary_neutral), public.strip_dashes(summary_spicy))
       IS DISTINCT FROM (summary_neutral, summary_spicy);

UPDATE public.scotus_cases SET summary_spicy = summary_spicy
 WHERE concat_ws(' ', summary_spicy, why_it_matters, who_wins, who_loses, holding,
                 dissent_highlights, practical_effect, media_says, actually_means,
                 ruling_label, substantive_winner) ~ '[—–]'
   AND (public.strip_dashes(summary_spicy), public.strip_dashes(why_it_matters),
        public.strip_dashes(who_wins), public.strip_dashes(who_loses), public.strip_dashes(holding),
        public.strip_dashes(dissent_highlights), public.strip_dashes(practical_effect),
        public.strip_dashes(media_says), public.strip_dashes(actually_means),
        public.strip_dashes(ruling_label), public.strip_dashes(substantive_winner))
       IS DISTINCT FROM (summary_spicy, why_it_matters, who_wins, who_loses, holding,
        dissent_highlights, practical_effect, media_says, actually_means,
        ruling_label, substantive_winner);

UPDATE public.executive_orders SET summary = summary
 WHERE concat_ws(' ', summary, section_what_they_say, section_what_it_means, section_reality_check,
                 section_why_it_matters, action_reasoning, action_section::text) ~ '[—–]'
   AND (public.strip_dashes(summary), public.strip_dashes(section_what_they_say),
        public.strip_dashes(section_what_it_means), public.strip_dashes(section_reality_check),
        public.strip_dashes(section_why_it_matters), public.strip_dashes(action_reasoning),
        public.strip_dashes(action_section))
       IS DISTINCT FROM (summary, section_what_they_say, section_what_it_means,
        section_reality_check, section_why_it_matters, action_reasoning, action_section);

UPDATE public.pardons SET summary_spicy = summary_spicy
 WHERE concat_ws(' ', crime_description, corruption_reasoning, trump_connection_detail,
                 summary_neutral, summary_spicy, why_it_matters, pattern_analysis,
                 post_pardon_notes, receipts_timeline::text) ~ '[—–]'
   AND (public.strip_dashes(crime_description), public.strip_dashes(corruption_reasoning),
        public.strip_dashes(trump_connection_detail), public.strip_dashes(summary_neutral),
        public.strip_dashes(summary_spicy), public.strip_dashes(why_it_matters),
        public.strip_dashes(pattern_analysis), public.strip_dashes(post_pardon_notes),
        public.strip_dashes(receipts_timeline))
       IS DISTINCT FROM (crime_description, corruption_reasoning, trump_connection_detail,
        summary_neutral, summary_spicy, why_it_matters, pattern_analysis, post_pardon_notes,
        receipts_timeline);

-- VERIFY (read-only): every count must be 0. Same test as C: rows the guard would still change.
SELECT 'stories' AS t, count(*) FROM public.stories
 WHERE (summary_neutral ~ '[—–]' OR summary_spicy ~ '[—–]')
   AND (public.strip_dashes(summary_neutral), public.strip_dashes(summary_spicy))
       IS DISTINCT FROM (summary_neutral, summary_spicy)
UNION ALL
SELECT 'scotus_cases', count(*) FROM public.scotus_cases
 WHERE concat_ws(' ', summary_spicy, why_it_matters, who_wins, who_loses, holding,
                 dissent_highlights, practical_effect, media_says, actually_means,
                 ruling_label, substantive_winner) ~ '[—–]'
   AND (public.strip_dashes(summary_spicy), public.strip_dashes(why_it_matters),
        public.strip_dashes(who_wins), public.strip_dashes(who_loses), public.strip_dashes(holding),
        public.strip_dashes(dissent_highlights), public.strip_dashes(practical_effect),
        public.strip_dashes(media_says), public.strip_dashes(actually_means),
        public.strip_dashes(ruling_label), public.strip_dashes(substantive_winner))
       IS DISTINCT FROM (summary_spicy, why_it_matters, who_wins, who_loses, holding,
        dissent_highlights, practical_effect, media_says, actually_means,
        ruling_label, substantive_winner)
UNION ALL
SELECT 'executive_orders', count(*) FROM public.executive_orders
 WHERE concat_ws(' ', summary, section_what_they_say, section_what_it_means, section_reality_check,
                 section_why_it_matters, action_reasoning, action_section::text) ~ '[—–]'
   AND (public.strip_dashes(summary), public.strip_dashes(section_what_they_say),
        public.strip_dashes(section_what_it_means), public.strip_dashes(section_reality_check),
        public.strip_dashes(section_why_it_matters), public.strip_dashes(action_reasoning),
        public.strip_dashes(action_section))
       IS DISTINCT FROM (summary, section_what_they_say, section_what_it_means,
        section_reality_check, section_why_it_matters, action_reasoning, action_section)
UNION ALL
SELECT 'pardons', count(*) FROM public.pardons
 WHERE concat_ws(' ', crime_description, corruption_reasoning, trump_connection_detail,
                 summary_neutral, summary_spicy, why_it_matters, pattern_analysis,
                 post_pardon_notes, receipts_timeline::text) ~ '[—–]'
   AND (public.strip_dashes(crime_description), public.strip_dashes(corruption_reasoning),
        public.strip_dashes(trump_connection_detail), public.strip_dashes(summary_neutral),
        public.strip_dashes(summary_spicy), public.strip_dashes(why_it_matters),
        public.strip_dashes(pattern_analysis), public.strip_dashes(post_pardon_notes),
        public.strip_dashes(receipts_timeline))
       IS DISTINCT FROM (crime_description, corruption_reasoning, trump_connection_detail,
        summary_neutral, summary_spicy, why_it_matters, pattern_analysis, post_pardon_notes,
        receipts_timeline);

-- ROLLBACK (only if the guard must come off; the rewrite in C is not reversible, the dashes
-- are gone). Order matters: the triggers and the jsonb overloads call strip_dashes(text),
-- which calls strip_dashes_plain.
-- DROP TRIGGER IF EXISTS strip_editorial_dashes ON public.stories;
-- DROP TRIGGER IF EXISTS strip_editorial_dashes ON public.scotus_cases;
-- DROP TRIGGER IF EXISTS strip_editorial_dashes ON public.executive_orders;
-- DROP TRIGGER IF EXISTS strip_editorial_dashes ON public.pardons;
-- DROP FUNCTION IF EXISTS public.stories_strip_dashes();
-- DROP FUNCTION IF EXISTS public.scotus_cases_strip_dashes();
-- DROP FUNCTION IF EXISTS public.executive_orders_strip_dashes();
-- DROP FUNCTION IF EXISTS public.pardons_strip_dashes();
-- DROP FUNCTION IF EXISTS public.strip_dashes(jsonb);
-- DROP FUNCTION IF EXISTS public.strip_dashes_json_walk(jsonb, text);
-- DROP FUNCTION IF EXISTS public.strip_dashes(text);
-- DROP FUNCTION IF EXISTS public.strip_dashes_plain(text);
