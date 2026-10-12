# October 11, 2026 (evening): EO admin hotfix, ADO-625 + ADO-629 shipped, ADO-600 files on main

Started from `2026-10-11-ado-600-591-backlog-cleanup.md`, about 3:05 to 4:40 PM CT.

## 1. Skipped as instructed
- **Backlog cleanup:** `review/decisions` on https://claude.ai/artifact/8y9rnYNFsdHNqcBQ1DuC9a has `submitted: false` (Josh's notes only on 63, 512, 594, 602, 609). Nothing closed or moved.
- **ADO-624:** the EO routine runs weekdays only. Check Monday after about 11 AM CT (RemoteTrigger `list_runs` on `trig_01McAzRLMuu8cawTzbskQkmJ`, `"status":"recorded"` in `get_run_log`), then close.

## 2. PROD admin EO tab hotfix (PR #178, deployed)
- Symptom (Josh): PROD admin Exec Orders showed "Failed to fetch EOs". SCOTUS looked broken too but was only an empty Drafts tab.
- Cause: PROD `executive_orders` has no `archive_reason` column (TEST does). Both `admin-executive-orders` and `admin-update-executive-orders` selected it, so PostgREST returned 42703 on every list. Confirmed per column with the PROD anon key (`select=<col>&limit=1`).
- Fix dabb2d9: both selects drop the column (admin never showed it), with a comment. PR #178 merged; both functions deployed to TEST and PROD (`npx supabase functions deploy <fn> --project-ref osjbulmltfpcoldydexg --workdir <main worktree>`).
- Ruled out on the way: gateway/CORS (OPTIONS fine), the live admin.html (byte-identical to main), URL length (10.8 KB `in.(...)` works on PROD).

## 3. ADO-600 record files (PR #177, merged)
Migration 130, its PGlite test, the drift-check SQL, the schema doc rows, and the alert header comment. No behavior change.

## 4. ADO-625: stopped feeds retry daily, per-feed liveness (CLOSED)
- **Migration 131:** `feed_registry.last_failed_at`, `last_item_published_at` (nullable). Applied by Josh on TEST and PROD.
- **`scripts/rss/feed-health.js`:**
  - `selectFeeds` keeps the healthy query unchanged and runs a retry query in parallel. It appends up to 5 stopped feeds whose last failure is over 24h old, never-stamped first.
  - `newestItemPublishedAt` takes the newest item date in the feed itself. Undated items and items more than 5 minutes ahead are ignored (Codex P2: clamping a far-future item made a frozen feed look alive).
  - Writes go through separate updates that only log on error, so the code is order-independent with the migration.
- **`fetch_feed.js`:**
  - Stamps the failure, and stamps liveness on every 200.
  - An unstamped feed gets one unconditional fetch, so a feed that answers 304 forever still gets stamped.
  - A failed registry read stamps only (never writes count 0+1).
  - A non-OK response is counted once.
- **Alert:**
  - Stopped feeds read "retried once a day and still failing". Before 131 it says nothing retries them.
  - New stale-feed line: a working feed whose newest item is over 7 days old while its source has confirmed new articles.
- **Why liveness is the feed's newest item, not "inserted new articles":** that is the ADO-600 overlap trap. Politico Top's items get stored via another feed first, so it would never create articles.
- **Evidence:**
  - TEST run 38173624012: CSM (stopped) recovered with 2 articles; Time (stopped) is still broken (HTML), count 6; Reason's newest item is August 19.
  - PROD run 38174567961: 20 feeds, no stamp or retry warnings. PROD has no stopped feeds today.
  - Health check 38174918208: healthy, and the stale read works on PROD.

## 5. ADO-629: pardon filter pills (CLOSED)
- React `src/lib/filters.ts`: the pills are built from `TONE_SYSTEM.labels.pardons`, 5 down to 0. The test checks them against tone-system.ts and the JSON.
- Legacy `public/pardons-app.js`: the pills come from the card labels and are keyed by level. Level 0 survives the URL, the chip, the request, and `pardons-active`, which rejected 0 (deployed TEST and PROD).
- PROD `?corruption_level=0` returns the 4 public level-0 pardons.

## 6. Reviews
- ADO-625/629: two `/code-review medium` passes (10 findings, then 9: 6 and 3 fixed, the rest answered in commit messages and card comments), plus Josh's local Codex (1 P2, fixed in d3d6f95).
- `qa:smoke` green, with the new `qa:feed-health` added to it.
- The hotfix was a two-line select change.

## 7. Decisions (Josh)
- **ADO-524:** a recheck that finds a new arrest on a public pardon publishes the note directly (no hold, no unpublish). Recorded on the card.
- **ADO-594:** keep. Next session, Josh pastes on TEST in order: 123, 124, 125, 126, 127, then `scripts/maintenance/2026-10-04-ado-592-front-definitions.sql` (outside 14:00 UTC). Then the gold check (90% gate), then the backfill.
- **ADO-616 EOs 14426/14433:** Josh is sitting on both and said "no change" to an EO prompt calibration fix. Claude's read (on the card): 14433 is rated 1 but fits level 3 by the rubric; 14426 at 0 is generous. No overall positive skew (284 EOs: L0=1, L1=30). 616 stays open until he decides.

## 8. Findings not fixed (proposed card, needs Josh's OK)
- `public/admin.html` loads `@supabase/supabase-js@2` and `@babel/standalone` **unpinned** from jsDelivr. Babel standalone moved to a new major (8.x) on October 7, 2026. Any future release can break all of admin with no deploy of ours. Proposed: pin both to the versions that work today. $0, one file.

## Next session
1. Backlog page: if `submitted`, run the closes and moves as approved.
2. Monday after about 11 AM CT: EO heartbeat, then close ADO-624.
3. ADO-594 / 592: Josh's TEST pastes (above), then the gold check.
4. ADO-524: build (migration `post_pardon_checked_at`, recheck step in the pardons agent, gold set of real re-offenders plus the same-name trap).
5. Then 579/580. DB size (585) and security (587) stay deferred.
