# ADO-608: homepage leads with alarm 4-5, ICE & Deportations front, homepage design round

**Date:** October 3, 2026 (evening, CT) · **Cards:** ADO-608 (Active), ADO-548 (design comment), ADO-609 (new bug) · **Branch:** test

## Why

Josh: a first-time visitor does not get anything memorable. The homepage showed "white" minor items, it did not say what the site tracks, and it did not read as an action tracker.

Measured on PROD (anon reads, October 3, 2026):

- The main line for September 3 to October 3 had 88 entries. 87 were Election Suppression and 63 of those were alarm 3, because rule v1.2 gave that front an alarm floor of 3.
- Every other front was close to invisible. The new-peak clause hid Iran's 9 alarm-4 developments.
- There were zero alarm-5 stories in those 30 days, so "lead with the 5s" alone would show nothing.
- 77 alarm-4 stories had no front. Roughly a third were ICE and deportations.

## What shipped (committed and pushed to test)

| Piece | Where |
|---|---|
| Rule v1.3: pins win; published-front member on at alarm_eff 4+; loose end at 5. The opening, new-peak and floor clauses are retired, and the election floor is cleared. Ends with a refresh. | `migrations/122_main_line_rule_v1_3.sql` |
| EOs, SCOTUS rulings and pardons on the main line from level 4 (was 5): `MAIN_LINE_SOURCE_ALARM` | `src/lib/timeline.ts`, test updated |
| ICE & Deportations front: flagship, alarm 5, sweep priority 72 (after Election 50 and Courts 70, before Israel 75, Iran 80, RFK 85, Hegseth 90). Guarded PROD paste file with a targeted sweep and refresh. | `scripts/maintenance/2026-10-03-ado-608-ice-front.sql` |
| End-to-end PGlite test of both SQL files: rule branches, 25 headline placements, idempotency, all-or-nothing, guards, rollback | `scripts/tests/ice-front-sql-pglite.test.mjs` (not in qa:smoke; PGlite is undeclared) |
| Docs | `docs/database/database-schema.md` rule v1.3; PRD section 12 decision entry plus D4 marked superseded |

ICE regex evidence: run against PROD unassigned stories, it matched more than 1,000 (PostgREST caps the count at 1,000). A read of 70 random hits found all on topic. A bare case-insensitive "ICE" match would also hit "Justice" and "Service", so the pattern uses word boundaries (`\m...\M`). Weather and sports "ice" is excluded only when the headline has no immigration word (code review finding, fixed).

Size of the new main line on PROD, front members at 4+ per month: Jul 64, Aug 36, Sep 44, plus ICE at about 20 a month. January to June are dense (March 641) because GPT-era enrichment rated about two-thirds of stories 4+. ADO-594's labels are the planned thinning.

## State of each environment

- **TEST:** the ICE front is live (events id 18, 173 stories, written over PostgREST from the file's constants and read back byte for byte). The sweep co-word on TEST holds the round-2 review fix (generic words no longer rescue weather/sports "ice"); no TEST member depended on the looser version. **Rule v1.3 is NOT applied yet** (Josh paste).
- **PROD:** nothing applied.

## Next steps, in order

1. **Josh, TEST:** paste `migrations/122_main_line_rule_v1_3.sql` into the TrumpyTracker-Test SQL Editor. Expect one row starting with `rows_changed`.
2. Claude verifies on TEST: no alarm-3 rows on `main_line=is.true` except pins, and several fronts including ICE show at 4+.
3. **Josh, PROD:** paste migration 122, then the ICE file in its three parts (pre-check, the BEGIN-to-COMMIT apply block, result). Expect `ice-deportations` with several hundred members and `members_outside_pattern` 0.
4. PROD PR: cherry-pick d195cd0, a8a4376 and 0866473 (0866473 also carries this handoff; the mockups are not in git). The frontend change is independent of the SQL order.
5. AC4 check on PROD, then ADO-608 moves to Testing and on.

## Homepage design round (ADO-548, NOT built)

Four rounds of mockups. All are local and gitignored: `.superpowers/brainstorm/events-homepage-v2/topics-v1..v4.html`, `v5-compare.html` (A/B/C) and `v6-compare.html` (A, A+, A+ with tabs). The generator scripts were in this session's scratchpad only. The HTML files embed their data, so they open standalone.

- **Rejected:** colored tiles with counts and headlines ("way too busy"), a separate card-grid Topics page, and colored topic cards with taglines ("crackers on a box", "not professional"). Colored borders and boxed tags read as clutter.
- **Liked:** A (plain text index of topics) and C (text tabs). Josh wanted A "with more oomph".
- **Pick to confirm with Josh:** **A+ with tabs.**
  - A promise line: "Everything Trump is doing, in one place. We follow 12 ongoing stories, from ICE raids to the Epstein files, and log every major move as it happens."
  - A live status line.
  - A scoreboard list of topics showing big moves in the last 30 days, sorted, with a red dot for a big move this week.
  - Sticky text tabs once the list scrolls away.
  - Tapping a topic filters the homepage timeline in place, with its own URL (no separate front page) and a Biggest moves / Everything switch.
  - Near-monochrome; red only for alarm 5.
  - Every timeline row names its type ("Supreme Court") and its topic.
- The research basis was a one-line promise, topics as plain text, and plain-English labeled entries. Sources: Christina Pagel's Trump Action Tracker and Just Security's collection.

## Findings not fixed this session

- **ADO-609 (Bug, new):** Supreme Court rows show `case_name` ("Nelsen v. Pike"). `scotus_cases.media_says` already holds a plain-English headline.
- **Duplicate stories on PROD (proposed card, needs Josh's OK):** the September 25 SCOTUS voter-database ruling appears as about 5 separate stories. That case is the Clustering Judge's job. ADO-583 (Judge write denials) is Closed, so a new card should check whether the PROD Judge runs and saw these pairs.
- **PROD `v_event_stats` times out on an anon read (57014):** front counts for ADO-548 must be precomputed. Noted on ADO-548.

## Gotchas from this session

- The Bash tool collapses `\\` inside heredocs. Write scripts containing backslashes with the Write tool.
- The Supabase MCP connector in this session only reaches WhiskeyPal. TTracker DDL still goes through Josh's SQL Editor paste, while data writes and RPCs on TEST work through the supabase-test PostgREST MCP.
- PROD anon reads (public key in `src/lib/supabase.ts`) are a cheap way to measure published data. `primary_headline=imatch.<regex>` runs Postgres `~*`, which is how the ICE pattern was tested against PROD.
