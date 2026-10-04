-- ADO-592 - front definitions: the all-fronts agent's rubric (events.agent_definition) for the 8
-- published fronts other than Election, their agent_pattern, and the keyword fixes the October 4,
-- 2026 front reviews tested on all 16,383 PROD headlines (docs/features/fronts-claude-agent/front-reviews/).
-- TEST and PROD: fronts are looked up by slug. Needs migration 127. Summary and open questions:
-- plan.md, "Definitions file (October 4, 2026)". Test: scripts/tests/front-definitions-sql-pglite.test.mjs
-- APPLY OUTSIDE the daily fronts run (14:00 UTC, a few minutes); part (2) refuses if the agent wrote
-- anything in the last 15 minutes. Pastes: (1) pre-check; (2) APPLY, BEGIN to COMMIT as ONE block;
-- (3) result. IF (2) ERRORS: run   ROLLBACK;   alone first, fix the cause, re-run (2) (idempotent).
-- Rollback: the commented block at the bottom (restores the backed-up values, unfiles this sweep).
-- Result (3): 9 rows, first column slug; expect in_agent true on every row.

-- (1) PRE-CHECK (read-only). Expect 9 rows, all published; has_definition true only for
-- election-suppression on a first run (all 9 after). Part (2) refuses if anything is off.
SELECT e.slug, e.publish_state, e.sweep_priority,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id) AS members,
       e.agent_pattern IS NOT NULL                                           AS has_agent_pattern,
       NULLIF(btrim(e.agent_definition), '') IS NOT NULL                     AS has_definition
  FROM public.events e
 WHERE e.slug IN ('trump-corruption', 'election-suppression', 'epstein-files', 'the-courts',
                  'ice-deportations', 'israel-gaza', 'iran', 'rfk-hhs', 'hegseth-pentagon')
 ORDER BY e.sweep_priority, e.id;

-- (2) APPLY: one transaction, BEGIN to COMMIT. Paste and run the whole block at once.
BEGIN;

-- (2a) Backup table (the ADO-610 one, created there; plus agent_definition). Service role only.
CREATE TABLE IF NOT EXISTS public.front_merge_backup_events (
  merge_tag      TEXT        NOT NULL,
  event_id       BIGINT      NOT NULL,
  slug           TEXT        NOT NULL,
  publish_state  TEXT        NOT NULL,
  published_at   TIMESTAMPTZ,
  sweep_pattern  TEXT,
  sweep_coword   TEXT,
  sweep_priority SMALLINT    NOT NULL,
  sweep_summary  BOOLEAN     NOT NULL,
  agent_pattern  TEXT,
  backed_up_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (merge_tag, event_id)
);
ALTER TABLE public.front_merge_backup_events ADD COLUMN IF NOT EXISTS agent_definition TEXT;
ALTER TABLE public.front_merge_backup_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.front_merge_backup_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.front_merge_backup_events TO service_role;

-- (2b) Guards, backup, write, invariants. Regexes are dollar-quoted ($p$...$p$), so every backslash
-- and apostrophe is stored exactly as the reviews tested it. Each agent_pattern is its sweep verbatim
-- plus extras (the 592/595/608/610 convention), except Election's, which is unchanged.
DO $do$
DECLARE
  c_tag CONSTANT TEXT := 'ado-592-defs';

  -- Trump Corruption: definition only (sweep and agent_pattern stay the ADO-610 values)
  tc_def CONSTANT TEXT := $d$This front is the record of public power used for private gain by Trump, his family, his envoys and his allies. A story belongs when money, gifts or business flow to Trump, his family (Eric, Don Jr., Ivanka, Melania, Barron, Jared Kushner) or their companies (Trump Organization, Trump Media, World Liberty Financial, the memecoin, licensing deals), or to Steve Witkoff and his family, from people with business before the government (foreign governments, donors, companies); when an official act follows money (a pardon, contract, regulatory decision, tariff break or lawsuit settlement for a donor or crony; the payout funds for allies; paid access to Trump); when Trump profits from his own policy moves (stock and crypto timing, insider trading near announcements, oil deals for allies); when public property or money is turned to his projects (the Qatar jet, the ballroom and its donors, the Reflecting Pool and East Potomac contracts, the presidential library, the gold card); or when the checks on all this are removed (inspectors general fired, ethics and anti-corruption units disbanded, FCPA enforcement paused).

**Decline:** corruption cases with no link to Trump's circle (a mayor's bribery plea, a state official); rhetoric ("Biden calls Trump corrupt") and campaign attacks; Kushner's and Witkoff's diplomacy when no money is in the story; Trump's construction projects (the arch, renovations) unless the story is about who is paid or who donated; general budget, debt or watchdog stories outside the Trump circle; golf-course incidents.

**Tie-breaks:** this front (priority 15) wins any keyword overlap, so keep it honest: a story goes here only when the money or favor is the news. A pardon for a donor or a crony's company comes here; the pardon itself as clemency stays off the fronts. The Epstein files stay on Epstein unless the story is about money for favors. The Board of Peace goes to Israel & Gaza unless money reaches Trump or his family. An FDA, Pentagon or immigration decision that followed a donation comes here ahead of RFK, Hegseth or ICE.

### Calibration examples

