# Front review: Election Suppression (`election-suppression`)

ADO-592 per-front review, October 4, 2026. Model: the ADO-610 Trump Corruption review. Proposals only: nothing here has been applied anywhere.

**How this was measured.** One read-only pass over PROD with the anon key: every story's id, headline, status, date and alarm (16,383 stories, January 3 to October 4, 2026; about 3 MB of egress, no content or embeddings), plus `story_event` and `events` (including this front's live `sweep_pattern`, `sweep_coword` and `agent_pattern`). Every regex below ran in PGlite (the same Postgres ARE engine) against those real headlines. This front is the only one with `sweep_summary` true, so its sweep also reads summaries (with the co-word still required in the headline); summary hits were not simulated, so sweep counts below are headline-only lower bounds. PROD event id 8, priority 50, 449 members. It is the only front the daily Claude agent already judges (`prompt-v1.md`, PROD cron since September 30, 2026). Agent declines live in `pipeline_skips`, which anon cannot read, so this review cannot tell a declined story from one still waiting in the backlog.

## 1. Threads (term 2)

1. Trump's election executive orders: the March 25, 2025 order (proof of citizenship on the federal form, ballot deadlines, EAC pressure) and the 2026 order for a federal voter list and mail-voting limits, and the court fights over both.
2. The SAVE Act and the SAVE America Act: House passage, the Senate standoff, Trump pressuring Thune and attaching it to must-pass bills, state copies.
3. Federal grabs for voter data: DOJ suits and demands for state voter files, DHS running voter rolls through the SAVE citizenship database, Social Security data, the EAC commissioner working with Cleta Mitchell's group.
4. The FBI raid on the Fulton County election office (January 2026), the seizure of 2020 ballots, Gabbard's presence, the warrant built on debunked claims.
5. Relitigating 2020 as a tool: the "grand conspiracy" probe, subpoenas for Arizona and Georgia records and election workers' data, pardons for fake electors, pressure to free Tina Peters (see question 2).
6. Mail voting: Trump's vow to end it, the order, the Supreme Court's mail-ballot ruling, USPS.
7. Mid-decade redistricting: Texas, Missouri, North Carolina, Ohio, Indiana, Florida, Virginia and California, and the Supreme Court's 2026 Voting Rights Act decision that set off a second wave of southern maps (agent only, see below).
8. Dismantling election security: CISA's election work cut, an election denier as director of election security.
9. Threats around the midterms: troops or ICE at polling places, a state of emergency before the vote, talk of "nationalizing" or cancelling elections.
10. DOJ's Civil Rights Division walking away from voting-rights enforcement.

## 2. PROD misses

- **Keyword-catchable: 39 loose ends, 33 clearly on topic.** SAVE Act and SAVE America Act 23 (the current rule says "SAVE Act", which does not match "SAVE America Act", and most of these headlines carry no election word for the co-word), Fulton County 6, voter records 3, the election executive order and mail-voting rulings 3, election office raid 2, troops at polls 1, state of emergency 1. Examples: "Federal judge halts Trump's election executive order seeking to create a federal voter list" (11709), "Federal Judge Strikes Key Parts of Trump Order Restricting Mail Voting" (11700), "FBI searched Fulton County offices in probe of possible 2020 election 'defects,' affidavit says" (2751), "Fulton County argues FBI seizure of 2020 ballots shows 'callous disregard' for constitutional rights" (2605, alarm 5), "Democrats Condemn FBI Election Office Raid: 'A Seismic Event'" (1894, alarm 5), "Alarm as Trump DoJ pushes for voter information on millions of Americans" (765, alarm 5), "Trump tells Thune to keep Senate in session to pass SAVE America Act" (13091), "DOD tells senator it has 'no plan' for troops at polls" (16251), "Trump doesn't rule out declaring state of emergency before midterm elections" (16229). The 6 weak ones are analysis segments and fact-checks (11898, 5352, 5755, 12041, 5396) and a state-court ruling against a private activist (12258).
- **Agent territory, unknown status:** 368 unassigned headlines match the current agent pattern but not the sweep (voters, voting, ballots, redistricting). Many are clear assigns by the prompt's own rubric, for example "Federal Agents Search Voting Rights Group in Ohio" (11070, alarm 5), "Judge Orders D.H.S. to Restore 4 States' Access to Citizenship Data" (12276), "Exclusive: EAC commissioner communicated with Cleta Mitchell's group on proof of citizenship, emails show" (15764), and 132 redistricting headlines (for example "DeSantis unveils new GOP-friendly congressional map on eve of special session", 8214). They are either in the backlog (the agent judges 80 a day, newest first) or were declined. See question 1.

## 3. Keyword changes (verified on PROD headlines)

Append to the end of the current `sweep_pattern` (inside its outer parentheses), and add the SAVE act name to the co-word so those headlines pass without an election word:

