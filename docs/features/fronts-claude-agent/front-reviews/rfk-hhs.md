# Front review: RFK Jr.'s HHS (`rfk-hhs`)

ADO-592 per-front review, October 4, 2026. Model: the ADO-610 Trump Corruption review. Proposals only: nothing here has been applied anywhere.

**How this was measured.** One read-only pass over PROD with the anon key (16,383 story headlines, January 3 to October 4, 2026; ids, headlines, dates and alarms only, no summaries or content), then PGlite (Postgres 17, the same regex engine) simulating the migration-115 sweep against those real headlines. PROD event id 11, priority 85, 149 members today. Agent pool sizes are headline-only lower bounds.

## 1. Threads (term 2)

1. The vaccine advisers: all 17 ACIP members fired, the new panel's votes (thimerosal, MMRV, the hepatitis B birth dose), the charter rewrite after the court loss.
2. The childhood schedule cut from 17 diseases to 11 without a vote, and the court fight over it (Judge Murphy, the First Circuit appeal).
3. The CDC: Director Monarez fired, senior resignations, acting directors, the "vaccines do not cause autism" page rewritten, mass layoff notices.
4. The FDA under Kennedy: Marks forced out, Prasad in and out, Makary's resignation and the commissioner turnover, COVID shot limits, the Moderna flu shot refusal, blocked safety research, food dyes.
5. Autism claims: Tylenol in pregnancy, leucovorin, vaccines and autism, ineffective autism treatments no longer warned against.
6. Measles comes back: outbreaks, child deaths, the elimination status, and the fight over how deaths are counted.
7. HHS layoffs and restructuring (about 20,000 jobs) and the rulings on them.
8. Research cuts: NIH grant terminations, the $500 million mRNA cancellation, Bhattacharya running NIH and the CDC.
9. Leaving global health: the WHO exit, Gavi funding.
10. MAHA: the commission report and its fake citations, food and pesticides, fluoride, the surgeon general picks (Casey Means, then Nicole Saphier).
11. The vaccine injury compensation program reshaped.
12. Accountability: Kennedy's hearings, Cassidy's turn, Sanders' release of internal emails, Kennedy's MAHA book money.

## 2. PROD misses

Every PROD headline with a current sweep word is already a member, so the misses all lack those words. Found by probing seed terms on loose ends:

- **Bare "Kennedy" next to a health word (10):** "Judge Strikes Down Kennedy's Vaccine Policies" (5319), "Kennedy Seeks to Expedite Appeal of Ruling That Blocked His Vaccine Policies" (11183), "Kennedy's Vaccine Agenda Hits Roadblocks" (6119), "Kennedy Makes Unfounded Claim That Keto Diet Can 'Cure' Schizophrenia" (2445).
- **"R.F.K." with periods (2):** the sweep's `rfk` misses "A Peptide Showdown: F.D.A. Scientists May Clash With R.F.K.'s Agenda" (12932) and "Is R.F.K., Jr., Winning or Losing?" (14314).
- **FDA leadership (10):** the Makary firing and resignation (8987, 8988, 9195, 9200, 9227), "Trump administration's embattled FDA vaccine chief ousted for the second time" (4675), the acting and nominated commissioners (9265, 14063), "Trump's FDA chief to start giving bonuses for faster drug reviews" (4553), and one borderline item (13072, below).
- **Surgeon general nominations (8):** Casey Means and Nicole Saphier.
- **Measles (10):** "US health officials exclude measles-related deaths in Pennsylvania from counts" (14639), "Trump administration is failing to address spread of measles, experts say" (4538, alarm 5).
- **Vaccine policy phrasing (5):** "Trump order endorses plan to reduce vaccines recommended for children" (10321, alarm 5), "US committee is reconsidering all vaccine recommendations" (2143), "FDA refuses to consider Moderna flu shot in move experts claim is part of 'anti-vaccine agenda'" (2946).
- **NIH (1):** Bhattacharya's oversight hearing (5387).
- **For the agent only (no safe keyword):** "Top Drug Regulator Is Fired From the F.D.A." (9507, alarm 5), "F.D.A. Blocked Publication of Research Finding Covid and Shingles Vaccines Were Safe" (8761), "'Astounding' vaccine change puts US behind peer countries" (117, alarm 5), the rest of the Moderna flu shot story (2741, 2803, 3302), "U.S. Formally Withdraws From World Health Organization" (1363, alarm 5).

