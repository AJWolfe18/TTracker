# Handoff: key scan, four PRs merged, ADO-586 closed, ADO-577 PR with Codex fixes (September 20, 2026, afternoon)

All clock times are Central (CT). UTC = CT + 5 hours. Session ran about 1:25 PM to 6:25 PM CT.
Previous handoff (same day, morning): `2026-09-20-ado-586-silence-alert-executor-times-pardon-hold.md`.

## Outcome in one line
Every step Josh listed except the key rotation is done or waiting on him: PRs #147, #148, #149 and a docs
scrub (#150) are merged, ADO-586 is closed with live proof, ADO-577 is on PR #151 with all four Codex
findings fixed, the Judge and the executor are proven clean again, and the security scan found exactly one
live leaked credential (the TEST service key), which only Josh can rotate.

## 1. Security (details deliberately kept out of this public doc)
- A full git-history scan (1,973 commits, all branches) was run with a scratchpad script that prints
  fingerprints only. Result: one live credential, the TEST service_role key; no PROD service key anywhere in
  history; the other hits are dead (an older TEST key, two June 2025 GitHub tokens) or public by design
  (anon keys). Triage detail lives in project memory `active-work`, not here.
- Setup docs that carried real keys now carry placeholders: test commit `b28c385`, main via PR #150.
  History still holds the old key, so the scrub is cosmetic until Josh rotates.
- STILL OWED BY JOSH: rotate the TEST legacy JWT secret in the Supabase dashboard, then update the GitHub
  secrets, local `.env`, the MCP entry in `~/.claude.json` (then claude-sync push), the TEST cloud
  environment, and Netlify TEST if present. After that Claude updates the hardcoded TEST anon key in
  `src/lib/supabase.ts`, `public/supabase-browser-config.js`, `config/supabase-config-test.js`,
  `scripts/test/test-rss-pipeline.js` and checks the old key returns 401. The numbered walkthrough was
  given to Josh in the session.
- Private-or-public: Josh has not decided. Recommendation given: stay public. Roughly 1,350 Actions
  minutes were used in the last 30 days and the executor adds about 270 a month, close to the 2,000
  private cap; private also needs GitHub Pro ($4/month). GitHub secret scanning is OFF on the repo and is
  free on public repos: worth turning on with push protection.

## 2. PRs and cards
| PR | What | Result |
|---|---|---|
| #147 | executor poll times (ADO-583) | merged |
| #148 | routine silence alert (ADO-586) | merged after the last Codex P1: the Discord fallback step now exits 1 when Discord cannot be reached (test `d4a279c`) |
| #149 | pardons prompt v1.2 (ADO-588) | merged; PROD runs read v1.2 from main since 3:01 PM CT |
| #150 | docs key scrub | merged |
| #151 | needs-review Discord alert (ADO-577) | OPEN, waiting for Josh's Codex re-run and merge word |

- ADO-586: Closed. Live proof in health check run `35529432794` on main: `[routine-silence] judge: fresh`
  and `stories: fresh`, follow-up step skipped. Final AC check is on the card.
- ADO-588: Active. AC 1 and AC 5 recorded MET (TEST log id 2 completed on v1.2, pardons 1/4/7/8 have real
  source_urls, id 5 is the test placeholder). AC 6 needs a PROD run with real work; PROD queue is empty.
- ADO-577: Ready for Prod, no comment added (Josh did not ask for one).

## 3. ADO-577 on PR #151: what changed after Codex
Test commits `1619b3e` and `37c917e`, both cherry-picked to `deploy/ado-577-discord-alerts`.
1. Undelivered alert exited 0 (P1): records flagged + Discord not delivered now exits 1. A check that
   cannot run posts its own "could not run" message; exit 1 only if that fails too. Steps stay
   `continue-on-error`, so the ingest job never fails because of an alert.
2. 26-hour window could lose a flag (P1): the alert is now a reminder of the open queue, every row still
   flagged from the last 7 days (`ALERT_WINDOW_HOURS`, default 168), rows from the last 26 hours marked
   NEW. It stops by itself once the record is reviewed in admin.
3. TEST runs looked like PROD (P1): pardons and EO workflows set `ALERT_ENV`; `postDiscord` prefixes
   `[TEST]` (covers the new-work alerts too) and the link points at the TEST site. SCOTUS is PROD only.
4. EO reason read from the wrong record (P2): the EO agent writes its reason to
   `executive_orders_enrichment_log.notes`; a trigger only syncs the boolean. The query embeds the newest
   flagged log row in the same bounded request. Verified the query shape against TEST (no flagged EOs
   there, so the reason path is covered by the unit test only).
- Conflict resolution on the deployment branch: main's `package.json` list plus `qa:alerts` only
  (`qa:social` is not on main); EO workflow keeps main's concurrency group, step name and run line.
- `npm run qa:smoke` exit 0 on test after each change. Scripts byte-identical between test and the PR.

## 4. Routine checks
- Judge 4:03 PM CT (`cse_01EKzaMAi7W9eCXcJsrzyqn4`): published, 0 denials, accepted the corrected
  start-up message. 30 pairs: 0 merge, 29 keep, 1 uncertain (15450 vs 15563). Executor run `35544298855`
  at 6:19 PM CT: 30 rows logged, 0 merged/deferred/failed, digest sent, branch deleted.
  GitHub skipped all three new poll slots (4:23, 4:53, 5:23 PM CT); the executor ran 2 hours late even
  after #147. One sample. If it persists, the $0 fix is the Judge routine triggering the executor directly.
  The agent's push notification called this the "first" live run; it is not (live since September 19).
  Agents have no memory between runs, wording slip only.
- Pardons PROD 3:01 PM CT (`cse_01XCn2sPJh49Dqg5UEVygZd8`): v1.2 from main, queue empty, log id 141
  completed. A second PROD Pardons run fired at 1:33 PM CT (`cse_016knvKg1XUx23SjhjQ44XDp`) right after
  #149 merged; not triggered by this session, log not read. Ask Josh.
- SCOTUS and EO PROD: latest runs September 18, both healthy empty runs. Classifier still unproven for
  their content PATCH. Next runs Monday about 11:02 and 11:06 AM CT.

## 5. ADO-587 (not started, Josh wants to discuss first)
Read-only inventory of `.github/workflows` on main: 13 workflows, 10 read a PROD Supabase secret, none
uses a GitHub Environment. Three have no main-only ref check at all: `enrich-story.yml`,
`process-manual-article.yml`, `test-secrets.yml`. Rebuild the table with the one-liner in the session
(yaml parse + `secrets\.` grep) rather than trusting this list next week.

## Review and QA
- Subagent review passes were NOT run (Josh's standing no-subagents rule; `Agent`/`Task` are denied).
  Review = inline in session + Josh's Codex on #148 (one P1, fixed) and #151 (four findings, fixed).
- `npm run qa:smoke` exit 0 three times on test.

## Open items for Josh
1. Rotate the TEST key (section 1). Say whether to make the repo private (recommendation: no).
2. Re-run Codex on PR #151, then say "merge 151".
3. Decide: Judge routine text "private" to "public" repository (must be asked in his own words).
4. Decide: re-enrich the blind-enriched pardons (September 3 batch, id 173). Recommendation yes, $0; it
   also gives ADO-588 AC 6 its proof run.
5. Was the 1:33 PM CT PROD Pardons run his?
6. Discuss ADO-587 before any work starts.

## Next-session prompt
```
/start-work Read docs/handoffs/2026-09-20-pm-security-scan-prs-merged-ado-577-codex.md first. No subagents. Do not create ADO cards or comments I did not ask for. Times in Central.
(0) Security: I have rotated the TEST key / I have not. If rotated, update the four files that hardcode the TEST anon key, confirm the old key returns 401, MCP works, TEST site loads, TEST RSS run passes.
(1) PR #151: [merged / Codex findings pasted below]. If merged, read the next main runs of the pardons, EO and SCOTUS workflows and confirm the "Alert flagged enrichments" step ran and the alert is titled without [TEST]; then close ADO-577 after the AC check.
(2) ADO-588 AC 6: read the first PROD Pardons run with real work.
(3) My answers to the open decisions: ...
(4) Discuss ADO-587 with me before touching anything.
```
