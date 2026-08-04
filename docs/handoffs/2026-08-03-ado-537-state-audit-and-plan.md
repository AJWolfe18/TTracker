# 2026-08-03 — ADO-537 state audit + execution plan

**Type:** planning session. No code, SQL, or config changed. One new doc.
**Cost:** $0.

## Why this session existed

Josh asked where we left off after ~2 weeks idle. Memory's HOT tier was stale (still described
ADO-533 as mid-monitoring and ADO-531 as gated), so the answer had to be rebuilt from git, ADO, and
the TEST database rather than trusted from memory.

## What was actually found

Last **product** work was **2026-07-18** (ADO-537, manual merge + unmerge). The 07-25 commits were
ADO-skill/MCP tooling, not product.

**ADO-537 is half-verified, and that was not visible from the card:**

| Phase | Code on `test` | TEST DB | Exercised |
|---|---|---|---|
| 1 — manual merge | ✅ `50b2ce6` | ✅ migration 104 applied | ✅ real merge logged 07-19 02:48 UTC |
| 2 — unmerge | ✅ `dfdaf6a` | ❌ **migration 105 never applied** | ❌ never run |

Verified by query: `story_merge_audit.unmerged_at` does not exist on TEST. The unmerge button is
shipped code that physically cannot work there yet.

**Nothing from ADO-537 has reached PROD** — `main` has no migration 104/105, no `admin-judge-merge`,
no unmerge code in `admin.html`.

**Root cause of the invisibility:** the 07-18 session ended without a handoff doc and without an ADO
comment recording phase 2. This handoff exists so that doesn't repeat.

## Deliverable

`docs/superpowers/plans/2026-08-03-ado-537-unmerge-verify-and-prod.md` (commit `a199043`).
8 tasks: apply 105 to TEST → redeploy both edge functions → prove the merge→unmerge round trip on
stories that actually hold articles → promote to PROD in order → prove it there → close.

**Read the plan, don't re-derive it.** It carries the verified current state, the exact fixtures, and
a Review History section explaining why each non-obvious instruction is worded the way it is.

## Decision made (and why)

**Finish ADO-537 before starting ADO-531.** Unmerge is the reversal path for exactly what the backfill
does 12,000 times; running the backfill without a tested undo is the wrong order. ADO-531's own gate
(533's monitoring window) cleared back on 07-07 — it is otherwise ready to execute, plan already
approved at `docs/features/clustering-judge/backfill-plan.md`.

## Traps found while reviewing the plan (all folded into it)

1. Cherry-picking ADO-537 onto `main` **will** conflict on `backfill-plan.md` (modify/delete — the file
   is test-only). Resolution is `git rm`; taking the `test` version ships the unstarted ADO-531 plan.
2. `stories.source_count` is unreliable — TEST's highest-`source_count` active stories hold **zero**
   articles. Pick fixtures by `article_story` membership. (Now also in memory as a durable convention.)
3. Nothing proves migrations 101/102 ever ran on PROD; 105 alters a table 101 creates. Preflight added.
4. The live Judge cron and 2-hourly RSS must be **paused** around the PROD round trip — the window
   where a story sits split is exactly what the Judge would re-merge, possibly into a different story.
   With an explicit turn-back-on step.

## Next session starts here

Task 1: Josh pastes `migrations/105_unmerge_story.sql` into the **TEST** SQL Editor
(`wnrjrywpcadwutfykflu`), declining the "Enable RLS" suggestion. Everything after that is in the plan.

ADO-537 remains in **Testing** — correctly, the work isn't done. Session comment posted (id 28532602).
