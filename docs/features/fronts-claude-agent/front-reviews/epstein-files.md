# Front review: The Epstein Files (`epstein-files`)

ADO-592 per-front review, October 4, 2026. Model: the ADO-610 Trump Corruption review. Proposals only: nothing here has been applied anywhere.

**How this was measured.** One read-only pass over PROD with the anon key: every story's id, headline, status, date and alarm (16,383 stories, January 3 to October 4, 2026; about 3 MB of egress, no content or embeddings), plus `story_event` and `events`. Every regex below ran in PGlite (the same Postgres ARE engine) against those real headlines, simulating the migration-115 sweep (headline only, lowest priority wins, only unassigned active stories). One extra read-only probe listed unassigned stories whose `summary_neutral` contains "epstein" (ids and headlines only). PROD event id 1, priority 60, 242 members, no `agent_pattern` set.

## 1. Threads (term 2)

1. The "client list" and the binders: Bondi's February 2025 release to influencers, then the July 2025 DOJ/FBI memo saying there was no list and nothing more would come out.
2. Ghislaine Maxwell: Blanche's July 2025 interview, her move to a minimum-security camp, the clemency campaign, the Senate resolution against a pardon (July 2026), her failed release bids, her congressional testimony.
3. The Epstein Files Transparency Act: the Massie and Khanna discharge petition, the House and Senate votes, Trump signing it on November 19, 2025, the December 19 deadline, partial and redacted releases, files that went missing and then reappeared.
4. The House Oversight probe: estate documents, the birthday book, subpoenas, depositions (the Clintons, Wexner, Gates, Lutnick, Groff, Kellen, Dershowitz) and contempt (the Clintons, Leon Black).
5. Trump's own ties: the birthday letter, his $10 billion suit against the Wall Street Journal, DOJ documents with allegations against him, emails naming him, Melania's statements and the accusers who say they fear retaliation.
6. Administration officials in the files: Lutnick, the Navy secretary in the flight logs, the agency head with personal ties.
7. DOJ handling: Bondi subpoenaed and then fired (April 2, 2026) before a cover-up hearing, Blanche as acting attorney general, a judge finding he conceded breaking the Act, the 3.5 million page reading room.
8. Deflection: Trump ordering DOJ to investigate Democrats' Epstein ties (November 2025) and calling the files a hoax.
9. Fallout abroad and in elite circles, as far as it feeds back to the US files: Prince Andrew stripped and arrested (February 2026), Mandelson fired as ambassador, the Paul Weiss chair and the LA28 chair (Wasserman) resigning, Larry Summers.
10. Survivors pressing the government: hearings, State of the Union guests, ads, lawsuits for the files.

## 2. PROD misses

The bare `epstein` sweep is clean: all 242 PROD headlines with "Epstein" are on the front. The misses are stories that do not say "Epstein" in the headline.

- **Keyword-catchable: 18 loose ends, all on topic.** Maxwell 13, Prince Andrew 3, the Clinton contempt and deposition fight 2. Examples: "Senate unanimously passes resolution opposing pardon for Ghislaine Maxwell" (13205), "Todd Blanche says he would not recommend a pardon for Ghislaine Maxwell" (9688), "Will Trump Pardon Ghislaine Maxwell? Her Lawyer Thinks So." (7554, alarm 5), "Melania Trump's Alleged Emails With Ghislaine Maxwell: Read in Full" (2049), "Democrats Seek Maxwell Prison Visit, Citing Preferential Treatment" (1399), "What the arrest of former Prince Andrew can teach us about power and abuse" (3366, alarm 5), "Donald Trump Reacts to Former Prince Andrew Arrest" (3350), "Hillary Clinton deposition paused over leaked photo" (3921), "WATCH LIVE: House Oversight panel meets to review resolutions holding Clintons in contempt" (1187).
- **Agent-only: 39 unassigned stories mention Epstein in the summary but not the headline.** About 13 clearly belong, about 8 are borderline, the rest are incidental. Clear: "DOJ releases missing files with unconfirmed allegations about Trump from the 1980s" (4628), "Justice Department publishes documents with sexual assault allegations against Trump" (4603), "House Oversight Committee subpoenas Attorney General Pam Bondi" (4475), "Pam Bondi is set for another Hill grilling, but not the one some lawmakers hoped for" (10281), "Trump and the Wasserman scandal jolt LA's Olympics plans" (3431), "The Old Friend Looming Over Trump's State of the Union" (3689), "King Charles Should Use Trump Visit To Help Andrew Police Probe Get Files" (5894). Borderline: Bondi's firing (6570, 6512), Blanche's confirmation hearing (12536), the UK Mandelson papers (4979, 5646). Incidental: a blasphemy podcast (7537), a Sarah Ferguson explainer (2273), a No Kings column (6087).

## 3. Keyword changes (verified on PROD headlines)

