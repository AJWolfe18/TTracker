# Handoff — ADO-466 PROD Deploy + EO Claude Agent Epic Created

**Date:** 2026-04-14
**Session length:** ~4 hours
**Closed:** ADO-466 (silent-skip visibility), ADO-475 (pubDate bug)
**Created:** ADO-476 (EO Claude Agent epic) + 6 child stories (477-482)

## What shipped

### ADO-466 to PROD
- Migration `20260412000000_pipeline_skips.sql` applied to PROD (project `osjbulmltfpcoldydexg`)
- Edge function `admin-pipeline-skips` deployed to PROD
- PR #84 merged with 8 commits (7 ADO-466 + 1 ADO-475 ride-along)
- First PROD RSS run verified: 86 rows in `pipeline_skips` (freshness_filter from Politico), Failures tab populates
- `Pipeline Skips Cleanup (PROD scheduled)` workflow active for 30-day retention

### ADO-475 AI review catch
First AI review flagged a legitimate edge case the initial fix missed: non-empty-but-invalid `isoDate` strings still fell through to `now()` instead of `pubDate` because `||` only checks truthiness. Enhanced fix (commit `2883143`) validates via `Date` parse before using. Re-reviewed clean.

## What's teed up for next session

**Start here:** ADO-477 (S1 of EO Claude Agent epic) — create `executive_orders_enrichment_log` table, apply to TEST, update schema doc. Mirror `scotus_enrichment_log` pattern (migration 090).

## Key decision this session

**EO Claude Agent — full migration, not prompt iteration.**

Audited 25 enriched EOs (prompt v4-ado273) and confirmed structural issues:
- 88% rated alarm_level 4, zero at levels 0/1/2 (rating scale collapsed)
- "dangerous precedent" in 76%, "under the guise of" in 52% (boilerplate saturation)
- 0 of 25 EOs named a specific real person/company/lobbyist
- Fabricated cronyism on routine policies (LIRR Railway Labor Act board, wrongful-detention protection)

Hard facts (order numbers, dates, statutes) are fine. The failure is "who benefits / real agenda" invention + tone calibration collapse — classic GPT-4o-mini failure modes that don't respond cleanly to prompt rules.

Initial proposal was a "Quality Pass" story for prompt iteration. Josh rejected: "we spent 2 months longer than we should have chasing our tails on SCOTUS" — the Claude agent solved in 1 prompt file what 4,300 lines of SCOTUS enrichment code couldn't. Same pattern applies here.

## Epic structure (ADO-476)

| Card | Story | Next-session readiness |
|---|---|---|
| 477 | Agent run log for EOs | ✅ Start here |
| 478 | EO voice + gold-set validation | Needs 477 |
| 479 | Daily automated enrichment (TEST) | Needs 478 |
| 480 | Admin dashboard EO tab | Needs 479 |
| 481 | PROD launch + backlog re-enrichment | Needs 480 |
| 482 | Retire legacy EO scripts | Needs 481 + 5d stability |

Pattern reference: ADO-467 (SCOTUS Claude Agent Epic). Architecture, prompt structure, trigger config, admin UX all directly applicable.

## Follow-ups

- **ADO-474** (silent-skip instrumentation for old EO pipeline) — will be obsoleted by S1 (agent has observability built in). Close when S6 closes.
- No cleanup owed on this session's PR #84 — merged clean.

## Gotchas hit

- `migrations/` (root) on `main` vs `supabase/migrations/` on `test` — git auto-relocated the new migration file on cherry-pick. Accepted the auto-relocation.
- `gh pr merge --squash` threw a local fast-forward warning that looked like failure. Remote merge actually succeeded — always verify with `gh pr view <id> --json state,mergedAt`.
