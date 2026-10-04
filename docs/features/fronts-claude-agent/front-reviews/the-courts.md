# Front review: The Courts (`the-courts`)

ADO-592 per-front review, October 4, 2026. Model: the ADO-610 Trump Corruption review. Proposals only: nothing here has been applied anywhere.

**How this was measured.** One read-only pass over PROD with the anon key: every story's id, headline, status, date and alarm (16,383 stories, January 3 to October 4, 2026; about 3 MB of egress, no content or embeddings), plus `story_event` and `events`. Every regex below ran in PGlite (the same Postgres ARE engine) against those real headlines, simulating the migration-115 sweep (headline only, lowest priority wins, only unassigned active stories). One extra read-only probe counted unassigned stories whose `summary_neutral` contains "judge" or "supreme court" (ids and headlines only). PROD event id 6, priority 70, **11 members**, no `agent_pattern` set.

## 1. Threads (term 2)

1. Defied orders and contempt: the Alien Enemies Act flights (Boasberg's contempt inquiry, ended on appeal in April 2026 and back before the appeals court in September), ICE ignoring release orders in Minnesota, DOJ admitting it violated dozens of orders in New Jersey, the Abrego Garcia return order.
2. Attacks on judges: "rogue judges", calls to impeach them, Trump calling justices "fools and lap dogs", DOJ misconduct complaints against judges, DOJ rebuking judges for talking to the press.
3. Threats to judges' safety and judges warning in public: the "judicial emergency", federal judges describing violent threats, the Chief Justice on personal attacks, Justice Jackson on the emergency docket.
4. Blocked orders with no topic front of their own: funding freezes and grant cuts, Voice of America, NPR and PBS, the Kennedy Center, union contracts, slavery exhibits, student race data, tariffs in the trade court.
5. The Supreme Court and presidential power: universal injunctions (June 2025), the tariff ruling (February 20, 2026), Lisa Cook and the other firings, the emergency docket.
6. Unlawful US attorneys: Halligan, Habba-style "acting" appointments, the New Jersey triumvirate, judges naming replacements and Trump firing them within hours.
7. DOJ candor and ethics: lawyers referred for discipline, judges finding false statements, a "serious breakdown" in legal ethics, grand juries refusing to indict.
8. Courts stopping retaliation against critics: the Comey and Letitia James cases, Don Lemon, subpoenas of reporters and of the Fed (see question 3).
9. Remaking the bench: Emil Bove and a generation of young judges.

## 2. PROD misses

The front holds 11 stories against hundreds of real court-versus-administration stories on PROD. The current rule (defiance or contempt words plus a court word) has already swept everything it can.

- **Keyword-catchable: 33 loose ends, none off topic** (one is an analysis segment, 3461). Unlawful US attorneys 12, Trump attacking judges or justices 11, judges rebuking DOJ lawyers 5, defied orders and judges' warnings 5. Examples: "Judges Grow Angry Over Trump Administration Violating Their Orders" (3550), "Trump flouts lower court rulings in unprecedented display of executive power" (8603, alarm 5), "Republican-Appointed Judge Says Trump Has Created 'Judicial Emergency'" (2653), "Federal judges describe violent threats amid 'dehumanizing attacks' from political leaders" (13798, alarm 5), "Trump Calls Justices Who Ruled Against Him 'Fools and Lap Dogs'" (3440), "Trump Calls for Law Cracking Down on Crime and 'Rogue Judges'" (6026), "White House fires U.S. attorney in N.Y. hours after judges appointed him" (2857, alarm 5), "US attorneys handpicked by Pam Bondi were appointed illegally, judge rules" (4875), "Judge Refers Justice Dept. Lawyer for Possible Discipline, Calling Out 'Lack of Candor'" (8769), "Justice Dept. Tries to Rebuke Federal Judges for Speaking to The Times" (16213).
- **Agent-only, the big one: rulings that block or allow administration actions.** A trial "judge or court + block/strike down/unlawful + Trump or an agency" regex, with ICE, election, RFK, Pentagon, Iran, Israel and Epstein words excluded, finds **88 loose ends (62 at alarm 4+), about three in four on topic**: "Federal judge blocks Trump order to end funding for NPR and PBS" (6402), "Judge Voids Mass Layoffs at Voice of America" (4740), "Trump Administration Acted Illegally With Homeless Grants Program, Judge Rules" (6414, alarm 5), "Donald Trump Violated the Constitution, Federal Judge Rules" (530, alarm 5), "Supreme Court, for now, blocks Trump from firing Fed board member Lisa Cook" (11863). Its systematic misses are Trump's personal cases (E. Jean Carroll, the BBC suit, the hush money appeal, about 10), the anti-weaponization fund (Corruption's topic), and immigration words the exclusion list does not know (TPS, border wall).
- **Supreme Court stories:** 402 unassigned headlines (605 summaries) mention the Supreme Court or the justices. Most are not about the administration (trans athletes, abortion pills, guns, state maps). See question 2.

