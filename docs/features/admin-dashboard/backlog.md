# Admin Dashboard — Gap Backlog (2026-10-13)

Draft User Stories from the admin dashboard review. Not yet in ADO: the cloud session that drafted them had no ADO access. Create them with `/ado create story "<title>"`, then paste in each description and AC.

Scope decisions from Josh:
- Cost/budget display: **skipped for now**.
- Submit Article: **leave as is** (planned for later, button stays disabled).
- Legacy admin pages: **delete**.

Suggested order: 1 → 2 → 3 → 4 → 5 → 6 → 7. **Sequencing and handoff: `plan.md`.** Cards 1, 3, 5 and 6 are built in PR 1 (cloud session); cards 2 and 4 are next. No AI/API cost for any of these; they're dashboard and edge-function changes only.

---

## 1. Judge tab: Dismiss button + "Needs review" view, move tab up

**Why:** Uncertain pairs pile up in the Judge list with no way to clear them, and Judge is the tab Josh uses most but sits near the end.

**Context:** The Judge already won't ask about an uncertain pair again unless a new article joins one of the stories (verdict memory, migration 106). The clutter is in the UI, not the Judge. Dismissing writes a `source='manual', verdict='keep'` row to `clustering_judge_log`, which the Judge treats as an authoritative "keep separate". The `manual` source is already allowed (migration 104), so no migration is needed.

**Changes**
- `admin-judge-merge` edge function: add a `dismiss` action (writes the manual keep row, `dry_run=false`, `merged=false`).
- Judge tab: add a **Dismiss** button on each uncertain row, next to `use`.
- Default view = **Needs review**: uncertain verdicts with no later manual verdict for the same pair. Keep an "All verdicts" toggle for the full log.
- Tab order: Home, **Judge**, Stories, Pardons, SCOTUS, Exec Orders, Feeds, Failures, Social.
- Home "Needs Attention": add a "Judge: N to review" row that links to the Judge tab.
- Remove the merge popup's outdated line "There's no undo from the UI yet" (Unmerge exists).

**Acceptance criteria**
- [ ] Clicking Dismiss on an uncertain row removes it from the Needs review view without a page reload.
- [ ] The dismissed pair shows in "All verdicts" as `keep` / `manual`.
- [ ] The Judge doesn't re-ask about a dismissed pair unless a new article joins either story (expected, by design).
- [ ] Judge is the 2nd tab, and the Home count matches the number of rows in Needs review.
- [ ] Dismiss is password-gated like the other admin functions (no anon access).

---

## 2. Stories: "Needs review" queue

**Why:** Home shows "Stories need review: N", but nothing lets you see or clear those stories.

**Context:** The Claude stories agent does **not** do this review; its prompt forbids it from writing `needs_review`. A database trigger (migration 080, `flag_story_for_review()`) flags stories automatically for a short summary, low confidence, or failed enrichment, and saves why in `review_reason`. The `reviewed_at`/`reviewed_by` columns exist but nothing writes them.

**Changes**
- Stories tab: add a **Needs review** filter that shows `review_reason`.
- Per row: **Mark reviewed** (sets `reviewed_at` / `reviewed_by`, clears the flag) and the existing Edit.
- Clicking the Home "Stories need review" row opens this filter.
- **Check before building:** whether the trigger re-flags a story on its next UPDATE after the flag is cleared. If it does, the trigger must respect `reviewed_at`, which would need a migration.

**Acceptance criteria**
- [ ] The filter shows exactly the stories counted on Home.
- [ ] Mark reviewed removes the story from the queue, and it stays off after the next enrichment run.
- [ ] Writes go through a password-gated edge function, not the anon key.

---

## 3. Home tab fixes

**Changes**
- **Trigger Pipeline** always opens the TEST workflow (`rss-tracker-test.yml`), even on PROD. Make it follow the environment (`rss-tracker-prod.yml` on PROD).
- Make every "Needs Attention" row clickable and open the matching tab and filter. Today only 2 of 7 rows are. (PR 1 opens the right tab; per-tab filters land with card 2. The Feeds row waits on card 4.)
- The fallback stats path hardcodes "Stories need review" to 0. Query the real column, as the edge function does.

