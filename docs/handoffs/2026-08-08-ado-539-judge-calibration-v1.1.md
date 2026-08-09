# 2026-08-08 — ADO-539 Judge calibration v1.1 (Testing, ready for PROD PR)

**Ticket:** ADO-539 → **Testing**. **Branch:** `test` @ `fc1d6c9` (12 commits).
**Executed from:** `docs/features/clustering-judge/calibration-v1.1-plan.md` (approved plan, not re-planned).

## What shipped

1. **Migration 106** — verdict memory in `get_clustering_judge_candidates`. A pair is skipped while a
   live **settled** verdict is newer than the latest `article_story.matched_at` on either side.
2. **Prompt v1.1** — licensed-inference + format-variant merge rules, chain-of-events carve-out,
   explicit precedence (keep beats licensed inference), recalibrated wrong-merge cost, `judge-v1.1`.
3. **Gold set gs-209..211** — the three hedge-pattern pairs.
4. **judge-dryrun re-scored** — 30 → 122 pairs, now in `qa:smoke` as `qa:judge-dryrun`.

## Verification (both gates actually run, not asserted)

**Precision gate:** 122 pairs, merge precision **100%** (TP=22, FP=0), **all 100 different_event pairs
swept with zero false merges**, gs-209/210/211 flip to merge 3/3, 11/11 keep traps hold (incl. gs-168,
gs-189), July 4th 10/10. Proven non-vacuous: injecting one false merge → 95.7% and exit 1.

**Migration 106 applied to TEST; fixtures 6/6 PASSED** (pair 16981/17005, sim 0.8966), run via
PostgREST: (c) live keep suppresses · (f) dry-run does NOT · (m) cap-deferred merge does NOT ·
(j) reverse-order unmerge suppresses · (e) newer `matched_at` reopens · (h) heartbeat does NOT.
TEST left byte-identical (fixture rows deleted, borrowed `matched_at` restored + re-read).

## Two real defects caught in review

1. **CRITICAL — cap-deferred merges created memory.** The clause filtered only on
   `dry_run`/ids/`created_at`. The prompt logs `merge` with `merged=false, dry_run=false` when the
   10-merge run cap is hit or `merge_stories` returns `ok:false`, and defers the pair. Those rows would
   have suppressed it for the rest of the 7-day window — and a failed merge never stamps `matched_at`,
   so nothing would reopen it. **"Deferred, not dropped" would have become dropped.** Fixed:
   `AND (l.verdict <> 'merge' OR l.merged = true)`. Would have hit **ADO-531's backfill** hardest.
2. **Perf** — correlated `max(matched_at)` ran per-pair on an O(n²) join; hoisted into the `recent`
   CTE via `LEFT JOIN LATERAL` (n²/2 probes → n).

## Next session — PROD deploy

1. `git checkout -b deploy/ado-539-judge-v1.1 origin/main`, cherry-pick the ADO-539 commits.
   **Known gotcha:** `backfill-plan.md` is test-only → `git rm` on cherry-pick conflict.
2. PR to main, `@codex review`, `gh pr merge --squash`.
3. **Josh applies migration 106 on PROD** (`osjbulmltfpcoldydexg`). Verify
   `idx_judge_log_pair_live` exists and the function is still 1 row; re-run the security advisor.
   **Run `EXPLAIN ANALYZE` on the RPC** — the LATERAL hoist is unmeasured on PROD.
4. Live verify over 24h / 3 runs: known re-hedge pairs stay silent, uncertain volume drops,
   spot-check every `merged=true`.

## Open decisions (Josh's call, none block PROD)

- **gs-209 encodes a rule the prompt doesn't state.** It's a multi-beat *saga* timeline recap; the
  written format-variant rule covers a *single scheduled occasion*, and licensed inference needs
  exactly one plausible referent. Either add the saga-recap rule or drop gs-209 as a rule target.
- **`uncertain` now surfaces once.** Verdict memory suppresses `uncertain` like `keep`, so a pair
  flagged for a human appears once instead of every run; the only push is a best-effort Discord digest
  with no resolved/unresolved state. Consider exempting `uncertain`, or an unresolved list in the Judge tab.
- **Hot pairs still re-judge.** Gaza 13257/13295 went cold 08-01 while re-hedging ran to 08-05 (so 106
  helps there), but 13362/13383 was quiet in only ~21% of 8h slots. Optional: a ~48h suppression floor
  regardless of new articles — strictly more suppression, cannot weaken unmerge safety.
- **The gate never calls the model.** It scores hand-authored verdicts against labels the author saw.
  Stronger follow-up: a blinded run of the real prompt through the real model over gold evidence
  (~$1/sweep at repo costing), plus ~20 held-out different_event pairs.

## Gotchas worth remembering

- `article_story`'s PK is **`article_id` alone** — an article belongs to exactly one story. You cannot
  attach one article to two stories; borrow and repoint instead.
- TEST has **zero** candidate pairs at the production `0.83/7d` knobs. Any TEST fixture using production
  thresholds silently validates nothing. Use `0.1/60d` — the memory predicate is threshold-independent.
- The `supabase-test` MCP has **write** access (service_role), so TEST DML/verification can be done
  directly. DDL still cannot — no `exec_sql` RPC, and the `claude_ai_Supabase` MCP is scoped to the
  WhiskeyPal org only.
- Local `.env` `SUPABASE_URL` points at **TEST**, not PROD. PROD reads are possible read-only via the
  public anon key in `public/supabase-browser-config.js`; `story_merge_audit` and `clustering_judge_log`
  need service_role and are not reachable locally.
