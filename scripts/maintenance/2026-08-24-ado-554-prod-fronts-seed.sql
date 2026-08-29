-- ADO-554 / ADO-563 - PROD fronts seed, run by hand in the PROD SQL Editor on August 24, 2026.
-- RECORD ONLY. Already applied; never deployed by code. Kept so ADO-557 (fronts automation)
-- can reuse the sweep regexes and so the Election Suppression front's definition is in git.
--
-- Step 1: migration 112 (tracker_pin + v_tracker_stories) was applied first.
-- Step 2: 8 fronts, published. 7 mirror TEST (ids 7-13 there); election-suppression is new (Josh).
INSERT INTO public.events (slug, name, dek, alarm_level, tier, lifecycle, publish_state, published_at, started_at, created_by) VALUES
('epstein-files', 'The Epstein Files', 'The scandal the administration cannot close. Binders, emails, a forced congressional vote, and a signed release bill, with the White House fighting disclosure at every step.', 5, 'flagship', 'open', 'published', NOW(), '2025-09-24T14:16:02+00:00', 'human'),
('iran', 'Iran', 'A war ordered without a congressional vote, sold as victory, and still unresolved. Strikes, a shaky ceasefire, collapsing talks, and a Congress cut out of the loop.', 5, 'flagship', 'open', 'published', NOW(), '2026-04-09T16:00:00+00:00', 'human'),
('trump-crypto', 'Trump Crypto', 'The presidency as a token launch. Family coins, foreign investors, and regulators calling for inquiries into the deals of the people running the government.', 4, 'major', 'open', 'published', NOW(), '2025-09-24T15:51:57+00:00', 'human'),
('qatar-jet', 'The Qatar Jet', 'A foreign government gave the president a 747. He kept it, flew it, and taxpayers are paying for the retrofit.', 4, 'major', 'open', 'published', NOW(), '2026-07-01T16:18:45+00:00', 'human'),
('selling-the-white-house', 'Selling the White House', 'A private-money ballroom, donors kept incognito, and invitations that come with a fundraising ask. The people''s house, priced for access.', 4, 'major', 'open', 'published', NOW(), '2025-11-01T09:02:22+00:00', 'human'),
('the-courts', 'The Courts', 'The slow collision between this administration and the judiciary. Blocked orders, defied rulings, and judges warning out loud about a judicial crisis.', 4, 'major', 'open', 'published', NOW(), '2025-09-24T22:41:47+00:00', 'human'),
('kushners-deals', 'Kushner''s Deals', 'Sovereign wealth keeps landing with the son-in-law. Gulf money, withheld disclosures, and a family business that never stopped running.', 3, 'standard', 'open', 'published', NOW(), '2025-04-09T00:00:00+00:00', 'human'),
('election-suppression', 'Election Suppression', 'Fraud claims as the pretext. Voter-roll purges, attacks on mail-in ballots, threats to seize election machinery, and a push to decide who gets to vote before the next election is held.', 5, 'flagship', 'open', 'published', NOW(), '2025-03-25T00:00:00+00:00', 'human')
ON CONFLICT (slug) DO NOTHING;

-- Step 3: keyword sweep, one front per story (most specific front wins via pri).
-- Result on PROD: epstein 235, iran 1510, crypto 40, qatar 7, ballroom 120, courts 10, kushner 14, election ~67.
WITH pool AS (
  SELECT id, primary_headline AS h FROM public.stories WHERE status = 'active' AND primary_headline IS NOT NULL
), pick AS (
  SELECT id, 'qatar-jet' AS slug, 10 AS pri FROM pool WHERE h ~* 'qatar' AND h ~* '(jet|747|air force one|plane|boeing)'
  UNION ALL SELECT id, 'kushners-deals', 20 FROM pool WHERE h ~* 'kushner'
  UNION ALL SELECT id, 'trump-crypto', 30 FROM pool WHERE h ~* '(crypto|memecoin|meme coin|\$TRUMP|world liberty|stablecoin|bitcoin|binance)' AND h ~* '(trump|kushner|witkoff|white house|president)'
  UNION ALL SELECT id, 'selling-the-white-house', 40 FROM pool WHERE h ~* 'ballroom'
  UNION ALL SELECT id, 'election-suppression', 50 FROM pool WHERE h ~* '(voter roll|voter purge|purge(s|d)? (of )?voter|mail-in|mail ballot|absentee ballot|election fraud|voter fraud|rigged|SAVE Act|seiz(e|ing) (the |voting )?(election|machines)|take over (the )?election|nationaliz\w* (the )?election|election integrity|decertif|voting rights act|proof of citizenship|citizenship proof|voter id|voting machine|election takeover|cancel(ing|ed)? (the )?(midterm|election)|postpone (the )?(midterm|election)|suspend (the )?(midterm|election))' AND h ~* '(election|vote|voter|ballot|midterm)'
  UNION ALL SELECT id, 'epstein-files', 60 FROM pool WHERE h ~* 'epstein'
  UNION ALL SELECT id, 'the-courts', 70 FROM pool WHERE h ~* '(judge|court|judiciary|judicial)' AND h ~* '(def(y|ies|ied|iance)|contempt|ignor(e|es|ed|ing) (the )?(court|ruling|order)|constitutional crisis|impeach(ing)? (a |the )?judge|existential threat|attack(s|ed|ing)? (on )?(the )?(judge|judiciary|courts))'
  UNION ALL SELECT id, 'iran', 80 FROM pool WHERE h ~* '\miran(ian)?\M' AND h !~* 'iranian revolution'
), best AS (
  SELECT DISTINCT ON (id) id, slug FROM pick ORDER BY id, pri
)
INSERT INTO public.story_event (story_id, event_id, assigned_by, confidence)
SELECT b.id, e.id, 'human', 0.8 FROM best b JOIN public.events e ON e.slug = b.slug
ON CONFLICT (story_id) DO NOTHING;

-- ADO-570: the homepage reads the precomputed main line, so re-apply the rule
-- after any front/assignment change (requires migration 113).
SELECT * FROM public.refresh_tracker_derived();