## 3. Keyword changes (verified on PROD headlines)

The old co-word is folded into the old rule as a lookahead (the ADO-610 convention), so `sweep_coword` becomes NULL and the kept rule matches exactly what it did. Four branches are added: collision phrases, judges with US attorneys, judges rebuking the government's lawyers, and Trump attacking judges. The last two exclude ICE words, because Courts (70) would otherwise take ICE stories from ICE (72) whenever a judge also scolds the government; defiance and contempt stay Courts even in ICE cases, as today.

```
sweep_pattern (sweep_coword NULL, priority stays 70):
^(?=.*(judge|court|judiciary|judicial)).*(def(y|ies|ied|iance)|contempt|ignor(e|es|ed|ing) (the )?(court|ruling|order)|constitutional crisis|impeach(ing)? (a |the )?judge|existential threat|attack(s|ed|ing)? (on )?(the )?(judge|judiciary|courts))|rogue judges?|judicial (emergency|crisis|independence)|impeach\w* (a |the |federal |activist |rogue )?judges?\M|\mjudges?\M.*\m(threats\M|violen|pizzas?\M|doxx|intimidat)|\m(threats?|attacks?) (on|to|against) (federal )?(judges|the judiciary|the courts)\M|\m(violat|flout|disobey|ignor|evad|def(y|ies|ied|ying))\w* (a |the |their |his |her |its |multiple |repeated |several |lower |federal )*(court|judges?'?s?|judicial) (orders?|rulings?)\M|\m(judges?|courts?)\M.*\m(violat|flout|disobey|ignor|evad)\w* (their|his|her|its|the) (orders?|rulings?)\M|\m(judges?|courts?)\M.*\m(u\.?s\.? attorneys?|top prosecutors?)\M|\m(u\.?s\.? attorneys?|top prosecutors?)\M.*\m(judges?|courts?)\M|\m(appointed|serving) (illegally|unlawfully)\M|\m(illegally|unlawfully) (appointed|serving)\M|^(?!.*\m(ice|deport\w*|immigra\w*|migrants?|asylum|detain\w*|detainees?|icc|international criminal court)\M)(?=.*\m(judges?|courts?)\M)(?=.*\m(justice dep(t|artment)|doj|government|administration|trump)\M).*\m(candor|discipline|sanction(ed|ing)?|misconduct|lied|lying|misled|misleading|false (statement|claim|allegation)s?|breakdown|bad faith|unethical|unseemly|rebuk\w*|chastis\w*|scold\w*)\M|^(?!.*\m(ice|deport\w*|immigra\w*|migrants?|asylum|detain\w*|detainees?|icc|international criminal court)\M)(?=.*\mtrump\w*\M)(?=.*\m(judges?|justices|supreme court|judiciary)\M).*\m(slams?|slammed|blasts?|blasted|attacks?|attacked|rips?|vents?|vented|lashes out|lashed out|fools|lap ?dogs|radical left|rogue|lunatics?|derang\w*|ransack\w*|in league)\M
```

