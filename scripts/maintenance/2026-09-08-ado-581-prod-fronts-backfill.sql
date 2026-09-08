-- ADO-581 session 1 - PROD runbook, run by hand in the PROD SQL Editor (osjbulmltfpcoldydexg).
-- RECORD ONLY. Never deployed by code. Order matters; each step is idempotent.
--
-- 0. Migration 115 FIRST: paste migrations/115_front_sweep_and_alarm_floor.sql and run it
--    (accept the "destructive operations" dialog - it is the DROP VIEW of the rule view,
--    recreated in the same statement batch). Expect "Success. No rows returned".
--
-- 1. Dry run - how many stories would the election rule pull in, by alarm level, and how
--    many of those are redistricting? Read this BEFORE step 2; if redistricting swamps the
--    main line, drop "|gerrymander|redistrict|congressional map|district map" from
--    events.sweep_pattern for election-suppression and re-check.
WITH e AS (SELECT sweep_pattern, sweep_coword FROM public.events WHERE slug = 'election-suppression'),
pool AS (
  SELECT s.id, s.primary_headline AS h, s.summary_neutral AS sm,
         COALESCE(s.alarm_level, CASE s.severity WHEN 'critical' THEN 5 WHEN 'severe' THEN 4 WHEN 'moderate' THEN 3 WHEN 'minor' THEN 2 END, 2) AS alarm_eff
    FROM public.stories s
   WHERE s.status = 'active' AND s.primary_headline IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.story_event se WHERE se.story_id = s.id)
)
SELECT p.alarm_eff,
       COUNT(*) AS would_assign,
       COUNT(*) FILTER (WHERE p.h ~* '(gerrymander|redistrict|congressional map|district map)') AS redistricting,
       COUNT(*) FILTER (WHERE p.sm IS NOT NULL) AS enriched
  FROM pool p, e
 WHERE p.h ~* e.sweep_coword
   AND (p.h ~* e.sweep_pattern OR (p.sm IS NOT NULL AND p.sm ~* e.sweep_pattern))
 GROUP BY p.alarm_eff ORDER BY p.alarm_eff DESC;

-- 2. Full backfill across ALL fronts (existing hand assignments survive: ON CONFLICT DO NOTHING).
SELECT * FROM public.assign_fronts_sweep(NULL);

-- 3. The three stories from the card, assigned by hand in case the regex missed any of them
--    (USPS whistleblower 14648 alarm 4, Texas polling-site cuts 14592 alarm 3, ICE at polling
--    places 14688 alarm 3). Confidence 1.0 = human call. No tracker_pin needed: the floor rule
--    puts alarm 3+ election members on the main line.
INSERT INTO public.story_event (story_id, event_id, assigned_by, confidence)
SELECT s.id, e.id, 'human', 1.0
  FROM public.stories s
  JOIN public.events e ON e.slug = 'election-suppression'
 WHERE s.id IN (14648, 14592, 14688)
ON CONFLICT (story_id) DO NOTHING;

-- 4. Apply the rule.
SELECT * FROM public.refresh_tracker_derived();

-- 5. Verify: every alarm 3+ election member is main_line = true, and the three ids are there.
SELECT s.id, s.primary_headline, s.alarm_level, s.main_line, se.assigned_by
  FROM public.stories s
  JOIN public.story_event se ON se.story_id = s.id
  JOIN public.events e ON e.id = se.event_id AND e.slug = 'election-suppression'
 WHERE s.status = 'active' AND s.summary_neutral IS NOT NULL
 ORDER BY s.first_seen_at DESC
 LIMIT 60;

SELECT COUNT(*) AS main_line_total FROM public.stories WHERE main_line IS TRUE;

-- 6. Sanity: the incremental window finds nothing new right after the backfill.
SELECT * FROM public.assign_fronts_sweep(NOW() - INTERVAL '48 hours');

-- ROLLBACK of the backfill only (keeps the schema): the sweep rows are the only
-- 'agent' assignments that exist before ADO-546 Wave 2 ships.
-- DELETE FROM public.story_event WHERE assigned_by = 'agent' AND assigned_at >= '2026-09-08';
-- SELECT * FROM public.refresh_tracker_derived();

-- ============================================================================
-- 7. Election-beat feeds (AC 4). Added on TEST September 8, 2026 as ids 197/198.
--    Brennan Center publishes no RSS feed (checked /rss, /rss.xml, /feed, homepage
--    <link> tags) - skipped. Democracy Docket's root /feed/ is an empty shell; the
--    news-alerts category feed carries the items. Votebeat is Atom (rss-parser is fine).
-- ============================================================================
INSERT INTO public.feed_registry (feed_url, feed_name, source_name, topics, tier, is_active) VALUES
  ('https://www.votebeat.org/arc/outboundfeeds/rss/', 'Votebeat', 'Votebeat', ARRAY['elections','voting','politics'], 2, true),
  ('https://www.democracydocket.com/news-alerts/feed/', 'Democracy Docket News Alerts', 'Democracy Docket', ARRAY['elections','voting','courts'], 2, true)
ON CONFLICT (feed_url) DO NOTHING;

INSERT INTO public.feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
SELECT f.id, 5000, false, f.source_name, 'ADO-581 election beat - 5K char excerpt cap matches article scraping limit'
  FROM public.feed_registry f
 WHERE f.feed_url IN ('https://www.votebeat.org/arc/outboundfeeds/rss/', 'https://www.democracydocket.com/news-alerts/feed/')
   AND NOT EXISTS (SELECT 1 FROM public.feed_compliance_rules r WHERE r.feed_id = f.id);
