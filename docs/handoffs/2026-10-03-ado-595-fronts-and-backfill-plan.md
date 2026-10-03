# Handoff: ADO-595 new fronts + 2-year backfill plan (October 2 to 3, 2026)

**Card:** ADO-595 (Testing), epic 543. ADO-596 (traffic report) was created in Todo. Commits on test: `3670862`, `fe78b80`.
**Canonical doc:** `docs/features/events-tracker/plan-595-fronts-backfill.md` (open decisions D1 to D6 are in section 0).

## What Josh asked
- Fronts for Hegseth (firings, Signalgate), Kushner's shady dealings, Israel (involvement in our elections, AIPAC, pulling us into Iran, Gaza) and RFK.
- The important stories from the last ~2 years, and a way to add things by hand later.
- Then: a plain-English site traffic report (that became ADO-596).

## What was done
- **Fronts, live on TEST:**
  - Hegseth's Pentagon is now flagship.
  - Kushner's Deals is now "The Envoys' Deals" (Kushner + Witkoff; slug `kushners-deals` kept).
  - New "Israel & Gaza" (`israel-gaza`, priority 75) and "RFK Jr.'s HHS" (`rfk-hhs`, priority 85).
  - TEST: 62 / 1 / 37 / 21 stories. Values were written from the SQL file's constants and read back byte for byte.
- **PROD paste files:**
  - `scripts/maintenance/2026-10-02-ado-595-new-fronts.sql`, then `scripts/maintenance/2026-10-01-ado-592-hegseth-pentagon-front.sql`, **in that order**. Hegseth's one-time sweep can only lose to fronts that already exist.
  - Each file is a pre-check, ONE BEGIN..COMMIT apply block, then a result query.
  - On any error, run `ROLLBACK;` first.
- **Test:** `scripts/tests/fronts-sql-pglite.test.mjs`, 29 checks, all pass. It is test-only and not in qa:smoke, because pglite is not a declared dependency.
- **Research (4 parallel agents):**
  - Seed timelines in `docs/features/events-tracker/seeds/` (211 dated developments with sources).
  - A code audit of backfill blockers.
  - A comparison of news sources. Recommended: Wikipedia citations plus an agent pass for the seeds, then our own importer. Paid APIs and the Guardian/NYT APIs are out.

## Reviews
- `/code-review medium` x3:
  - Round 1: 4 findings (over-broad Envoys, Israel and RFK rules; "Kushners" missed).
  - Round 2: 3 findings (direction of the Israel push rule; bare billion/invest; Tehran-only headlines).
  - Round 3: 1 finding (a failed transaction needs a ROLLBACK note).
  - All fixed.
- Cowork review: 6 findings, all fixed in `fe78b80`. The SQL now applies in one transaction with enforced priority guards. The plan now requires SSRF rules, a date guard on all 3 clustering attach paths, and no reopen from old articles, and its Envoys wording matches the SQL.
- qa:smoke passed.

## Gotchas
- Fronts are one-per-story and sweeps never move a filed story. Every sweep rule is permanent, which is why the Envoys and RFK sweeps are narrow and leave edge cases to the ADO-592 agent.
- Bash heredocs collapse backslashes. Regex constants were edited by writing replacement text with the Write tool and swapping it in with node. The Hegseth file is CRLF.
- Another session (ADO-597) was committing in the same folder. Stage files explicitly.

## Findings recorded on cards (not fixed here)
- **ADO-547:** dead `articles-manual` + `manual-article-processor.js` + 2 workflows, and `CLAUDE.md` still points at them; B2 manual-add requirements.
- **ADO-592:** headlines the sweeps leave to the agent on purpose (Envoys diplomacy, bare "Kennedy", Tehran/Khamenei-only).

## Proposed cards (need Josh's OK)
- **B1, backfill importer** (after D1): SSRF-safe fetcher, ingest with the real publish date, date guard on all 3 clustering attach paths, no reopen. About $0.50 of OpenAI one time plus 1 to 2 days of Stories-agent capacity.
- **Kennedy Center front** (D5): about 30 TEST stories, all loose ends today.

## Next session
1. PROD paste: the ADO-595 file, then Hegseth. Claude loads each in the SQL Editor and Josh presses Run. Then check trumpytracker.com.
2. ADO-596 traffic report (also closes ADO-564).
3. Josh's D1 to D6. On D1 approval, create B1 and fold B2 into ADO-547.

Cost this session: $0 cash (no OpenAI calls; regex SQL; Claude plan usage only).
