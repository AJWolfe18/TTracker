# November 25, 2026: PROD health sweep, homepage main line frozen, card close-out

## FIRST-UP for next session
1. **Homepage catch-up (Josh, PROD).** Did Josh run `scripts/maintenance/2026-11-25-prod-refresh-tracker-catchup.sql` on PROD? Expected one row, `rows_changed` about 2,700-3,000. Verify: anon `v_tracker_stories?main_line=is.true&order=first_seen_at.desc&limit=3` shows stories from after November 11, and the next PROD RSS run logs `refresh_tracker_derived rows_changed=... took_ms=...`, not `refresh-tracker: FAILED`. If 120 s still times out, something else is slowing PROD (DB over quota, bloat): investigate before retrying.
2. **Permanent fix (Codex first), pending Josh's yes, proposed as its own Bug card:** a migration giving `refresh_tracker_derived()` its own `statement_timeout` (for example `ALTER FUNCTION ... SET statement_timeout = '60s'`), and a Discord alert when `scripts/maintenance/refresh-tracker.js` fails (it is silent today). Findings logged on ADO-594.
3. **Health-check daily window gap, pending Josh's yes, proposed as its own card:** RSS Pipeline Health Check only runs `alert-ingest-health` and the Stories flag digest when GitHub starts it 12:00-17:59 UTC; GitHub has started it only around 07:00 and 20:00 UTC since November 7, so neither ran November 8-24. Proposed fix: the Netlify scheduled function dispatches the health check once a day (same pattern and token as `rss-prod-trigger`). Logged on ADO-602.
4. **Supabase Pro upgrade (ADO-585), by December 1-5.** Josh's click (Billing -> Change plan -> Pro, $25/month).
5. **Josh's PROD admin checks to close cards:** EO 14433 rating + mark reviewed (ADO-616), Fronts tab (547: note all 9 fronts have 0 updates written), Combine (60), Feeds tab at phone width (343), Dismiss + phone width (631), Undo + Security Advisor (525), GA4/PostHog + Lighthouse (569), SCOTUS triage word (495), two EO ratings (579, now Todo).
6. **ADO-524 recheck misses re-offenders on PROD:** 141 pardons checked since October 25, all quiet; William Goodman (PROD id 15) checked October 25 and missed, though TEST found him. Read the October 25 pardons run log.
7. **ADO-635 RSS ANN timeouts** still 6 per PROD run.

## What was done
- **PROD sweep (November 7-25):** 474 scheduled runs on main, 473 success (1 GitHub startup_failure November 11). RSS 14-17 runs a day. All six cloud routines fresh. Label backfill 418 -> 17,033 of 19,427. Manual health check run today (about 1:30 PM CT): feeds healthy, Stories digest slot empty, routines fresh.
- **Homepage frozen since November 11 (Josh spotted it):** `refresh_tracker_derived()` times out on every PROD RSS run since November 12. The ADO-594 label backfill changed the rule's input for thousands of old stories; ~2,760 flags pending (1,304 should be on, 1,458 coverage should be off), the single UPDATE exceeds the timeout, rolls back, and grows each run. `tracker_stats` (homepage counters, "0 at alarm 5") is frozen too. Ingestion, enrichment and labels are fine.
- **ADO-637 closed** (AC1-5 verified; AC3 14-17 runs/day for 18 days).
- **Card close-out sweep (17 cards):** closed 523, 626, 593, 624, 634, 580; moved 579 and 531 to Todo; 524, 343, 631, 495, 525, 569, 602, 616, 594, 592 stay open with AC comments naming what is left.
- **TEST cloud env:** `FRONTS_POOL_DAYS=all` set (Chrome, verified 3 variables). PROD deliberately NOT set: the prompt spec says `all` times out on PROD, and PROD's 30-day pool works.
- MCP announcement (November 24: Skills over MCP, Tasks, Elicitation, File Uploads): nothing to do for TrumpyTracker.
- Discord bot question: recommended against an auto-responding bot (cost + most alerts need Josh's judgment); fix the missing daily check instead.

## Gotchas
- `refresh-tracker` failure is non-fatal and silent; grep PROD RSS logs for `refresh-tracker: FAILED`.
- The claude.ai Supabase connector only sees the WhiskeyPal org; PROD reads go through anon PostgREST (`stories_enrichment_log` is not anon-readable: 42501).
- Cloud environment env vars: claude.ai/code -> environment picker -> hover the environment -> gear -> Environment variables.
- The TEST cloud environment holds the TEST service key that is still unrotated (see security notes in memory).

## Verification
- Run counts: `gh run list --branch main --created '>=2026-11-07'`.
- Refresh history: `gh run view <id> --log | grep -oE "refresh-tracker: [^\"]{0,90}|refresh_tracker_derived rows_changed=[0-9]+"`.
