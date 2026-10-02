# Front Assignment Agent (Election Suppression) - Plan

**ADO:** 582 (ADO-581 session 2). Parent epic 543. Status lives on the card, not here.
**Prompt:** `prompt-v1.md` in this folder (the deliverable the cloud routine reads at run time).
**Migration:** `migrations/116_front_agent_candidates.sql`.
**Cost:** $0 marginal (Claude subscription cloud routine). No OpenAI. Egress per run: headline + summary for at most 80 stories (about 100 KB).

## Why

The migration-115 regex sweep runs every pipeline cycle and files the obvious election stories. Two classes are still missed, by design:

1. **Redistricting.** Pulled out of the sweep on September 14, 2026: a PROD dry run showed 125 of 357 alarm-3+ matches were map fights, and under the floor-3 main-line rule they would have drowned the homepage. Josh still wants the real ones ("Missouri court allows Trump-backed districts").
2. **Judgment cases.** History pieces, rhetoric, mobilization stories and horse-race coverage that carry election words but are not the state changing the rules. More regex is the wrong tool (ADR 0001: judgment problems get a Claude agent, not prompt-tuning on a pattern).

## Shape (mirrors the SCOTUS / Stories cloud agents)

```
GitHub Actions RSS run (every 2h)          claude.ai routine (daily 14:00 UTC)
  assign-fronts.js  (regex sweep)   ---->    Front Assignment Agent
  refresh-tracker.js                         1. front_agent_candidates('election-suppression', 25)
                                             2. judge each: assign / decline (Section 4 rubric)
                                             3. story_event row  |  pipeline_skips row
                                             4. loop pages until empty or MAX_PER_RUN
                                             5. refresh_tracker_derived()  (main line updates today)
                                             6. Discord one-liner if assigned > 0
```

**Ordering.** The ADO card says "after `assign-fronts.js` and before `refresh-tracker.js`". A cloud routine cannot sit inside a GitHub Actions job, so the equivalent is: the routine runs after the sweeps have had their turn (every 2h all day) and ends by calling `refresh_tracker_derived()` itself, exactly what `refresh-tracker.js` does. The pool it sees is only what the regex did not catch, because the sweep's `story_event` rows exclude those stories from the RPC.

**Why an RPC instead of PostgREST filters.** The pool needs two `NOT EXISTS` (no `story_event`, no prior decline since last update) and a regex on two columns. PostgREST cannot express the anti-joins; the RPC keeps the pool definition in one place and lets the pattern live as data on `events.agent_pattern` (the migration-115 convention: tune with `UPDATE`, never a prompt edit).

**Why a `note` column on `story_event`.** The spot-check and Josh's audit need to see *why* a story was assigned. `confidence` alone is not auditable. `note` is hidden from anon by a column-level grant (same treatment as `tracker_pin.note`, migration 112).

**Decline dedup.** A declined story would otherwise be re-judged every day while it stays active. The RPC excludes stories with a `front_assignment / agent_declined` skip row created after the story's `last_updated_at`. New articles bump `last_updated_at`, so a story that grows is judged again. `pipeline_skips` retention is 30 days; a still-active story older than that gets one more look, which is fine.

**Candidate pattern (current value).** `events.agent_pattern` for `election-suppression`, tightened September 30, 2026 (TEST applied; PROD paste in `scripts/maintenance/2026-09-30-ado-582-tighten-agent-pattern.sql`, which also holds the rollback):

```
\m(voters?|voting|ballots?|precincts?|redistrict\w*|gerrymander\w*|congressional maps?|district maps?|polling (place|places|location|locations|hours|site|sites)|certif(y|ies|ied|ying|ication))\M
```

The migration 116 seed also matched `elections?`, `electoral`, `votes?`, `midterms?`, `polls?`, bare `polling` and `pollsters?`; the first PROD run judged 80 and declined 73, mostly horse race, polls and House floor votes. Rule for any future change: the new pattern must still match every story the agent has assigned (`story_event.note LIKE 'fronts-v1%'`); the maintenance file's DO block enforces it. Never re-run migration 116 PART D (it resets to the broad seed). `front-agent-prompt.test.mjs` reads the pattern from the maintenance file, so a new value = a new maintenance file + repoint the test.

**Concurrency.** `story_event.story_id` is the PK, so two writers cannot both assign. The agent treats 409 as "already assigned" and moves on. It never PATCHes.

## Decisions (Josh, dated)