| Headline | Decision | Why |
|---|---|---|
| Steve Witkoff, Trump's Special Envoy, Made More Than $250 Million While in Government | **assign** | Envoy profiting in office |
| For $1 Million, Donors to U.S.A. Birthday Group Offered Access to Trump | **assign** | Paid access |
| Trump Plans to Protect Methane-Leaking Stripper Wells. This Billionaire Donor Will Benefit. | **assign** | Policy following a donor |
| A $5 Million Donation From Big Tobacco Preceded F.D.A. Vape Decision | **assign** | Donation, then a decision; wins over RFK Jr.'s HHS |
| Trump sending Vance, Witkoff and Kushner to Pakistan for ceasefire talks with Iran | **iran**, not this front | Diplomacy, no money |
| Former mayor of Mississippi's capital pleads guilty to bribery and fraud | **decline** | Not Trump's circle |$d$;

  -- Election Suppression: sweep fix (SAVE America Act and 9 more branches, appended inside the
  -- 115 pattern's outer parentheses) and co-word; agent_pattern unchanged; definition = the 127
  -- seed plus the review's additions (appended below, never rewritten).
  el_old    CONSTANT TEXT := $p$(voter roll|voter purge|purg(e|es|ed|ing) (of )?(the )?voter|voter registration|voter suppression|voter intimidation|voter (data|database|file)|mail-in|mail ballot|mail(ed)? ballots|vote[- ]by[- ]mail|absentee ballot|ballot (drop ?box|harvest|access)|early voting|hand[- ]count|election fraud|voter fraud|rigged.{0,20}(election|vote|ballot|midterm)|(election|vote|ballot|midterm).{0,20}rigged|stolen election|SAVE Act|seiz(e|es|ed|ing|ure) (of )?(the |voting |election )?(election|machines|equipment|records|ballots|files)|take over (the )?election|nationaliz\w* (the )?election|federaliz\w* (the )?election|election integrity|decertif|certif(y|ies|ied|ying|ication) (of )?(the )?(election|results|vote)|refus\w* to certify|voting rights act|proof of citizenship|citizenship (proof|check|list|verification|question)|noncitizen|non-citizen|voter id|voting machine|election (takeover|police|task force|official|officials|files|records|data|equipment)|(cancel|postpone|suspend|delay)(ing|ed|s)? (the )?(midterm|election)|polling (place|site|location|station)|poll (worker|watcher|closure|closing)|polling[- ]place|usps|postal service)$p$;
  el_sweep  CONSTANT TEXT := left(el_old, length(el_old) - 1)
    || $p$|\msave america act\M|(restrict\w*|limit\w*|ban\w*|end\w*|curb\w*|eliminat\w*) (on |of )?(mail voting|voting by mail)|mail voting (bans?|restrictions?|limits?|orders?)|voter (lists?|records|information|info)\M|fulton county|(raid\w*|search\w*|seiz\w*).{0,40}election (office|offices|hub|headquarters)|election (office|offices|hub) (raid|search)\w*|\mtroops?\M (at|near|outside|to|in) (the )?(polls|polling (places?|sites?|stations?|locations?))\M|\melection\w* (executive )?orders?\M|executive orders? on (elections?|voting)|(state of emergency|emergency powers|martial law|insurrection act).{0,60}\m(midterms?|elections?)\M$p$
    || ')';
  el_cw_old CONSTANT TEXT := $p$(election|vote|voter|voting|ballot|midterm|poll|precinct|electoral)$p$;
  el_cw     CONSTANT TEXT := $p$(election|vote|voter|voting|ballot|midterm|poll|precinct|electoral|\msave (america )?act\M)$p$;
  el_seed_start CONSTANT TEXT := 'The front is "**fronts they are screwing us on**"';
  el_marker CONSTANT TEXT := '### All fronts: additions (ADO-592, October 2026)';
  el_add    CONSTANT TEXT := $d$

### All fronts: additions (ADO-592, October 2026)

- The federal government collecting, matching or demanding voter data (DOJ suits for state voter files, DHS citizenship checks of voter rolls, a federal voter list) is mechanism 1, including court rulings on it.
- Federal agents searching election offices or voting-rights groups, or seizing ballots and election records, including 2020 records, is mechanism 3. Relitigating 2020 counts when a federal or state agency acts now (a raid, a subpoena, a records demand); history pieces do not.
- A credible threat by the President or an agency to put troops, ICE or emergency powers between voters and the polls is mechanism 2.

**Tie-breaks with the other fronts:** Trump Corruption (priority 15) keeps donor and money stories. This front (50) wins over The Courts (70) for any ruling on voting, voter data or maps, and over ICE & Deportations (72) for ICE at polling places. A SAVE Act story where the bill rides on unrelated legislation stays here.

| Headline | Decision | Why |
|---|---|---|
| Federal judge halts Trump's election executive order seeking to create a federal voter list | **assign** 0.90 | Court ruling on a federal voter list (mechanism 1) |
| FBI searched Fulton County offices in probe of possible 2020 election 'defects,' affidavit says | **assign** 0.90 | Federal seizure of election records (mechanism 3) |
| Trump doesn't rule out declaring state of emergency before midterm elections | **assign** 0.70 | Credible threat to change how the midterms run |
| Tamara Keith and Amy Walter on the impact of Trump's push for the SAVE Act | **decline** 0.80 | Analysis segment, no new action |
| Marjorie Taylor Greene Fears Trump Will Cancel 2028 Election | **decline** 0.80 | Speculation, no actor taking a step |$d$;

  -- The Epstein Files: sweep adds rare names, Maxwell next to a custody or clemency word, the
  -- Clintons next to contempt or deposition. Prince Andrew is NOT swept (open question for Josh);
  -- the agent judges him (agent extras).
  ep_sweep CONSTANT TEXT := $p$epstein|ghislaine|giuffre|wexner|lesley groff|sarah kellen|marcinkova|jean[- ]luc brunel|zorro ranch|little st\.? james|client list|birthday book|\mmaxwell\M.*\m(prison|pardon|clemency|commut|testi|depos|immunity)|\m(prison|pardon|clemency|commut|testi|depos|immunity)\w*\M.*\mmaxwell\M|\mclintons?\M.*\m(contempt|depos)|\m(contempt|depos\w*)\M.*\mclintons?\M$p$;
  ep_agent CONSTANT TEXT := ep_sweep || $p$|prince andrew|mountbatten[- ]windsor|\m(maxwell|mandelson|transparency act|sex[- ]trafficking|trafficking victims?|survivors?)\M$p$;
  ep_def   CONSTANT TEXT := $d$The Epstein Files front is the fight over what the government knows about Jeffrey Epstein's sex-trafficking network and who it protects. A story belongs when it reports a development in: the release, withholding, redaction or loss of Epstein records by DOJ, the FBI or a court; the Epstein Files Transparency Act and its enforcement; congressional subpoenas, depositions, hearings or contempt in the Epstein probe; Ghislaine Maxwell's custody, testimony, appeals or clemency; Trump's own documented ties to Epstein and his lawsuits or threats over them; administration officials named in the files; DOJ leaders (Bondi, Blanche, Patel) acting on the files or being questioned about them; survivors pressing the government; and fallout for powerful people (Prince Andrew, Mandelson, Wexner, Gates, Summers) when it comes from the US files or puts pressure on US officials.

**Decline** when Epstein is incidental: comedy and satire (SNL, award-show jokes), protest art, campaign and horse-race stories where Epstein is one issue among many (Massie's primary), UK or royal-family news with no link to the US files or US officials, and DOJ-leadership stories whose summary does not tie the event to the files.

**Tie-breaks:** Trump Corruption (priority 15) keeps money stories (Trump business deals, donors) even if an Epstein name appears; a Maxwell pardon or commutation is Epstein, not Corruption. A court ruling on the files, the Act or grand-jury records is Epstein, not The Courts. A congressional vote is Epstein when the vote is about the files.

### Calibration examples

| Headline | Decision | Why |
|---|---|---|
| DOJ releases missing files with unconfirmed allegations about Trump from the 1980s | **assign** 0.85 | DOJ release of Epstein records naming Trump |
| Senate unanimously passes resolution opposing pardon for Ghislaine Maxwell | **assign** 0.90 | Maxwell clemency, a chamber acted |
| House Oversight Committee subpoenas Attorney General Pam Bondi | **assign** 0.80 | Subpoena over the files (the summary says so) |
| British prime minister was warned of 'reputational risk' in appointing Mandelson, files show | **decline** 0.60, borderline | UK domestic fallout, no US actor |
| Is blasphemy the last straw for Trump's Maga base? (podcast) | **decline** 0.90 | Epstein is a passing mention |$d$;

  -- The Courts: the old co-word folded into the old rule as a lookahead (sweep_coword becomes NULL),
  -- plus four branches. agent_pattern: the TIGHT variant (no Supreme Court phrase; open question).
  co_old    CONSTANT TEXT := $p$(def(y|ies|ied|iance)|contempt|ignor(e|es|ed|ing) (the )?(court|ruling|order)|constitutional crisis|impeach(ing)? (a |the )?judge|existential threat|attack(s|ed|ing)? (on )?(the )?(judge|judiciary|courts))$p$;
  co_cw_old CONSTANT TEXT := $p$(judge|court|judiciary|judicial)$p$;
  co_sweep  CONSTANT TEXT := $p$^(?=.*(judge|court|judiciary|judicial)).*(def(y|ies|ied|iance)|contempt|ignor(e|es|ed|ing) (the )?(court|ruling|order)|constitutional crisis|impeach(ing)? (a |the )?judge|existential threat|attack(s|ed|ing)? (on )?(the )?(judge|judiciary|courts))|rogue judges?|judicial (emergency|crisis|independence)|impeach\w* (a |the |federal |activist |rogue )?judges?\M|\mjudges?\M.*\m(threats\M|violen|pizzas?\M|doxx|intimidat)|\m(threats?|attacks?) (on|to|against) (federal )?(judges|the judiciary|the courts)\M|\m(violat|flout|disobey|ignor|evad|def(y|ies|ied|ying))\w* (a |the |their |his |her |its |multiple |repeated |several |lower |federal )*(court|judges?'?s?|judicial) (orders?|rulings?)\M|\m(judges?|courts?)\M.*\m(violat|flout|disobey|ignor|evad)\w* (their|his|her|its|the) (orders?|rulings?)\M|\m(judges?|courts?)\M.*\m(u\.?s\.? attorneys?|top prosecutors?)\M|\m(u\.?s\.? attorneys?|top prosecutors?)\M.*\m(judges?|courts?)\M|\m(appointed|serving) (illegally|unlawfully)\M|\m(illegally|unlawfully) (appointed|serving)\M|^(?!.*\m(ice|deport\w*|immigra\w*|migrants?|asylum|detain\w*|detainees?|icc|international criminal court)\M)(?=.*\m(judges?|courts?)\M)(?=.*\m(justice dep(t|artment)|doj|government|administration|trump)\M).*\m(candor|discipline|sanction(ed|ing)?|misconduct|lied|lying|misled|misleading|false (statement|claim|allegation)s?|breakdown|bad faith|unethical|unseemly|rebuk\w*|chastis\w*|scold\w*)\M|^(?!.*\m(ice|deport\w*|immigra\w*|migrants?|asylum|detain\w*|detainees?|icc|international criminal court)\M)(?=.*\mtrump\w*\M)(?=.*\m(judges?|justices|supreme court|judiciary)\M).*\m(slams?|slammed|blasts?|blasted|attacks?|attacked|rips?|vents?|vented|lashes out|lashed out|fools|lap ?dogs|radical left|rogue|lunatics?|derang\w*|ransack\w*|in league)\M$p$;
  co_agent  CONSTANT TEXT := co_sweep || $p$|\m(judges?|judiciary|judicial|injunctions?|restraining orders?|unconstitutional|struck down|strikes? down|boasberg|u\.?s\.? attorneys?|emergency docket|shadow docket|contempt)\M$p$;
  co_def    CONSTANT TEXT := $d$The Courts front is the collision between this administration and the judiciary. A story belongs when: the administration defies, ignores, slow-walks or is found to have violated a court order; a judge holds or threatens to hold officials in contempt; the President, the White House or DOJ attacks, threatens, files complaints against or calls to impeach judges or justices; judges warn in public about threats, attacks or a judicial crisis; a court rules on the legality of a US attorney's appointment; a judge finds the government's lawyers misled the court or refers them for discipline; a federal court (including the Supreme Court) blocks, voids or allows an executive action that has no topic front of its own (funding freezes, grants, layoffs, agency closures, media funding, tariffs, the Kennedy Center, data demands); or the Supreme Court rules on the limits of presidential power (firings, tariffs, universal injunctions, the emergency docket).

**Decline** when: the case is Trump's own (the hush money conviction, E. Jean Carroll, his defamation suits against news outlets, the BBC); the parties are states, companies or private people with no federal administration party; the court is foreign or international; the Supreme Court case does not involve the administration (guns, abortion pills, trans athletes, state election maps); or the story is a filing deadline or a hearing date with no ruling.

**Tie-breaks, topic beats venue:** rulings on immigration, deportation, detention, visas, TPS and birthright citizenship go to ICE & Deportations; on voting, voter data and maps to Election Suppression; on the Epstein files to Epstein; on vaccines and HHS to RFK Jr.'s HHS; on the Pentagon or Hegseth to Hegseth's Pentagon; on the ballroom, the library or the anti-weaponization fund to Trump Corruption. **Except:** defiance of a court order, contempt, and attacks on or threats to judges stay on The Courts even when the case is about immigration (this matches the sweep, where The Courts at 70 wins over ICE at 72). National Guard deployment cases stay on The Courts unless the headline names the Pentagon or Hegseth.

### Calibration examples

| Headline | Decision | Why |
|---|---|---|
| Federal judge blocks Trump order to end funding for NPR and PBS | **assign** 0.85 | Blocked executive order, no topic front |
| Supreme Court, for now, blocks Trump from firing Fed board member Lisa Cook | **assign** 0.80 | Supreme Court on the limits of presidential power |
| Judge blocks Trump officials from detaining refugees in Minnesota | **ice-deportations**, not this front | Topic beats venue |
| Judge temporarily blocks payouts from Trump's $1.8B 'anti-weaponization' settlement fund | **trump-corruption**, not this front | Topic beats venue |
| Judge rejects Trump's latest bid to challenge hush money conviction | **decline** 0.90 | Trump's personal case |
| Supreme Court Allows States to Bar Transgender Athletes From Girls' Sports | **decline** 0.85 | No administration party |$d$;

  -- ICE & Deportations: Kilmar Abrego Garcia added inside the sweep's word group (the accented
  -- spelling is its own entry); agent_pattern = the new sweep plus the ADO-608 extras, unchanged.
  ic_old    CONSTANT TEXT := $p$\m(ice|deport\w*|immigra\w*|migrants?|asylum|refugee admissions|detention (camps?|centers?|centres?|facilit\w*|beds?|polic\w*|sites?)|mass detention|mandatory detention|detainees?|third[- ]countr\w*|border patrol|bovino|cbp|customs and border protection|border czar|homan|alligator alcatraz|cornhusker clink|speedway slammer|cecot|alien enemies act|sanctuary (cities|city|states?|jurisdictions?|polic\w*)|masked (agents?|officers?|men)|(workplace|worksite|farm|factory) raids?)\M$p$;
  ic_extras CONSTANT TEXT := $p$|\m(dhs|homeland security|noem|border|citizenship|visas?|tps|temporary protected status|daca|dreamers?|birthright|travel ban|green cards?|naturaliz\w*|denaturaliz\w*)\M$p$;
  ic_sweep  CONSTANT TEXT := $p$\m(ice|deport\w*|immigra\w*|migrants?|asylum|refugee admissions|detention (camps?|centers?|centres?|facilit\w*|beds?|polic\w*|sites?)|mass detention|mandatory detention|detainees?|third[- ]countr\w*|border patrol|bovino|cbp|customs and border protection|border czar|homan|alligator alcatraz|cornhusker clink|speedway slammer|cecot|alien enemies act|sanctuary (cities|city|states?|jurisdictions?|polic\w*)|masked (agents?|officers?|men)|(workplace|worksite|farm|factory) raids?|kilmar|abrego|ábrego)\M$p$;
  ic_def    CONSTANT TEXT := $d$This front is the record of the government arresting, detaining, deporting and expelling people, and of the fights over it. A story belongs when ICE, Border Patrol, CBP, DHS leadership, the White House or DOJ carries out or orders immigration arrests and raids, detention (the camps, conditions, deaths in custody, detention expansion), deportations and removal flights (third countries, CECOT, Guantánamo, the Alien Enemies Act), the end of legal protections that makes people deportable (TPS, parole, DACA, refugee admissions, mass visa or green-card revocations, birthright citizenship, travel bans), or targets sanctuary jurisdictions; when a court rules on any of it; or when agents' conduct is the story (masked agents, shootings, arrests of citizens, officials or reporters).

**Decline:** DHS stories with no enforcement angle (the department's funding fight in general, TSA, FEMA, Secret Service, the Noems' personal life); legal immigration business (H-1B fees, visa processing delays, employer programs); border wall construction and its environmental fights (lean decline, mark `uncertain`); "ice" as weather, food or sport; polls and campaign positioning on immigration.

**Tie-breaks:** Trump Corruption (priority 15) takes money flowing to Trump allies from the crackdown (contracts to donors, the detention companies' payments to Trump allies). Election Suppression (50) takes ICE at or near polling places and voter-citizenship checks. The Courts (70) takes open defiance of a court order (contempt over deportation flights); an ordinary ruling stays here. This front beats Israel & Gaza (75) on the detention and deportation of pro-Palestinian activists (Khalil, Mahdawi, Ozturk). National Guard and troop deployments to cities are not this front unless the story is about the immigration operation itself (troops guarding an ICE facility or joining arrests).

### Calibration examples

| Headline | Decision | Why |
|---|---|---|
| Trump administration pursues Kilmar Ábrego García on previously dismissed charges | **assign** | The wrongful-deportation saga, now a prosecution |
| Trump Admin Allowed to End TPS for 3 Countries: What We Know | **assign** | Removing protection makes people deportable |
| U.S. set for largest mass visa revocation in history targeting up to 200,000 foreigners | **assign** | Mass revocation |
| DHS Shutdown Could Come Back to Bite Democrats | **decline** | Funding politics, no enforcement action |
| Federal judge halts Big Bend border wall construction in blow to Trump agenda | **decline**, uncertain | Wall construction, not arrests or removals |$d$;

  -- Israel & Gaza: sweep adds Board of Peace, Francesca Albanese, and the ICC next to a US actor;
  -- co-word excludes East Palestine and adds three push verbs; agent extras per the review.
  is_old    CONSTANT TEXT := $p$\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\w*)\M$p$;
  is_cw_old CONSTANT TEXT := $p$^(?!.*\m(pro-palestinian|pro-hamas)\M)((?!.*\miran(ian)?\M)|.*\m(israel\w*|netanyahu)\M.{0,60}\m(urg(es|ed|ing)|press(es|ed|ing)|pressur(es|ed|ing)|lobb(ies|ied|ying)|push(es|ed|ing)|convinc(es|ed|ing)|persuad(es|ed|ing)|goad(s|ed|ing)|lur(es|ed|ing)|drag(s|ged|ging))\M(?!\s+(back|by)\M).{0,60}\m(us|u\.s|america\w*|trump|washington|white house|congress)\M|.*\m(trump|washington|white house|congress)\M.{0,40}\m(pressured|pushed|lobbied|urged|persuaded|convinced|dragged|goaded|lured)\s+by\s+(the\s+)?(israel\w*|netanyahu)\M)$p$;
  is_ag_old CONSTANT TEXT := $p$\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\w*)\M|\m(fara|foreign agents? registration|havas|clock tower x|bridges partners|esther project|stoic|diaspora ministry|ministry of diaspora|democratic majority for israel|dmfi|adelson|gaza humanitarian foundation|ghf|international stabilization force|international criminal court|icc|albanese|icj|international court of justice|famine|genocide|epic fury|midnight hammer|war powers)\M$p$;
  is_sweep  CONSTANT TEXT := $p$\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\w*|board of peace|francesca albanese)\M|^(?=.*\m(sanction\w*|trump|rubio|washington|u\.s|us|america\w*)\M).*\m(icc|international criminal court)\M$p$;
  is_cw     CONSTANT TEXT := $p$^(?!.*\m(pro-palestinian|pro-hamas|east palestine)\M)((?!.*\miran(ian)?\M)|.*\m(israel\w*|netanyahu)\M.{0,60}\m(urg(es|ed|ing)|press(es|ed|ing)|pressur(es|ed|ing)|lobb(ies|ied|ying)|push(es|ed|ing)|convinc(es|ed|ing)|persuad(es|ed|ing)|goad(s|ed|ing)|lur(es|ed|ing)|drag(s|ged|ging)|forc(es|ed|ing)|sway(s|ed|ing)|lean(s|ed|ing)? on)\M(?!\s+(back|by|to)\M).{0,60}\m(us|u\.s|america\w*|trump|washington|white house|congress)\M|.*\m(trump|washington|white house|congress)\M.{0,40}\m(pressured|pushed|lobbied|urged|persuaded|convinced|dragged|goaded|lured|forced|swayed)\s+by\s+(the\s+)?(israel\w*|netanyahu)\M)$p$;
  is_agent  CONSTANT TEXT := is_sweep || $p$|\m(fara|foreign agents? registration|havas|clock tower x|bridges partners|esther project|stoic|diaspora ministry|ministry of diaspora|democratic majority for israel|dmfi|adelson|gaza humanitarian foundation|ghf|international stabilization force|international criminal court|icc|special rapporteur|icj|international court of justice|famine|genocide|abraham accords|mike huckabee|zionis\w*|hezbollah)\M$p$;
  is_def    CONSTANT TEXT := $d$This front is the record of what the US government does for, with, or because of Israel's government, and of Israel's government and US pro-Israel groups acting on American politics. A story belongs when a US actor (the President, State, the Pentagon, Treasury, Congress, a US court) arms, funds, shields, sanctions on Israel's behalf, plans for Gaza, or goes to war alongside Israel at Israel's urging; or when Israel's government or a named pro-Israel group spends on, lobbies, or runs influence campaigns aimed at US elections and officials. Gaza's toll belongs when it comes with a US decision or a finding by a named body. Name Israel's government and US groups separately; never call a group "Israel". Genocide is always "X concludes", never the site's own claim.

