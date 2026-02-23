# Handoff: SCOTUS Frontend PR + Feature Flag Wiring

**Date:** 2026-02-22
**ADO:** 354 (Review), 82 (Review), 390 (New)
**Branch:** test | **PR:** #80 (deploy/scotus-frontend → main)

## What happened

Created PR #80 with 10 frontend files from test + feature flag wiring. SCOTUS tab is flag-gated (`scotus: false` in `flags-prod.json`) so it deploys hidden. Code review caught and fixed: `filename` scope bug in `__FF_DEBUG__`, UX flash on `?tab=scotus` with flag off.

New ADO-390 created: 108 unenriched cases (`v2-ado280-flagged`, no `case_type`) + 7 merits cases that are enriched but still `is_public=false`.

## Next session

1. **Merge PR #80** — review at https://github.com/AJWolfe18/TTracker/pull/80
2. **Verify on trumpytracker.com** (flag OFF):
   - Site loads, no console errors
   - `window.__FF_DEBUG__` shows `scotus: false`
   - No SCOTUS tab visible, `?tab=scotus` stays on Stories
   - `?ff_scotus=true` enables SCOTUS tab + cases load
3. **Flag flip PR** — new branch from post-merge main, change `scotus: false` → `true` in `flags-prod.json`
4. **Close ADO-354, 82, 81, 80** after flag flip verified
5. **ADO-390** — investigate enrichment gaps (108 unenriched + 7 merits not public) — separate session
