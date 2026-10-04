# Front review: Iran (`iran`)

ADO-592 per-front review, October 4, 2026. Model: the ADO-610 Trump Corruption review. Proposals only: nothing here has been applied anywhere.

**How this was measured.** One read-only pass over PROD with the anon key: every story's id, headline, status, date and alarm (16,383 stories, January 3 to October 4, 2026; about 3 MB of egress, no content or embeddings), plus `story_event` and `events`. Every regex below ran in PGlite (the same Postgres ARE engine) against those real headlines, simulating the migration-115 sweep (headline only, lowest priority wins, only unassigned active stories). One extra read-only probe, in id windows to stay under the anon timeout, listed unassigned stories whose `summary_neutral` contains "iran" (ids and headlines only). PROD event id 2, priority 80, 1,591 members (the biggest front by far), no `agent_pattern` set.

## 1. Threads (term 2)

1. Maximum pressure and the spring 2025 nuclear talks (Witkoff and Araghchi, Oman and Rome).
2. Operation Midnight Hammer, June 21 to 22, 2025: B-2 strikes on Fordow, Natanz and Isfahan with no congressional vote, the "obliterated" claim against the intelligence assessment, the twelve-day Israel and Iran war and its ceasefire.
3. The run-up to the 2026 war: the January 2026 protests and Trump's threats, carriers moved from Venezuela, February talks, bases the Gulf states refused.
4. Operation Epic Fury, from February 28, 2026: US strikes, Khamenei killed, Trump urging Iranians to "take back" the country and talking about picking the next leader.
5. The Strait of Hormuz: closure, mines, the blockade, Project Freedom escorts, tolls and the "American territory" claim, allies refusing to help, the UN vetoes.
6. Congress cut out: war powers resolutions (Senate and House votes from March to June 2026), the war funding request, the $1.5 trillion military budget.
7. Cost at home: gas and jet fuel prices, inflation, tax refunds swallowed, farmers, the USPS surcharge.
8. Casualties and conduct: US service members killed and the dignified transfers, civilian deaths, threats to destroy power plants and infrastructure, officers facing war-crime orders.
9. Ceasefires and deals: the April 8 ceasefire, its collapse on July 13, the June deal and the "nuclear dust" handover, IAEA inspections, Pakistan as go-between.
10. Dissent: MAGA's anti-war wing, Vance's doubts, Pope Leo, Gabbard's resignation, pressure on the press ("treason").
11. Spillover: strikes on Gulf states, threats to Oman, the Houthis and the Red Sea, the Saudi pipeline (see question 2).

## 2. PROD misses

Every headline with "Iran" or "Iranian" is already on the front. The misses use other words.

- **Keyword-catchable: 79 loose ends, about 75 on topic.** Strait of Hormuz 53 (none off topic), "Iranians" (plural, which `\miran(ian)?\M` does not match) 8, "Middle East war" 10, Tehran, Khamenei, Kharg and Epic Fury 8. Examples: "Ships go dark as the clock runs out on Trump's 'undeclared naval war' in the Strait of Hormuz" (12478, alarm 5), "US to take over Strait of Hormuz, charge 20 percent fee for cargo shipped through, Trump says" (12482), "Trump threatens Oman in latest play to open the Strait of Hormuz" (10187, alarm 5), "Trump says US does not need Nato after being rebuffed over strait of Hormuz" (5410, alarm 5), "Trump Hails Khamenei Death, Urges Iranians to 'Take Back' Nation" (4114, alarm 5), "Congress is absent as Trump threatens Iranians 'will die'" (6877, alarm 5), "In Choosing 'Epic Fury,' Trump Names a War and Defines His Presidency" (5313, alarm 5), "Republicans confront the massive cost of Trump's Middle East war" (4610), "U.S. national security offices, weakened by firings, confront Mideast war" (4629, alarm 5). Weak ones: a fertilizer history piece (13098), Europe's far right (4466), a UK opinion column (4893).
- **Agent-only: 463 unassigned stories mention Iran in the summary (316 at alarm 4+).** A sample read suggests roughly a third belong: war-powers votes ("Republicans Again Block War Powers Measure in the Senate", 11248), war-crime orders ("Trump threats cause dilemma for US officers: disobey orders or commit war crimes", 6792, alarm 5), "Trump threatens to bomb Oman, widening the war that crippled the global economy" (14111), the war's cost ("How Trump's war screwed you out of your Trump tax refund", 7826). The rest are approval polls, inflation reports and campaign stories where the war is one cause among several.
- **Unreachable without a hand move:** headlines and summaries that only say "the war" (for example "Trump insists $1.5 trillion military budget for a war Congress didn't approve ranks above day care", 6645, alarm 5). "War" alone is far too broad for any pattern.

## 3. Keyword changes (verified on PROD headlines)

```
sweep_pattern (sweep_coword unchanged: ^(?!.*iranian revolution); priority stays 80):
\miran(ians?)?\M|hormuz|tehran|khamenei|\mkharg\M|epic fury|midnight hammer|\mirgc\M|revolutionary guards?|\m(fordow|natanz|isfahan)\M|\m(middle east|mideast) wars?\M|\mwars? in the middle east\M
```