| Date | Decision |
|------|----------|
| September 8, 2026 | Session 2 = a Claude agent for the election front ONLY (not all fronts) |
| September 14, 2026 | Redistricting out of the regex; the agent judges map stories |
| September 15, 2026 (Claude, on the pattern) | Agent runs as a claude.ai routine that self-refreshes the main line; not a GH Actions step (no API spend, matches the four existing agents) |
| September 15, 2026 (Claude) | Assign threshold 0.70; borderline leans are declines with `uncertain: true` so they are queryable |
| September 30, 2026 | PROD cron `0 14 * * *` UTC (9 AM CT) daily |
| September 30, 2026 | Before the PROD backfill: tighten `agent_pattern` (generic election/midterm/poll/vote words out) and record a page of decisions per script call (`record <file>`) instead of one call per story |
| September 30, 2026 | Every front gets the agent: ONE agent picks the best front or none for each story (ADO-592), not one agent per front |

## Open decisions (Josh)

- **Other fronts.** Decided September 30, 2026 (row above): one all-fronts agent, ADO-592. Draft patterns for the other 7 fronts are in the next section; their own open decisions are listed there.

## ADO-592 groundwork: agent patterns for the other 7 fronts (October 1, 2026)

**File:** `scripts/maintenance/2026-10-01-ado-592-agent-patterns.sql`. **Not applied anywhere.** It runs by hand as part of the ADO-592 build (TEST first, PROD before the all-fronts routine goes live there). Nothing reads these values today (`front-agent-db.js` is hardcoded to `election-suppression`). The file has a read-only pre-check, a guarded `UPDATE`, a result query and the rollback.

**How each draft was built.** Every pattern is `<the front's sweep_pattern, verbatim from migration 115 PART E> | \m(<extra terms>)\M`. Keeping the sweep verbatim makes each pattern a superset of its sweep, so every sweep-assigned member (sweeps read the headline) matches by construction, on TEST and on PROD, and no old sweep term is lost (for example the-courts keeps "constitutional crisis", "existential threat", "ignored the ruling" and "attacks on the courts"; trump-crypto keeps "$TRUMP"). The pattern is also tried on `summary_neutral` (most sweeps read the headline only), and the extras add the obvious synonyms the sweep misses. The pattern only bounds the pool; the agent does the judging, so a few off-topic matches are fine.

**Gate (per front, stricter than ADO-582).** Every current member of the front (sweep, hand or agent) must match the new pattern on headline or summary. The 582 gate only checked agent-assigned members, and none of these 7 fronts has any yet. Each front is decided on its own: a front with a member outside its pattern, or with a different non-NULL pattern already set, is skipped with a NOTICE naming the reason and the story ids, and the other fronts still apply. So one PROD hand-assigned member cannot block all 7, and a front can be left out on purpose by deleting its line. The result query shows NOT APPLIED with NULL counts for a skipped front, never a zero that looks like a pass.

**How it was measured (TEST, October 1, 2026).** Through PostgREST only (no SQL access from this lane), read-only, ids only, no `content` or `embedding`. PostgREST `imatch` is the same `~*` operator the RPC uses. The pool replicates `front_agent_candidates()`: `status = 'active'`, headline and summary not null, headline OR summary matches, and no `story_event` row (an embedded anti-join). The decline exclusion is 0 for these fronts because no front other than election has decline rows yet (checked). Member misses were queried as "neither column matches, NULL counted as no match", the same as the 582 gate's `COALESCE`; that query does return the 2 sweep members outside the election pattern (15099, 17394), so it is not vacuous. The SQL file itself was also run end to end in an in-memory PGlite with migration 116's function: it applies all 7, re-runs cleanly, skips only the affected front when a member falls outside or a different pattern is set (the other 6 still apply), and the result query shows NOT APPLIED before the apply. The same run checks that every pattern starts with its migration 115 sweep verbatim. TEST has 645 active, enriched, unassigned stories.

