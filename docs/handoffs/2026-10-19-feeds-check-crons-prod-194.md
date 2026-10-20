# October 19, 2026: feeds health check, off-peak crons (#193), PROD deploy #194 (ADO-631, ADO-343, ADO-523)

About 9:30 to 11:45 PM CT. Started from `/start-work` "confirm the feeds are running fine".

## 1. Feeds health check (PROD, read-only)
- **RSS Tracker PROD:** last 15 scheduled runs all `success`; latest run 19/19 feeds succeeded, 0 enrichment skips, entity extraction ~$0.007/run.
- **Stories:** clustering created 4-34 stories per run; the Claude Stories agent last enriched at 9:40 PM CT (checked with the public read key).
- **WaPo Politics (feed 5):** stopped since October 14 (last good fetch 4:09 AM CT); every `feeds.washingtonpost.com` URL returns nginx 502, also from this PC; `www.washingtonpost.com/arcio/rss/*` times out for scripts. No announced change (feed directories say the section feeds worked on September 28; only the homepage feed was retired in July). The daily retry (ADO-625) keeps trying. **Replace if still down around October 22.**
- **Newsweek:** one 404 at 4:27 AM CT October 19, fine on the next run.
- **ANN timeouts** (4-5 per run): known, ADO-635.
- **Run count:** 3-7 runs a day against a `0 */2` schedule (12), with a 7-hour gap on October 19 (4:27 AM to 11:42 AM CT).

## 2. Off-peak crons: PR #193 (merged to main, ab67cfc)
Every workflow scheduled at `:00` moved to an off-peak minute; cadence unchanged. Test commit df64ea6.

| Workflow | Was | Now |
|---|---|---|
| rss-tracker-prod | `0 */2` | `17 */2` |
| rss-health-check | `0 */6` | `41 */6` |
| executive-orders-tracker | `0 16` | `7 16` |
| pardons-tracker | `0 18` | `37 18` |
| scotus-tracker | `0 18` | `47 18` |
| pipeline-skips-cleanup | `0 4` | `13 4` |

No workflow reads `github.event.schedule`. Josh's Codex: no findings. **Verify around October 21:** count scheduled RSS PROD runs per day; if still well under 12, use an external `workflow_dispatch` trigger.

## 3. Codex automatic reviews
ChatGPT Settings > Code Review: `AJWolfe18/TTracker` automatic review is **Off** (the repo setting overrides the personal default, which is still On for WhiskeyPal and delivery_plugin). The last automatic review was #190 (October 14). "Use credits for reviews" is Off, so reviews never bill beyond the subscription. Nothing was changed; the stale memory note was fixed.

## 4. #189 Codex P2 fix (ADO-631)
Codex: Home's Judge count stayed stale after a dismiss/merge with a source filter on.
- 90ecb33: after any successful dismiss, merge or unmerge, re-fetch Home's global count (like the Feeds tab's `onFeedsChanged`).
- `/code-review medium` on 90ecb33: 1 real (two paths racing to set Home's count, plus a stats-poll reply able to restore an old count), 1 by design (a failed fetch shows "unknown"). Fixed in dec32f9: the Judge list no longer pushes the count; `fetchJudgeReviewCount` has a request token.
- Josh's second Codex pass on both commits: no findings.
- #186 and #187's red CI on their PRs was the old PROD-ref lint (fixed on test by #180), not real.

## 5. PROD deploy: PR #194 (merged to main 5e9fe0d, 11:30 PM CT)
Cherry-picked #187, #189, #191, 90ecb33, dec32f9 and removed `ADMIN_IMPROVEMENTS.md`.
- **Edge functions deployed to PROD first:** `admin-judge-log`, `admin-judge-merge`, `admin-feeds`, `admin-stats` (each answers 401 to a wrong password). New admin.html live within ~40 s.
- **Conflict resolutions:** the Social tab (ADO-572) never shipped to main, so the tab list and the "not built" fallback drop `social`; #187 kept main's `PRODUCT_VISION.md` and `business-logic-mapping.md`; `dashboard-legacy.html` removed. `git diff test HEAD -- public/admin.html` = only the Social tab and main's `GVR` label (ADO-551 not on main).
- `qa:smoke` green on the deploy branch.
- ADO-631, 343, 523 commented and left in **Testing**: Josh checks the PROD admin page (Judge, Feeds tabs; 343 also owes its 375px check) before Closed. No migrations.

## 6. Held for Josh's Codex (no SQL run tonight)
| Card | Commits on test | PROD SQL |
|---|---|---|
| ADO-594 labels | ee422e8, 757e7d1, 40f7698, 0a38c77, b3441a9, bf7ad1d, 3a9c26c, 39d0296 | migrations 123-127 |
| ADO-592 fronts | 863eff6, a0e79fa, aa5adb9, 79d3ab5 | `scripts/maintenance/2026-10-04-ado-592-front-definitions.sql` |
| ADO-524 recheck | b9c32d0 through ff55780 | migration 132 |
| ADO-626 (#186, Codex done) | 07ccfa1 | migration 133, after 132 |

Order: 123 + 124 before the claude-v1.1 Stories prompt reaches main; 125-127; the 592 file outside 14:00 UTC; PROD label backfill routine (`LABEL_BACKFILL_PROD=true`); 132 (editor shows the destructive dialog for DROP FUNCTION: Run) before pardons prompt v1.4; then #186 + 133. Details: `2026-10-11-ado-594-592-524-test-and-recheck.md`.

## 7. Found, not fixed (proposed cards, need Josh's OK)
1. **WaPo Politics feed down since October 14:** replace the source if still 502 around October 22 (score a candidate with `scripts/rss/scorer.js`).
2. **Verify #193 around October 21:** if RSS PROD is still well under 12 runs/day, add an external `workflow_dispatch` trigger ($0).
3. Personal Codex auto-review default is still On for WhiskeyPal and delivery_plugin (Josh's call; TTracker is Off).

## Next session
1. Josh's Codex on 594/592/524 → PROD SQL one file at a time (Section 6 order).
2. ADO-634 AC5: 6 PROD Judge runs with 0 `permission_denied`, then close.
3. Around October 21-22: run counts (#193) and WaPo.
