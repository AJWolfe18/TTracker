# Handoff: September pardons re-enriched, clemency type fixed, ADO-588 closed (September 23, 2026, evening)

All clock times are Central (CT). UTC = CT + 5 hours. Session ran about 8:30 PM to 10:15 PM CT.
Previous handoff (September 21): `2026-09-21-pardons-blank-page-eo-review-ado-589.md`.

## Outcome in one line
Josh noticed the September pardons were missing from the site. 21 of the 30 September grants had been
enriched blind (the ADO-588 research bug), so they were flagged and hidden. The scraper had also
labeled all 29 September 3 rows as commutations when only 6 are. Josh ran two PROD SQL fixes, the
agent is re-enriching the rows with working research, ADO-588 is Closed, and two new Bugs
(ADO-590, ADO-591) cover the code and schema fixes. No code changed this session.

## 1. Pardons pipeline status
- DOJ page came back on September 22 (Last-Modified 9:53 AM CT). Runs September 22 and 23 were green:
  171 parsed, 0 inserted. Newest DOJ grant is still September 8 (Emory Clash Jones, id 173).
- The 30 September rows were inserted on September 9 (run at 3:45 PM CT). Nothing new since.
- The site reads pardons via anon PostgREST (`is_public=eq.true`); hidden rows can't be read from a
  dev session (Supabase MCP has no PROD permission, no PROD service key locally, admin needs the password).

## 2. PROD data fixes Josh ran (SQL editor, scratchpad files, both guarded by an exact row count)
1. Reset `enriched_at = NULL` on the 21 hidden, review-flagged September rows not on prompt v1.2
   (ids 147-150, 153-158, 160, 164-173). Matched 21.
2. Clemency type: the September 3 section is one mixed table under "23 Pardons and 6 Commutations".
   Warrant PDF Title metadata names the type. Real commutations: Bloom 148, Dougherty 153,
   Frantzen 156, Harden 158, Haymon 159, Williams 172. The other 23 were set to 'pardon' and their
   `enriched_at` cleared, so write-ups that said "commutation" get redone. Public rows stayed public.
3. Migration `063_corruption_level_zero.sql` applied by Josh (ADO-591). Returned "no rows", as expected.
   NOT yet verified that no old 1-5 check survives under another name (read-only check is in ADO-591).

## 3. Re-enrichment runs (PROD routine `trig_018LUznaUWwijFhMZLp8kYE2`, 5 rows per run, manual trigger)
- Run 1 `cse_011ASkAK3BNA1VStybsFhW1h` (9:27 PM, log id 145): health check passed, real WebSearch
  results, 5 enriched, 0 failed. Dougherty L3, Brooks and Campo L1 published; Bidon and Bloom held.
  Bidon was scored L0 but PROD's check rejected 0, so the agent wrote L1 and flagged her (ADO-591).
- Run 2 `cse_01GTxSVyBCYg9A4E8mckvUkt` (9:46 PM) completed. Run 3 `cse_01DWhiu7bkKthGYvf8MqTg7u`
  (10:01 PM) was running at session end.
- At 10:10 PM CT, 11 September rows were public. Roughly 3-4 more runs clear the queue; the daily
  3 PM CT run finishes it if nobody triggers them manually.

## 4. ADO
- ADO-588 Closed: all 7 AC recorded MET (AC 6 from run 1's log, AC 7 `qa:smoke` exit 0 on test).
- ADO-590 (Bug, New): the scraper takes clemency_type from the section heading. Fix: per-row type from
  the warrant PDF Title; if the Title is missing, fall back to 'pardon' and call recordSkip.
- ADO-591 (Bug, New): PROD rejected corruption_level 0. Migration applied; verify the constraint,
  review Bidon (id 147), close.

## 5. Gotchas
- The Claude Code auto-mode classifier blocks Claude from WRITING PROD DDL/SQL files for Josh
  ("Production Deploy"). Point Josh at the existing repo migration file instead, or have him add a
  permission rule. Data-fix SQL (UPDATE with a row-count guard) was allowed.
- A DOJ section heading can name both types; never trust the heading for clemency_type.
- Warrant PDFs: `/pardon/media/<id>/dl?inline`; the Title metadata holds "YYYY-MM-DD Pardon|Commutation
  Warrant <name>", but some have none.

## 6. Next session
Prompt (also given to Josh in chat): `/start-work ADO-591 then ADO-590`: verify the PROD
corruption_level constraint, have Josh review Bidon, close 591; then build the ADO-590 scraper fix
with a mixed-section fixture test, review, QA, and PR to main. Also confirm the September re-enrichment
queue is empty. Unchanged older items: PR #151 (ADO-577) awaiting Josh's Codex, TEST key rotation,
ADO-587 discussion, Supabase DB-size quota decision, EO 14426 Publish click.
