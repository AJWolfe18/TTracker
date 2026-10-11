# October 10, 2026: PROD queue clean-up (ADO-616, ADO-601, new ADO-624)

## Why
Josh: "review all the queues in prod, we have had multiple alerts, stale notices, or blocks and we need to correct all of them."

## What the audit found
- **All six PROD Claude routines were healthy** (Election front, Judge, Stories, Pardons, EO, SCOTUS): every slot fired, no classifier denials, no 10-second deaths. Judge executor merging normally (GitHub cron lag only).
- **The Discord nags came from two sources:**
  1. Review flags holding 78 items off the site (ADO-616): 27 pardons (v1.1/v1.2 flagged thin research, every level 0, judgment calls), 49 pre-agent SCOTUS rows never in the agent queue, 2 EOs hidden by the old EO flag trigger.
  2. Five silent feeds (ADO-601). CSM and Newsweek were fine but quarantined: `selectFeeds()` skips `failure_count >= 5` forever, with no retry. Time's politics feed now returns HTML. Politico Picks has been behind a Cloudflare 403 since July 20. Reason's tag feed froze August 19 (304 on every run). Time and Politico Top were also quarantined.

## What shipped
- **PR #175 (merged, squash 00f796a on main):** migration 128 file, EO admin and the two EO edge functions (deployed to PROD), EO prompt (level 0 no auto-flag), pardons prompt v1.3 + level-table row fix, ingest alert names stopped feeds (`QUARANTINE_FAILURES`, listed once, not also as silent).
- **Run on PROD by Josh:**
  - `scripts/maintenance/2026-10-10-ado-601-silent-feeds.sql`: CSM + Newsweek reset. Time moved to `time.com/feed/` (allow-list guard). Politico Top moved to `rss.politico.com/congress.xml`. Reason moved to `reason.com/latest/feed/` with `disallowedUrlIncludes` `/volokh/ /podcast/ /video/`. Result: all 5 at failure_count 0.
  - Migration 128 + `scripts/maintenance/2026-10-06-held-back-rows.sql` (one transaction). Result: scotus pending 49, eo hidden_flagged 0, pardons still flagged 0.
- **On test only:** 4ea9650, 13c6c20, 22f8970 (the SQL files are test-only per `.claude/test-only-paths.md`).

## Feed choice (Josh asked "are they similar?")
Each candidate was run through the real `scoreGovRelevance` and compared with the old feed's PROD titles. The first picks were wrong: politics-news.xml is campaign-only, and Reason's politics category feed was 26 of 48 Volokh law-blog posts. Congress.xml and Reason latest (minus Volokh) are the closest matches. Time's site-wide feed relies on its allow-list filter (8 of 25 kept, all political).

## Reviews and tests
- /code-review medium on the October 10 commits: 10 findings, all fixed in 13c6c20 (pardon step in its own block, v1.3 log guard, wider selector, Time allow-list guard, no double listing, JSDoc, named threshold).
- Codex on PR #175: no findings.
- Both SQL files PGlite-tested: first run, re-run no-op, guard failures roll back everything (note: the SQL Editor runs the whole file as one transaction, so separate DO blocks do NOT isolate steps).
- `npm run qa:smoke` green on test and on the deploy branch.
- Gap: 22f8970 (feed URL swap in a test-only SQL file) had no code review beyond a PGlite test.

## Left for next session
1. Check the first v1.3 pardons batch: run session `cse_01MCK9TiAg3wqpMBjmYS1d22` (fired 02:40 UTC October 11). Does it publish, and does it flag only checkable doubts? Then fire the remaining batches (27 total, 5 per run; trigger `trig_018LUznaUWwijFhMZLp8kYE2`).
2. SCOTUS batch `cse_013woUL8CbCEb6ayDxzpv5VE`: 49 rows at 20 per run, so 2 more runs (`trig_019eD3JTVeSajL4qTJJSC6tq`, or the weekday 16:00 UTC schedule).
3. Feeds: grep the next `RSS Tracker - PROD` run for feed ids 1, 2, 4, 8, 9, then `gh workflow run "RSS Pipeline Health Check" --ref main` and expect `quarantined=[]` with none of the 5 silent. Then ADO-601 AC 3 → Resolved.
4. Josh: admin → Mark reviewed on EOs 14426 and 14433 (stops the daily EO Discord post).
5. Verify the ADO-616 AC bullet by bullet, then Close. Migration 128 on TEST: confirm with Josh that it ran.
6. ADO-624: stopped-routine alert for SCOTUS/EO/Pardons/Election front.

## Findings not fixed (each has a card)
- **ADO-625:** stopped feeds should retry once a day (a failed fetch should stamp a time so `selectFeeds` can retry).
- **ADO-626:** the pardons agent logs `agent_model: claude-opus-4-6` while the routine runs `claude-opus-5-5`, because the prompt hardcodes the string. Cosmetic; check the SCOTUS/EO prompts too.
- **ADO-624:** stopped-routine alert for SCOTUS/EO/Pardons/Election front (Josh: next session).
