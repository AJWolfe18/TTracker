# PROD merges, Codex round 3 fixes, PROD SQL (October 2, 2026, evening CT)

Picks up from `docs/handoffs/2026-10-01-autonomous-multi-card-session.md` (Late update 3). Cost: $0 (no AI calls beyond plan usage, no bulk reads).

## What shipped
- **TEST pre-steps:** migration 120 re-run on TEST (self-test passed, verify 0). TEST Tracker click-through for #159: All with only Pardons on shows 25 pardons (was empty); the catch-up marker shows after Stories off / Load earlier x2 / Stories on, and clears after two more loads.
- **Codex round 3 (Josh's local review), 2 P1s fixed** in test PR #169 and pushed onto the main PR branches file for file:
  - #165: the four dash helpers (`strip_dashes_plain`, both `strip_dashes`, `strip_dashes_json_walk`) kept Postgres's PUBLIC execute grant, so anon could call them via `/rpc`. Now revoked from PUBLIC/anon/authenticated, granted to service_role, plus a privilege check DO block. Proven on TEST: anon 200 before, 42501 after; service_role still works.
  - #161: `postDiscord` had no timeout. Now aborts after 10s with a ref'd timer cleared in `finally` (AbortSignal.timeout's timer is unref'd, so the abort never fired in the test; a hung fetch in a quiet process would just exit). New hang test in `qa:alerts`.
  - Review: `/code-review medium`, clean (one comment-wording note, fixed). PGlite run of the full migration with Supabase-like roles: all pass.
- **All 5 main PRs merged** by Claude on Josh's explicit "merge": #162, #159, #161, #165, then `admin-undo` deployed to PROD (`npx supabase functions deploy admin-undo --project-ref osjbulmltfpcoldydexg`), then #166.
- **PROD SQL (Josh pasted, all passed):**
  1. Migration 120: verify 0/0/0/0.
  2. Migration 118: anon f, authenticated f, service_role t.
  3. Migration 119: both columns NOT NULL.
  4. SCOTUS 2099/2399 reset: both pending, public. **Runbook cutoff corrected first** (0ff7807): 2399 was enriched September 2 16:04 UTC under the old prompt, so the September 2 cutoff would have skipped it. Cutoff is now the #165 merge (2026-10-03 01:54:33 UTC).
  5. 26A124 (case 2392): Sotomayor, Kagan, Jackson; 6-3; level 4.
  6. ADO-493 delete: STEP 1 read 1212/0/8, not 1220. The card's 1,220 was the import total including the 8 public cases kept; a GROUP BY confirmed 1212 flagged + 8 enriched public. Runbook updated to expect 1212, delete ran, STEP 3 = 0 left, 8 kept.
- **ADO:** Closed 493, 577, 349, 590, 353. 593 Resolved. Comments with what is owed on 525, 580, 494, 262, 315, 569.

## Routines (checked after the merges)
All 6 PROD claude.ai routines enabled and firing on schedule; all GitHub PROD workflows green for 2+ days. The 02:44 UTC Stories run used the merged main and every write passed the new dash trigger. **SCOTUS and EO routines run weekdays only (16:00 UTC)**, so 2099/2399 re-enrich Monday October 5, 11 AM CT; then `/scotus-review 2099,2399` closes 580 AC 2.

## Owed (Josh)
- PROD admin Undo on a story, a pardon and a SCOTUS case + security advisor check -> close 525.
- trumpytracker.com Tracker, All, only Pardons -> close 593.
- #162 checks (GA4 Realtime query_length, PostHog, Lighthouse, EO labels) -> 262, 315, 569.
- First scheduled PROD RSS and SCOTUS runs green with no Node 20 warnings -> 494 (AC 4 date missed, Josh's call).
- ADO-585 DB size: Josh is weighing pruning coverage stories once ADO-594 labels exist.

## Next session (Josh asked for this first, before 594 S1)
Two Stories-agent quality bugs from that 02:44 UTC run. Paste:

```
/start-work Two Stories-agent quality bugs found in the PROD Stories run on October 3, 2026 at 02:44 UTC (routine trig_0182WcUVyjF7Q5o2GWJMxbo1, session cse_01BCXvtAF2SD5KuxMwDir7ow, run id stories-2026-10-03T02-45-12.322Z). Read its log with RemoteTrigger get_run_log, not the claude.ai page.

BUG 1 - wrong copy live on PROD:
- 16294 (new ICE guidance on car chases/traffic stops): summary_spicy says the memo "loosened up" traffic stops; the memo TIGHTENS them. Factual error.
- 16287 (Big Bend border wall): top_entities has ORG-DHS, which the source never mentions.
- 16291 (Talarico/Paxton Texas Senate ads): neutral summary adds names/parties not in the source; spicy adds an unsourced line about the Senate majority.
The agent flagged these itself but could not fix them (one PATCH per story rule). Correct them on PROD the way admin edits stories (keep the review-flag and dash-guard triggers in mind), then check why the agent wrote past its source and whether the prompt (docs/features/stories-claude-agent/prompt-v1.md) needs a "thin source = say less" rule.

BUG 2 - thin sources: 13 of the 17 stories in that run got needs_manual_review=true because the DB only had a 1-2 sentence blurb (NYT Politics, PBS NewsHour, WaPo Politics). Find out:
- How much article text we store per feed (length(content) / length(excerpt) by feed over the last 30 days - SQL aggregates only, NEVER select content itself; egress rule).
- Whether this is new (a regression) or always true for these feeds, and what share of PROD stories are thin-source.
- The cause (feed only publishes blurbs vs our fetch or compliance truncation, see feed_compliance_rules 5K limit) and the options, with cost. One recommendation.

Context: DB size is over the Supabase free quota (ADO-585); do not propose storing more full text without stating the size impact. I'm weighing pruning coverage stories once ADO-594 labels exist - note if the findings bear on that.
Create one ADO Bug for these (ask me first if you think it should be two). Work on test; PROD data edits only with my OK.
```

Then ADO-594 S1 (PRD `docs/features/events-tracker/prd.md` section 14.10), then ADO-592 (still parked on Josh's pattern + Hegseth title/tier calls).

## Gotchas learned
- Supabase gives anon/authenticated EXECUTE on every new public function: revoke on every helper a migration adds (now in memory).
- The claude.ai Supabase MCP has no permission on PROD; PROD SQL stays clipboard + Josh paste. Josh copying a result table overwrites the SQL on the clipboard: re-copy before each step.
- Supabase SQL Editor shows only the last statement's result and often hides RAISE NOTICE output; verify with a read-only check query instead.