PGlite results: 79 new loose ends (above), every old match still matched, no headline lost. Overlaps with other fronts are only already-assigned stories (ICE 2, Hegseth 1, Israel 1), which never move. Speed: 150 ms over all 16,383 headlines (old 16 ms).

Left to the agent on purpose: ceasefire (Russia and Ukraine use it too), war powers (Venezuela, Cuba and Greenland votes in January and March 2026), Houthis, Red Sea, gas prices, oil prices, blockade (Cuba and Venezuela blockades), "the war".

## 4. Agent input

**agent_pattern** (the sweep verbatim plus extras; every current member matches on its headline):

```
\miran(ians?)?\M|hormuz|tehran|khamenei|\mkharg\M|epic fury|midnight hammer|\mirgc\M|revolutionary guards?|\m(fordow|natanz|isfahan)\M|\m(middle east|mideast) wars?\M|\mwars? in the middle east\M|\m(iran\w*|ayatollah|persian gulf|gulf states|war powers|houthis?|red sea|oman|strait|ceasefire|cease-fire|enriched uranium|nuclear (deal|talks|program|sites?|facilit\w*)|regime change|centcom|dignified transfer|service members killed)\M
```

Expected PROD pool: about 500 (the 463 summary hits plus 48 headline-only extras), before the ADO-594 coverage filter. That is the largest pool in this batch; the first backfill will take several daily runs at 80 per run.

**Definition the agent judges against.**

> The Iran front is the United States' war with Iran and everything Washington does to start it, run it, pay for it or end it, from January 20, 2025 on. A story belongs when a US actor (the President, the White House, the Pentagon, State, Treasury, Congress, a US court) takes, orders, threatens or votes on an action about Iran, or when the story reports a direct consequence of the war for Americans: strikes and threats of strikes, regime-change talk, the Strait of Hormuz (closure, mines, escorts, tolls, the blockade), war-powers votes and war funding, US casualties, civilian deaths and war-crime orders, ceasefires, talks and nuclear deals, sanctions and threats against countries that help Iran, the war's oil and gas shock when the story is about the war's effect, and dissent inside the administration or Trump's coalition about the war.
>
> It does not belong when Iran is one item in a list: approval-rating polls, monthly inflation or jobs reports, campaign stories, the economy in general. Iran's internal politics with no US action, other conflicts (Russia and Ukraine, Venezuela, Cuba, Greenland), and war-powers votes about those other conflicts do not belong.
>
> Tie-breaks: Israel and Gaza (priority 75) keeps stories about Israel pushing the US toward the war (Netanyahu lobbying, Israel striking first to drag the US in); Israel and Iran trading strikes belongs here when a US decision is part of the story (a green light, an appeal to stop, US air defense); with no US role it is a loose end. Hegseth's Pentagon (90) cedes the conduct of the Iran war to Iran. Trump Corruption (15) keeps insider trading or profiteering around war announcements. A court case about the war is Iran, not The Courts.

**Calibration headlines (all real PROD stories in the expected pool).**

| Headline | Decision | Why |
|---|---|---|
| Republicans Again Block War Powers Measure in the Senate (11248) | assign 0.85 | Congress voting on the Iran war (the summary names Iran) |
| Trump threatens to bomb Oman, widening the war that crippled the global economy (14111) | assign 0.85 | Presidential threat that extends the war |
| Trump threats cause dilemma for US officers: disobey orders or commit war crimes (6792) | assign 0.80 | Conduct of the war, war-crime orders |
| Senate blocks Venezuela war powers bill after Vance breaks deadlock (725) | decline 0.95 | War powers, but Venezuela |
| Trump Disapproval on Gas Tops Every President This Century: Harry Enten (9389) | decline 0.85 | A poll; the war is background |
| U.S. Airstrikes Targeting Houthis Killed Scores of Civilians in Yemen (15071) | decline 0.60, borderline | Depends on question 2 |

## 5. Open questions for Josh

1. **Iran only, or all of Trump's wars?** The dek already says "a war ordered without a congressional vote". PROD has 213 loose ends on Venezuela and Maduro, 81 on Cuba (the blockade) and 82 on Greenland, with no front. *Recommended: keep this front Iran only and review a separate "Venezuela and Cuba" front; merging them would bury the Iran story under a different war.*
2. **The Houthis.** 8 loose ends in July to October 2026 (Red Sea attacks, the Saudi pipeline, US strikes that killed civilians in Yemen). *Recommended: Iran when the story ties the Houthis to the Iran war (attacks on shipping during it, US strikes in that campaign); otherwise a loose end.*
3. **started_at** is April 9, 2026, but the war began February 28, 2026 and the first US strikes were June 21, 2025. Members already go back to January 2026. *Recommended: June 21, 2025.*
4. **Israel overlap.** The Israel review found about 10 stories on this front that are really "Israel pushing the US into the war" (for example 4124, 3107). The sweep never moves assigned stories; only a hand move in admin fixes them.
