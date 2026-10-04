# Front review: Hegseth's Pentagon (`hegseth-pentagon`)

ADO-592 per-front review, October 4, 2026. Model: the ADO-610 Trump Corruption review. Proposals only: nothing here has been applied anywhere.

**How this was measured.** One read-only pass over PROD with the anon key (16,383 story headlines, January 3 to October 4, 2026; ids, headlines, dates and alarms only, no summaries or content), then PGlite (Postgres 17, the same regex engine) simulating the migration-115 sweep against those real headlines. PROD event id 12, priority 90 (loses every overlap), 195 members today. Agent pool sizes are headline-only lower bounds.

## 1. Threads (term 2)

Josh's October 2, 2026 calls: flagship, title kept, boat strikes stay here, the Iran war's conduct stays on Iran, National Guard deployments are out.

1. The purge of the brass: the Joint Chiefs chairman, the Navy chief, the service JAGs, the NSA chief, the DIA director, the Southern Command chief, the Army chief of staff and others pushed out, mostly without a stated reason; the cuts to general and admiral posts.
2. The service secretaries: Navy Secretary Phelan forced out, Army Secretary Driscoll's resignation, Hung Cao installed.
3. The boat strikes in the Caribbean and the Pacific: each strike, the killing of survivors, the "kill everybody" order, Admiral Bradley, the death toll past 200, Congress demanding the videos.
4. Signalgate: the chats, the second chat with family, the inspector general's finding.
5. The press lockout: the credential rules, the walkout, the New York Times suit and the ruling against the Pentagon.
6. Going after critics: Sen. Mark Kelly's censure, demotion and lawsuit; the investigations of the lawmakers in the "illegal orders" video (the DOJ's part included); officers punished for dissent.
7. The Department of War rename and the "warrior ethos" culture push (the Quantico speeches, the chaplains, the academies).
8. The transgender troops ban and its court fight.
9. The 2025 staff purge and leak probes (Caldwell, Selnick, Carroll).
10. Hegseth answering for it: hearings, budget testimony, impeachment resolutions, Congress forcing disclosure.
11. Active-duty troops at home only when the Pentagon or Hegseth is the actor (the Marines sent to Los Angeles).
12. The Pentagon's dispute with Anthropic is Josh's open decision D4 (Claude has a conflict of interest and takes no view; see section 4).

## 2. PROD misses

The sweep words are well covered: only 3 loose ends contain them, all excluded on purpose by the NATO and China co-word. 54 Iran members also match this sweep and stay on Iran by design. The misses:

- **Boat strikes not called "boat strikes" (12):** "US military strikes another boat in Pacific, bringing death toll above 200" (10329, alarm 5), "Two Survivors Left at Sea After U.S. Attacks Boat in Pacific" (10168), "An Ecuadorian Fishing Boat Disappears Amid Trump's Strikes in the Pacific" (11903, alarm 5), "U.S. Military Sinks Boats Said to Aid Drug Smuggling Near Ecuador" (14880), and 8 more single-strike reports.
- **The "illegal orders" video (7):** "Lawmakers Say They Will Not Cooperate With Inquiry Into Illegal Orders Video" (2449, alarm 5), "Trump administration is investigating Sen. Slotkin for Democrats' video urging troops to resist 'illegal orders'" (684), the grand jury that declined to indict (2673).
- **Service secretaries (4, one of them off topic, see section 3):** "Trump nominates loyalist Hung Cao to be permanent navy secretary" (14678), "Trump encouraged Army secretary to stay in job" (14723).
- **Transgender troops (3):** "Trump Administration Asks Supreme Court to Uphold Ban on Transgender Troops" (14508), "Inside the Secretive Boards Deciding Trans Troops' Fate" (13364).
- **The top general and military justice (3):** "Trump's Threats of War Crimes Intensify Pressure on General Caine" (6881), "Air Force Major Recommended for General Court-Martial After Protesting Trump" (16147).
- **Filed on Iran but really this front's purge thread:** "Hegseth asks Army's top uniformed officer to step down as U.S. wages war against Iran" (6596, alarm 5). Two more are half and half: "Senate threatens to freeze Hegseth's travel in bid for boat strike videos, Iran school strike probe" (11348) and its twin (11339).

## 3. Keyword changes (verified on PROD headlines)

Adds: `illegal orders`, "military/illegal orders video", `seditious six`; Army, Navy or Air Force secretary; transgender troops, service members or soldiers, and "trans troops"; General Caine and "top general"; court-martial; and a boat-strike branch: "boat", or a drug or drug-smuggling "vessel", only when the headline also has a strike word (strike, attack, hit, kill, sink, survivors) AND a US or military actor (US, American, military, Navy, Pentagon, Hegseth, Trump, SOUTHCOM). The co-word is unchanged (Russia, Moscow, Ukraine, NATO, China, Taiwan stay out).

```
sweep_pattern:
\m(hegseth|pentagon|department of war|war department|secretary of war|war secretary|joint chiefs|boat strikes?|drug boats?|signalgate|illegal orders|(military|illegal) orders video|seditious six|(army|navy|air force) secretary|secretary of the (army|navy|air force)|transgender (troops|service ?members|soldiers|military ban)|trans troops|general caine|gen\. caine|dan caine|top (u\.s\. )?general|court[- ]martial\w*)\M|^(?=.*\m(strikes?|struck|attacks?|hits?|kill(s|ed|ing)?|sinks?|sank|survivors?)\M)(?=.*\m(u\.s|us|american|military|navy|pentagon|hegseth|trump|southcom)\M).*\m(boats?|(drug|alleged drug|drug-smuggling|drug-trafficking) vessels?)\M

sweep_coword: unchanged
```

