# Front review: ICE & Deportations (`ice-deportations`), agent definition only

ADO-592, October 4, 2026. The keywords were reviewed on October 3, 2026 (ADO-608, `scripts/maintenance/2026-10-03-ado-608-ice-front.sql`), so this file is the agent's definition plus one keyword gap found along the way. Measured read-only against PROD headlines (16,383 stories, no summaries) with PGlite. PROD event id 13, priority 72, 1,263 members.

**agent_pattern:** keep the ADO-608 value (sweep verbatim, plus DHS, Homeland Security, Noem, border, citizenship, visas, TPS, DACA, Dreamers, birthright, travel ban, green cards, naturalization). Headline-only pool today: 429 loose ends, and 197 of them are there only because of "DHS" or "Homeland Security" (the DHS funding shutdown, Noem's exit, TSA, FEMA). The definition below declines those; the pattern does not need to change for it.

**Keyword gap (one, clear):** Kilmar Abrego Garcia, the best-known wrongful deportation, is not in the sweep. 6 PROD loose ends, all on topic (for example "Trump administration pursues Kilmar Ábrego García on previously dismissed charges", 14013, alarm 4); 2 more are already members. Add `kilmar|abrego|ábrego` inside the sweep's word group (the accented spelling needs its own entry). Checked in PGlite: 8 hits on PROD, 0 off topic.

**Plain definition.** This front is the record of the government arresting, detaining, deporting and expelling people, and of the fights over it. A story belongs when ICE, Border Patrol, CBP, DHS leadership, the White House or DOJ carries out or orders immigration arrests and raids, detention (the camps, conditions, deaths in custody, detention expansion), deportations and removal flights (third countries, CECOT, Guantánamo, the Alien Enemies Act), the end of legal protections that makes people deportable (TPS, parole, DACA, refugee admissions, mass visa or green-card revocations, birthright citizenship, travel bans), or targets sanctuary jurisdictions; when a court rules on any of it; or when agents' conduct is the story (masked agents, shootings, arrests of citizens, officials or reporters).

Decline: DHS stories with no enforcement angle (the department's funding fight in general, TSA, FEMA, Secret Service, the Noems' personal life); legal immigration business (H-1B fees, visa processing delays, employer programs); border wall construction and its environmental fights (lean decline, mark `uncertain`); "ice" as weather, food or sport; polls and campaign positioning on immigration.

Tie-breaks: Trump Corruption (15) takes money flowing to Trump allies from the crackdown (contracts to donors, the detention companies' payments to Trump allies). Election Suppression (50) takes ICE at or near polling places and voter-citizenship checks. The Courts (70) takes open defiance of a court order (contempt over deportation flights); an ordinary ruling stays here. This front beats Israel & Gaza (75) on the detention and deportation of pro-Palestinian activists (Khalil, Mahdawi, Ozturk). National Guard and troop deployments to cities are not this front unless the story is about the immigration operation itself (troops guarding an ICE facility or joining arrests); per Josh's October 2, 2026 note they may become a front of their own.

**Calibration (real PROD headlines)**

| Headline | Decision | Why |
|---|---|---|
| Trump administration pursues Kilmar Ábrego García on previously dismissed charges (14013) | assign | The wrongful-deportation saga, now a prosecution |
| Trump Admin Allowed to End TPS for 3 Countries: What We Know (2726) | assign | Removing protection makes people deportable |
| U.S. set for largest mass visa revocation in history targeting up to 200,000 foreigners (14302) | assign | Mass revocation |
| DHS Shutdown Could Come Back to Bite Democrats (5435) | decline | Funding politics, no enforcement action |
| Federal judge halts Big Bend border wall construction in blow to Trump agenda (16287) | decline, uncertain | Wall construction, not arrests or removals |
