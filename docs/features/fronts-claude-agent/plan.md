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
| hegseth-pentagon (new, see below) | sweep hegseth, pentagon, department of war, secretary of war, joint chiefs, boat strikes, drug boats, signalgate; extras: defense secretary, admirals, four-star, top brass, military leaders/officers/lawyers/commanders, JAG, judge advocates, illegal orders, signal chat, service members, warrior ethos | 9 (after its sweep) | 62 | 62 / 62 | Applied on TEST October 1, 2026 with its own file (it is a new front, not a pattern change). |

**Union of the 7 pools on TEST:** 69 stories (10.7% of the 645 unassigned); no story is in two pools. The election pool is 0 right now (the RPC returns no rows: everything is judged). **PROD will be much larger:** the election pool was 1,095 on PROD against 38 on TEST. The result query in the SQL file reports the real PROD pools per front, read from the RPC's own `pool_size`. These pools are counted before any ADO-594 "coverage" filter; if the 594 design is approved (PR #160, decision D7), the pool shrinks further and the patterns do not change.

**Cost:** $0. The SQL is a one-row-per-front `UPDATE` plus counts; the agent runs on plan usage.

### Open Decisions (Josh)

1. **The Courts: tight or wide pattern?** Tight (the draft): 50 on TEST. Wide adds `supreme court`, `justices`, `ruled`, `ruling(s)`: 98 on TEST, mostly Supreme Court news and generic "ruling" stories. *Recommended: tight.* Supreme Court rulings already have their own tracker source, and the tight set still catches the judge-versus-administration fights the front is about. Choosing wide = add those four terms to the-courts line in the SQL file. Blocks only the-courts (the file applies each front on its own).
2. **Kushner's Deals: keep the Gulf terms?** With `saudi`, `emirati`, `abu dhabi` and `gulf money`, the pool catches Gulf deals whose summary does not name Kushner, at the cost of state-visit stories the agent will decline (3 of 4 on TEST). *Recommended: keep them.* The front's description is "Gulf money", and a decline costs nothing but a little plan usage. Blocks only kushners-deals; the other fronts can apply without it.
3. **When to apply the file.** *Recommended: as part of the ADO-592 build, not before.* Applying early does nothing (no routine reads these fronts yet) and would only need re-checking if members change in the meantime. The DO block re-checks the gate at apply time either way, and on PROD it may skip a front whose hand-assigned members fall outside its pattern; the NOTICE lists those ids for a pattern fix.

## New front: Hegseth's Pentagon (October 1, 2026)

**Asked by Josh, October 1, 2026:** "a huge one right now that is super shady and the reasoning not clear". Folded into ADO-592 (no new card). **File:** `scripts/maintenance/2026-10-01-ado-592-hegseth-pentagon-front.sql` (pre-check, guarded insert, sweep, refresh, result, rename and rollback). **Applied on TEST** October 1, 2026 at 9:43 PM CT (events id 15). PROD is a Josh step.

**What belongs.** What Hegseth and the Pentagon leadership do to and with the military, and the fights over it: generals, admirals and military lawyers fired or pushed out with no stated reason, the Caribbean boat strikes and the orders behind them (including the killing of survivors), the Signal chat, press restrictions at the Pentagon, investigations of critics (Sen. Mark Kelly's "illegal orders" video), the renaming to the Department of War, and Congress forcing the Pentagon to disclose. **What does not.** The conduct of the Iran war stays on the Iran front. Ordinary foreign policy (Russia, Ukraine, NATO, China, Taiwan) stays a loose end. **National Guard deployments to US cities are left out of both patterns:** the White House orders them, their court fights already go to The Courts, and they recur like ICE raids (the PRD's "different shape", a possible front of its own). A Guard story still lands here when its headline names the Pentagon or Hegseth (for example "Pentagon to Withdraw Some National Guard Troops From Chicago and Portland").

**Rubric (PRD section 2):** sustained (since February 21, 2025), accumulating (62 TEST stories), stakes (alarm 5 stories), unresolved, nameable: 5 of 5.

**Name.** Three options; the first is used (a rename is the one-line `UPDATE` in the file; the slug `hegseth-pentagon` stays):
1. **Hegseth's Pentagon** (recommended): names the person and the institution, like "Kushner's Deals", and covers strikes, purges and press, not only the firings.
2. **The Pentagon Purge:** sharper, but the boat strikes and the press fight are not a purge.
3. **The Department of War:** uses the rename against itself, but readers may take it for the Iran war.