**Result on PROD (PGlite):** the targeted sweep would file 29 loose ends and lose none. A read of all 29: 27 on topic, 1 borderline ("Trump said the top U.S. general was at the midterm convention. It's not true.", 15091), 1 off topic ("U.S. Has Deployed Weapons in Space, Air Force Secretary Says", 15263). The new terms also match 5 stories on other fronts, which stay put: Caine on Iran (3), the midterm troops story on Election Suppression, Phelan in the Epstein flight logs on Epstein. Speed: 0.47 s per 16,000 headlines (the old rule was 0.11 s).

Left to the agent on purpose: generals and admirals alone (most "general" hits are attorneys general and the UN Secretary-General), troops, military, Venezuela, Maduro, Quantico, the Pentagon budget.

## 4. Agent input

**agent_pattern** (new sweep verbatim, then extras). Today's extras are kept; added: `dod`, `quantico`, `press credentials`, `press corps`, `southern spear`, `southcom`, `narco-?terrorists?`. A bare `inspector general` was tried and dropped (it pulled in DHS inspector general stories).

```
\m(hegseth|pentagon|department of war|war department|secretary of war|war secretary|joint chiefs|boat strikes?|drug boats?|signalgate|illegal orders|(military|illegal) orders video|seditious six|(army|navy|air force) secretary|secretary of the (army|navy|air force)|transgender (troops|service ?members|soldiers|military ban)|trans troops|general caine|gen\. caine|dan caine|top (u\.s\. )?general|court[- ]martial\w*)\M|^(?=.*\m(strikes?|struck|attacks?|hits?|kill(s|ed|ing)?|sinks?|sank|survivors?)\M)(?=.*\m(u\.s|us|american|military|navy|pentagon|hegseth|trump|southcom)\M).*\m(boats?|(drug|alleged drug|drug-smuggling|drug-trafficking) vessels?)\M|\m(defense secretary|secretary of defense|defense department|admirals?|generals and admirals|four-star|three-star|top brass|military (leaders?|leadership|officers?|lawyers?|brass|commanders?|chaplains?|academies|academy)|judge advocates?|jag|signal chat|service members?|warrior ethos|dod|quantico|press credentials|press corps|southern spear|southcom|narco-?terrorists?)\M
```

Member gate: all 195 members match on the headline. Headline-only pool after the new sweep: 22 (22 today; the new sweep files 29 and the new extras add about as many).

**Plain definition.** This front is the record of what Hegseth and the Pentagon's political leadership do to and with the military, and the fights over it. A story belongs when they fire, push out, demote or punish officers, officials or critics; order or defend the boat strikes; restrict the press; reshape the force by order (transgender troops, flag officer cuts, the rename, the culture rules); or when Congress, a court or an inspector general acts on any of that. A boat-strike report with a death count belongs even when it names no official.

Decline: ordinary foreign and defense policy (NATO, Ukraine, China, Taiwan, troop moves to Europe or the Middle East, the Pentagon budget, weapons programs); military accidents and deaths in service; Venezuela and the Maduro raid unless Hegseth or the Pentagon's leadership is the actor (D3); National Guard and troop deployments to US cities (Josh, October 2, 2026); veterans' affairs.

Tie-breaks: every other front beats this one on keywords (priority 90). Iran (80) keeps the war's conduct, cost, casualties and strategy, including Hegseth's own Iran statements; this front keeps a purge, a press or a critic story even when it happens during the Iran war. Election Suppression (50) keeps troops at the polls. The Courts (70) keeps open defiance of a court order; an ordinary ruling against the Pentagon stays here. RFK (85) keeps civilian health rules; a Pentagon vaccine order is this front's.

**Anthropic (D4).** Josh has not decided whether the Pentagon's dispute with Anthropic belongs here, and Claude, which Anthropic makes, takes no view on it. Until he decides, the agent declines every Anthropic story with `uncertain: true` and the note "D4 pending", whatever front it might fit. (10 PROD Anthropic stories are already members through the word "Pentagon"; 43 more are loose ends.)

**Calibration (real PROD headlines)**

| Headline | Decision | Why |
|---|---|---|
| US military strikes another boat in Pacific, bringing death toll above 200 (10329) | assign | Boat strikes |
| Trump nominates loyalist Hung Cao to be permanent navy secretary (14678) | assign | Leadership remade around loyalty |
| Lawmakers Say They Will Not Cooperate With Inquiry Into Illegal Orders Video (2449) | assign | Going after critics |
| Pentagon Puts Iran War Cost at $25 Billion as Hegseth Berates Skeptics (8404) | Iran | War cost and conduct |
| Trump Orders 5,000 US Troops to Poland, Citing Bond With Karol Nawrocki (9893) | decline | Ordinary defense policy |
| Military Police Troops Put on Alert for Possible Deployment to Minnesota (1232) | decline | Domestic deployment, out by Josh's rule |

**Most important open question:** D4, the Anthropic stories (about 53 on PROD). Josh decides; the agent holds them until then. Smaller: approve a hand move of 6596 (General George's ouster) from Iran to this front.