**Decline:** Israeli domestic politics, IDF operations and Israel's wars in Lebanon or Syria with no US actor; antisemitism and campus stories with no named lobbying or election spending; candidate profiles and horse race that merely mention AIPAC; general Middle East coverage (oil, troop movements).

**Tie-breaks** (lower sweep priority wins on keywords; follow the same order): Trump Corruption (15) takes money for Trump, his family or the envoys (Kushner's and Witkoff's business deals; diplomacy alone is not corruption). Election Suppression (50) takes anything about who votes. ICE & Deportations (72) takes the detention or deportation of pro-Palestinian activists (Khalil, Mahdawi, Ozturk). Iran (80) takes the war itself, strikes, Hormuz, war-powers votes and talks; this front takes an Iran story only when Israel or Netanyahu is shown steering the US decision. The Board of Peace belongs here (it was created by the Gaza resolution and runs Gaza's plan) unless the story is about money reaching Trump or his family, which is Trump Corruption.

### Calibration examples

| Headline | Decision | Why |
|---|---|---|
| State Department Bypasses Congress to Send Israel More Than 20,000 Bombs | **assign** | US arms, skipping Congress |
| US sanctions international criminal court president and prosecutor | **assign** | US shields Israel from the court |
| AIPAC Spending Dominates the Michigan Democratic Senate Primary | **assign** | Named group spending on a US election |
| Push from Saudis, Israel helped move Trump to attack Iran | **assign** | Israel steering the US war decision |
| U.S. and Israel launch airstrikes against Iran | **iran**, not this front | The war itself |
| Pro-Palestinian activists accused of intimidation campaign against University of Michigan officials | **decline** | Campus story, no US-Israel policy or spending |$d$;

  -- Iran: sweep adds Iranians, Hormuz, Tehran, Khamenei, Kharg, operation names, the IRGC, the
  -- nuclear sites and "Middle East war"; co-word unchanged; agent extras per the review.
  ir_old   CONSTANT TEXT := $p$\miran(ian)?\M$p$;
  ir_sweep CONSTANT TEXT := $p$\miran(ians?)?\M|hormuz|tehran|khamenei|\mkharg\M|epic fury|midnight hammer|\mirgc\M|revolutionary guards?|\m(fordow|natanz|isfahan)\M|\m(middle east|mideast) wars?\M|\mwars? in the middle east\M$p$;
  ir_agent CONSTANT TEXT := ir_sweep || $p$|\m(iran\w*|ayatollah|persian gulf|gulf states|war powers|houthis?|red sea|oman|strait|ceasefire|cease-fire|enriched uranium|nuclear (deal|talks|program|sites?|facilit\w*)|regime change|centcom|dignified transfer|service members killed)\M$p$;
  ir_def   CONSTANT TEXT := $d$The Iran front is the United States' war with Iran and everything Washington does to start it, run it, pay for it or end it, from January 20, 2025 on. A story belongs when a US actor (the President, the White House, the Pentagon, State, Treasury, Congress, a US court) takes, orders, threatens or votes on an action about Iran, or when the story reports a direct consequence of the war for Americans: strikes and threats of strikes, regime-change talk, the Strait of Hormuz (closure, mines, escorts, tolls, the blockade), war-powers votes and war funding, US casualties, civilian deaths and war-crime orders, ceasefires, talks and nuclear deals, sanctions and threats against countries that help Iran, the war's oil and gas shock when the story is about the war's effect, and dissent inside the administration or Trump's coalition about the war.

**Decline** when Iran is one item in a list: approval-rating polls, monthly inflation or jobs reports, campaign stories, the economy in general. Iran's internal politics with no US action, other conflicts (Russia and Ukraine, Venezuela, Cuba, Greenland), and war-powers votes about those other conflicts do not belong.

**Tie-breaks:** Israel & Gaza (priority 75) keeps stories about Israel pushing the US toward the war (Netanyahu lobbying, Israel striking first to drag the US in); Israel and Iran trading strikes belongs here when a US decision is part of the story (a green light, an appeal to stop, US air defense); with no US role it fits no front. Hegseth's Pentagon (90) cedes the conduct of the Iran war to this front. Trump Corruption (15) keeps insider trading or profiteering around war announcements. A court case about the war is Iran, not The Courts.

### Calibration examples

| Headline | Decision | Why |
|---|---|---|
| Republicans Again Block War Powers Measure in the Senate | **assign** 0.85 | Congress voting on the Iran war (the summary names Iran) |
| Trump threatens to bomb Oman, widening the war that crippled the global economy | **assign** 0.85 | Presidential threat that extends the war |
| Trump threats cause dilemma for US officers: disobey orders or commit war crimes | **assign** 0.80 | Conduct of the war, war-crime orders |
| Senate blocks Venezuela war powers bill after Vance breaks deadlock | **decline** 0.95 | War powers, but Venezuela |
| Trump Disapproval on Gas Tops Every President This Century: Harry Enten | **decline** 0.85 | A poll; the war is background |$d$;

  -- RFK Jr.'s HHS: sweep adds R.F.K., FDA and NIH leaders, surgeon general picks, vaccine policy
  -- phrases, measles (not Canada or Mexico) and Kennedy next to a health word; co-word unchanged.
  -- The agent pattern drops the bare "kennedy" extra (it pulled in the Kennedy Center).
  rf_old    CONSTANT TEXT := $p$\m(rfk|robert f\. kennedy|kennedy jr|secretary kennedy|maha|make america healthy again|acip|vaccine (advisers|advisors|advisory|panel|committee|schedule)|childhood vaccines?|monarez|tylenol|acetaminophen|leucovorin|health secretary|hhs|health and human services|cdc|c\.d\.c)\M$p$;
  rf_ag_old CONSTANT TEXT := rf_old || $p$|\m(kennedy|vaccines?|vaccinations?|measles|autism|fluoride|mrna|fda|nih|makary|prasad|bhattacharya|surgeon general|public health|gavi|thimerosal|hepatitis b)\M$p$;
  rf_sweep  CONSTANT TEXT := $p$\m(rfk|r\.f\.k|robert f\. kennedy|kennedy jr|secretary kennedy|maha|make america healthy again|acip|vaccine (advisers|advisors|advisory|panel|committee|schedule)|childhood vaccines?|monarez|tylenol|acetaminophen|leucovorin|health secretary|hhs|health and human services|cdc|c\.d\.c|makary|prasad|bhattacharya|casey means|saphier|(fda|f\.d\.a\.?) (commissioner|chief|head|vaccine chief)|surgeon general (pick|nominee|nomination)|(pick|nominee) for (us |u\.s\. )?surgeon general|vaccine (recommendations?|polic(y|ies)|guidance|agenda|overhaul)|vaccines recommended)\M|^(?!.*\m(canad\w*|mexic\w*|ontario|alberta)\M).*\mmeasles\M|^(?=.*\m(vaccin\w*|measles|autism|health\w*|food|foods|diet|fluoride|fda|f\.d\.a|nih|cdc|hhs|maha|drugs?|medic\w*|pesticides?|ultraprocessed|ultra-processed|dyes?|protein|chronic|schizophrenia|tylenol|peptides?)\M).*\mkennedy('s)?\M$p$;
  rf_agent  CONSTANT TEXT := rf_sweep || $p$|\m(vaccines?|vaccinations?|measles|autism|fluoride|mrna|fda|f\.d\.a|nih|makary|prasad|bhattacharya|surgeon general|public health|gavi|thimerosal|hepatitis b|world health organization|moderna|flu shots?|food dyes?|ultra-?processed|raw milk|medical research|research grants?)\M$p$;
  rf_def    CONSTANT TEXT := $d$This front is the record of what Robert F. Kennedy Jr. and the people running the federal health agencies under him (HHS, CDC, FDA, NIH, CMS, the surgeon general's office) do to the country's protection against disease, and what follows from it. A story belongs when one of them fires or replaces scientists and advisers, changes vaccine rules or recommendations, cuts staff, research or global health money, promotes unproven health claims as policy, or rewrites what the agencies tell the public; when a court, Congress or a whistleblower acts on those decisions; or when the measured damage is reported (measles cases and deaths, lost elimination status, vaccination rates), with a US agency decision in view.

**Decline:** the Kennedy Center and every other Kennedy; Sen. John Kennedy; state and local health decisions where HHS is not the actor (a state fluoride ban, a state surgeon general, school vaccine exemptions); food recalls and routine FDA safety notices; drug-price deals announced by the White House; Medicaid and ACA funding fights in Congress; the Fauci investigations; foreign outbreaks with no US angle.

**Pending Josh (do not decide):** whether the abortion pill (mifepristone) belongs on this front at all. Until he decides, decline every mifepristone or abortion-pill story with `uncertain: true` and a rationale that starts with `borderline rfk-hhs: abortion pill pending`.

**Tie-breaks:** Trump Corruption (priority 15) takes money for official action (a donation that preceded an FDA decision). ICE & Deportations (72) takes health conditions inside detention. Hegseth's Pentagon (90) loses to this front on sweep words, but a military vaccine rule ordered by the Pentagon is Hegseth's. Ebola travel bans are immigration actions (ICE & Deportations), not this front, unless the CDC is the actor.

### Calibration examples

| Headline | Decision | Why |
|---|---|---|
| Trump order endorses plan to reduce vaccines recommended for children | **assign** | The schedule cut, a federal action |
| Top Drug Regulator Is Fired From the F.D.A. | **assign** | FDA leadership purge |
| US health officials exclude measles-related deaths in Pennsylvania from counts | **assign** | Agency rewriting the public record on measles |
| A $5 Million Donation From Big Tobacco Preceded F.D.A. Vape Decision | **trump-corruption**, not this front | Money before an official decision |
| Trump does not rule out demolishing the Kennedy Center | **decline** | Not this Kennedy |
| How Louisiana's New Surgeon General Wants to Transform Public Health | **decline** | State official, no HHS action |$d$;

  -- Hegseth's Pentagon: sweep adds the "illegal orders" video, service secretaries, transgender
  -- troops, the top general, court-martial, and boat strikes not called "boat strikes"; co-word
  -- unchanged; agent extras keep today's and add DOD, Quantico, press credentials and SOUTHCOM.
  he_old    CONSTANT TEXT := $p$\m(hegseth|pentagon|department of war|war department|secretary of war|war secretary|joint chiefs|boat strikes?|drug boats?|signalgate)\M$p$;
  he_ag_old CONSTANT TEXT := he_old || $p$|\m(defense secretary|secretary of defense|defense department|admirals?|generals and admirals|four-star|three-star|top brass|military (leaders?|leadership|officers?|lawyers?|brass|commanders?|chaplains?|academies|academy)|judge advocates?|jag|illegal orders|signal chat|service members?|warrior ethos)\M$p$;
  he_sweep  CONSTANT TEXT := $p$\m(hegseth|pentagon|department of war|war department|secretary of war|war secretary|joint chiefs|boat strikes?|drug boats?|signalgate|illegal orders|(military|illegal) orders video|seditious six|(army|navy|air force) secretary|secretary of the (army|navy|air force)|transgender (troops|service ?members|soldiers|military ban)|trans troops|general caine|gen\. caine|dan caine|top (u\.s\. )?general|court[- ]martial\w*)\M|^(?=.*\m(strikes?|struck|attacks?|hits?|kill(s|ed|ing)?|sinks?|sank|survivors?)\M)(?=.*\m(u\.s|us|american|military|navy|pentagon|hegseth|trump|southcom)\M).*\m(boats?|(drug|alleged drug|drug-smuggling|drug-trafficking) vessels?)\M$p$;
  he_agent  CONSTANT TEXT := he_sweep || $p$|\m(defense secretary|secretary of defense|defense department|admirals?|generals and admirals|four-star|three-star|top brass|military (leaders?|leadership|officers?|lawyers?|brass|commanders?|chaplains?|academies|academy)|judge advocates?|jag|signal chat|service members?|warrior ethos|dod|quantico|press credentials|press corps|southern spear|southcom|narco-?terrorists?)\M$p$;
  he_def    CONSTANT TEXT := $d$This front is the record of what Hegseth and the Pentagon's political leadership do to and with the military, and the fights over it. A story belongs when they fire, push out, demote or punish officers, officials or critics; order or defend the boat strikes; restrict the press; reshape the force by order (transgender troops, flag officer cuts, the rename to the Department of War, the culture rules); or when Congress, a court or an inspector general acts on any of that. A boat-strike report with a death count belongs even when it names no official.

**Decline:** ordinary foreign and defense policy (NATO, Ukraine, China, Taiwan, troop moves to Europe or the Middle East, the Pentagon budget, weapons programs); military accidents and deaths in service; Venezuela and the Maduro raid unless Hegseth or the Pentagon's leadership is the actor; National Guard and troop deployments to US cities (Josh, October 2, 2026); veterans' affairs.

**Pending Josh (do not decide):** the Pentagon's dispute with Anthropic. Josh has not decided whether it belongs on this front, and Claude, which Anthropic makes, takes no view on it. Until he decides, decline every Anthropic story, whatever front it might fit, with `uncertain: true` and a rationale that starts with `borderline hegseth-pentagon: D4 pending`.

**Tie-breaks:** every other front beats this one on keywords (priority 90). Iran (80) keeps the war's conduct, cost, casualties and strategy, including Hegseth's own Iran statements; this front keeps a purge, a press or a critic story even when it happens during the Iran war. Election Suppression (50) keeps troops at the polls. The Courts (70) keeps open defiance of a court order; an ordinary ruling against the Pentagon stays here. RFK Jr.'s HHS (85) keeps civilian health rules; a Pentagon vaccine order is this front's.

### Calibration examples

| Headline | Decision | Why |
|---|---|---|
| US military strikes another boat in Pacific, bringing death toll above 200 | **assign** | Boat strikes |
| Trump nominates loyalist Hung Cao to be permanent navy secretary | **assign** | Leadership remade around loyalty |
| Lawmakers Say They Will Not Cooperate With Inquiry Into Illegal Orders Video | **assign** | Going after critics |
| Pentagon Puts Iran War Cost at $25 Billion as Hegseth Berates Skeptics | **iran**, not this front | War cost and conduct |
| Trump Orders 5,000 US Troops to Poland, Citing Bond With Karol Nawrocki | **decline** | Ordinary defense policy |
| Military Police Troops Put on Alert for Possible Deployment to Minnesota | **decline** | Domestic deployment, out by Josh's rule |$d$;

  r       RECORD;
  e       public.events%ROWTYPE;
  b_agent TEXT;
  v_bad   TEXT;
  v_lost  TEXT;
  v_def   TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'agent_definition') THEN
    RAISE EXCEPTION 'events.agent_definition is missing: apply migration 127 first; nothing changed';
  END IF;

  -- not during a fronts run: the agent reads judged_fronts when it writes each decline (plan.md)
  IF EXISTS (SELECT 1 FROM public.pipeline_skips
              WHERE pipeline = 'front_assignment' AND reason = 'agent_declined'
                AND created_at > NOW() - INTERVAL '15 minutes')
     OR EXISTS (SELECT 1 FROM public.story_event
                 WHERE assigned_by = 'agent' AND note LIKE 'fronts-v%'
                   AND assigned_at > NOW() - INTERVAL '15 minutes') THEN
    RAISE EXCEPTION 'the fronts agent wrote a decision in the last 15 minutes (a run may be in progress); wait 15 minutes; nothing changed';
  END IF;

  -- every front exists and is published
  v_bad := (SELECT string_agg(s, ', ') FROM unnest(ARRAY['trump-corruption', 'election-suppression',
              'epstein-files', 'the-courts', 'ice-deportations', 'israel-gaza', 'iran', 'rfk-hhs',
              'hegseth-pentagon']) s
             WHERE NOT EXISTS (SELECT 1 FROM public.events x WHERE x.slug = s AND x.publish_state = 'published'));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'front(s) missing or not published: %; nothing changed', v_bad;
  END IF;

  -- one row per front: set_* false = leave that column as it is; old_* = the value the file expects
  -- to replace (the migration 115 / ADO-595 / ADO-608 / Hegseth file values, the same on TEST on
  -- October 4, 2026; NULL agent_pattern is always accepted)
  FOR r IN
    SELECT * FROM (VALUES
      ('trump-corruption',     false, NULL::text, NULL::text, false, NULL::text, NULL::text, false, NULL::text, NULL::text, tc_def),
      ('election-suppression', true,  el_old,     el_sweep,   true,  el_cw_old,  el_cw,      false, NULL,       NULL,       NULL),
      ('epstein-files',        true,  'epstein',  ep_sweep,   false, NULL,       NULL,       true,  NULL,       ep_agent,   ep_def),
      ('the-courts',           true,  co_old,     co_sweep,   true,  co_cw_old,  NULL,       true,  NULL,       co_agent,   co_def),
      ('ice-deportations',     true,  ic_old,     ic_sweep,   false, NULL,       NULL,       true,  ic_old || ic_extras, ic_sweep || ic_extras, ic_def),
      ('israel-gaza',          true,  is_old,     is_sweep,   true,  is_cw_old,  is_cw,      true,  is_ag_old,  is_agent,   is_def),
      ('iran',                 true,  ir_old,     ir_sweep,   false, NULL,       NULL,       true,  NULL,       ir_agent,   ir_def),
      ('rfk-hhs',              true,  rf_old,     rf_sweep,   false, NULL,       NULL,       true,  rf_ag_old,  rf_agent,   rf_def),
      ('hegseth-pentagon',     true,  he_old,     he_sweep,   false, NULL,       NULL,       true,  he_ag_old,  he_agent,   he_def)
    ) v(slug, set_sweep, old_sweep, new_sweep, set_coword, old_coword, new_coword,
        set_agent, old_agent, new_agent, def)
  LOOP
    SELECT * INTO e FROM public.events WHERE slug = r.slug;

    -- never overwrite a hand edit: each value must be the expected old one or already the new one
    IF r.set_sweep AND e.sweep_pattern IS DISTINCT FROM r.old_sweep AND e.sweep_pattern IS DISTINCT FROM r.new_sweep THEN
      RAISE EXCEPTION '%: sweep_pattern is not the value this file expects to replace (edited since?); nothing changed', r.slug;
    END IF;
    IF r.set_coword AND e.sweep_coword IS DISTINCT FROM r.old_coword AND e.sweep_coword IS DISTINCT FROM r.new_coword THEN
      RAISE EXCEPTION '%: sweep_coword is not the value this file expects to replace (edited since?); nothing changed', r.slug;
    END IF;
    IF r.set_agent AND e.agent_pattern IS NOT NULL
       AND e.agent_pattern IS DISTINCT FROM r.old_agent AND e.agent_pattern IS DISTINCT FROM r.new_agent THEN
      RAISE EXCEPTION '%: agent_pattern is not the value this file expects to replace (edited since?); nothing changed', r.slug;
    END IF;
    IF r.def IS NOT NULL AND NULLIF(btrim(e.agent_definition), '') IS NOT NULL AND e.agent_definition <> r.def THEN
      RAISE EXCEPTION '%: agent_definition already holds a different text (edited in admin?); nothing changed', r.slug;
    END IF;

    -- every new regex compiles (an invalid one raises here, before any write)
    PERFORM '' ~* r.new_sweep WHERE r.set_sweep;
    PERFORM '' ~* r.new_coword WHERE r.set_coword AND r.new_coword IS NOT NULL;
    PERFORM '' ~* r.new_agent WHERE r.set_agent;

    -- backup BEFORE writing (first run wins: a re-run keeps the original values)
    INSERT INTO public.front_merge_backup_events (merge_tag, event_id, slug, publish_state, published_at,
                sweep_pattern, sweep_coword, sweep_priority, sweep_summary, agent_pattern, agent_definition)
    VALUES (c_tag, e.id, e.slug, e.publish_state, e.published_at, e.sweep_pattern, e.sweep_coword,
            e.sweep_priority, e.sweep_summary, e.agent_pattern, e.agent_definition)
    ON CONFLICT (merge_tag, event_id) DO NOTHING;

    UPDATE public.events
       SET sweep_pattern    = CASE WHEN r.set_sweep  THEN r.new_sweep  ELSE sweep_pattern END,
           sweep_coword     = CASE WHEN r.set_coword THEN r.new_coword ELSE sweep_coword END,
           agent_pattern    = CASE WHEN r.set_agent  THEN r.new_agent  ELSE agent_pattern END,
           agent_definition = COALESCE(r.def, agent_definition),
           updated_at       = NOW()
     WHERE id = e.id
       AND ((r.set_sweep  AND sweep_pattern IS DISTINCT FROM r.new_sweep)
         OR (r.set_coword AND sweep_coword  IS DISTINCT FROM r.new_coword)
         OR (r.set_agent  AND agent_pattern IS DISTINCT FROM r.new_agent)
         OR (r.def IS NOT NULL AND agent_definition IS DISTINCT FROM r.def));

    -- member gate: no member is lost. Every member the old agent_pattern matched (every member,
    -- when there was none) must match the new one, on headline or summary.
    IF r.set_agent THEN
      b_agent := (SELECT agent_pattern FROM public.front_merge_backup_events
                   WHERE merge_tag = c_tag AND event_id = e.id);
      v_lost := (SELECT string_agg(x.id::text, ', ') FROM (
                   SELECT st.id
                     FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
                    WHERE se.event_id = e.id
                      AND (b_agent IS NULL
                           OR COALESCE(st.primary_headline, '') ~* b_agent
                           OR COALESCE(st.summary_neutral, '') ~* b_agent)
                      AND NOT (COALESCE(st.primary_headline, '') ~* r.new_agent
                               OR COALESCE(st.summary_neutral, '') ~* r.new_agent)
                    ORDER BY st.id LIMIT 20) x);
      IF v_lost IS NOT NULL THEN
        RAISE EXCEPTION '%: member stories outside the new agent_pattern (first 20): %; nothing changed', r.slug, v_lost;
      END IF;
    END IF;
  END LOOP;

  -- Election's definition: the migration 127 seed plus the review's additions, appended once
  v_def := (SELECT agent_definition FROM public.events WHERE slug = 'election-suppression');
  IF position(el_marker IN COALESCE(v_def, '')) = 0 THEN
    IF v_def IS NULL OR left(v_def, length(el_seed_start)) <> el_seed_start THEN
      RAISE EXCEPTION 'election-suppression: agent_definition is not the migration 127 seed (edited?); nothing changed';
    END IF;
    UPDATE public.events SET agent_definition = v_def || el_add, updated_at = NOW()
     WHERE slug = 'election-suppression';
  END IF;

  -- no two sweeping fronts share a priority (a tie is decided by event id)
  v_bad := (SELECT string_agg(p.sweep_priority || ': ' || p.slugs, '; ') FROM (
              SELECT sweep_priority, string_agg(slug, ', ' ORDER BY slug) AS slugs
                FROM public.events WHERE sweep_pattern IS NOT NULL
               GROUP BY sweep_priority HAVING COUNT(*) > 1) p);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'sweep priority shared by several fronts (%); nothing changed', v_bad;
  END IF;

  -- each agent_pattern starts with its sweep verbatim (Election excepted: its agent judges what the
  -- sweep leaves), so every swept story is inside the agent's view
  v_bad := (SELECT string_agg(slug, ', ') FROM public.events
             WHERE slug IN ('trump-corruption', 'epstein-files', 'the-courts', 'ice-deportations',
                            'israel-gaza', 'iran', 'rfk-hhs', 'hegseth-pentagon')
               AND left(agent_pattern, length(sweep_pattern)) IS DISTINCT FROM sweep_pattern);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'agent_pattern does not start with the sweep for: %; nothing changed', v_bad;
  END IF;

  -- all nine join the agent (published + agent_pattern + agent_definition)
  v_bad := (SELECT string_agg(s, ', ') FROM unnest(ARRAY['trump-corruption', 'election-suppression',
              'epstein-files', 'the-courts', 'ice-deportations', 'israel-gaza', 'iran', 'rfk-hhs',
              'hegseth-pentagon']) s
             WHERE NOT EXISTS (SELECT 1 FROM public.events x WHERE x.slug = s AND x.publish_state = 'published'
                                 AND x.agent_pattern IS NOT NULL AND NULLIF(btrim(x.agent_definition), '') IS NOT NULL));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'front(s) would not join the agent: %; nothing changed', v_bad;
  END IF;
END $do$;

-- (2c) SWEEP every active unassigned story with the new rules (full backfill; the pipeline's own runs
-- look back 48 hours). Same rules as assign_fronts_sweep(NULL) (migration 115): every front competes,
-- the lowest priority number wins, assigned stories never move. Rows carry a note so the rollback
-- finds exactly them.
WITH pool AS (
  SELECT st.id, st.primary_headline AS h, st.summary_neutral AS s
    FROM public.stories st
   WHERE st.status = 'active'
     AND st.primary_headline IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.story_event se WHERE se.story_id = st.id)
), rules AS (
  SELECT e.id AS event_id, e.slug, e.sweep_pattern, e.sweep_coword, e.sweep_priority, e.sweep_summary
    FROM public.events e
   WHERE e.sweep_pattern IS NOT NULL
), pick AS (
  SELECT p.id AS story_id, r.event_id, r.sweep_priority
    FROM pool p
    JOIN rules r
      ON (r.sweep_coword IS NULL OR p.h ~* r.sweep_coword)
     AND (p.h ~* r.sweep_pattern
          OR (r.sweep_summary AND r.sweep_coword IS NOT NULL AND p.s IS NOT NULL AND p.s ~* r.sweep_pattern))
), best AS (
  SELECT DISTINCT ON (pk.story_id) pk.story_id, pk.event_id
    FROM pick pk
   ORDER BY pk.story_id, pk.sweep_priority, pk.event_id
), ins AS (
  INSERT INTO public.story_event (story_id, event_id, assigned_by, confidence, note)
  SELECT b.story_id, b.event_id, 'agent', 0.8, 'ado-592-defs: keyword sweep' FROM best b
  ON CONFLICT (story_id) DO NOTHING
  RETURNING story_id, event_id
)
SELECT e.slug, COUNT(*) AS assigned
  FROM ins JOIN public.events e ON e.id = ins.event_id
 GROUP BY e.slug ORDER BY e.slug;

-- (2d) REFRESH the main line (convention after any front or assignment change).
SELECT * FROM public.refresh_tracker_derived();

COMMIT;

-- (3) RESULT (read-only). Expect 9 rows, in_agent true on every row. filed_now (PROD, from the
-- reviews' headline simulations): election ~39, epstein ~15, the-courts ~33, ice ~6, israel ~28,
-- iran ~79, rfk ~46, hegseth ~29 (overlaps can shift a few). members_outside_pattern 0 for the
-- fronts this file changed; trump-corruption may show about 10 envoy-diplomacy members (open
-- question for Josh, not a failure). agent_pool is the all-fronts agent's pool, before declines run.
WITH pool AS (SELECT COALESCE(MAX(c.pool_size), 0) AS n FROM public.front_agent_candidates_all(1) c)
SELECT e.slug,
       (e.publish_state = 'published' AND e.agent_pattern IS NOT NULL
        AND NULLIF(btrim(e.agent_definition), '') IS NOT NULL)                      AS in_agent,
       e.sweep_priority,
       (SELECT COUNT(*) FROM public.story_event se WHERE se.event_id = e.id)         AS members,
       (SELECT COUNT(*) FROM public.story_event se
         WHERE se.event_id = e.id AND se.note = 'ado-592-defs: keyword sweep')      AS filed_now,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id
           AND NOT (COALESCE(st.primary_headline, '') ~* e.agent_pattern
                    OR COALESCE(st.summary_neutral, '') ~* e.agent_pattern))        AS members_outside_pattern,
       (SELECT COUNT(*) FROM public.story_event se JOIN public.stories st ON st.id = se.story_id
         WHERE se.event_id = e.id AND st.main_line)                                  AS on_main_line,
       pool.n                                                                        AS agent_pool
  FROM public.events e CROSS JOIN pool
 WHERE e.slug IN ('trump-corruption', 'election-suppression', 'epstein-files', 'the-courts',
                  'ice-deportations', 'israel-gaza', 'iran', 'rfk-hhs', 'hegseth-pentagon')
 ORDER BY e.sweep_priority, e.id;

-- ROLLBACK (restores the values from before the first apply, unfiles this file's sweep). Agent
-- assignments made since stay (plan.md, "All fronts (ADO-592)", Rollback); so do stories the
-- pipeline filed with the new rules after the apply. Paste as one block:
-- BEGIN;
-- DELETE FROM public.story_event WHERE note = 'ado-592-defs: keyword sweep';
-- UPDATE public.events e
--    SET sweep_pattern = b.sweep_pattern, sweep_coword = b.sweep_coword,
--        agent_pattern = b.agent_pattern, agent_definition = b.agent_definition, updated_at = NOW()
--   FROM public.front_merge_backup_events b
--  WHERE b.merge_tag = 'ado-592-defs' AND b.event_id = e.id;
-- DELETE FROM public.front_merge_backup_events WHERE merge_tag = 'ado-592-defs';
-- SELECT * FROM public.refresh_tracker_derived();
-- COMMIT;