PGlite results: 33 new loose ends (above), all 11 members still match, every old match still matched. Checked and fixed during the review: "disobey orders" pulled in two military stories (1089, 6792) until the order branch required a court word; "Homeland Security" and "security clearance" matched an early "judge ... security" branch (dropped); "ICC Judges Sue Trump Administration Over Sanctions" (11644, Israel's topic) matched the sanctions branch (ICC excluded). The ICE exclusion keeps the rebuke and attack branches off 3 ICE headlines (835; 2912, "Court rebukes Trump administration for denying immigration detainees access to lawyers"; 7757). A fourth (3289, DOJ telling a judge that officials violated court orders on immigration) still matches the defiance branch, as intended. Speed: 1.2 s over all 16,383 headlines (old 90 ms), inside the ADO-610 precedent (2 s per 20,000) and irrelevant for the 48-hour pipeline pool. One old false positive stays because the old rule is kept verbatim: "Arkansas defies federal court to launch SNAP candy-and-soda ban" (11918, a state, not the administration).

**Not swept on purpose:** the broad "judge blocks X" branch above. It is 75% precise, would need its topic-exclusion list kept in step with every other front's sweep forever, and would put about 60 alarm-4 stories on the main line at once. The agent judges them instead.

## 4. Agent input

**agent_pattern** (the sweep verbatim plus extras; all 11 members match on the headline):

```
<the sweep_pattern above, verbatim>|\m(judges?|judiciary|judicial|injunctions?|restraining orders?|unconstitutional|struck down|strikes? down|boasberg|u\.?s\.? attorneys?|emergency docket|shadow docket|contempt)\M|\m(supreme court|justices)\M (rul\w*|block\w*|struck|strikes?|allow\w*|upholds?|sides?|reject\w*|halts?|lets?|clears?|says)\M
```

Bare `supreme court` and `justices` are deliberately not in it. Only the high court acting ("the Supreme Court ruled / blocked / allowed / upheld") is, a middle ground on the plan's still-open decision 1 (see question 2). Expected PROD pool: about 600 (241 headline-only extras, the 371 summaries that say "judge", and about 150 more from the Supreme Court phrase, 79 headlines and roughly 120 summaries, all overlapping), before the ADO-594 coverage filter.

**Definition the agent judges against.**

> The Courts front is the collision between this administration and the judiciary. A story belongs when: the administration defies, ignores, slow-walks or is found to have violated a court order; a judge holds or threatens to hold officials in contempt; the President, the White House or DOJ attacks, threatens, files complaints against or calls to impeach judges or justices; judges warn in public about threats, attacks or a judicial crisis; a court rules on the legality of a US attorney's appointment; a judge finds the government's lawyers misled the court or refers them for discipline; a federal court (including the Supreme Court) blocks, voids or allows an executive action that has no topic front of its own (funding freezes, grants, layoffs, agency closures, media funding, tariffs, the Kennedy Center, data demands); or the Supreme Court rules on the limits of presidential power (firings, tariffs, universal injunctions, the emergency docket).
>
> It does not belong when: the case is Trump's own (the hush money conviction, E. Jean Carroll, his defamation suits against news outlets, the BBC); the parties are states, companies or private people with no federal administration party; the court is foreign or international; the Supreme Court case does not involve the administration (guns, abortion pills, trans athletes, state election maps); or the story is a filing deadline or a hearing date with no ruling.
>
> Tie-breaks, topic beats venue: rulings on immigration, deportation, detention, visas, TPS and birthright citizenship go to ICE and Deportations; on voting, voter data and maps to Election Suppression; on the Epstein files to Epstein; on vaccines and HHS to RFK Jr.'s HHS; on the Pentagon or Hegseth to Hegseth's Pentagon; on the ballroom, the library or the anti-weaponization fund to Trump Corruption. **Except:** defiance of a court order, contempt, and attacks on or threats to judges stay on The Courts even when the case is about immigration (this matches the sweep, where Courts at 70 wins over ICE at 72). National Guard deployment cases stay on The Courts unless the headline names the Pentagon or Hegseth.

**Calibration headlines (all real PROD stories).**

| Headline | Decision | Why |
|---|---|---|
| Federal judge blocks Trump order to end funding for NPR and PBS (6402) | assign 0.85 | Blocked executive order, no topic front |
| Supreme Court, for now, blocks Trump from firing Fed board member Lisa Cook (11863) | assign 0.80 | Supreme Court on the limits of presidential power |
| Judge blocks Trump officials from detaining refugees in Minnesota (1879) | decline 0.80 | Belongs to ICE and Deportations (topic beats venue) |
| Judge temporarily blocks payouts from Trump's $1.8B 'anti-weaponization' settlement fund (10288) | decline 0.75 | Belongs to Trump Corruption |
| Judge rejects Trump's latest bid to challenge hush money conviction (14487) | decline 0.90 | Trump's personal case |
| Supreme Court Allows States to Bar Transgender Athletes From Girls' Sports (11920) | decline 0.85 | No administration party |

## 5. Open questions for Josh

1. **Should every "judge blocks Trump" ruling be on this front?** The dek says "blocked orders", and PROD has about 88 such loose ends (62 at alarm 4+), roughly 8 a month for the main line. *Recommended: yes, through the agent (not the sweep), so the front finally reflects the fight; the alarm floor and ADO-594 decide what reaches the main line.*
2. **Supreme Court: tight, middle or wide** (the plan's decision 1, still open). *Recommended: middle, as drafted above.* The pattern takes "the Supreme Court / the justices ruled, blocked, allowed, upheld" (about 150 more candidates; of the 79 headlines, 20 name Trump or an agency) and the definition keeps only rulings that involve the administration. Wide (bare `supreme court` and `justices`) adds about 600, mostly off topic. Tight (neither) can miss rulings like the Lisa Cook decision (11863).
3. **Retaliation cases.** Court losses in DOJ cases against critics (Comey, Letitia James, Don Lemon, the Brennan subpoenas) have no front. *Recommended: on The Courts only when the story is a court ruling against DOJ; consider a separate "Retribution" front review.*
