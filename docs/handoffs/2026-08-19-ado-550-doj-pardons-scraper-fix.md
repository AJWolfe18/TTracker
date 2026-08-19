# 2026-08-19 — ADO-550: DOJ pardons scraper fix + staleness tripwire (overnight autonomous run)

**Ticket:** ADO-550 (Bug, Active — PR pending Codex review)
**Branch:** `ado-550-doj-scraper-fix` → PR to test (per Josh's mid-session instruction: PRs, not direct pushes)
**Session mode:** fully autonomous overnight run (after ADO-551 in the same session)

## Root cause (confirmed, reproduced)

DOJ changed the section-header dash from a hyphen to an **en dash (U+2013)** starting with the
"February 12, 2026 – 7 Pardons" section. `parsePardonDate()`'s count-suffix regex only matched a literal
hyphen, so `new Date("February 12, 2026 – 7 Pardons")` → NaN → `currentDate = null` → every table in those
sections skipped silently. Reproduced against the live page: old parser yields exactly the 116 historical
entries from the ticket; the dropped sections are Feb 12 (7), Jun 4 (1), Jul 3 (17) = 25 missing grants.
The page markup is otherwise UNCHANGED (same h3 + 4-column tables). "July 6" from the ticket is the page's
"Updated July 6, 2026" stamp, not a grant date.

## The fix (`scripts/ingest/doj-pardons-scraper.js`)

1. **Dash normalization** in `parsePardonDate`: unicode dashes U+2010–U+2015 + minus U+2212 → `-`, and
   nbsp → space, before the count-suffix regex. Both old and new header formats parse.
2. **Pure parser extracted**: `parseDOJHtml(html)` exported (fetch stays in `scrapeDOJPage`); module got a
   direct-run guard so tests can import without firing `main()`.
3. **Tripwire** (ADO-466 pattern, after inserts, non-dry-run):
   - Any date-like h3 (contains a year) that fails to parse → `recordSkip(pardons_ingest/parse_error)` + exit 1.
   - `inserted === 0` AND newest page date > newest DB `pardon_date` (per `source_system='doj_opa'`) →
     `recordSkip(pardons_ingest/staleness_tripwire)` + exit 1.
   - Exit 1 fails the workflow (`set -euo pipefail`) → existing Discord failure alert fires. New constants
     added to `scripts/lib/skip-reasons.js` (`PARDONS_INGEST`, `STALENESS_TRIPWIRE`); `pipeline_skips` is
     free-form TEXT, no migration needed.
4. **Tests**: `scripts/tests/doj-pardons-parser.test.mjs` (9 cases: both dash formats, em dash, mixed page,
   tripwire signal, group proclamation, malformed rows, URL absolutization). Wired into package.json as
   `qa:pardons-parser` and added to `qa:smoke`.

## Verification (all done on TEST)

- Fixed parser vs live page: **141 parsed** (116 + 25), zero unparsed headers, newest date 2026-07-03.
- Real run against TEST DB: **51 inserted, 90 duplicates, 0 errors** (TEST was staler than PROD — it also
  lacked Nov 2025–Jan 2026 rows). TEST newest `pardon_date` now 2026-07-03. New rows are `is_public=false`,
  `research_status='pending'` (normal ingest defaults — enrichment publishes them).
- Idle re-run: 0 inserted / 141 duplicates / exit 0 — **no false tripwire** when page == DB.
- Tripwire firing path: simulated stale condition (page 2027-01-01, inserted 0) trips correctly and
  `recordSkip` wrote `pipeline_skips` row id 491 on TEST (left in place as evidence; 30-day retention).
- Note: the DOJ page lists the Jan-20-Amended trio (Herrera Velutini, Rossini, Vázquez Garced) under BOTH
  Jan 15 and Jan 20 — they correctly exist twice (name|date dedup is by design; PROD already has the trio).
- `npm run qa:smoke` green including the new suite; 121 vitest unaffected.

## PROD rollout path

PROD daily cron runs off **main** — the backlog lands on PROD only after this PR merges to test and the
commit is cherry-picked to main (next PROD deploy). Until then PROD stays green-but-stale (old code has no
tripwire). Downstream pardons Claude agent (daily 20:00 UTC) is healthy and will enrich the new rows
automatically. Cost: $0 AI for the scraper; backlog enrichment ≈ a few dozen pardons, well within daily spend.
