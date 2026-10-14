# Admin Dashboard Gaps — Plan

**Cards:** `backlog.md` (same folder) has each card's changes and acceptance criteria. That file is the spec; this plan is the sequencing and handoff.
**Started:** 2026-10-13 (cloud session, no ADO or Supabase access)
**Status lives in ADO:** ADO-631 (cards 1, 3, 5, 6 combined; PR 1), ADO-632 (card 2), ADO-343 (card 4, existing card rescoped). Card 7 has no card (recommended drop).

## Why it's split across sessions

The cloud session that started this can edit code and open PRs. It **cannot** reach ADO (no connector; `dev.azure.com` is blocked), deploy edge functions, apply migrations, or query the TEST database. So:

- **Cloud PR (PR 1):** code-only changes, verified locally with a mocked Supabase backend.
- **Desktop session:** review PR 1, deploy its edge functions to TEST, merge, create the ADO cards, and do the work that needs the database.

---

## PR 1 — cloud (branch `ccr-e66091d2-nndglt` → `test`)

| Card | What ships in PR 1 | Needs on desktop before merge |
|---|---|---|
| 1. Judge Dismiss + Needs review | All of it: UI, `admin-judge-merge` `dismiss` action, `admin-judge-log` `view: 'needs_review'` | **Deploy both edge functions to TEST first.** If the page goes live before the functions, the Dismiss button and the Needs-review view return errors. |
| 3. Home fixes | All of it (frontend only) | Nothing |
| 5. Mobile | All of it (CSS + Judge/Stories table stacking) | Check it on a real phone after the TEST deploy |
| 6. Cleanup | Delete legacy pages, pin library versions | Nothing |

**Not in PR 1:**
- **Card 2 (Stories needs-review queue):** needs a migration. See below.
- **Card 4 (Feeds tab):** new edge function plus a sizeable UI. It's its own session and PR.
- **Card 7 (Agent health):** not yet agreed with Josh.

### Desktop checklist for PR 1
1. `git fetch origin ccr-e66091d2-nndglt` and review the PR (Codex reviews it automatically; run the two-pass review as well).
2. Deploy to TEST:
   ```bash
   supabase functions deploy admin-judge-merge --project-ref wnrjrywpcadwutfykflu
   supabase functions deploy admin-judge-log   --project-ref wnrjrywpcadwutfykflu
   ```
3. Merge the PR into `test` → Netlify deploys the TEST site.
4. Verify on TEST: Judge is the 2nd tab and opens on "Needs review". Dismiss a row: it disappears, and the "All verdicts" view shows a `keep`/`manual` row. The Home "Judge: N to review" count matches. Check a 375px phone screen.
5. ~~Create the ADO cards~~ Done October 13, 2026: ADO-631 (Testing), ADO-632, ADO-343.
6. PROD later: follow the normal cherry-pick flow (`docs/guides/prod-deployment-checklist.md`), and deploy both edge functions to PROD **before** the page change reaches PROD.
   - The cherry-pick hits a modify/delete conflict on `public/dashboard-legacy.html` (main's copy differs). Resolve with `git rm`.
   - `ADMIN_IMPROVEMENTS.md` exists only on main. `git rm` it on the deploy branch.
   - `admin.html` on main is about 275 lines behind test (ADO-495, ADO-525, the Social tab), so ship those first or expect conflicts.

---

## Session 2 — desktop: Card 2, Stories needs-review queue (ADO-632)

**Finding (from reading migration 080):** `flag_story_for_review()` only ever **sets** `needs_review = TRUE`. It never clears the flag. So:
- A story that was later fixed (re-enriched, failure count reset) stays flagged forever, so the Home count may be inflated with stale flags.
- If an admin clears the flag while the cause still exists (e.g. a short summary), the next UPDATE flags the story again.

**Work**
1. Query TEST first: count flagged stories, and how many no longer meet any flag condition (stale). Use a `head`/count query with no wide columns.
2. Migration: the trigger (a) clears `needs_review`/`review_reason` when no reasons remain, and (b) doesn't re-flag when `reviewed_at` is newer than the last content change. Decide what counts as a content change, e.g. compare `reviewed_at` to `last_enriched_at` if that column exists.
3. Backfill: clear stale flags.
4. Password-gated "mark reviewed" write (extend `admin-update-story`, or a small new function).
5. Stories tab: a "Needs review" filter showing `review_reason`, a "Mark reviewed" button, and a link from the Home row.

## Session 3 — cloud or desktop: Card 4, Feeds tab (ADO-343)
Built October 13, 2026 in PR #191 (desktop). `admin-feeds` + `admin-stats` deployed to TEST; **deploy both to PROD before admin.html**. Failing is now active-only everywhere (admin-stats, Home fallback, Feeds tab). PROD has no `feed_compliance_rules` table: the tab shows a notice there; fix is ADO-633.

## Parked
- Cost/budget display: skipped by Josh (2026-10-13). Context: the header "Budget" only tracks OpenAI spend, which is now small since story enrichment moved to the Claude agent. It shows today only, not month-to-date against the $50/month limit.
- Submit Article: stays disabled until that feature is built.
- In-browser Babel build step (slow page loads on phones): a separate, larger card if mobile still feels slow after PR 1.
- Card 7 Agent health: waiting on Josh.
