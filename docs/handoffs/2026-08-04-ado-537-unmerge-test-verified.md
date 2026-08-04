# 2026-08-04 — ADO-537 unmerge: TEST-verified, PROD deploy mid-flight

**Ticket:** ADO-537 (Testing) · **Plan:** `docs/superpowers/plans/2026-08-03-ado-537-unmerge-verify-and-prod.md` (execute, don't re-plan) · **PR:** #109 (open, do NOT merge before the PROD SQL + functions)

## Where we stopped

Session ended cleanly at **plan Task 7 Step 1**: Josh was about to paste migrations 104 + 105 into the **PROD** SQL Editor. **Nothing on PROD has been mutated** — no SQL applied, no functions deployed, PR unmerged. There is no half-applied state.

## What this session proved (plan Tasks 1–6, all complete)

- **Migration 105 applied to TEST** (twice — second time after the lock fix). Verified: `unmerged_at` column, verdict CHECK gains `'unmerge'`, both RPCs `anon=f/authenticated=f/service_role=t`, PostgREST schema cache sees the RPC (`invalid_ids` smoke), `has_lock_fix=true`.
- **Both edge functions redeployed to TEST.**
- **Task 3 (empty-snapshot unmerge, pair 17085/17087):** tombstone cleared, `source_count` recomputed to true 0, snapshot id=2 consumed, log row 35 (`manual`/`unmerge`), double-unmerge refused (`not_merged_pair`). TEST residue: 17085 lives as an empty active story — accepted, documented.
- **Task 4 (real round trip, 17024 keep / 17022 absorb), run TWICE** (before and after the P2 lock fix): 2 articles moved, 2 restored, `article_story` identical article-for-article to baseline, `source_count`s recomputed (5→3/2), snapshots id=3 and id=4 consumed, full audit trail, no log-write warnings.
- **`qa:smoke` green** (all 7 sub-suites) — proves no clustering regression; feature evidence is the round trips above.
- **AC1–AC7 written onto ADO-537** (AC5 uses split-evidence wording); AC1–AC6 evidenced MET, AC7 open until the PROD proof.

## Codex review history (all folded in)

- **Round 3 (plan):** `functions download` clobber-trap removed from Task 7; `NOTIFY pgrst, 'reload schema'` added to migration 105 (Part F); AC5 evidence honesty.
- **Round 4 (plan):** PR body via `--body-file`; in-flight-run preflight added to Task 8 Step 1a; 7-commit summary fix.
- **PR #109 review:** **P2 fixed** in `c4735b8`/`4d8be0d` — `unmerge_story` now re-reads the snapshot *under* the FOR UPDATE locks (new refusal reason `snapshot_changed`, mapped in admin.html). **P1 accepted as documented limitation** (migration 105 header): loser's pre-merge status isn't snapshotted, unmerge restores `active` — zero exposure while the story lifecycle stays disabled. Both threads answered on the PR.

## Bonus shipped this session

- **Judge-tab story-id search** (`99ee110`): Josh hit "can't find the old merge" live. `admin-judge-log` gains `story_id` param (matches either side, **ignores the time window**); UI gains a Story box (applies on Enter). Reviewed clean, deployed to TEST.

## Next session — exact remaining steps (plan Tasks 7–8)

1. **Task 7 Step 1:** Josh pastes `migrations/104_manual_merge_source.sql` then `105_unmerge_story.sql` in the PROD SQL Editor (decline "Enable RLS"), then the verification block (source CHECK has `'manual'`, verdict CHECK has `'unmerge'`, grants `anon=f/auth=f/service_role=t` **hard gate**, `has_lock_fix=true`). Step 0 preconditions already PASSED (101/102 confirmed on PROD, 104 preflight count 0).
2. **Step 2:** deploy `admin-judge-merge` + `admin-judge-log` to PROD (`--project-ref osjbulmltfpcoldydexg`). **Never run `supabase functions download` in-repo.**
3. **Step 3:** Judge tab still reads; then `preview` curl against `admin-judge-merge` with the Task 8 pair (401 = `ADMIN_DASHBOARD_PASSWORD` secret missing).
4. **Step 4:** `gh pr merge 109 --squash`.
5. **Task 8:** PAUSE Judge cron + `ENABLE_PROD_SCHEDULES=false`, **verify nothing already in-flight** (`gh run list` + no recent judge-agent rows), pick a real agent-merge pair (snapshot non-empty!), BEFORE queries, unmerge→re-merge in one sitting, AFTER queries identical, **RE-ENABLE BOTH JOBS (hard gate)**, refresh `prod-deployment-manifest.md` (fold into PR or note it rides the next PROD PR — §1.2/§1.3 can be ticked: Step 0 proved 101/102 ran), AC7, close 537, `/end-work`.

## Follow-up candidates (do not lose)

- **Judge log UX:** gray out the unmerge button on rows whose merge was already reversed (Josh: "probably a better way to show that" — currently the stale button just refuses safely on click).
- **P1 revisit-if:** snapshot loser's pre-merge status in `story_merge_audit` if the closed/archived lifecycle ever turns on.
- Schema doc (`docs/database/database-schema.md`) hasn't absorbed 104/105 yet (`unmerged_at`, `unmerge_story`, verdict/source CHECK widenings) — fold into Task 8's doc pass.

## Commits this session (test branch)

`5134782` (codex r3: NOTIFY + plan), `8a79d0e` (plan: 7th commit), `64afc0f` (codex r4), `99ee110` (story-id search), `257330d` (plan: 8th commit), `c4735b8` (P2 lock fix). Deploy branch `deploy/ado-537-manual-merge-unmerge` tip: `4d8be0d`.
