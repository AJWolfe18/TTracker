# 2026-10-13 — ADO-631: admin dashboard PR 1 reviewed, deployed to TEST, merged (desktop session)

**Picks up from:** `2026-10-13-admin-dashboard-gaps-pr1.md` (cloud session that wrote PR #189).
**Plan / spec:** `docs/features/admin-dashboard/plan.md` and `backlog.md` (now carry ADO numbers).
**Cards:** ADO-631 (cards 1, 3, 5, 6 combined) → **Testing**. ADO-632 (card 2, Stories needs-review) → New. ADO-343 (card 4, Feeds tab; existing card rescoped) → New. Card 7 (agent health on Home): no card, recommended drop (see below).

## What was done
1. **Reviewed PR #189**: two-pass review (feature-dev:code-reviewer + a general-purpose production-readiness pass) plus Codex's GitHub review. 0 critical. 3 real issues, fixed on the PR branch before merge (commit `a75d33a`):
   - Home "Judge pairs to review" stayed stale up to 5 min after a dismiss (Codex P2). Fix: `JudgeTab` takes `onReviewCount` and reports `total_count` whenever it loads the unfiltered Needs review list.
   - Against an older `admin-judge-log` (ignores `view`), the tab rendered the full log under the Needs review banner. Fix: error + clear rows when `result.view !== 'needs_review'`.
   - No hint when more than 100 pairs exist. Fix: "showing the newest N".
   - Docs: card 6 AC reworded (Netlify `/* → /index.html 200` SPA fallback means deleted pages return the homepage, not 404); card 3 AC reworded; PROD cherry-pick gotchas added to plan.md.
2. **Deployed** `admin-judge-merge` + `admin-judge-log` to TEST with `npx --yes supabase@latest functions deploy <fn> --project-ref wnrjrywpcadwutfykflu --workdir <worktree of the PR branch>` (no global supabase CLI on this PC).
3. **Merged** PR #189 to test (squash `64577e1`). `npm run qa:smoke` exit 0; `qa:judge-executor` passes.
4. **Verified on the TEST site against the real TEST DB** (Josh signed in; Chrome): Home count 2 → dismissed one pair → row gone, All verdicts shows keep/manual, Home immediately 1. All Needs Attention rows open their tab (Feeds static by design). No horizontal scroll at 371px on all 8 enabled tabs (measured in a same-origin 375px iframe, since window resize didn't change the viewport). Wrong/no password → 401.
5. **ADO**: created 631 + 632 under Epic 234, rescoped 343, moved 631 to Testing with the AC table in a comment.

## Test data left on TEST
`clustering_judge_log` ids **80** and **81**: `run_id='qa-fixture-pr189'`, labelled "QA fixture ... Safe to ignore". 80 is dismissed (row id of the manual keep follows it). **81 is left open on purpose** for Josh's real-phone Dismiss test. TEST had zero live (non-dry-run) Judge rows, so without fixtures the Needs review list is always empty there.

## Remaining
- **Josh:** real-phone check of TEST admin (dismiss pair 81).
- **PROD (later, normal cherry-pick flow):** deploy both edge functions to PROD **before** admin.html; `git rm` `public/dashboard-legacy.html` on modify/delete conflict; `git rm ADMIN_IMPROVEMENTS.md` (main only); admin.html on main is ~275 lines behind test (ADO-495, 525, Social tab).
- **Next sessions:** ADO-632 (needs migration: trigger only sets `needs_review`, never clears), ADO-343 (new `admin-feeds` edge fn + tab).
- **Card 7 decision (Josh):** recommended drop. `scripts/monitoring/alert-routine-silence.js` already Discord-alerts every 6h when any agent goes quiet.

## Minor review findings not fixed (logged on ADO-631)
- Home's 5-minute auto-refresh re-runs the needs_review scan (up to 30 days of small id/verdict columns). Tiny egress at PROD's volume; revisit only if the log grows.
- `truncated` (20,000-row cap) is returned but not shown in the UI.
- Needs review keeps pairs whose stories are closed/archived or older than the Judge's 7-day window; they stay listed until someone acts or 30 days pass.
- `dismiss` doesn't check story status (dismissing a pair with a merged-away story writes a harmless keep row).

## Gotchas
- Admin edge functions authenticate with `x-admin-password` (`ADMIN_DASHBOARD_PASSWORD` secret), which is not in local `.env`, so they can't be curl-tested from here; verify through the signed-in page. Local `.env` names the anon key `SUPABASE_TEST_ANON_KEY`, not `SUPABASE_ANON_KEY`.
- The Chrome MCP `resize_window` did not shrink the viewport (stayed 2560px); a same-origin iframe at 375px shares sessionStorage, so it loads already signed in and gives a real phone-width layout.