## 3. Keyword changes (verified on PROD headlines)

Adds: `r\.f\.k`; Makary, Prasad, Bhattacharya, Casey Means, Saphier; "FDA commissioner/chief/head/vaccine chief"; surgeon general pick or nominee; "vaccine recommendations/policy/guidance/agenda/overhaul" and "vaccines recommended"; measles, unless the headline names Canada or Mexico; and bare Kennedy only when the headline also has a health word (vaccine, measles, autism, health, food, diet, FDA, NIH, CDC, HHS, MAHA, drug, medical, pesticide, dyes, protein, Tylenol and so on). The co-word is unchanged, so Kennedy Center, Sen. John Kennedy, Schlossberg, JFK and the rest stay out.

```
sweep_pattern:
\m(rfk|r\.f\.k|robert f\. kennedy|kennedy jr|secretary kennedy|maha|make america healthy again|acip|vaccine (advisers|advisors|advisory|panel|committee|schedule)|childhood vaccines?|monarez|tylenol|acetaminophen|leucovorin|health secretary|hhs|health and human services|cdc|c\.d\.c|makary|prasad|bhattacharya|casey means|saphier|(fda|f\.d\.a\.?) (commissioner|chief|head|vaccine chief)|surgeon general (pick|nominee|nomination)|(pick|nominee) for (us |u\.s\. )?surgeon general|vaccine (recommendations?|polic(y|ies)|guidance|agenda|overhaul)|vaccines recommended)\M|^(?!.*\m(canad\w*|mexic\w*|ontario|alberta)\M).*\mmeasles\M|^(?=.*\m(vaccin\w*|measles|autism|health\w*|food|foods|diet|fluoride|fda|f\.d\.a|nih|cdc|hhs|maha|drugs?|medic\w*|pesticides?|ultraprocessed|ultra-processed|dyes?|protein|chronic|schizophrenia|tylenol|peptides?)\M).*\mkennedy('s)?\M

sweep_coword: unchanged
```

**Result on PROD (PGlite):** the targeted sweep would file 46 loose ends and lose none. A read of all 46: 45 on topic, 1 borderline ("'Not standard' for Taylor Farms to ask White House to delay cyclospora recall, ex-FDA head says", 13072). The Kennedy branch alone: 12 hits on all of PROD (10 loose ends plus 2 members), all 12 on topic. Two other fronts' members also match and stay put ("ICE Puts Texas Detention Center on Lockdown After Measles Outbreak" on ICE, a surgeon general story on Hegseth). Speed: 0.74 s per 16,000 headlines (the old rule was 0.26 s; Corruption's is about 2 s), fine for the 48-hour pipeline sweep.

Left to the agent on purpose: bare vaccine(s), FDA, NIH, flu shots, Moderna, WHO, Gavi, public health, autism (most hits are state news, recalls, science explainers or opinion).

## 4. Agent input

**agent_pattern** (new sweep verbatim, then extras). Change from today: the bare `kennedy` extra is dropped. It put about 66 Kennedy Center stories, plus Sen. John Kennedy and Schlossberg stories, in this pool; the Kennedy-plus-health branch replaces it, and summaries that name the secretary still match `robert f. kennedy`, `kennedy jr` or `secretary kennedy`. Added extras: `world health organization`, `moderna`, `flu shots?`, `food dyes?`, `ultra-?processed`, `raw milk`, `medical research`, `research grants?`.