| Front | Draft pattern (the sweep, plus these extras) | TEST pool | Current members | Members matched | Notes |
|---|---|---|---|---|---|
| epstein-files | sweep `epstein`; extras: ghislaine, giuffre, birthday book, client list | 0 | 181 | 181 / 181 | The headline sweep already caught every Epstein story. Bare "maxwell" was dropped: on TEST it only pulled in an unrelated Paxton story (17226). |
| iran | sweep iran/iranian; extras: iran*, tehran, hormuz, khamenei, irgc, ayatollah, fordow, natanz, isfahan, war powers | 10 | 43 | 43 / 43 | Pool: Hormuz mine clearing, the UK and the blockade, war-powers votes, plus stories that mention Iran only in the summary (16923 on inflation, 16899 on the 25th Amendment). |
| trump-crypto | sweep crypto, memecoin, meme coin, $TRUMP, world liberty, stablecoin, bitcoin, binance; extras: meme coins, wlfi, usd1, digital assets, tokens, nfts, digital trading cards | 2 | 6 | 6 / 6 | Pool: Melania NFT earnings (17045), and 16999. The sweep needed a Trump co-word; the agent judges that instead. |
| qatar-jet | sweep `qatar`; extras: 747, jumbo jet, boeing, new/gifted/qatari/luxury/replacement air force one | 1 | 1 | 1 / 1 | Bare "air force one" was dropped on purpose: on PROD, "aboard Air Force One" press-gaggle stories would flood the pool. |
| selling-the-white-house | sweep `ballroom`; extras: east wing, donors, donations, fundraising, incognito, pay to play, fine arts commission, capital planning commission | 2 | 13 | 13 / 13 | Pool: a Democratic AI PAC (17215) and the campaign-spending ruling (17022), both likely declines. "donors" may pull in more campaign-finance stories on PROD; watch the PROD pool in the result query. |
| the-courts | the full migration 115 sweep (defy/defiance, contempt, ignored the court/ruling/order, constitutional crisis, impeach a judge, existential threat, attacks on the judiciary/courts); extras: judges, judiciary, judicial, injunctions, restraining orders, court orders, appeals/circuit/district courts, appellate, unconstitutional, struck down, impeach*, boasberg, block/blocked/blocking | 50 | 9 | 9 / 9 | The largest pool, and mostly real candidates (judges ordering the Pentagon, ICE and FEMA; Guard deployments; Comey). Noise is "blocks" and "defiance" in tariff stories. See decision 1 for the wider variant (98). |
| kushners-deals | sweep `kushner`; extras: affinity partners, jared, public investment fund, pif, sovereign wealth, electronic arts, saudi*, emirat*, abu dhabi, gulf money/states/investors/investment/royals | 4 | 0 | 0 / 0 | No members on TEST. The Gulf terms bring in the MBS visit and Khashoggi stories (3 of the 4). See decision 2. |

**Union of the 7 pools on TEST:** 69 stories (10.7% of the 645 unassigned); no story is in two pools. The election pool is 0 right now (the RPC returns no rows: everything is judged). **PROD will be much larger:** the election pool was 1,095 on PROD against 38 on TEST. The result query in the SQL file reports the real PROD pools per front, read from the RPC's own `pool_size`. These pools are counted before any ADO-594 "coverage" filter; if the 594 design is approved (PR #160, decision D7), the pool shrinks further and the patterns do not change.

**Cost:** $0. The SQL is a one-row-per-front `UPDATE` plus counts; the agent runs on plan usage.

### Open Decisions (Josh)

1. **The Courts: tight or wide pattern?** Tight (the draft): 50 on TEST. Wide adds `supreme court`, `justices`, `ruled`, `ruling(s)`: 98 on TEST, mostly Supreme Court news and generic "ruling" stories. *Recommended: tight.* Supreme Court rulings already have their own tracker source, and the tight set still catches the judge-versus-administration fights the front is about. Choosing wide = add those four terms to the-courts line in the SQL file. Blocks only the-courts (the file applies each front on its own).
2. **Kushner's Deals: keep the Gulf terms?** With `saudi`, `emirati`, `abu dhabi` and `gulf money`, the pool catches Gulf deals whose summary does not name Kushner, at the cost of state-visit stories the agent will decline (3 of 4 on TEST). *Recommended: keep them.* The front's description is "Gulf money", and a decline costs nothing but a little plan usage. Blocks only kushners-deals; the other fronts can apply without it.
3. **When to apply the file.** *Recommended: as part of the ADO-592 build, not before.* Applying early does nothing (no routine reads these fronts yet) and would only need re-checking if members change in the meantime. The DO block re-checks the gate at apply time either way, and on PROD it may skip a front whose hand-assigned members fall outside its pattern; the NOTICE lists those ids for a pattern fix.

## Verification

- TEST: migration 116 via SQL editor, push prompt to `test`, create the TEST trigger (env `env_01YRYGLu8C8ijpVWdPAwgVSQ`, branch `test`, no cron), run once, read `story_event.note` + `pipeline_skips` rows, spot-check 30 (AC 1).
- PROD (next session, after Josh's TEST review): migration 116 on PROD first, cherry-pick to main, create the PROD trigger with the cron, run once for the backfill (AC 4), check trumpytracker.com.

## Rollback

Disable the routine (`enabled: false`). Assignments are rows: `DELETE FROM story_event WHERE assigned_by = 'agent' AND note LIKE 'fronts-v1:%'` then `SELECT refresh_tracker_derived()`. The migration is additive (column + function); leaving it in place is harmless.
