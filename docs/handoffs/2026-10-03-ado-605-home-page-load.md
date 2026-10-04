# ADO-605: home page loads faster on phones (October 3, 2026)

**Card:** ADO-605, now **Testing** (every acceptance criterion MET, evidence on the card).
**Commits on `test`:** `851d472` (code), `9179da3` (ARCHITECTURE note), `cd2ec59` (perf script fix).

## What changed and why

The home page loaded in a chain: HTML, then the app JS, then the feature-flag file, then the
Tracker's 6 data requests. The data doesn't depend on what the flag file says, only on whether
the Tracker shows at all, so waiting for the flags cost a full round trip.

1. **Boot prefetch** (`src/lib/tracker-boot.ts`, called from `src/main.tsx` on `/` only). It starts
   the main-line first page, pins and tally at the same moment as the flag fetch. TrackerSpine takes
   those in-flight requests once, on its first load of the default view with every chip on. Each
   is handed out at most once and ignored after 30 s, and every failure resolves to a fallback
   (a fresh fetch) instead of rejecting. If rap_sheet is off, nothing takes them and nothing shows.
2. **Pinned-entry lookup runs alongside the pages** (`fetchTrackerPage` in `src/lib/timeline.ts`).
   The force_show `id=in.(...)` lookup used to wait for every source page. Now it starts as soon as
   the pins arrive. Its rows are still used only for sources whose first page succeeded, so the
   retry-duplication rule from the ADO-593 review holds.
3. **One-year cache for hashed files** (`immutableAssetHeaders` plugin in `vite.config.ts`). The build
   writes `dist/_headers` with `Cache-Control: public, max-age=31536000, immutable` for each exact
   file in `assets/`. It deliberately lists exact paths rather than `/assets/*`. A missing old chunk
   (an old tab after a deploy) falls through the SPA rewrite to index.html, and a wildcard would
   cache that HTML for a year. Verified on TEST that a fake chunk path gets max-age=0.
4. **`scripts/perf/phone-load.mjs`** now lists the TEST host's own requests, has `REPEAT=1` for a
   second visit, and blocks analytics with Chrome's URL blocking (`Network.setBlockedURLs`) instead of
   `ctx.route()`. **Gotcha:** Playwright turns the browser cache off whenever routing is on, so the old
   script could never show a caching win, and it added about 0.3 s to every load. Only compare runs
   from the same script version.

## Measurements (TEST, Galaxy S9+ emulation, 4G profile, CPU 4x slower)

| | Before (3 runs) | After (3 runs) |
|---|---|---|
| First Tracker entry, first visit (script before `cd2ec59`) | 3,107 (cold) / 2,109 / 2,099 ms | 1,676 / 1,695 / 1,692 ms |
| Data requests start | 1,204-1,645 ms, after flags finished | 627-633 ms, same moment as flags |
| Repeat visit, fixed script | not measurable before the fix | main JS from cache (0 ms vs about 240 ms), first entry about 0.66 s |

Under the fixed script, first visit is about 1.38 s.

Flag-off check (`?ff_rap_sheet=false`): classic feed rendered (19 story links). A DOM watcher running
from the first frame never saw the Tracker section.

Raw output was kept in the session scratchpad only (not in the repo).

## Reviews and QA

- `/code-review medium 68ca803..HEAD`: no findings. `cd2ec59` (script-only, test-only path) came after
  the review and was not re-reviewed.
- `npm run test:ui` 219/219 passed (6 new tests: tracker-boot suite + a concurrency test that fails on
  the old code). `npm run lint` (tsc) clean. `npm run qa:smoke` exit 0.

## PROD deployment (next step)

`scripts/perf/phone-load.mjs` is listed in `.claude/test-only-paths.md` and does **not** exist on main.
1. Branch from `main`, `git cherry-pick 851d472`. It conflicts on `scripts/perf/phone-load.mjs`
   (modify/delete): resolve with `git rm scripts/perf/phone-load.mjs`, then `git cherry-pick --continue`.
2. `git cherry-pick 9179da3` (ARCHITECTURE note). Skip `cd2ec59` (script only).
3. No migrations, edge functions, secrets or flags. After merge, check on PROD:
   `curl -sI https://trumpytracker.com/assets/<index-hash>.js` shows the immutable header.
4. A week or so after PROD, re-check the dead-swipe count in the traffic report (card note).

## Not done / open findings

- **Font preload (optional plan item 3), skipped on purpose:** Google Fonts file URLs are versioned
  (`newsreader/v26/...`) and change without notice, so a hardcoded preload would break silently.
- **About 0.5 s between data arriving and the first entry on a slow phone CPU.** It's app-bundle execution
  plus rendering, not network. It also delays the pinned-EO lookup, which is ready at about 0.83 s but
  starts at about 1.24 s because the main thread is busy. The main JS is 287 KB (90 KB gzipped). Proposed
  as a new card for Josh to approve (not created): profile the boot on a 4x CPU trace and split or trim
  the bundle.
- With rap_sheet off, the 6 prefetched requests are wasted (about 10-20 KB). That only happens through
  the URL override, since the flag is on in both envs. Accepted, no card.
