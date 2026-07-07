# Handoff — ADO-531 backfill planning (plan approved, execution next session)

**Date:** 2026-07-06 (late UTC 2026-07-07) · **ADO:** 531 → **Active** (plan approved; no code written yet)
**Prior:** ADO-533 Judge went live 2026-07-06 (`2026-07-06-ado-533-clustering-judge-session3.md`); its 3-day monitoring window runs through ~2026-07-10.

---

## TL;DR

Planning-only session. The full implementation plan for backfill-judging the ~12k legacy PROD stories
is **written, reviewed (Plan-agent + 3 rounds of Codex), and approved by Josh**. No repo code changed.
Next session executes the plan — do NOT re-plan or re-explore.

**Plan of record (identical copies):**
- Repo: `docs/features/clustering-judge/backfill-plan.md`
- Local: `C:\Users\Josh\.claude\plans\continue-ado-531-backfill-cluster-the-lexical-sonnet.md`

## What the plan builds (1-paragraph version)

Sliding 7-day window walking backward from today to 2026-01-03 (Josh's binding ruling — NOT a widened
window). Migration 103: `judge_backfill_state` singleton cursor (enabled/dry_run/anchor/lease + CHECK-
constrained knobs) + 5-arg `get_clustering_judge_candidates` (adds `p_anchor`, `p_exclude_judged`;
3-named-arg live call keeps working; ends with `NOTIFY pgrst, 'reload schema'`). New delta-prompt
`prompt-backfill-v1.md` (live prompt untouched): claim-first lease via atomic PATCH, drain-based cursor
advance, `source='judge-backfill'`, no per-run Discord. Admin: add the source value to
`admin-judge-log` VALID_SOURCES + admin.html SOURCES.

## Sizing (DONE — don't redo)

12,214 PROD stories, oldest 2026-01-03, ~2,000/month even spread, 12,198 with centroids. ≈62 anchor
positions at step 3d → est. 80–250 runs (~4–10 days at hourly cadence). Cash ≈ $0 (subscription
Sonnet); egress <100MB total. Real constraint = subscription usage; refine after the dry-run bucket.

## Review findings already folded into the plan (don't re-derive)

1. **Geometry:** 7d window / 3d step only guarantees co-windowing for pairs ≤4d apart — documented,
   `step_days` tunable to 2; window stays 7 per Josh.
2. **Cursor off-by-one:** done-check runs on the just-drained window's lower edge, else the oldest
   ~3 days of stories get skipped.
3. **Exclusion predicate:** exclude ONLY `verdict IN ('keep','uncertain') AND dry_run=false`. Never
   exclude merge verdicts (cap-deferred must re-surface; dry-run merges must not suppress live).
   Dry-run advances unconditionally after one pass (prevents stall).
4. **Run lease/CAS:** claim-first PATCH (`enabled=eq.true&done=eq.false&or=(lease_until...)`,
   `return=representation` = sole config source); renew at pairs 1,6,11,16,21,26 + before every
   merge; all cursor writes CAS on `last_run_id`.
5. **Knob CHECKs:** window 1–7, step 1–window, merge_cap 1–10 (0 stalls the drain rule), target ≤ anchor.
6. **PostgREST schema cache:** NOTIFY + verify both RPC call shapes through `/rest/v1/rpc/` per env
   before any agent run (stale cache would break the LIVE judge).

## HARD GATES (in order, from the plan)

- (a) sizing — done. (b) PROD **dry-run one historical bucket**, Josh eyeballs the Judge tab
  (source=judge-backfill; deploy edge fn first or the filter silently no-ops). (c) live low-cap
  buckets **only after ADO-533's 3-day window is clean (~2026-07-10) or Josh green-lights**.
  (d) hourly cron (`:15`, delete at done).

## NEXT SESSION

Josh has a paste-ready pickup prompt (given at end of this session). Sequence: execute plan → TEST
smoke per plan's Verification section → two-pass review → qa:smoke → commit/PR → gate (b). ADO-531 is
Active with rewritten description/AC matching the decided scope.

## Cost
$0 this session (planning; read-only PROD PostgREST HEAD counts only).
