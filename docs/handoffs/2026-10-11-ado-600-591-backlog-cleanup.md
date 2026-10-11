# October 11, 2026: close-outs, backlog cleanup, ADO-600 closed (ADO-591, 600, 553, 603, 616, 624, 629)

Sunday session, about 1:55 to 3:00 PM CT. Started from `2026-10-11-ado-616-624-close-out.md`.

## 1. Close-out checks
- **ADO-624 (stopped-routine alert):** the Election front routine wrote its own heartbeat at 9:11 AM CT (run `cse_01AUk33hy1pWjMRh19HFqB4v`, `"status":"recorded"`). EO runs weekdays only, so its first own heartbeat is Monday about 11 AM CT. **Close after that** (RemoteTrigger `list_runs` on `trig_01McAzRLMuu8cawTzbskQkmJ`, look for `heartbeat` / `"status":"recorded"` in `get_run_log`).
- **ADO-591: CLOSED.** Josh ran the one-line check on PROD: one constraint, `pardons_corruption_level_check` = `CHECK ((corruption_level IS NULL) OR ((corruption_level >= 0) AND (corruption_level <= 5)))`. All three AC met (evidence on the card).
- **ADO-616:** today's scheduled Track Pardons / Track Executive Orders / SCOTUS runs had not fired by 2:50 PM CT, so Josh had them triggered manually at the end of the session (runs 38169824500, 38169826251, 38169827934). See section 5 for what they showed. ADO-553 and ADO-603 close together with 616: their last open checks were the same rows the October 10 drain re-ran.

## 2. Backlog cleanup (Josh reviewing)
- Page: https://claude.ai/artifact/8y9rnYNFsdHNqcBQ1DuC9a (v3). Josh's strikes and notes save to the page's database: `ArtifactData get`, collection `review`, doc `decisions`. **Nothing in its groups closes or moves until `submitted` is true.** Then: close "doesn't make sense" (50) and "wouldn't move the needle" (26) with each line's reason as the comment, close 165 as a duplicate of 164, move 460-465 to WhiskeyPal under epic 484 (PATCH System.TeamProject + AreaPath + IterationPath; the PAT cannot create tags), close emptied epics and TTracker epic 459 unless struck. Struck lines reverse their default.
- Josh's rules (in memory): feature ideas stay open in their own unranked group because they are ideas to revisit; everything under epic 11 (Josh PM/Idea Tracking) stays; 151 closes, 152 stays. The "wouldn't move the needle" group (dashboards etc.) is a one-off call for this cleanup, not a standing rule. The standing rule is card hygiene: close a card in the same session it ships (after the AC check), search before opening a new one, don't leave finished work in Testing/Resolved.
- **Already closed today (26):** shipped and verified 63, 67, 91, 179, 199, 203, 205, 211, 225, 262, 265, 311, 315, 341, 342, 539, 582 (262 and 315 checked against the live trumpytracker.com files; 582 against today's run); duplicates 143, 166, 167, 178, 219, 222, 226, 233, 514. Held back from the duplicate list: 136 (idea epic) and 238 (feature idea).
- **Waiting on one check by Josh:** 525 (Undo test in PROD admin + security advisor), 74 (same advisor look), 569 (GA4 Realtime or PostHog still records), 593 (Tracker, All, only Pardons on, older pardons appear).
- Answers given on Josh's page notes: the site shows spicy headlines only (hardcoded in Home.tsx and Detail.tsx, so idea 150 adds a toggle); the Discord needs-review alert covers SCOTUS, EO and Pardons only, never Stories flags (602); admin has Re-enrich on all four content tabs; manual article submission is a dead "coming in Phase 2" button over a working `articles-manual` function (145 moved to the work list).
- **New: ADO-629 (Bug)**, from Josh: pardons filter pills use old level names (Pay-to-Play, Friends & Fam, Swamp, Celebrity, Broken Clock) instead of the tone-system card labels, and level 0 has no pill. In `src/lib/filters.ts` and `public/pardons-app.js` CORRUPTION_PILL_LABELS. $0, two files.

## 3. ADO-600 (PROD ingest RPC): migration 130 APPLIED on PROD
- **AC 1 met:** PROD articles has feed_id (**TEXT**, no FK; TEST is BIGINT), metadata (JSONB '{}'), opinion_flag (BOOLEAN false). The live function was the 121 version and wrote none of them; 0 of 2,276 articles in 30 days had a feed_id. Check file: `scripts/maintenance/2026-10-11-ado-600-prod-ingest-drift-check.sql`.
- **Migration 130** = the 121 function plus feed_id (all-digit ids only, kept as text) and metadata. First feed to store an article keeps feed_id and metadata together; empty metadata is filled only by the owning feed. opinion_flag deliberately not written (it switches on the clustering opinion penalty; needs the eval and a week of Judge). Guard: no-op on TEST's 032 version, upgrades earlier revisions of itself. `scripts/tests/ingest-rpc-130-pglite.test.mjs`: 26 checks. Josh applied it on PROD (verify row: stores_content true, stores_feed_id_metadata true). Not applied on TEST on purpose (no-op there).
- **Reviews:** two `/code-review medium` passes and Josh's local Codex. The first version also switched the daily ingest check to per-feed matching; review 2 showed article attribution cannot prove a feed is alive (an overlapping feed owns no articles; a manual article hides a dead feed), so `alert-ingest-health.js` stays on source_name (header explains why). Per-feed liveness is noted on **ADO-625** (stamp a last-new-item time at fetch). Codex P2 (another feed filling the owner's empty metadata) fixed in 3c74c1e.
- **AC 3 reworded with Josh** (feed_id is stored on every new PROD article) and **met**: the manual RSS run 38169822619 stored 10 new articles after the apply, 10 of 10 with feed_id and metadata. **ADO-600 CLOSED.** The PROD anon key reads articles (src/lib/supabase.ts PROD_ANON_KEY) for spot-checks like this.
- Not yet on main: migration 130 file, its test, the drift-check SQL, the alert comment, the schema doc. Nothing on main behaves differently because of them; ship with the next deploy PR.

## 4. QA and commits
- `npm run qa:smoke` green on 25f0246 (3c74c1e touched only the migration and its PGlite test, which passes).
- Commits on test: 000fe2d, 5d793e6, 25f0246, 3c74c1e, plus this handoff.

## 5. Manual runs at session end (Josh: "trigger the tracker manually")
- Needs-review lines (service key): **pardons 0** still flagged (was 27), **SCOTUS 0** (was 49), **EO 2** (presumably 14426 and 14433, still unmarked by Josh). So **ADO-553 and ADO-603 CLOSED** with that evidence; **ADO-616 stays open** until Josh marks the two EOs reviewed in PROD admin (comment on the card).
- RSS Tracker - PROD 38169822619: success; feed_id check passed (section 3).

## Next session
1. Read `review/decisions` on the backlog page; if `submitted`, run the closes and moves exactly as approved.
2. Ship the ADO-600 files (migration 130, its test, drift-check SQL, schema doc, alert comment) to main with the next deploy PR. Record only.
3. Monday after about 11 AM CT: EO heartbeat, then close ADO-624.
4. ADO-616 once Josh has marked EOs 14426 and 14433 (the EO needs-review line should read 0).
5. Josh's order: ADO-524 + ADO-625 (add the fetch-time liveness stamp), then 592/594 (594 marked "revisit first"), then 579/580. 629 and 609 are small reader-facing fixes near the top of the work list.
