# 2026-08-05 — ADO-537 PROD deploy COMPLETE + Judge uncertain-verdict analysis

**Tickets:** ADO-537 (Closed) · ADO-538 (New, Judge tab UX) · ADO-539 (New, Judge calibration v1.1)
**Plan executed:** `docs/superpowers/plans/2026-08-03-ado-537-unmerge-verify-and-prod.md` (Tasks 7–8, done)

## What shipped to PROD tonight

1. **Migrations 104 + 105** applied by Josh in the PROD SQL Editor, all footer verifications passed:
   source CHECK gains `manual`, verdict CHECK gains `unmerge`, `story_merge_audit.unmerged_at` exists,
   both RPCs `anon=f/authenticated=f/service_role=t` (hard gate), codex-P2 lock fix present
   (`snapshot_changed` re-read under FOR UPDATE).
2. **Edge functions** deployed to `osjbulmltfpcoldydexg`: `admin-judge-merge` v1, `admin-judge-log` v2
   (03:05 UTC, confirmed via `functions list`).
3. **PR #109 squash-merged** to main (`6868a06`) LAST, per plan ordering — new admin.html (Manual
   Merge card, unmerge button, story-id search) live on trumpytracker.com.

## The PROD round-trip proof (AC7)

Josh drove it via UI (not the plan's SQL-first flow — evidence gathered after the fact via one
self-finding SQL query, results on the ADO-537 card):
- **13324/13327**: manual merge (audit 152) → unmerge (snapshot consumed, `unmerged_at` stamped,
  article restored, log 2701 `manual/unmerge`) → re-merge (fresh snapshot 153, log 2702).
- End state verified: 13327 tombstoned into 13324; survivor `source_count` 14 **exactly equals** its
  `article_story` row count. Bonus real merge 13383→13362 (7 articles; survivor recount 8 = membership).
- **Jobs were paused during the proof and re-enabled the same night** (hard gate honored): Judge cron
  `trig_01DDXZkpC9PkgTzU8wDdL9QM` disabled 03:22→enabled 03:44 UTC (next run 05:03);
  `ENABLE_PROD_SCHEDULES` false 03:22→true 03:44. Nothing was in flight during the window.

## Docs updated (commit `bc433a2` on test)

- `prod-deployment-manifest.md`: everything ticked with evidence kind noted (101/102 verified applied
  via Task 7 Step 0; functions via deploy timestamps; JS/prompt via origin/main). 
- `database-schema.md`: gains `clustering_judge_log`, `story_merge_audit`, `judge_run_merge_count`
  and the merge/unmerge/recompute RPCs.
- ⚠️ These ride the NEXT PROD PR — main's copies are stale until then.

## Judge uncertain-verdict analysis (Josh's live ask → ADO-539)

30 recent `uncertain` verdicts = only **13 distinct pairs**. Three patterns:
1. **Re-hedging**: no verdict memory — Gaza pair 13257/13295 judged uncertain **6×**; Blanche pairs 6×/4×.
2. **"B lacks specifics"** (dominant): analysis/explainer pieces get "cannot confirm" instead of the
   same-cycle-commentary merge Section 4 already licenses. Josh manually merged 2 of these — ground truth.
3. **Format variants**: previews/"how to watch"/WATCH clips hedge against the event itself (Judge later
   merged 13128→13123 anyway after hedging twice).
Correct hedges exist too (2-venue Michigan visits, Fauci retrospective, passport batches). Confidences
all cluster 0.35–0.5 — no threshold fix; rules must change. Unmerge existing weakens the extreme
default-DENY rationale. **Gate: gold-set eval (precision holds ≥98%) before any prompt change ships.**

## Next session (in order)

1. **Cherry-pick ADO-532's eval harness + gold set to main** — NOT on origin/main (only
   `judge-dryrun.js` is); the PROD Judge prompt dangles a reference to the gold-set file, and 539's
   eval gate needs the harness. 532 sits Ready for Prod. Include `bc433a2` (docs) in the same PR.
   Remember the known conflict: `backfill-plan.md` is test-only → `git rm` on cherry-pick conflict.
2. **ADO-539** calibration (analysis on the card), then **ADO-531** backfill.

## Loose ends (recorded, not urgent)

- ADO-515 social share: still blocked on Josh setting Netlify PROD env vars.
- ~~Legacy GPT EO enrichment~~ → **FIXED same night, see addendum below (ADO-540).**
- ADO cards 447/510 sit in Testing but look like WhiskeyPal-domain items, not TrumpyTracker deploys.

---

## ADDENDUM — same-night second act (after the first /end-work)

**ADO-540 filed AND fixed AND deployed:** Josh wanted the legacy EO GPT spend gone. Killing the
workflow or rolling the key were both wrong (workflow = the only EO ingestion; key = PR code review).
Shipped the surgical fix instead: Josh applied `ALTER TABLE executive_orders ADD COLUMN IF NOT EXISTS
description TEXT` on PROD, then **PR #110** (`c3f35de`) put the tested raw-only script on main —
file-copied from `test` (NOT a `dc8912d` cherry-pick: that commit drags 4 files and was modified twice
since). AI review's 2 blockers verified FALSE before merge (live PROD probe: `alarm_level` exists;
`today` defined at line 51). **540 = Resolved** (Bugs have no Testing state — New/Active/Resolved/Closed
only, now documented in the ado skill). **Close 540 after today's 16:00 UTC
`executive-orders-tracker.yml` run is green and writes raw rows.** `OPENAI_API_KEY`'s sole remaining
consumer is AI PR code review.

**Backlog hygiene:** 524 demoted Active→Todo; stale memory fixed (528/482 were referenced as open but
closed weeks ago).

**ARCHITECTURE.md rebuilt** (`4e8cfb2`, `18ff5cd`): was badly stale (claimed GPT story enrichment,
"planned" pardons). Now has current-state tables — who-enriches-what, secret consumers, kill switches —
update rows in-session when pipelines/secrets/flags change.

**Commits (test):** `bc433a2` manifest+schema, `3f5219d` handoff, `4e8cfb2` ARCHITECTURE rewrite,
`18ff5cd` ARCHITECTURE 540-row, `f89b290` ado-skill Bug states. **Main:** `6868a06` (PR #109),
`c3f35de` (PR #110).
