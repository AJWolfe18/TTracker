# ADO-605, 608 and 610 on PROD: homepage leads with 4-5, ICE and Trump Corruption fronts

**Date:** October 4, 2026 (CT) · **Cards:** ADO-605, ADO-608, ADO-610 (new), ADO-611 (new), comments on ADO-592 and ADO-594 · **Branch:** test (72a84c4 + this handoff) · **PROD PR:** #174 (squash-merged 1:48 PM CT)

## What is live on PROD now

| Piece | How it got there | Checked |
|---|---|---|
| ADO-605 faster phone home page (boot prefetch, immutable hashed assets) | PR #174 | `assets/*` serve `max-age=31536000,immutable`; `/` and `flags-prod.json` stay `must-revalidate` |
| Migration 122, main-line rule v1.3 | Josh pasted (TEST October 4, PROD October 4) | PROD: 1,723 rows changed in 89 s (one-time; a normal pipeline refresh is about 1 s) |
| EO/SCOTUS/pardons at level 4+ (`MAIN_LINE_SOURCE_ALARM`) | PR #174 | unit tests |
| ICE & Deportations front | Josh pasted the ADO-608 file on PROD | 1,263 members, 0 outside pattern; main line Jul 45, Aug 35, Sep 24 |
| Trump Corruption front (ADO-610) | Josh pasted on TEST then PROD | PROD 318 members (196 moved + 122 swept), 224 on the main line; old fronts draft with 0 members; anon cannot see them or the backup tables |

PROD main line, last 30 days after everything: 57 entries, none below alarm 4, across 8 fronts (Election 23, ICE 19, Iran 9, Corruption 2, and 1 each Hegseth, Israel, RFK, Courts).

## ADO-610: Trump Corruption

Josh, October 4: corruption should be ONE front covering crypto, the Qatar jet, abusing markets, Kushner, paying friends for the Reflecting Pool, and oil deals.

- File: `scripts/maintenance/2026-10-04-ado-610-trump-corruption-front.sql`; test: `scripts/tests/corruption-front-sql-pglite.test.mjs` (66 checks). Both are test-only.
- It merges trump-crypto, qatar-jet, selling-the-white-house and kushners-deals into `trump-corruption` (flagship, sweep priority 15). The old fronts become `draft` with no sweep. Their settings and every moved membership are in `front_merge_backup_events` / `front_merge_backup_story_event` (merge_tag `ado-610`, service-role only). The rollback is the file footer.
- One regex keeps each old front's rule (each co-word folded in as a lookahead, rare word first for speed) and adds: Reflecting Pool, East Potomac, oil deals and Harold Hamm, Trump/White House stock and insider trading, Trump Media, Trump Organization, emoluments/self-dealing/no-bid/FCPA, Greco and US anti-corruption bodies, gold card, the Trump presidential library, LIV Golf, the Trump family next to a money word, donors or cronies next to contracts/pardons/loans, and the compensation fund.
- Left to the assignment agent on purpose (too noisy as keywords): corruption, bribe, pay-to-play, donor alone, Rose Garden, the arch, Trump Tower, golf.
- Medium code review: 4 low findings, all fixed in 72a84c4 (story_event lock plus a straggler re-run, anti-corruption plurals and US anchor, no bare "administration", rollback refiles post-merge members via `assign_fronts_sweep(NULL)`).
- Codex reviewed PR #174 and found nothing. Its report did not mention the SQL files, so ADO-610's "Codex clean" criterion is unconfirmed (card left in Testing).

## Corrections made on cards

- **ADO-594's design is already approved** (October 1, PRD section 14, D1 to D8). The next step is the BUILD. A comment that said "design session" was corrected.
- **The daily Claude front pass only judges Election Suppression** (`front-agent-db.js` FRONT_SLUG). Other fronts' `agent_pattern` is inert until ADO-592, so they grow by keyword only. Corrected on ADO-592 and ADO-610.
- The ADO-592 agent-patterns file for the seven original fronts was never applied on PROD (noted on ADO-592).

## New cards and scope

- **ADO-610** Trump Corruption front (this work).
- **ADO-611** Research: official-action sources beyond EOs, pardons and SCOTUS (Federal Register, Congress.gov, USAspending, OGE).
- ADO-594 comment: also link EOs, pardons and SCOTUS rulings INTO fronts.
- ADO-592 comment: review every front (threads, PROD misses, keywords, agent definition) as part of the build.

## Proposed, awaiting Josh

- **Auto-apply migrations:** a GitHub Action applies new migration files and logs each one. TEST runs on push; PROD runs on merge, after Josh approves. It replaces SQL Editor pastes and stops TEST/PROD drift. $0. It needs the PROD DB connection string in a protected GitHub Environment.
- **AGENTS.md is stale:** it still says to comment `@codex review` and that automatic reviews are on (both retired August 25).

## Next session

1. ADO-594 build (S1 first), then ADO-592 with the per-front review.
2. Monday, October 5: `/scotus-review 2099,2399` for ADO-580.
3. ADO-548 homepage design: Josh to confirm "A+ with tabs" (unchanged since October 3).

## Gotchas from this session

- **Never `git worktree remove` a worktree whose node_modules has junctions into the main repo.** It follows them and empties the main `node_modules` (this session lost `.bin`, `@napi-rs` and `@tybys`). Remove each junction with `cmd /c rmdir` first. Recovery: `npm ci`, then `npm install --no-save @electric-sql/pglite@0.3.16`, then `git checkout -- node_modules` (126 tracked files there; they are also why a whole-folder junction fails).
- PROD anon PostgREST caps at 1,000 rows and times out around 3 s. An array length is not a count. The whole corruption regex times out as an anon read, so probe per branch.
- The PROD repo disallows merge commits. Use `gh pr merge --squash`.
- Supabase SQL Editor shows an RLS prompt on CREATE TABLE. "Run without RLS" is fine when the file enables RLS itself.
