# Handoff: ADO-581 session 1 - fronts regex sweep every cycle + per-front main-line alarm floor (September 8, 2026)

Josh: "let's do your recommendation then tell me what you specifically need from me." The recommendation was session 1 = regex sweep + floor + pins (no-regret, $0), session 2 = a Claude fronts-assignment agent for the **election front only**. Session 1 is on TEST; PROD is blocked on Josh (see "What Josh must do").

## What shipped (commit 02aa28c on `test`)

### Migration 115 - `migrations/115_front_sweep_and_alarm_floor.sql` (applied on TEST via the SQL editor)
- **Sweep rules are data.** `events.sweep_pattern` (headline regex), `sweep_coword` (second headline regex, the precision anchor), `sweep_priority` (lower wins, one front per story), `sweep_summary` (also try the pattern on `summary_neutral`, but only for headlines that match the co-word). Seven fronts carry the August 24 seed regexes verbatim; Election Suppression is broadened (USPS, mail ballots, polling places, voter rolls, citizenship checks, certification, election officials, redistricting). Tuning = `UPDATE events`, no migration.
- **Rule v1.2:** `events.main_line_alarm_floor` (CHECK 1-5). `v_tracker_main_line_rule` gained one clause: a member with `alarm_eff >= floor` is on the main line. NULL floor = v1.1 unchanged. Election Suppression floor = 3.
- **`assign_fronts_sweep(p_since)`**: candidates = active stories with no `story_event` row (and touched since `p_since` when given). Inserts `assigned_by='agent', confidence=0.8`, `ON CONFLICT (story_id) DO NOTHING`. Returns `(slug, assigned)` rows plus a `_candidates` row. Draft fronts sweep too.
- Seeds the Election Suppression front if missing (TEST never had it; PROD keeps its row via ON CONFLICT).
- **Re-run caution:** PART E re-seeds the patterns, so re-running the whole file resets any later tuning.

### Runner + workflows
- `scripts/maintenance/assign-fronts.js`: `--all` (backfill), `--since <iso>`, `--hours N`, default 48h lookback. Never fails: RPC error -> `pipeline_skips front_assignment/sweep_failed` (new `REASONS.SWEEP_FAILED`), exit 0. Bad flag -> exit 2.
- "Assign stories to fronts" step added **before** "Refresh Tracker main line + tally" in all five workflows (rss prod/test, scotus, pardons, eo), `if: always()`. Order matters: the refresh applies the rule, so members must exist first.
- `qa:fronts` (arg parsing, RPC shaping, never-throw) added to `qa:smoke`. Full smoke green.

### TEST results
| Run | Result |
|-----|--------|
| `--all` backfill | 231 of 2,962 assigned: election 60, epstein 147, ballroom 10, iran 7, courts 3, crypto 1 |
| default 48h re-run | 0 of 0 (TEST has had no new stories) |
| refresh after | rows_changed 4; every alarm 3+ election member main_line = true |

**Regex tightening after the first pass** (false positives seen on TEST): `rigged` now needs an election noun within 20 chars (dropped "Donald Trump Says Polls Are Rigged As His Approval Rating Struggles"); the ICE-near-polls clause was removed (dropped "Anger Over ICE Raids Is Driving Some Latino Voters to the Polls"; "polling place" covers the real ICE-at-polls story). Known residual noise: "When Gerry met a salamander: The 1812 roots of gerrymandering" (history piece) - the session-2 agent is the fix for that class, not more regex.

**Redistricting is the judgment call.** It is in the election pattern because Josh listed "Missouri court allows Trump-backed districts" as a real miss, but on TEST it is most of the election front (Indiana/Texas/California/Missouri map fights). With floor 3, every alarm 3+ redistricting story lands on the PROD main line. The PROD runbook's step 1 is a dry-run count by alarm level with a redistricting column so Josh can decide before the backfill.

### Feeds (AC 4)
Added on TEST with compliance rows: **Votebeat** (id 197, Atom at `/arc/outboundfeeds/rss/`, 100 entries) and **Democracy Docket** (id 198, `news-alerts/feed/` - the root `/feed/` returns an empty 1 KB shell). **Brennan Center publishes no RSS** (checked `/rss`, `/rss.xml`, `/feed`, homepage `<link>` tags) - two feeds, not three. First fetch = the TEST RSS run dispatched after the push (run 34289531432).