**Acceptance criteria**
- [ ] On PROD, Trigger Pipeline opens the PROD workflow; on TEST, the TEST workflow.
- [ ] Each Needs Attention row opens the right tab with the right filter.

---

## 4. Feeds tab (replace "Coming soon")

**Why:** Home says "Feeds failed: N" but doesn't say which feeds. Feed health is currently checked by hand in Supabase.

**Changes**
- New password-gated edge function `admin-feeds` (list + update), following the `admin-pipeline-skips` pattern.
- Feeds table: name, source, tier, active, `failure_count`, `last_fetched_at`, `last_failed_at`, `last_item_published_at` (silent-feed signal, ADO-625), and whether a `feed_compliance_rules` row exists.
- Filters: All / Failing (failure_count ≥ 5) / Silent (newest item > 7 days old) / Inactive.
- Actions: activate/deactivate, reset failure count.
- Adding feeds stays a SQL task for now. That could be a follow-up card.

**Acceptance criteria**
- [ ] Each Home "Feeds failed" count links to the Failing filter, and the counts match.
- [ ] A feed missing a compliance rule is visibly flagged.
- [ ] Toggles write through the edge function only, never the anon key.
- [ ] Queries select named columns only (egress rule), with no `content` or `embedding` columns.

---

## 5. Mobile-friendly admin

**Problems found**
- The 8 tabs sit in one row that doesn't wrap or scroll, so they run off-screen on phones.
- `.dashboard-grid` needs cards at least `400px` wide, which overflows phones narrower than 400px. "Content Overview" is forced to span 2 columns, which breaks the single-column layout.
- 9 data tables (Judge has 9 columns) are unreadable on a phone.
- The modals and the Judge merge/unmerge popups aren't checked on small screens.

**Changes**
- Tab nav: horizontal scroll (or wrap) under 640px, with a 44px minimum touch target.
- Grid: `minmax(min(400px, 100%), 1fr)`; drop the forced `span 2` under 900px.
- Tables: under 640px, show each row as a stacked card (headline, verdict, actions first). Do Judge and Stories first, then the other tabs.
- Modals: full screen under 640px, with the action buttons pinned at the bottom.
- Test at 375px width (iPhone SE/mini) and 414px.

**Acceptance criteria**
- [ ] No horizontal page scroll at 375px on any tab.
- [ ] Judge Dismiss/use/unmerge and Stories Edit are reachable with a thumb at 375px.
- [ ] Desktop layout is unchanged above 900px.

**Note:** The page converts its whole 6,700-line source in the browser on every load, so it's slow on phones. A proper build step is a separate, larger card. Not included here.

---

## 6. Cleanup: delete legacy admin pages + pin libraries

**Changes**
- Delete `public/admin-supabase.html` and `public/dashboard-legacy.html` (root `ADMIN_IMPROVEMENTS.md` exists only on `main`; it goes when PROD is synced).
- Update `scripts/simple-server.js:77`, which still points to `admin-supabase.html`.
- Pin exact library versions in `public/admin.html`. Today it loads `react@18`, `react-dom@18`, `@babel/standalone` (no version) and `@supabase/supabase-js@2`, so an upstream release can break admin without any change on our side.
- Check `.claude/test-only-paths.md` and the PROD deploy checklist so the deletions also reach PROD.

**Acceptance criteria**
- [ ] `/admin-supabase.html` and `/dashboard-legacy.html` return 404 on TEST, then on PROD.
- [ ] No repo references to the deleted files remain.
- [ ] Admin loads and works with the pinned versions.

---

## 7. (Proposed) Agent health on Home

**Why:** System Health only covers the RSS feed run. If the Stories, SCOTUS, Exec Orders, Pardons or Judge agents silently stop, Home stays green.

**Changes**
- For each agent, show "last run X ago" from data it already writes (for example, the latest Judge heartbeat row in `clustering_judge_log`, or the latest enrichment timestamp per table). Turn amber or red past each agent's expected cadence.

**Acceptance criteria**
- [ ] One row per agent, showing its last-run time and status.
- [ ] Thresholds match each agent's schedule.

**Status:** Not yet agreed. Confirm or drop.