```
\m(rfk|r\.f\.k|robert f\. kennedy|kennedy jr|secretary kennedy|maha|make america healthy again|acip|vaccine (advisers|advisors|advisory|panel|committee|schedule)|childhood vaccines?|monarez|tylenol|acetaminophen|leucovorin|health secretary|hhs|health and human services|cdc|c\.d\.c|makary|prasad|bhattacharya|casey means|saphier|(fda|f\.d\.a\.?) (commissioner|chief|head|vaccine chief)|surgeon general (pick|nominee|nomination)|(pick|nominee) for (us |u\.s\. )?surgeon general|vaccine (recommendations?|polic(y|ies)|guidance|agenda|overhaul)|vaccines recommended)\M|^(?!.*\m(canad\w*|mexic\w*|ontario|alberta)\M).*\mmeasles\M|^(?=.*\m(vaccin\w*|measles|autism|health\w*|food|foods|diet|fluoride|fda|f\.d\.a|nih|cdc|hhs|maha|drugs?|medic\w*|pesticides?|ultraprocessed|ultra-processed|dyes?|protein|chronic|schizophrenia|tylenol|peptides?)\M).*\mkennedy('s)?\M|\m(vaccines?|vaccinations?|measles|autism|fluoride|mrna|fda|f\.d\.a|nih|makary|prasad|bhattacharya|surgeon general|public health|gavi|thimerosal|hepatitis b|world health organization|moderna|flu shots?|food dyes?|ultra-?processed|raw milk|medical research|research grants?)\M
```

Member gate: all 149 members match on the headline. Headline-only pool after the new sweep: 58 (166 today).

**Plain definition.** This front is the record of what Robert F. Kennedy Jr. and the people running the federal health agencies under him (HHS, CDC, FDA, NIH, CMS, the surgeon general's office) do to the country's protection against disease, and what follows from it. A story belongs when one of them fires or replaces scientists and advisers, changes vaccine rules or recommendations, cuts staff, research or global health money, promotes unproven health claims as policy, or rewrites what the agencies tell the public; when a court, Congress or a whistleblower acts on those decisions; or when the measured damage is reported (measles cases and deaths, lost elimination status, vaccination rates), with a US agency decision in view.

Decline: the Kennedy Center and every other Kennedy; Sen. John Kennedy; state and local health decisions where HHS is not the actor (a state fluoride ban, a state surgeon general, school vaccine exemptions); food recalls and routine FDA safety notices; drug-price deals announced by the White House; Medicaid and ACA funding fights in Congress; the Fauci investigations; abortion-pill court cases (unless the FDA itself acts, see the open question); foreign outbreaks with no US angle.

Tie-breaks: Trump Corruption (15) takes money for official action ("A $5 Million Donation From Big Tobacco Preceded F.D.A. Vape Decision", 9828). ICE (72) takes health conditions inside detention. Hegseth (90) loses to this front on sweep words, but a military vaccine rule ordered by the Pentagon ("US military service members will no longer be required to get annual flu shot", 7794) is Hegseth's. Ebola travel bans are immigration actions (ICE's agent extras), not this front, unless the CDC is the actor.

**Calibration (real PROD headlines)**

| Headline | Decision | Why |
|---|---|---|
| Trump order endorses plan to reduce vaccines recommended for children (10321) | assign | The schedule cut, a federal action |
| Top Drug Regulator Is Fired From the F.D.A. (9507) | assign | FDA leadership purge |
| US health officials exclude measles-related deaths in Pennsylvania from counts (14639) | assign | Agency rewriting the public record on measles |
| A $5 Million Donation From Big Tobacco Preceded F.D.A. Vape Decision (9828) | Corruption | Money before an official decision |
| Trump does not rule out demolishing the Kennedy Center (16226) | decline | Not this Kennedy |
| How Louisiana's New Surgeon General Wants to Transform Public Health (13947) | decline | State official, no HHS action |

**Most important open question:** the abortion pill. The FDA's mifepristone review is an HHS action under Kennedy, but 18 PROD loose ends on it are mostly Supreme Court and Louisiana litigation over mail access. Recommendation: the front takes only FDA or HHS actions on the pill (label changes, the safety review); the court fights stay loose ends.
