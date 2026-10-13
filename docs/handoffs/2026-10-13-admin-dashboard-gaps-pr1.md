# 2026-10-13 — Admin dashboard gaps: review + PR 1 (cloud session)

**Plan / next steps:** `docs/features/admin-dashboard/plan.md`. **Card specs:** `docs/features/admin-dashboard/backlog.md`.
**No ADO cards yet:** the cloud session had no ADO access. Create them from `backlog.md` on desktop.

## What was done
- Reviewed `public/admin.html` with Josh. Agreed scope: Judge cleanup, mobile, Home fixes, Feeds tab, delete the legacy pages. Cost display is skipped for now. Submit Article stays as it is.
- PR 1 (`ccr-e66091d2-nndglt` → `test`) covers cards 1, 3, 5 and 6:
  - **Judge:** a `dismiss` action in `admin-judge-merge` logs a `source='manual', verdict='keep'` row, so verdict memory (migration 106) settles the pair. `admin-judge-log` gets `view:'needs_review'`: pairs whose latest live verdict is `uncertain` and whose two stories are both still live, over the last 30 days, cursor-paged by id. The tab opens on "Needs review", Judge is now the 2nd tab, Home shows a "Judge pairs to review" count, and the outdated "no undo" text is gone.
  - **Home:** Trigger Pipeline follows the environment. Needs Attention rows open their tab. The fallback stats path now counts `stories.needs_review` instead of hardcoding 0.
  - **Mobile:** below 640px, tabs scroll sideways, tables stack into cards, and popups go full screen. The grid no longer overflows below 400px.
  - **Cleanup:** deleted `admin-supabase.html` and `dashboard-legacy.html` (`ADMIN_IMPROVEMENTS.md` was already gone on `test`); pinned React 18.3.1, Babel standalone 8.0.6 (the major version prod already loads) and supabase-js 2.117.2.

## Verification done (cloud)
- Headless Chromium at 375px and 1366px, with the CDN libraries served from the pinned npm versions and Supabase faked: no horizontal page scroll on any tab, Dismiss removes the row and calls `dismiss` with the pair, and the All view shows unmerge only on the executed merge.
- The two edge functions pass `deno lint`, and `deno check` is clean apart from 2 implicit-any errors on lines that were already there.
- `qa:eo-admin-unit` and `qa:judge-executor` pass. `qa:alerts` fails because `dotenv` isn't installed in this container (unrelated).
- **Not done:** edge functions are not deployed, and nothing was checked against the real TEST database.

## Gotchas
- **Deploy `admin-judge-merge` + `admin-judge-log` to TEST before merging the PR.** Before the deploy, the Home Judge count shows "—" (handled), but the Judge tab shows the plain log and Dismiss returns a 400 error.
- Card 2 finding: migration 080's trigger only ever **sets** `needs_review`; it never clears it. Stale flags are likely, and clearing a flag by hand gets undone on the next update. That card needs a migration (details in `plan.md`).
