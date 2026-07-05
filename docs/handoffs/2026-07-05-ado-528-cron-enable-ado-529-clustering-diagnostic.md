# Handoff: ADO-528 Cron Enable + ADO-529 Clustering Quality Diagnostic

**Date:** 2026-07-05
**Branch:** test (workflow config + docs changes; PR #105 merged to main)
**ADO:** 528 (Stories Claude Agent), state=Active, 3-day monitoring window running. 529 (Clustering Quality Audit), state=Closed. 530 (Narrative Thread Tracking), state=Todo. 531 (Historical Backfill), state=Todo.

## What Was Done

### 1. ADO-528 AC6 — PROD cron enabled

Enabled the PROD cron schedule (`30 */2 * * *`) on `trig_0182WcUVyjF7Q5o2GWJMxbo1` via `RemoteTrigger action=update` (full nested `job_config.ccr` resent per the known gotcha). Confirmed `next_run_at`. Reconfirmed `ENABLE_LEGACY_STORY_ENRICHMENT=false` via `gh variable list` and the latest PROD run log (16:58 UTC 2026-07-05, run 28748145319: `ENABLE_LEGACY_STORY_ENRICHMENT: false`, `stories_enriched: 0`). Added a comment to ADO-528; left state at Active — the 3-day monitoring window just started, AC6 doesn't fully close until it passes clean (~2026-07-08).

### 2. ADO-529 — Clustering Quality Audit (diagnostic → root cause → recommendation → plan doc → fix → close)

Followed the required diagnostic-first discipline (didn't skip to a fix). Full detail, raw evidence, and reproducible commands are in **`docs/features/clustering-quality/plan.md`** — read that before re-investigating anything here.

**Bottom line:** the low lifetime 1.4 articles/story ratio is **not** a clustering bug. Recent tuning already attaches ~39% of new articles/week to existing stories, and 8/8 hand-verified live merges were correct. Two separate findings instead:

1. **Small real gap:** `ENABLE_TIERB_MARGIN_BYPASS` (a corroboration-based margin-tie-breaker, identical to the mechanism already live unconditionally in Tier A) defaulted `false` and was never set in either RSS workflow — so it only ran in shadow-mode logging, never live. Fixed this session.
2. **The actual explanation for the low ratio is structural, not fixable by clustering tuning:** the 72-hour rolling window per story is a correct guard against false merges of unrelated events with generic phrasing — but it also means there's no way to represent one narrative thread spanning weeks/months (Epstein, ICE). That's a different capability (a future "thread" layer), motivated by Josh's Important Stories Tracker idea, not scoped here.

**Fix shipped:** `ENABLE_TIERB_MARGIN_BYPASS` added to both RSS workflows as a repo-variable-overridable kill switch (`${{ vars.ENABLE_TIERB_MARGIN_BYPASS || 'true' }}`, defaults ON) — Codex review on PR #105 caught the first version being hardcoded `'true'` (would've needed a workflow PR to roll back instead of a fast variable flip); fixed and re-reviewed clean. **PR #105 merged to main** (commit `8ec1a70`). No code changes to `hybrid-clustering.js` itself — the bypass logic already existed, tested via months of shadow-mode logging. Zero cost impact (no new AI calls).

**Two follow-up tickets created** (explicitly kept separate per Josh, not bundled):
- **ADO-530**: Design narrative/thread tracking layer — the real prerequisite for Important Stories Tracker. Not scoped yet.
- **ADO-531**: Historical backfill/re-cluster of legacy stories — recommended to wait until ADO-530's data model exists, since a standalone backfill using just the Tier B fix would only yield ~2-3% improvement (not worth doing twice).

### Why the initial background-agent conclusion needed correcting

The first background diagnostic agent sampled only 1 day of logs and concluded the Tier B flag was a bigger lever than it actually is. Re-analyzing with a 7-day sample (and fixing a JSON-parsing bug — see gotcha below) showed the real impact is only ~2%/week, not "the fix." Lesson for next time: don't trust a single-day log sample's effect-size estimate for anything you're about to act on — cheap to extend the window before committing.

## Verification

- `npm run qa:smoke` — 0 failures (config-only change, no logic touched).
- Codex AI review on PR #105 — passed clean after the repo-variable fix.
- `gh pr view 105` confirmed `MERGED`, commit `8ec1a70`.
- ADO-529 AC1-AC4 all verified MET before closing (see ADO comment history).

## Gotchas Hit This Session (also in memory)

- Parsing a `grep -o '"type":"X".*'` log fragment: it's missing the opening `{` but DOES include the real closing `}`. Prepend `"{"` only — appending `"}"` too causes a double-brace JSON parse error. Bit this twice before catching it.
- `gh pr merge --merge` fails on this repo ("Merge commits are not allowed") — use `--squash`.

## Next Session Should

1. Check the ADO-528 3-day monitoring window (started 2026-07-05, ends ~2026-07-08) — if clean (no legacy-GPT stories touched, no failed runs, `attached_324_tier_b > 0` appearing in `CLUSTERING_SUMMARY` logs), close AC6 and move ADO-528 to Closed.
2. Spot-check a few live Tier B merges the same way Tier A was verified this session (pull `article_id`/`story_id` from `CROSS_RUN_OVERRIDE` logs with `tier:"B"`, compare real headlines).
3. ADO-530/531 are Todo, not urgent — pick up whenever thread-tracking work becomes a priority. Don't start ADO-531 before ADO-530 has a data model decision.