```
sweep_pattern additions:
|\msave america act\M|(restrict\w*|limit\w*|ban\w*|end\w*|curb\w*|eliminat\w*) (on |of )?(mail voting|voting by mail)|mail voting (bans?|restrictions?|limits?|orders?)|voter (lists?|records|information|info)\M|fulton county|(raid\w*|search\w*|seiz\w*).{0,40}election (office|offices|hub|headquarters)|election (office|offices|hub) (raid|search)\w*|\mtroops?\M (at|near|outside|to|in) (the )?(polls|polling (places?|sites?|stations?|locations?))\M|\melection\w* (executive )?orders?\M|executive orders? on (elections?|voting)|(state of emergency|emergency powers|martial law|insurrection act).{0,60}\m(midterms?|elections?)\M

sweep_coword (new value):
(election|vote|voter|voting|ballot|midterm|poll|precinct|electoral|\msave (america )?act\M)
```

PGlite results: 39 new loose ends (above), every old match still matched, and only 1 match on another front ("House G.O.P. Releases Budget to Unlock $95 Billion for Iran War and SAVE Act", 12572, already on Iran, where it stays). A looser "troops ... polls" branch was tried and tightened: it matched "Americans have little appetite for sending U.S. troops to Iran, polls show" (6440), and since Election (50) beats Iran (80), a new story like that would have been taken from Iran. Bare "mail voting" was tried and dropped: it pulled in a California governor debate (8822) and a newsletter (15556); the final branch needs a restriction word next to it. Bare "election offices" was dropped too ("Hundreds of Wisconsin election offices not using cybersecurity best practices", 16261). Speed: 1.0 s over all 16,383 headlines (old 0.6 s). Summary matches were not simulated: "fulton county" and "voter records" in a summary still need an election word in the headline, which keeps that side narrow.

Left to the agent on purpose (unchanged from the September 14 and 30 decisions): redistricting and maps, generic voter, voting, poll and midterm words, Tina Peters, fake electors, election security.

## 4. Agent input

**agent_pattern** (the current PROD value verbatim plus extras, so every story the agent has assigned still matches, as the ADO-582 rule requires):

```
\m(voters?|voting|ballots?|precincts?|redistrict\w*|gerrymander\w*|congressional maps?|district maps?|polling (place|places|location|locations|hours|site|sites)|certif(y|ies|ied|ying|ication))\M|\m(save (america )?act|fulton county|federal voter list|citizenship (lists?|data|database)|election (offices?|records|workers?|officials?|equipment)|mail voting)\M
```

Per `plan.md`, a new value means a new maintenance file with the guarded DO block and repointing `front-agent-prompt.test.mjs`.

**Definition the agent judges against.** The prompt-v1 rubric (Section 4) stands; it is the model the other fronts copied. Three additions for the all-fronts prompt:

> - The federal government collecting, matching or demanding voter data (DOJ suits for state voter files, DHS citizenship checks of voter rolls, a federal voter list) is mechanism 1, including court rulings on it.
> - Federal agents searching election offices or voting-rights groups, or seizing ballots and election records, including 2020 records, is mechanism 3. Relitigating 2020 counts when a federal or state agency acts now (a raid, a subpoena, a records demand); history pieces and old prosecutions winding down do not.
> - A credible threat by the President or an agency to put troops, ICE or emergency powers between voters and the polls is mechanism 2.
>
> Tie-breaks: Trump Corruption (15) keeps donor and money stories. Election (50) wins over The Courts (70) for any ruling on voting, voter data or maps, and over ICE (72) for ICE at polling places. A SAVE Act story where the bill rides on unrelated legislation stays here.

**Calibration headlines (real PROD stories, to add to prompt-v1's table).**

| Headline | Decision | Why |
|---|---|---|
| Federal judge halts Trump's election executive order seeking to create a federal voter list (11709) | assign 0.90 | Court ruling on a federal voter list (mechanism 1) |
| FBI searched Fulton County offices in probe of possible 2020 election 'defects,' affidavit says (2751) | assign 0.90 | Federal seizure of election records (mechanism 3) |
| Trump doesn't rule out declaring state of emergency before midterm elections (16229) | assign 0.70 | Credible threat to change how the midterms run |
| Tamara Keith and Amy Walter on the impact of Trump's push for the SAVE Act (5352) | decline 0.80 | Analysis segment, no new action |
| Marjorie Taylor Greene Fears Trump Will Cancel 2028 Election (9925) | decline 0.80 | Speculation, no actor taking a step |

## 5. Open questions for Josh

1. **Declined or waiting?** Clear rubric matches such as the Fulton County raid (1894, 2751), the voting-rights group search (11070) and DOJ's voter-data push (765) are not on the front. *Recommended: before the ADO-592 build, run one service-role query of `pipeline_skips` (front_assignment / agent_declined) for these ids. If the agent declined them, the prompt needs the three additions above; if they are waiting, the backlog needs a few more runs.*
2. **Tina Peters and the fake electors.** 8 Tina Peters loose ends (Trump pressured Colorado, whose governor commuted her sentence in May 2026) and several fake-elector case dismissals. *Recommended: out, unless the story is a federal action now (a pardon, a funding threat to force her release); they are about 2020, not the next election.*
3. **SAVE Act noise.** The sweep will file every SAVE America Act headline, including Senate horse race and fact-checks (5 of the 23). *Recommended: accept; ADO-594's coverage label keeps the analysis off the main line.*