Add rare names, Maxwell only next to a custody or clemency word (bare "maxwell" pulled a Paxton story on TEST), Prince Andrew, and the Clintons only next to contempt or deposition. Mandelson, Bondi, Blanche, Massie and Khanna are left to the agent: on PROD most of their headlines are about other things (Massie's primary, Blanche's DOJ, Bondi's firing).

```
sweep_pattern (sweep_coword stays NULL, priority stays 60):
epstein|ghislaine|giuffre|wexner|lesley groff|sarah kellen|marcinkova|jean[- ]luc brunel|zorro ranch|little st\.? james|client list|birthday book|\mmaxwell\M.*\m(prison|pardon|clemency|commut|testi|depos|immunity)|\m(prison|pardon|clemency|commut|testi|depos|immunity)\w*\M.*\mmaxwell\M|prince andrew|mountbatten[- ]windsor|\mclintons?\M.*\m(contempt|depos)|\m(contempt|depos\w*)\M.*\mclintons?\M
```

PGlite results on the 16,383 PROD headlines: 260 matches (242 current members plus the 18 loose ends above), 0 false positives, 0 matches on any other front, every old match still matched. Speed: 238 ms over all headlines (old: 12 ms); the pipeline sweep only reads a 48-hour pool, so this is negligible.

## 4. Agent input

**agent_pattern** (the sweep verbatim plus extras; every current member matches on its headline):

```
epstein|ghislaine|giuffre|wexner|lesley groff|sarah kellen|marcinkova|jean[- ]luc brunel|zorro ranch|little st\.? james|client list|birthday book|\mmaxwell\M.*\m(prison|pardon|clemency|commut|testi|depos|immunity)|\m(prison|pardon|clemency|commut|testi|depos|immunity)\w*\M.*\mmaxwell\M|prince andrew|mountbatten[- ]windsor|\mclintons?\M.*\m(contempt|depos)|\m(contempt|depos\w*)\M.*\mclintons?\M|\m(maxwell|mandelson|transparency act|sex[- ]trafficking|trafficking victims?|survivors?)\M
```

Because the pattern is also tried on `summary_neutral`, "epstein" in the summary is what pulls in the Bondi and DOJ-release stories. Expected PROD pool after the new sweep: about 40 (39 summary hits plus about 10 headline-only extras, minus the 18 the sweep takes), before the ADO-594 coverage filter.

**Definition the agent judges against.**

> The Epstein Files front is the fight over what the government knows about Jeffrey Epstein's sex-trafficking network and who it protects. A story belongs when it reports a development in: the release, withholding, redaction or loss of Epstein records by DOJ, the FBI or a court; the Epstein Files Transparency Act and its enforcement; congressional subpoenas, depositions, hearings or contempt in the Epstein probe; Ghislaine Maxwell's custody, testimony, appeals or clemency; Trump's own documented ties to Epstein and his lawsuits or threats over them; administration officials named in the files; DOJ leaders (Bondi, Blanche, Patel) acting on the files or being questioned about them; survivors pressing the government; and fallout for powerful people (Prince Andrew, Mandelson, Wexner, Gates, Summers) when it comes from the US files or puts pressure on US officials.
>
> It does not belong when Epstein is incidental: comedy and satire (SNL, award-show jokes), protest art, campaign and horse-race stories where Epstein is one issue among many (Massie's primary), UK or royal-family news with no link to the US files or US officials, and DOJ-leadership stories whose summary does not tie the event to the files.
>
> Tie-breaks: Trump Corruption (priority 15) keeps money stories (Trump business deals, donors) even if an Epstein name appears; a Maxwell pardon or commutation is Epstein, not Corruption. A court ruling on the files, the Act or grand-jury records is Epstein, not The Courts. A congressional vote is Epstein when the vote is about the files.

**Calibration headlines (all real PROD stories).**

| Headline | Decision | Why |
|---|---|---|
| DOJ releases missing files with unconfirmed allegations about Trump from the 1980s (4628) | assign 0.85 | DOJ release of Epstein records naming Trump |
| Senate unanimously passes resolution opposing pardon for Ghislaine Maxwell (13205) | assign 0.90 | Maxwell clemency, a chamber acted |
| House Oversight Committee subpoenas Attorney General Pam Bondi (4475) | assign 0.80 | Subpoena over the files (the summary says so) |
| British prime minister was warned of 'reputational risk' in appointing Mandelson, files show (4979) | decline 0.60, borderline | UK domestic fallout, no US actor |
| Is blasphemy the last straw for Trump's Maga base? (podcast) (7537) | decline 0.90 | Epstein is a passing mention |

## 5. Open questions for Josh

1. **Foreign fallout.** The sweep now files Prince Andrew stories (3 loose ends, all about his Epstein arrest). Should UK and royal fallout be on the front at all, or only when it ties back to the US files? *Recommended: keep Andrew in the sweep (in 2026 every Andrew headline is Epstein) and let the agent decline UK stories with no US link, such as the Mandelson papers.*
2. **Pop culture on the main line.** At least 6 current members are jokes, protest art or celebrity spats (for example "Jeffrey Epstein 'Ghost' Shows Donald Trump the 'Future' on 'SNL'", 9502; the Trump and Epstein statue on the Mall, 4919; Cardi B, 2927). The sweep files anything that says Epstein. *Recommended: leave them on the front; ADO-594's coverage label should keep them off the main line.*
3. **started_at** is September 24, 2025 (the data seed). The saga in term 2 starts with the binders in February 2025. *Recommended: set it to February 27, 2025 if the front page shows "since" dates.*