### CI proof (TEST RSS run 34289531432, success)
- "Assign stories to fronts" step: `assign_fronts_sweep last 48h: assigned 4 of 73 candidates (election-suppression=2, iran=1, trump-crypto=1)`, then the refresh. AC 3 met.
- Votebeat parsed (100 entries) but every item was older than the 96h freshness window, so nothing ingested yet; the next scheduled runs pick up new posts.
- **Democracy Docket: 5 of 10 articles failed with "Cannot convert object to primitive value".** Root cause: WordPress emits `<guid isPermaLink="false"></guid>` (empty) on some items; xml2js turns that into a NULL-PROTOTYPE object holding only `$`, and `String()` on it throws instead of returning "[object Object]". `toStr()` in `scripts/rss/utils/primitive.js` now returns `''` for any object it cannot read a value from, so `safeGuid` falls back to the link. Re-ran the five items locally against TEST: all inserted. `qa:rss-primitive` added to `qa:smoke`. This bug would have hit any WordPress feed with an empty guid.

### Docs
`docs/database/database-schema.md`: events columns, rule v1.2 paragraph, `assign_fronts_sweep` section. Seed SQL header notes it is superseded. `.claude/test-only-paths.md`: the PROD runbook is manual, never deployed.

## Gotchas found
- **plpgsql `RETURNS TABLE (slug, assigned)` makes those names variables** - an unqualified `slug` in the body raised 42702 "column reference is ambiguous". Every column reference in the function is table-qualified now. The failure proved the never-fail path: two `sweep_failed` skip rows (515, 516) landed on TEST and the pipeline would have stayed green.
- **The claude.ai Supabase MCP only sees WhiskeyPal**, not TrumpyTracker TEST/PROD - migrations still go through the SQL editor in Chrome. The TEST editor works in auto mode; **navigating to the PROD project URL was denied by the auto-mode classifier.**
- Monaco: `window.monaco.editor.getModels()[0].setValue(sql)` pastes a migration in one call; the "Potential issue detected" dialog (DROP VIEW) has a Run query button at about (863, 445).
- `feed_registry.feed_url` has no unique constraint - use NOT EXISTS, not ON CONFLICT, when inserting feeds by SQL.

## What Josh must do (PROD, about 5 minutes)
1. PROD SQL editor: run `migrations/115_front_sweep_and_alarm_floor.sql` (accept the destructive-ops dialog; it is the DROP VIEW of the rule view, recreated in the same batch).
2. Run `scripts/maintenance/2026-09-08-ado-581-prod-fronts-backfill.sql` step by step. Step 1 = dry-run count. If redistricting swamps the main line, drop `|gerrymander|redistrict|congressional map|district map` from the election `sweep_pattern` first. Steps 2-4 backfill, hand-assign 14648 / 14592 / 14688, refresh. Step 5 verifies. Step 7 adds the two feeds.
3. Check trumpytracker.com: USPS whistleblower, Texas polling-site cuts, ICE-at-polling-places on the main line under Election Suppression.
4. Then the code goes to main: next session cherry-picks 02aa28c (+ the handoff commit) onto a deployment branch, PR, merge. Migration before code, as always.

Alternative: if Josh would rather Claude run PROD, allow the Chrome navigate action to `supabase.com/dashboard/project/osjbulmltfpcoldydexg/*` in auto mode.

## AC status on the card
AC 1 NOT MET (PROD blocked). AC 2 MET on TEST. AC 3 MET (run 34289531432). AC 4 MET on TEST with two feeds (first Democracy Docket articles inserted after the guid fix; Votebeat on the next fresh post). AC 5: qa:smoke green; ADO-557 commented, closes when 581 reaches PROD.

## Session 2 (not started)
Claude fronts-assignment agent for the election front only: candidate pool = stories with an election word in headline or summary and no front, rubric = state action that changes who can vote, how votes are counted, or who certifies -> assign; horse-race / campaign coverage -> no. One `story_event` row, `assigned_by='agent'`, confidence stored; declines write `FRONT_ASSIGNMENT` skips (constants exist). Backfill the ~500 candidates once, then daily. $0 marginal on the subscription.

## Still owed by Josh (unchanged from September 3)
ADO-579 numbers for EO 14420 / 14407; ADO-580 (2392 level 3 vs 4); SCOTUS routine cron `0 16,23 * * *`; ADO-564 north-star numbers (due September 7); 572 / 577 verification on TEST then PROD deploy; `.agents/` and `exec brief for blueprint.png` untracked at repo root.