Row values follow the other fronts' launch (the August 24 seed): `tier` major, `alarm_level` 5, `lifecycle` open, `publish_state` published, `created_by` human, `started_at` February 21, 2025 (the day the Chairman of the Joint Chiefs and the service JAGs were fired). One mismatch: on TEST every other major front is alarm 4 and only the flagships (Epstein, Iran, Election Suppression) are alarm 5, so tier major with alarm 5 is unique to this front (see decision 5). Dek: "The Pentagon remade around loyalty, with the reasons rarely given. Generals and military lawyers pushed out, boat strikes that killed survivors, reporters locked out, and a senator investigated for telling troops to refuse illegal orders."

**Sweep (migration 115 conventions).** Headline only (`sweep_summary` false). `sweep_priority` 90, the highest number, so it loses every overlap (lower wins; Iran is 80). `sweep_coword` is a negative lookahead that keeps Russia, Moscow, Ukraine, NATO, China and Taiwan headlines out, the same trick as Iran's. `agent_pattern` is the sweep verbatim plus the extras in the table row above, so every sweep member matches it by construction (member gate: 62 of 62).

**Iran overlap.** 4 stories already on Iran match this sweep (Hegseth's claims of victory, "maximum lethality", his theology, "the Iran war is a game"); they stay on Iran, because the sweep only fills stories with no front. Among unassigned stories, 0 match both sweeps; if one does later, Iran wins on priority.

**TEST numbers.** Sweep: 62 unassigned active stories (65 before the co-word; the 3 dropped are Hegseth warning Russia twice and the China-based engineers bill). 13 of the 62 are enriched. After `refresh_tracker_derived()`, 5 members are on the main line (three alarm-5 boat strike stories, the alarm-5 story on Hegseth's legal fixer and the new press rules, and the alarm-4 Pentagon press fight story). The same full sweep also filed 3 September 22-23 Iran stories that the manual TEST pipeline had not swept yet (correct Iran matches; they stay). PROD uses a targeted part 3 instead (below), so it files Hegseth stories only. Agent pool after the sweep: 9.
- **Sample catches:** "Hegseth Says He Did Not See Survivors of Boat Strike Clinging to Wreckage", "Pentagon report concludes Hegseth put troops in danger with Signal chat", "Hegseth orders rare, urgent meeting of hundreds of generals, admirals", "Mark Kelly Under Pentagon Investigation for 'Illegal Orders' Video", "Federal judge finds Pentagon in violation of court order to restore reporters' access", "Trump will use military housing money for $1,776 Pentagon bonuses", "Anthropic's Blacklisting by the Pentagon Was Legal, Federal Judges Rule".
- **Sweep noise (filed automatically, Josh can move them in admin):** "Pentagon and elections bills could be combined in bid to unfreeze House floor", "Frustration roils lawmakers briefed on Pentagon's war request" (Iran war funding, no "Iran" in the headline), two Hegseth speech videos.
- **Left for the agent (pool of 9):** "Trump Plans to Attend Gathering of U.S. Military Officers" (a real member), the military-pay-in-the-shutdown pair, the Portland troop stories (expected declines, per the Guard rule), an aircraft carrier near Venezuela, and two off-topic matches (a House recess story and a Veterans Day speech).
- **Misses (by design):** National Guard deployment stories that do not name the Pentagon or Hegseth (an agent pattern with "national guard" and "troops" added gave a pool of 40 against 22 before the sweep, mostly Guard deployment stories, and was rejected).

**Josh steps (PROD).** Paste the file's five parts in the PROD SQL Editor in order. Part 3 is a targeted sweep (needed once because pipeline runs only look back 48 hours): it uses the same rules as `assign_fronts_sweep(NULL)`, so every front competes and the lowest priority wins, but it files only the stories Hegseth's Pentagon wins, and it only fills stories with no front (Codex P1 on PR #164: the full sweep also filed other fronts' stories, which the rollback could not undo). Part 5 should show members > 0 and members_outside_pattern 0. Rollback: delete the events row (its story_event rows and any front updates cascade) and refresh. Its members become loose ends; a story moved onto this front by hand later loses its front too, rather than returning to its old one.

### Open Decisions (Josh): Hegseth's Pentagon
4. **Title.** *Recommended: Hegseth's Pentagon* (options above).
5. **Tier.** *Recommended: major* (like Courts and Crypto). Flagship would make it the fourth flagship next to Epstein, Iran and Election Suppression (the PRD allows 3 to 5). Note the pairing on TEST: every major front is alarm 4 and every flagship is alarm 5, and this row is major at alarm 5. Major means also setting `alarm_level = 4` to match; flagship keeps alarm 5.
6. **Boat strikes inside this front.** *Recommended: yes.* The scandal is Hegseth's order and its legal cover; they are 40 of the 62 TEST members. The alternative is a front of their own.

## All fronts (ADO-592)

**Files:** `migrations/127_all_fronts_agent.sql`, `scripts/fronts/front-agent-db.js`, `prompt-v1.md` (same path, so the routines need no config change; content is now prompt version `fronts-v2`). Tests: `scripts/tests/front-agent-prompt.test.mjs` (in `qa:fronts`) and `scripts/tests/all-fronts-agent-sql-pglite.test.mjs` (PGlite, run by hand).

**How it works.** One routine, one pass over the pool, one front (or none) per story.
- **Agent fronts** are events that are published AND have `agent_pattern` AND have `agent_definition` (new column, migration 127). The definition is the plain rubric the agent judges a front against (what belongs, what does not, calibration examples). It is data: a new front, or a sharper definition, is an `UPDATE`, never a prompt edit, and admin can edit it later (ADO-547). A front without a definition is invisible to the agent, so a pattern can be set before its definition is ready.
- **Election carries over unchanged.** Migration 127 seeds `election-suppression.agent_definition` with the fronts-v1 Section 4 rubric verbatim (only when NULL, so a re-run never undoes an edit). Until the other definitions land (a follow-up maintenance file built from `front-reviews/<slug>.md`), election is the only agent front and the pool is the election pool.
- **Pool:** `front_agent_candidates_all(p_limit)`: active, enriched, no `story_event` row, NOT `action_label = 'coverage'` (unlabeled stays in: fail open, PRD 14.6), headline or summary matches ANY agent front's pattern. Each row carries `action_label`, `action_actor` (hints) and `matched_fronts` (the fronts whose pattern matched, lowest sweep priority first).
- **Script:** a new `fronts` verb prints the agent fronts with their definitions once per run; `candidates` calls the new RPC; every `assign` (and every record-file assign entry) names a front slug, which the script checks against the agent fronts before ANY write (one unknown front refuses the whole file). The single allow rule is unchanged and covers every call.
- **Declines mean "fits no front"**: `pipeline_skips` with `metadata.front = 'none'` and `metadata.judged_fronts` (the agent fronts at write time). The story is hidden from exactly those fronts until it gains articles, so a front whose definition lands later (the planned order) still gets one look at every active story its pattern matches. Old election-only declines (`metadata.front = 'election-suppression'`) hide the story from election only, so a story the v1 agent declined still reaches ICE, Hegseth and the rest when it matches their patterns; an election-only match stays hidden (no re-judging the ~1,000 PROD election declines).
- **Tie-break:** the definitions' own rules first, then lower `sweep_priority` wins (same as the sweep).
- **Notes** are `fronts-v2: <slug>: <rationale>`. Any future election pattern gate should match `note LIKE 'fronts-v%'` (the 2026-09-30 file checks `fronts-v1%` only).

**Deploy order.** (1) Migration 123 must already be on the environment (127 reads `stories.action_label`; on October 4, 2026 TEST did not have it yet). (2) Migration 127 on TEST and PROD. (3) The definitions maintenance file. (4) Only then the prompt and script reach `main`: PROD's routine resets to `origin/main`, and the old prompt keeps using `front_agent_candidates(p_slug)` (116, untouched) until then. The ADO-592 agent-pattern files must also be applied for those fronts to have a pool. **Never apply a definitions change while a fronts run is in progress** (PROD daily at 14:00 UTC, 9:00 AM CT, a few minutes): `judged_fronts` is read when each decline is written, so a front that gains a definition mid-run would hide that run's later declines from it without the agent ever judging them (code review, October 4, 2026, low). Apply outside the run window.

**TEST pool (October 4, 2026, before coverage and declines; PostgREST `imatch`, ids only):** election 37 (almost all already declined by fronts-v1, so hidden), ICE 38, Israel & Gaza 12, RFK 9, Hegseth 9 (2 overlap ICE), 3 election stories also match ICE. Trump Corruption not measured (its pattern is too long to pass through a URL filter). Rough first pool once every definition is set: about 70 plus Trump Corruption. The 127 result query reports the real `pool_size`.

**Cost.** $0 cash: plan usage on the existing routine, no OpenAI. The pool is bigger than election-only (more fronts), and the coverage filter shrinks it (PRD 14.6 measured 62.5% of a sample as coverage). Egress per run stays at headline + summary for at most `FRONTS_MAX_PER_RUN` (80) stories plus the definitions once (a few KB each), about 100-150 KB.

**Rollback.** Revert the prompt and script commit on `main` (the old prompt uses the untouched 116 RPC). Assignments: `DELETE FROM story_event WHERE assigned_by = 'agent' AND note LIKE 'fronts-v2:%'`, then `SELECT refresh_tracker_derived()`. Migration 127 is additive and harmless to leave.

### Definitions file (October 4, 2026)

**File:** `scripts/maintenance/2026-10-04-ado-592-front-definitions.sql`. It supersedes the October 1 draft `2026-10-01-ado-592-agent-patterns.sql`, which must not be applied. **Not applied anywhere.** Run it after migration 127 and before the fronts-v2 prompt reaches `main`, outside the 14:00 UTC run (it refuses if the agent wrote anything in the last 15 minutes). One transaction: guards (each value must be the old value it expects or already the new one, so a hand edit is never overwritten; no member lost; no shared sweep priority; each agent_pattern starts with its sweep; all nine fronts join the agent), a backup of the old values (`front_merge_backup_events`, tag `ado-592-defs`), the writes, a full sweep whose rows carry `note = 'ado-592-defs: keyword sweep'` (so the rollback finds them), and the refresh. Same file on TEST and PROD (fronts by slug). Test: `scripts/tests/front-definitions-sql-pglite.test.mjs` (PGlite, by hand; it checks every regex against its review). **Cost:** $0 cash; the agent pool grows (plan usage only).

Per front ("filed" = the review's PROD headline simulation; overlaps can shift a few):

| Front | What changes | Filed on PROD |
|---|---|---|
| Trump Corruption | Definition only | 0 |
| Election Suppression | Sweep adds SAVE America Act, mail-voting limits, voter lists and records, Fulton County, election-office raids, troops at polls, election orders, emergency powers before elections; co-word takes the SAVE act name. agent_pattern unchanged. Definition = the 127 seed plus three additions, tie-breaks and 5 calibration rows | ~39 |
| The Epstein Files | Sweep adds rare names, Maxwell next to a custody or clemency word, the Clintons next to contempt or deposition (not Prince Andrew); agent_pattern set (Andrew, Maxwell, Mandelson, survivors); definition | ~15 |
| The Courts | Co-word folded into the sweep, plus judges with US attorneys, rebukes of the government's lawyers, Trump attacking judges, defied orders; agent_pattern set (tight: no Supreme Court phrase); definition | ~33 |
| ICE & Deportations | Kilmar Abrego Garcia in the sweep (and the agent_pattern); definition | ~6 |
| Israel & Gaza | Sweep adds Board of Peace, Francesca Albanese, the ICC next to a US actor; co-word excludes East Palestine, adds three push verbs; agent extras swapped (war powers, Epic Fury, Midnight Hammer, bare Albanese out); definition | ~28 |
| Iran | Sweep adds Iranians, Hormuz, Tehran, Khamenei, Kharg, Epic Fury, Midnight Hammer, the IRGC, the nuclear sites, "Middle East war"; agent_pattern set; definition | ~79 |
| RFK Jr.'s HHS | Sweep adds R.F.K., FDA and NIH leaders, surgeon general picks, vaccine policy phrases, measles (not Canada or Mexico), Kennedy next to a health word; bare "kennedy" out of the agent_pattern; definition | ~46 |
| Hegseth's Pentagon | Sweep adds the "illegal orders" video, service secretaries, transgender troops, General Caine, court-martial, boat strikes not called that; agent extras add DOD, Quantico, press credentials, SOUTHCOM; definition | ~29 |

**Claude's calls (one-line changes if Josh disagrees):** Prince Andrew is left to the agent, not swept (Josh's open question). The Courts' agent_pattern is the tight variant. Election's agent_pattern is unchanged (the review's extras were not tested, and a new value also means repointing `front-agent-prompt.test.mjs`). ICE's agent_pattern gains the three Abrego words so it stays a superset of its sweep. The Anthropic (Hegseth) and abortion-pill (RFK) questions are held in the definitions as `uncertain` declines (`borderline <slug>: ... pending`), not decided. Election's 2020 addition leaves out "old prosecutions winding down" (that is the Tina Peters question). Calibration rows carry headlines only (PROD story ids differ on TEST).

**Open for Josh** (none of these is in the SQL):
1. Epstein: should UK and royal fallout be on the front, and should the sweep file Prince Andrew stories? Today the agent judges them and the definition keeps only fallout tied to the US files or US officials. (`front-reviews/epstein-files.md`, Q1)
2. Epstein: keep jokes, protest art and celebrity spats on the front? (`epstein-files.md`, Q2)
3. Epstein: move `started_at` to February 27, 2025? (`epstein-files.md`, Q3)
4. Iran: Iran only, or all of Trump's wars (Venezuela, Cuba, Greenland)? (`iran.md`, Q1)
5. Iran: the Houthis, only when tied to the Iran war? (`iran.md`, Q2)
6. Iran: move `started_at` to June 21, 2025? (`iran.md`, Q3)
7. Israel & Gaza: hand-move the 10 "Israel pulled the US into Iran" stories from Iran (724, 3107, 3854, 4124, 4387, 4402, 6760, 7037, 7116, 12061)? (`israel-gaza.md`; `iran.md`, Q4)
8. The Courts: every "judge blocks Trump" ruling on this front? The definition takes them through the agent (the dek says "blocked orders"); none are swept. (`the-courts.md`, Q1)
9. The Courts: Supreme Court tight (shipped), middle or wide? Middle = append the review's `supreme court|justices ... ruled/blocked/...` branch to the agent_pattern. (`the-courts.md`, Q2)
10. The Courts: court losses in DOJ cases against critics (Comey, Letitia James), or a separate "Retribution" front? (`the-courts.md`, Q3)
11. Election: were the Fulton County raid, the voting-rights group search and DOJ's voter-data push declined or still waiting? One service-role `pipeline_skips` query. (`election-suppression.md`, Q1)
12. Election: Tina Peters and the fake electors, out unless a federal action now? (`election-suppression.md`, Q2)
13. Election: the sweep now files every SAVE America Act headline, horse race included (accepted here, as the review recommends; ADO-594's coverage label keeps analysis off the main line). (`election-suppression.md`, Q3)
14. RFK: the abortion pill, FDA or HHS actions only? Held as uncertain declines until then. (`rfk-hhs.md`)
15. Hegseth: the Pentagon's dispute with Anthropic (D4). Held as uncertain declines; Claude takes no view. (`hegseth-pentagon.md`)
16. Hegseth: hand-move 6596 (General George's ouster) from Iran? (`hegseth-pentagon.md`)
17. Trump Corruption: hand-move the 10 envoy-diplomacy members (6 to Iran, 4 to no front) before the agent goes live? (`trump-corruption.md`)

## Verification

- TEST: migration 116 via SQL editor, push prompt to `test`, create the TEST trigger (env `env_01YRYGLu8C8ijpVWdPAwgVSQ`, branch `test`, no cron), run once, read `story_event.note` + `pipeline_skips` rows, spot-check 30 (AC 1).
- PROD (next session, after Josh's TEST review): migration 116 on PROD first, cherry-pick to main, create the PROD trigger with the cron, run once for the backfill (AC 4), check trumpytracker.com.

## Rollback

Disable the routine (`enabled: false`). Assignments are rows: `DELETE FROM story_event WHERE assigned_by = 'agent' AND note LIKE 'fronts-v1:%'` then `SELECT refresh_tracker_derived()`. The migration is additive (column + function); leaving it in place is harmless.
