// Runs the ADO-592 definitions file end to end on PGlite (Postgres 17) against a minimal copy of the
// tracker schema plus migrations 116, 123 and 127, with all nine published fronts (and the four
// retired ones) holding their real TEST values (read October 4, 2026):
//   scripts/maintenance/2026-10-04-ado-592-front-definitions.sql
// Checks: every stored regex round-trips against the front review it came from; the old values the
// file replaces are the migration 115 / ADO-595 / ADO-608 / Hegseth / ADO-610 literals (so PROD,
// built from those files, passes the guards); headline placement after the sweep; no member lost;
// all nine fronts join the agent; idempotent re-run; the footer rollback; all-or-nothing on a forced
// invariant failure and on every guard.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/front-definitions-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('front-definitions-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const read = (f) => fs.readFileSync(path.join(repo, f), 'utf8').replace(/\r\n/g, '\n');
const M116 = read('migrations/116_front_agent_candidates.sql');
const M123 = read('migrations/123_story_action_labels.sql');
const M127 = read('migrations/127_all_fronts_agent.sql');
const DEFS = read('scripts/maintenance/2026-10-04-ado-592-front-definitions.sql');
const review = (slug) => read(`docs/features/fronts-claude-agent/front-reviews/${slug}.md`);

// TEST events, October 4, 2026 (PostgREST read of slug, publish_state, sweep_*, agent_pattern), as
// returned (JSON-escaped), for the nine published fronts. The retired fronts carry no rules.
const TEST_EVENTS = JSON.parse(String.raw`[
{"id":19,"slug":"trump-corruption","sweep_priority":15,"sweep_summary":false,"sweep_pattern":"^(?=.*(crypto|memecoin|meme coin|\\$TRUMP|world liberty|stablecoin|bitcoin|binance)).*(trump|kushner|witkoff|white house|president)|qatar.*(jet|747|air force one|plane|boeing)|(jet|747|air force one|plane|boeing).*qatar|ballroom|^(?=.*\\m(kushner\\w*|witkoff\\w*|affinity partners)\\M)(?!.*\\m(world liberty|wlfi|usd1|crypto\\w*|memecoins?|meme coins?|stablecoins?|bitcoin|binance|charles kushner|josh kushner|tony kushner|thrive capital)\\M)(?=.*\\m(affinity|business (deal|deals|dealings|interests|ties|empire)|dealings|money|windfalls?|payday|payments?|fundrais\\w*|investors?|investment (firm|fund|company)|private equity|profit\\w*|conflicts? of interest|ethics?|hotels?|resorts?|real estate|financial (empire|interests?|ties|disclosures?|stakes?|dealings)|disclos\\w*|empire|probes?|investigat\\w*|(saudi|qatari|emirati|abu dhabi|uae|gulf|foreign|sovereign) (money|fund|funds|investors?|investment|cash|royals?|backers?|wealth)|pif|public investment fund|electronic arts|paramount|warner|sazan|albania\\w*|serbia\\w*|belgrade)\\M)|reflecting pool|east potomac|\\moil deals?\\M|harold hamm|\\m(trump\\w*|white house)\\M.*\\m(stock trad\\w*|insider trad\\w*|market manipulat\\w*)|\\m(stock trad\\w*|insider trad\\w*|market manipulat\\w*).*\\m(trump\\w*|white house)\\M|trump media\\M(?! (ban|ecosystem|coverage|outlets?|personalit))|truth social (stock|shares|priority)|\\mdjt\\M|trump organi[sz]ation|\\mtrump org\\M|\\m(emoluments?|self[- ]dealing|kleptocra\\w*|no[- ]bid|foreign corrupt practices|fcpa)\\M|\\mgreco\\M|^(?=.*\\m(trump\\w*|fbi|doj|justice department|white house|federal)\\M).*anti[- ]corruption (squads?|units?|monitor\\w*|bod(y|ies)|watchdogs?|offices?|sections?|divisions?|enforcement|probes?)|gold card|\\mtrump\\w*\\M.*presidential library|presidential library.*\\mtrump|trump library|liv golf|^(?=.*\\m(eric trump|trump jr|don jr|donald trump jr|ivanka|trump sons|trump family|trump children)\\M).*\\m(business\\w*|firms?|company|companies|deals?|invest\\w*|stakes?|ventures?|startups?|backed|profit\\w*|resorts?|develop\\w*|loans?|contracts?|fund\\w*|money|bankroll\\w*|paid|portfolio|brand|licens\\w*|towers?|golf|hotels?|rich|wealth\\w*|windfalls?)\\M|\\m(donors?|megadonors?|fundraisers?|cronies|crony)\\M.*\\m(contracts?|pardon\\w*|loans?)\\M|\\m(contracts?|pardon\\w*)\\M.*\\m(donors?|megadonors?|fundraisers?|cronies|crony)\\M|\\m(trump\\w*|jan(uary)?\\.? 6)\\M.*compensation fund|compensation fund.*\\mtrump","sweep_coword":null,"agent_extras":"|\\m(corrupt\\w*|donors?|megadonors?|oligarchs?|bribe\\w*|kickbacks?|conflicts? of interest|self[- ]enrich\\w*|pay[- ]to[- ]play|grift\\w*|cronies|crony|cronyism|payouts?|watchdogs?|inspectors? general|qatar\\w*|crypto\\w*|stablecoins?|memecoins?|golf|resorts?|licensing|gifts?|rose garden|arch|jared|special envoys?|board of peace|sazan|phoenix financial|public investment fund|pif|sovereign wealth|electronic arts|tahnoon|aryam|mgx|g42|saudi\\w*|emirat\\w*|abu dhabi|gulf (money|states|investors?|investment|royals?))\\M"},
{"id":14,"slug":"election-suppression","sweep_priority":50,"sweep_summary":true,"sweep_pattern":"(voter roll|voter purge|purg(e|es|ed|ing) (of )?(the )?voter|voter registration|voter suppression|voter intimidation|voter (data|database|file)|mail-in|mail ballot|mail(ed)? ballots|vote[- ]by[- ]mail|absentee ballot|ballot (drop ?box|harvest|access)|early voting|hand[- ]count|election fraud|voter fraud|rigged.{0,20}(election|vote|ballot|midterm)|(election|vote|ballot|midterm).{0,20}rigged|stolen election|SAVE Act|seiz(e|es|ed|ing|ure) (of )?(the |voting |election )?(election|machines|equipment|records|ballots|files)|take over (the )?election|nationaliz\\w* (the )?election|federaliz\\w* (the )?election|election integrity|decertif|certif(y|ies|ied|ying|ication) (of )?(the )?(election|results|vote)|refus\\w* to certify|voting rights act|proof of citizenship|citizenship (proof|check|list|verification|question)|noncitizen|non-citizen|voter id|voting machine|election (takeover|police|task force|official|officials|files|records|data|equipment)|(cancel|postpone|suspend|delay)(ing|ed|s)? (the )?(midterm|election)|polling (place|site|location|station)|poll (worker|watcher|closure|closing)|polling[- ]place|usps|postal service)","sweep_coword":"(election|vote|voter|voting|ballot|midterm|poll|precinct|electoral)","agent_pattern":"\\m(voters?|voting|ballots?|precincts?|redistrict\\w*|gerrymander\\w*|congressional maps?|district maps?|polling (place|places|location|locations|hours|site|sites)|certif(y|ies|ied|ying|ication))\\M"},
{"id":7,"slug":"epstein-files","sweep_priority":60,"sweep_summary":false,"sweep_pattern":"epstein","sweep_coword":null,"agent_pattern":null},
{"id":12,"slug":"the-courts","sweep_priority":70,"sweep_summary":false,"sweep_pattern":"(def(y|ies|ied|iance)|contempt|ignor(e|es|ed|ing) (the )?(court|ruling|order)|constitutional crisis|impeach(ing)? (a |the )?judge|existential threat|attack(s|ed|ing)? (on )?(the )?(judge|judiciary|courts))","sweep_coword":"(judge|court|judiciary|judicial)","agent_pattern":null},
{"id":18,"slug":"ice-deportations","sweep_priority":72,"sweep_summary":false,"sweep_pattern":"\\m(ice|deport\\w*|immigra\\w*|migrants?|asylum|refugee admissions|detention (camps?|centers?|centres?|facilit\\w*|beds?|polic\\w*|sites?)|mass detention|mandatory detention|detainees?|third[- ]countr\\w*|border patrol|bovino|cbp|customs and border protection|border czar|homan|alligator alcatraz|cornhusker clink|speedway slammer|cecot|alien enemies act|sanctuary (cities|city|states?|jurisdictions?|polic\\w*)|masked (agents?|officers?|men)|(workplace|worksite|farm|factory) raids?)\\M","sweep_coword":"^(?!.*\\m(ice (storms?|cream|caps?|sheets?|age|hockey|rinks?|skat\\w*|shelf|shelves|melt\\w*|dance|bath|plunge|cube)|sea ice|thin ice|on ice|hockey|glaciers?|vanilla ice)\\M)|\\m(deport\\w*|immigra\\w*|migrants?|asylum|detention|detain\\w*|detainees?|homan|noem|dhs|cbp|border patrol|ice (raids?|agents?|officers?|arrests?|detention|detainees?|custody|facilit\\w*|jails?|crackdown))\\M","agent_pattern":"\\m(ice|deport\\w*|immigra\\w*|migrants?|asylum|refugee admissions|detention (camps?|centers?|centres?|facilit\\w*|beds?|polic\\w*|sites?)|mass detention|mandatory detention|detainees?|third[- ]countr\\w*|border patrol|bovino|cbp|customs and border protection|border czar|homan|alligator alcatraz|cornhusker clink|speedway slammer|cecot|alien enemies act|sanctuary (cities|city|states?|jurisdictions?|polic\\w*)|masked (agents?|officers?|men)|(workplace|worksite|farm|factory) raids?)\\M|\\m(dhs|homeland security|noem|border|citizenship|visas?|tps|temporary protected status|daca|dreamers?|birthright|travel ban|green cards?|naturaliz\\w*|denaturaliz\\w*)\\M"},
{"id":16,"slug":"israel-gaza","sweep_priority":75,"sweep_summary":false,"sweep_pattern":"\\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\\w*)\\M","sweep_coword":"^(?!.*\\m(pro-palestinian|pro-hamas)\\M)((?!.*\\miran(ian)?\\M)|.*\\m(israel\\w*|netanyahu)\\M.{0,60}\\m(urg(es|ed|ing)|press(es|ed|ing)|pressur(es|ed|ing)|lobb(ies|ied|ying)|push(es|ed|ing)|convinc(es|ed|ing)|persuad(es|ed|ing)|goad(s|ed|ing)|lur(es|ed|ing)|drag(s|ged|ging))\\M(?!\\s+(back|by)\\M).{0,60}\\m(us|u\\.s|america\\w*|trump|washington|white house|congress)\\M|.*\\m(trump|washington|white house|congress)\\M.{0,40}\\m(pressured|pushed|lobbied|urged|persuaded|convinced|dragged|goaded|lured)\\s+by\\s+(the\\s+)?(israel\\w*|netanyahu)\\M)","agent_pattern":"\\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\\w*)\\M|\\m(fara|foreign agents? registration|havas|clock tower x|bridges partners|esther project|stoic|diaspora ministry|ministry of diaspora|democratic majority for israel|dmfi|adelson|gaza humanitarian foundation|ghf|international stabilization force|international criminal court|icc|albanese|icj|international court of justice|famine|genocide|epic fury|midnight hammer|war powers)\\M"},
{"id":8,"slug":"iran","sweep_priority":80,"sweep_summary":false,"sweep_pattern":"\\miran(ian)?\\M","sweep_coword":"^(?!.*iranian revolution)","agent_pattern":null},
{"id":17,"slug":"rfk-hhs","sweep_priority":85,"sweep_summary":false,"sweep_pattern":"\\m(rfk|robert f\\. kennedy|kennedy jr|secretary kennedy|maha|make america healthy again|acip|vaccine (advisers|advisors|advisory|panel|committee|schedule)|childhood vaccines?|monarez|tylenol|acetaminophen|leucovorin|health secretary|hhs|health and human services|cdc|c\\.d\\.c)\\M","sweep_coword":"^(?!.*\\m(kennedy center|kennedy honors|performing arts|schlossberg|rfk stadium|john kennedy|sen\\. kennedy|senator kennedy|anthony kennedy|kennedy space|jfk|ted kennedy|caroline kennedy|kerry kennedy|joe kennedy|assassination|becerra|former health secretary|ex-us health secretary)\\M)","agent_pattern":"\\m(rfk|robert f\\. kennedy|kennedy jr|secretary kennedy|maha|make america healthy again|acip|vaccine (advisers|advisors|advisory|panel|committee|schedule)|childhood vaccines?|monarez|tylenol|acetaminophen|leucovorin|health secretary|hhs|health and human services|cdc|c\\.d\\.c)\\M|\\m(kennedy|vaccines?|vaccinations?|measles|autism|fluoride|mrna|fda|nih|makary|prasad|bhattacharya|surgeon general|public health|gavi|thimerosal|hepatitis b)\\M"},
{"id":15,"slug":"hegseth-pentagon","sweep_priority":90,"sweep_summary":false,"sweep_pattern":"\\m(hegseth|pentagon|department of war|war department|secretary of war|war secretary|joint chiefs|boat strikes?|drug boats?|signalgate)\\M","sweep_coword":"^(?!.*\\m(russia|moscow|ukraine|nato|china|taiwan)\\M)","agent_pattern":"\\m(hegseth|pentagon|department of war|war department|secretary of war|war secretary|joint chiefs|boat strikes?|drug boats?|signalgate)\\M|\\m(defense secretary|secretary of defense|defense department|admirals?|generals and admirals|four-star|three-star|top brass|military (leaders?|leadership|officers?|lawyers?|brass|commanders?|chaplains?|academies|academy)|judge advocates?|jag|illegal orders|signal chat|service members?|warrior ethos)\\M"}
]`);
// trump-corruption's agent_pattern is its sweep plus extras (stored split above to keep it readable)
for (const ev of TEST_EVENTS) if (ev.agent_extras) { ev.agent_pattern = ev.sweep_pattern + ev.agent_extras; delete ev.agent_extras; }
const NINE = TEST_EVENTS.map((ev) => ev.slug);
const T = Object.fromEntries(TEST_EVENTS.map((ev) => [ev.slug, ev]));

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(id bigint primary key, slug text unique, name text, publish_state text,
  published_at timestamptz, sweep_pattern text, sweep_coword text, sweep_priority smallint not null default 100,
  sweep_summary boolean not null default false, updated_at timestamptz);
create table public.stories(
  id bigint primary key, status text default 'active', primary_headline text, summary_neutral text default 'summary',
  first_seen_at timestamptz default now(), last_updated_at timestamptz,
  alarm_level smallint default 4, severity text, category text, main_line boolean not null default false);
create table public.story_event(story_id bigint primary key references public.stories(id),
  event_id bigint references public.events(id) on delete cascade, event_update_id bigint, assigned_by text,
  confidence numeric, assigned_at timestamptz default now(), reassigned_at timestamptz,
  reassigned_from_event_id bigint);
create table public.tracker_pin(source text, entity_id text, pin text, primary key(source, entity_id));
create table public.pipeline_skips(id bigserial primary key, pipeline text, reason text, entity_type text,
  entity_id text, metadata jsonb, created_at timestamptz not null default now());
-- stand-in for the real refresh: a front member at alarm 4+ is on the main line
create function public.refresh_tracker_derived() returns table(rows_changed int) language plpgsql as $$
declare n int;
begin
  update public.stories s set main_line = (s.alarm_level >= 4 and exists (select 1 from public.story_event se where se.story_id = s.id))
   where s.main_line is distinct from (s.alarm_level >= 4 and exists (select 1 from public.story_event se where se.story_id = s.id));
  get diagnostics n = row_count;
  return query select n;
end $$;
`;

// Unassigned headlines (real PROD headlines from the reviews unless marked): [id, headline, want]
const CASES = [
  // epstein-files
  [101, 'Senate unanimously passes resolution opposing pardon for Ghislaine Maxwell', 'epstein-files'],
  [102, 'Democrats Seek Maxwell Prison Visit, Citing Preferential Treatment', 'epstein-files'],
  [103, 'Hillary Clinton deposition paused over leaked photo', 'epstein-files'],
  [104, 'WATCH LIVE: House Oversight panel meets to review resolutions holding Clintons in contempt', 'epstein-files'],
  [105, 'Donald Trump Reacts to Former Prince Andrew Arrest', '-'],               // Andrew is not swept (open question)
  [106, 'Paxton sues Maxwell House over coffee labels', '-'],                     // invented: bare maxwell stays out
  // iran
  [111, 'Ships go dark as the clock runs out on Trump\'s \'undeclared naval war\' in the Strait of Hormuz', 'iran'],
  [112, 'Trump Hails Khamenei Death, Urges Iranians to \'Take Back\' Nation', 'iran'],
  [113, 'Congress is absent as Trump threatens Iranians \'will die\'', 'iran'],
  [114, 'In Choosing \'Epic Fury,\' Trump Names a War and Defines His Presidency', 'iran'],
  [115, 'Republicans confront the massive cost of Trump\'s Middle East war', 'iran'],
  // Code review: Israel's co-word guard must cover Iran's widened terms, or priority 75 steals these
  [9190, 'Israel strikes Tehran, killing IRGC commanders', 'iran'],
  [9191, 'Israeli strikes kill hundreds of Iranians as Trump weighs joining', 'iran'],
  [116, 'U.S. national security offices, weakened by firings, confront Mideast war', 'iran'],
  [117, 'Americans have little appetite for sending U.S. troops to Iran, polls show', 'iran'],  // not Election's troops branch
  [118, 'Republicans Again Block War Powers Measure in the Senate', '-'],         // agent only
  // the-courts
  [121, 'Judges Grow Angry Over Trump Administration Violating Their Orders', 'the-courts'],
  [122, 'Trump flouts lower court rulings in unprecedented display of executive power', 'the-courts'],
  [123, 'Republican-Appointed Judge Says Trump Has Created \'Judicial Emergency\'', 'the-courts'],
  [124, 'Federal judges describe violent threats amid \'dehumanizing attacks\' from political leaders', 'the-courts'],
  [125, 'Trump Calls Justices Who Ruled Against Him \'Fools and Lap Dogs\'', 'the-courts'],
  [126, 'White House fires U.S. attorney in N.Y. hours after judges appointed him', 'the-courts'],
  [127, 'US attorneys handpicked by Pam Bondi were appointed illegally, judge rules', 'the-courts'],
  [128, 'Judge Refers Justice Dept. Lawyer for Possible Discipline, Calling Out \'Lack of Candor\'', 'the-courts'],
  [129, 'Court rebukes Trump administration for denying immigration detainees access to lawyers', 'ice-deportations'],
  [130, 'Federal judge blocks Trump order to end funding for NPR and PBS', '-'],  // agent only (not swept on purpose)
  [131, 'Trump threats cause dilemma for US officers: disobey orders or commit war crimes', '-'],
  // election-suppression
  [141, 'Federal judge halts Trump\'s election executive order seeking to create a federal voter list', 'election-suppression'],
  [142, 'Federal Judge Strikes Key Parts of Trump Order Restricting Mail Voting', 'election-suppression'],
  [143, 'FBI searched Fulton County offices in probe of possible 2020 election \'defects,\' affidavit says', 'election-suppression'],
  [144, 'Democrats Condemn FBI Election Office Raid: \'A Seismic Event\'', 'election-suppression'],
  [145, 'Alarm as Trump DoJ pushes for voter information on millions of Americans', 'election-suppression'],
  [146, 'Trump tells Thune to keep Senate in session to pass SAVE America Act', 'election-suppression'],
  [147, 'DOD tells senator it has \'no plan\' for troops at polls', 'election-suppression'],
  [148, 'Trump doesn\'t rule out declaring state of emergency before midterm elections', 'election-suppression'],
  [149, 'Hundreds of Wisconsin election offices not using cybersecurity best practices', '-'],
  // israel-gaza
  [151, 'US sanctions international criminal court president and prosecutor', 'israel-gaza'],
  [152, 'ICC Judges Sue Trump Administration Over Sanctions', 'israel-gaza'],
  [153, 'Trump Seeks $1B From Nations for Board of Peace Permanent Membership', 'israel-gaza'],
  [154, 'Trump Pledges $10m to Continued Recovery From East Palestine Train Disaster', '-'],
  [155, 'Duterte\'s ICC trial opens in The Hague', '-'],                          // invented: no US actor
  [156, 'Israel forced the US into the Iran war, officials say', 'israel-gaza'],   // invented: new push verb
  [157, 'Israel forced to delay strikes on Iran', 'iran'],                         // invented: "forced to" is not a push
  // rfk-hhs
  [161, 'Judge Strikes Down Kennedy\'s Vaccine Policies', 'rfk-hhs'],
  [162, 'Kennedy Makes Unfounded Claim That Keto Diet Can \'Cure\' Schizophrenia', 'rfk-hhs'],
  [163, 'A Peptide Showdown: F.D.A. Scientists May Clash With R.F.K.\'s Agenda', 'rfk-hhs'],
  [164, 'Trump administration\'s embattled FDA vaccine chief ousted for the second time', 'rfk-hhs'],
  [165, 'US health officials exclude measles-related deaths in Pennsylvania from counts', 'rfk-hhs'],
  [166, 'Trump order endorses plan to reduce vaccines recommended for children', 'rfk-hhs'],
  [167, 'Measles cases surge in Ontario', '-'],                                    // invented
  [168, 'Trump does not rule out demolishing the Kennedy Center', '-'],
  // hegseth-pentagon
  [171, 'US military strikes another boat in Pacific, bringing death toll above 200', 'hegseth-pentagon'],
  [172, 'Two Survivors Left at Sea After U.S. Attacks Boat in Pacific', 'hegseth-pentagon'],
  [173, 'Lawmakers Say They Will Not Cooperate With Inquiry Into Illegal Orders Video', 'hegseth-pentagon'],
  [174, 'Trump nominates loyalist Hung Cao to be permanent navy secretary', 'hegseth-pentagon'],
  [175, 'Air Force Major Recommended for General Court-Martial After Protesting Trump', 'hegseth-pentagon'],
  [176, 'Hegseth warns Russia over Ukraine', '-'],                                  // invented: co-word
  [177, 'Ferry hits fishing boat off Maine coast', '-'],                            // invented: no US actor
  // ice-deportations
  [181, 'Trump administration pursues Kilmar Ábrego García on previously dismissed charges', 'ice-deportations'],
  [182, 'Abrego Garcia lawyers ask judge to toss smuggling case', 'ice-deportations'],  // invented
  [183, 'Ice storm closes roads across Texas', '-'],
  // trump-corruption (unchanged rules still win their overlaps)
  [191, 'Company led by Republican fundraiser pardoned by Trump wins $106m federal contract', 'trump-corruption'],
  [192, 'A $5 Million Donation From Big Tobacco Preceded F.D.A. Vape Decision', '-'],
];
// Current members: [id, headline, front, assigned_by, note]. 205 matches neither the old nor the new
// Hegseth agent_pattern (hand-seeded): not "lost". 206 is the East Palestine false member; 208 an
// envoy-diplomacy member outside the corruption pattern (open question, untouched).
const MEMBERS = [
  [201, 'Epstein files release delayed again', 'epstein-files', 'agent', null],
  [202, 'Iran fires missiles at US base', 'iran', 'agent', null],
  [203, 'Judge weighs contempt over defied deportation order', 'the-courts', 'agent', null],
  [204, 'County purges voter roll before midterm', 'election-suppression', 'agent', 'fronts-v1: county purge'],
  [205, 'Veterans Day parade draws crowds', 'hegseth-pentagon', 'human', null],
  [206, 'Trump Pledges $10m to Continued Recovery From East Palestine Train Disaster', 'israel-gaza', 'agent', null],
  [207, 'RFK Jr. fires vaccine advisers', 'rfk-hhs', 'agent', null],
  [208, 'Trump sending Vance, Witkoff and Kushner to Pakistan for ceasefire talks with Iran', 'trump-corruption', 'agent', null],
  [209, 'ICE raids meatpacking plant', 'ice-deportations', 'agent', null],
  [210, 'House G.O.P. Releases Budget to Unlock $95 Billion for Iran War and SAVE Act', 'iran', 'agent', null],
  [211, 'Hegseth asks Army\'s top uniformed officer to step down as U.S. wages war against Iran', 'iran', 'agent', null],
];

let failures = 0;
const check = (ok, label) => { if (!ok) failures += 1; out(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const count = async (db, q) => Number((await db.query(q)).rows[0].n);
async function run(db, sql) { try { await db.exec(sql); return null; } catch (e) { return e.message; } }
async function runbookRecover(db, label) {
  let stuck = false;
  try { await db.query('select 1'); } catch (e) { stuck = /current transaction is aborted/.test(e.message); }
  check(stuck, `${label}: session is left in the failed transaction (why the header says ROLLBACK first)`);
  await db.exec('ROLLBACK;');
  let ok = true;
  try { await db.query('select 1'); } catch { ok = false; }
  check(ok, `${label}: ROLLBACK; recovers the session`);
}

async function makeDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(M116);
  await db.exec(M123);
  const retired = [[10, 'qatar-jet', 10], [13, 'kushners-deals', 20], [9, 'trump-crypto', 30], [11, 'selling-the-white-house', 40]];
  for (const [id, slug, prio] of retired) {
    await db.query("insert into public.events(id, slug, name, publish_state, sweep_priority) values ($1,$2,$2,'draft',$3)", [id, slug, prio]);
  }
  for (const ev of TEST_EVENTS) {
    await db.query(`insert into public.events(id, slug, name, publish_state, published_at, sweep_pattern, sweep_coword,
      sweep_priority, sweep_summary, agent_pattern, updated_at) values ($1,$2,$2,'published','2026-08-24',$3,$4,$5,$6,$7,'2026-10-01')`,
    [ev.id, ev.slug, ev.sweep_pattern, ev.sweep_coword, ev.sweep_priority, ev.sweep_summary, ev.agent_pattern]);
  }
  await db.exec(M127);   // seeds election's definition
  const slugId = Object.fromEntries((await db.query('select slug, id from public.events')).rows.map((r) => [r.slug, r.id]));
  for (const [id, h] of CASES) await db.query('insert into public.stories(id, primary_headline) values ($1,$2)', [id, h]);
  for (const [id, h, front, by, note] of MEMBERS) {
    await db.query("insert into public.stories(id, primary_headline, first_seen_at) values ($1,$2, now() - interval '3 day')", [id, h]);
    await db.query("insert into public.story_event(story_id, event_id, assigned_by, confidence, note, assigned_at) values ($1,$2,$3,0.8,$4, now() - interval '2 day')",
      [id, slugId[front], by, note]);
  }
  await db.exec('select * from public.refresh_tracker_derived()');
  return db;
}
const placement = async (db) => Object.fromEntries((await db.query(
  'select st.id, e.slug from public.stories st left join public.story_event se on se.story_id = st.id left join public.events e on e.id = se.event_id')).rows
  .map((r) => [r.id, r.slug ?? '-']));
const settings = async (db) => JSON.stringify((await db.query(
  `select slug, publish_state, sweep_pattern, sweep_coword, sweep_priority, sweep_summary, agent_pattern, agent_definition, updated_at
     from public.events order by slug`)).rows);
const ev = async (db, slug) => (await db.query('select * from public.events where slug = $1', [slug])).rows[0];
const footer = DEFS.split('\n-- ROLLBACK (')[1].split('\n');
const ROLLBACK = footer.slice(footer.indexOf('-- BEGIN;'), footer.indexOf('-- COMMIT;') + 1).map((l) => l.slice(3)).join('\n');
const RESULT = DEFS.split('-- (3) RESULT')[1].split('\n-- ROLLBACK (')[0].split('\n').slice(1).filter((l) => !l.startsWith('--')).join('\n');

// Review code blocks: the regexes exactly as the reviews tested them.
const blocks = (md) => md.split('```').filter((_, i) => i % 2 === 1).map((b) => b.split('\n').filter((l, i, a) => !(i === 0 && l === '') && !(i === a.length - 1 && l === '')));
const after = (block, label) => block[block.findIndex((l) => l.startsWith(label)) + 1];
const R = {};
{
  const ep = blocks(review('epstein-files')); R.epSweep = after(ep[0], 'sweep_pattern'); R.epAgent = ep[1][0];
  const ir = blocks(review('iran')); R.irSweep = after(ir[0], 'sweep_pattern'); R.irAgent = ir[1][0];
  const co = blocks(review('the-courts')); R.coSweep = after(co[0], 'sweep_pattern'); R.coAgent = co[1][0];
  const el = blocks(review('election-suppression')); R.elAdd = after(el[0], 'sweep_pattern additions'); R.elCw = after(el[0], 'sweep_coword');
  const is = blocks(review('israel-gaza')); R.isSweep = after(is[0], 'sweep_pattern'); R.isCw = after(is[0], 'sweep_coword'); R.isAgent = is[1][0];
  const rf = blocks(review('rfk-hhs')); R.rfSweep = after(rf[0], 'sweep_pattern'); R.rfAgent = rf[1][0];
  const he = blocks(review('hegseth-pentagon')); R.heSweep = after(he[0], 'sweep_pattern'); R.heAgent = he[1][0];
}
const ANDREW = 'prince andrew|mountbatten[- ]windsor';
const SC_PHRASE = String.raw`|\m(supreme court|justices)\M (rul\w*|block\w*|struck|strikes?|allow\w*|upholds?|sides?|reject\w*|halts?|lets?|clears?|says)\M`;
const EXPECT = {
  'epstein-files': { sweep: R.epSweep.replace(`${ANDREW}|`, ''), coword: null,
    agent: R.epSweep.replace(`${ANDREW}|`, '') + `|${ANDREW}` + R.epAgent.slice(R.epSweep.length) },
  iran: { sweep: R.irSweep, coword: T.iran.sweep_coword, agent: R.irAgent },
  'the-courts': { sweep: R.coSweep, coword: null,
    agent: R.coAgent.replace('<the sweep_pattern above, verbatim>', R.coSweep).replace(SC_PHRASE, '') },
  'election-suppression': { sweep: T['election-suppression'].sweep_pattern.slice(0, -1) + R.elAdd + ')', coword: R.elCw,
    agent: T['election-suppression'].agent_pattern },
  'israel-gaza': { sweep: R.isSweep, coword: R.isCw, agent: R.isAgent },
  'rfk-hhs': { sweep: R.rfSweep, coword: T['rfk-hhs'].sweep_coword, agent: R.rfAgent },
  'hegseth-pentagon': { sweep: R.heSweep, coword: T['hegseth-pentagon'].sweep_coword, agent: R.heAgent },
  'ice-deportations': { sweep: T['ice-deportations'].sweep_pattern.replace(String.raw`raids?)\M`, String.raw`raids?|kilmar|abrego|ábrego)\M`),
    coword: T['ice-deportations'].sweep_coword,
    agent: T['ice-deportations'].agent_pattern.replace(String.raw`raids?)\M|`, String.raw`raids?|kilmar|abrego|ábrego)\M|`) },
  'trump-corruption': { sweep: T['trump-corruption'].sweep_pattern, coword: null, agent: T['trump-corruption'].agent_pattern },
};

out('front-definitions-sql-pglite');

// 0. Fixture and sources agree (pure string checks)
{
  check(Object.values(R).every((v) => typeof v === 'string' && v.length > 5), 'every review regex block parsed');
  check(R.epAgent.startsWith(R.epSweep) && R.irAgent.startsWith(R.irSweep) && R.isAgent.startsWith(R.isSweep)
    && R.rfAgent.startsWith(R.rfSweep) && R.heAgent.startsWith(R.heSweep), 'each review agent_pattern starts with its sweep');
  check(R.coAgent.includes(SC_PHRASE), 'the courts review carries the Supreme Court phrase this file leaves out');
  check(R.epSweep.includes(`${ANDREW}|`), 'the Epstein review sweep carries the Andrew branch this file leaves to the agent');
  check(review('ice-deportations').includes('`kilmar|abrego|ábrego`'), 'the ICE review names kilmar|abrego|ábrego');
  // PROD was built from these files (TEST was read back byte for byte), so passing the guards on
  // the TEST fixture means passing them on PROD.
  const lit = (file, v) => read(file).includes(`'${v.replace(/'/g, "''")}'`);
  const M115 = 'migrations/115_front_sweep_and_alarm_floor.sql';
  const F595 = 'scripts/maintenance/2026-10-02-ado-595-new-fronts.sql';
  const F608 = 'scripts/maintenance/2026-10-03-ado-608-ice-front.sql';
  const FHEG = 'scripts/maintenance/2026-10-01-ado-592-hegseth-pentagon-front.sql';
  const F610 = 'scripts/maintenance/2026-10-04-ado-610-trump-corruption-front.sql';
  const srcOk = [
    [M115, T['election-suppression'].sweep_pattern], [M115, T['election-suppression'].sweep_coword], [M115, 'epstein'],
    [M115, T['the-courts'].sweep_pattern], [M115, T['the-courts'].sweep_coword], [M115, T.iran.sweep_pattern], [M115, T.iran.sweep_coword],
    [F595, T['israel-gaza'].sweep_pattern], [F595, T['israel-gaza'].sweep_coword], [F595, T['israel-gaza'].agent_pattern],
    [F595, T['rfk-hhs'].sweep_pattern], [F595, T['rfk-hhs'].sweep_coword], [F595, T['rfk-hhs'].agent_pattern],
    [F608, T['ice-deportations'].sweep_pattern], [F608, T['ice-deportations'].sweep_coword], [F608, T['ice-deportations'].agent_pattern],
    [FHEG, T['hegseth-pentagon'].sweep_pattern], [FHEG, T['hegseth-pentagon'].sweep_coword], [FHEG, T['hegseth-pentagon'].agent_pattern],
    [F610, T['trump-corruption'].sweep_pattern],
    [F610, T['trump-corruption'].agent_pattern.slice(T['trump-corruption'].sweep_pattern.length)],   // c_sweep || '<extras>'
  ].filter(([f, v]) => !lit(f, v)).map(([f, v]) => `${path.basename(f)}: ${v.slice(0, 50)}`);
  check(srcOk.length === 0, `TEST values equal the migration 115 / 595 / 608 / Hegseth / 610 literals${srcOk.length ? ': ' + srcOk.join('; ') : ''}`);
}

{
  const db = await makeDb();
  const start = await placement(db);
  const startSettings = await settings(db);
  const seed = (await ev(db, 'election-suppression')).agent_definition;
  check(typeof seed === 'string' && seed.startsWith('The front is "**fronts they are screwing us on**"'), 'setup: migration 127 seeded the election definition');

  // 1. Apply (the whole file: pre-check, apply block, result query)
  const err = await run(db, DEFS);
  check(err === null, `definitions file applies${err ? ': ' + err : ''}`);

  // 2. Stored values round-trip against the reviews
  for (const slug of NINE) {
    const e = await ev(db, slug);
    const x = EXPECT[slug];
    const bad = ['sweep', 'coword', 'agent'].filter((k) => ({ sweep: e.sweep_pattern, coword: e.sweep_coword, agent: e.agent_pattern })[k] !== x[k]);
    check(bad.length === 0, `${slug}: stored ${bad.length ? bad.join(', ') + ' DIFFER from' : 'values match'} the review${bad.length ? '' : ' (sweep, co-word, agent_pattern)'}`);
  }
  check((await ev(db, 'the-courts')).sweep_coword === null, 'the-courts: co-word folded in (NULL)');
  check(await count(db, "select count(*) n from public.events where slug in ('qatar-jet','kushners-deals','trump-crypto','selling-the-white-house') and sweep_pattern is null and agent_pattern is null and agent_definition is null") === 4,
    'retired fronts untouched');

  // 3. Placement
  const got = await placement(db);
  const bad = CASES.filter(([id, , want]) => got[id] !== want).map(([id, h, want]) => `${id} (${h.slice(0, 40)}) got ${got[id]} want ${want}`);
  check(bad.length === 0, `placement of ${CASES.length} headlines${bad.length ? ': ' + bad.join('; ') : ''}`);
  const lost = MEMBERS.filter(([id, , front]) => got[id] !== front).map(([id]) => id);
  check(lost.length === 0, `no current member moved or lost${lost.length ? ': ' + lost.join(', ') : ''}`);
  const filed = CASES.filter(([, , w]) => w !== '-').length;
  check(await count(db, "select count(*) n from public.story_event where note = 'ado-592-defs: keyword sweep'") === filed, `every sweep row carries the rollback note (${filed})`);
  check(await count(db, "select count(*) n from public.stories where id = 171 and main_line") === 1, 'refresh ran (a swept alarm-4 story is on the main line)');

  // 4. All nine join the agent; the pool sees the new patterns
  check(await count(db, `select count(*) n from public.events where publish_state = 'published' and agent_pattern is not null
     and nullif(btrim(agent_definition), '') is not null`) === 9, 'all nine published fronts are agent fronts');
  const pool = (await db.query('select story_id, matched_fronts from public.front_agent_candidates_all(100)')).rows;
  const pf = Object.fromEntries(pool.map((r) => [Number(r.story_id), r.matched_fronts]));
  check(JSON.stringify(pf[118]) === '["iran"]', `war powers is Iran's alone in the pool (Israel dropped it): ${JSON.stringify(pf[118])}`);
  check(JSON.stringify(pf[105]) === '["epstein-files"]', `Prince Andrew reaches the agent through the Epstein extras: ${JSON.stringify(pf[105])}`);
  check(JSON.stringify(pf[130]) === '["the-courts"]', `a "judge blocks" ruling reaches the agent through the Courts extras: ${JSON.stringify(pf[130])}`);
  check(pf[168] === undefined, 'the Kennedy Center no longer reaches the RFK pool (bare kennedy dropped)');

  // 5. Definitions
  const defs = Object.fromEntries((await db.query(`select slug, agent_definition d from public.events where slug = any($1)`, [NINE])).rows.map((r) => [r.slug, r.d]));
  const el = defs['election-suppression'];
  check(el.startsWith(seed) && el.split('### All fronts: additions (ADO-592').length === 2 && el.includes('Fulton County'), 'election: the 127 seed plus the additions, once');
  const phrase = {
    'trump-corruption': 'public power used for private gain', 'epstein-files': 'sex-trafficking network',
    'the-courts': 'collision between this administration and the judiciary', 'ice-deportations': 'arresting, detaining, deporting',
    'israel-gaza': 'for, with, or because of Israel', iran: "United States' war with Iran", 'rfk-hhs': 'protection against disease',
    'hegseth-pentagon': 'to and with the military',
  };
  const defBad = Object.entries(phrase).filter(([s, p]) => !(defs[s] || '').includes(p) || !(defs[s] || '').includes('### Calibration examples')).map(([s]) => s);
  check(defBad.length === 0, `each definition carries its review text and a calibration table${defBad.length ? ': ' + defBad.join(', ') : ''}`);
  const leaks = NINE.filter((s) => /\(\d{3,5}(, \d{3,5})*\)|open question|question \d|\(D\d\)/i.test(defs[s].replace(seed, '')));
  check(leaks.length === 0, `no PROD story ids or review cross-references in the definitions${leaks.length ? ': ' + leaks.join(', ') : ''}`);
  check(defs['rfk-hhs'].includes('borderline rfk-hhs: abortion pill pending') && defs['hegseth-pentagon'].includes('borderline hegseth-pentagon: D4 pending'),
    'open questions are held as uncertain declines, not decided');

  // 6. Backup: the original values, one row per front
  const bk = Object.fromEntries((await db.query("select slug, sweep_pattern, agent_pattern, agent_definition from public.front_merge_backup_events where merge_tag = 'ado-592-defs'")).rows.map((r) => [r.slug, r]));
  check(Object.keys(bk).length === 9 && bk.iran.agent_pattern === null && bk['epstein-files'].sweep_pattern === 'epstein'
    && bk['election-suppression'].agent_definition === seed && bk['trump-corruption'].agent_definition === null, 'backup holds the original values of all nine');
  check(await count(db, `select count(*) n from information_schema.role_table_grants
    where grantee in ('anon','authenticated','PUBLIC') and table_name = 'front_merge_backup_events'`) === 0, 'backup table: no anon/authenticated grants');

  // 7. Result query
  const res = (await db.query(RESULT)).rows;
  check(res.length === 9 && Object.keys(res[0])[0] === 'slug' && res.every((r) => r.in_agent === true), 'result: 9 rows, first column slug, in_agent true on every row');
  const rr = Object.fromEntries(res.map((r) => [r.slug, r]));
  check(Number(rr['hegseth-pentagon'].members_outside_pattern) === 1 && Number(rr['trump-corruption'].members_outside_pattern) === 1
    && Number(rr.iran.members_outside_pattern) === 0, 'result: members_outside_pattern shows the hand-seeded and envoy members only');
  check(Number(rr.iran.filed_now) === CASES.filter(([, , w]) => w === 'iran').length && Number(res[0].agent_pool) > 0, 'result: filed_now and agent_pool');

  // 8. Idempotent re-run
  const s1 = await settings(db);
  const p1 = JSON.stringify(await placement(db));
  const err2 = await run(db, DEFS);
  check(err2 === null, `re-run succeeds${err2 ? ': ' + err2 : ''}`);
  check(await settings(db) === s1, 're-run changes no front value (updated_at included)');
  check(JSON.stringify(await placement(db)) === p1, 're-run changes no membership');
  check(await count(db, "select count(*) n from public.front_merge_backup_events where merge_tag = 'ado-592-defs' and slug = 'iran' and agent_pattern is null") === 1,
    're-run keeps the ORIGINAL values in the backup');

  // 9. Rollback (file footer, uncommented)
  check(ROLLBACK.startsWith('BEGIN;') && ROLLBACK.trim().endsWith('COMMIT;'), 'rollback block extracted from the file footer');
  const rbErr = await run(db, ROLLBACK);
  check(rbErr === null, `rollback runs${rbErr ? ': ' + rbErr : ''}`);
  const strip = (s) => JSON.stringify(JSON.parse(s).map(({ updated_at, ...rest }) => rest));   // eslint-disable-line no-unused-vars
  check(strip(await settings(db)) === strip(startSettings), 'rollback restores every front value');
  const back = await placement(db);
  const drift = Object.keys(start).filter((id) => start[id] !== back[id]).map((id) => `${id}: ${start[id]} -> ${back[id]}`);
  check(drift.length === 0, `rollback restores every membership${drift.length ? ': ' + drift.join('; ') : ''}`);
  check(await count(db, "select count(*) n from public.front_merge_backup_events where merge_tag = 'ado-592-defs'") === 0, 'rollback clears its backup rows');
  check(await run(db, DEFS) === null, 'file applies again after a rollback');
}

// 10. All-or-nothing: a forced invariant failure (an Epstein member outside the new agent_pattern;
// Epstein had no agent_pattern, so every member must match) changes nothing.
const guard = async (label, setup, needle) => {
  const db = await makeDb();
  await db.exec(setup);
  const s0 = await settings(db);
  const p0 = JSON.stringify(await placement(db));
  const err = await run(db, DEFS);
  check(err !== null && err.includes(needle), `refuses: ${label}${err && !err.includes(needle) ? ' (got: ' + err + ')' : ''}`);
  await runbookRecover(db, label);
  check(await settings(db) === s0 && JSON.stringify(await placement(db)) === p0, `${label}: nothing changed`);
  check(await count(db, "select count(*) n from pg_class where relname = 'front_merge_backup_events'") === 0, `${label}: no backup table left behind`);
};
await guard('an Epstein member outside the new agent_pattern',
  "insert into public.stories(id, primary_headline) values (300, 'Royal biographer publishes new book'); insert into public.story_event(story_id, event_id, assigned_by) values (300, 7, 'human')",
  'epstein-files: member stories outside the new agent_pattern (first 20): 300');
await guard('failing refresh', "create or replace function public.refresh_tracker_derived() returns table(rows_changed int) language plpgsql as $$ begin raise exception 'refresh broke'; end $$;",
  'refresh broke');
await guard('a hand-edited sweep', "update public.events set sweep_pattern = 'iran|tehran' where slug = 'iran'",
  'iran: sweep_pattern is not the value this file expects to replace');
await guard('a hand-edited agent_pattern', "update public.events set agent_pattern = 'hegseth' where slug = 'hegseth-pentagon'",
  'hegseth-pentagon: agent_pattern is not the value');
await guard('a definition already edited in admin', "update public.events set agent_definition = 'hand written' where slug = 'trump-corruption'",
  'trump-corruption: agent_definition already holds a different text');
await guard('election definition no longer the 127 seed', "update public.events set agent_definition = 'rewritten' where slug = 'election-suppression'",
  'election-suppression: agent_definition is not the migration 127 seed');
await guard('a front unpublished', "update public.events set publish_state = 'draft' where slug = 'rfk-hhs'",
  'front(s) missing or not published: rfk-hhs');
await guard('a sweep priority clash', "update public.events set sweep_pattern = 'zzz', sweep_priority = 80 where slug = 'qatar-jet'",
  'sweep priority shared by several fronts (80: iran, qatar-jet)');
await guard('a fronts run in progress (recent decline)',
  "insert into public.pipeline_skips(pipeline, reason, entity_type, entity_id, metadata) values ('front_assignment', 'agent_declined', 'story', '118', '{\"front\": \"none\"}')",
  'the fronts agent wrote a decision in the last 15 minutes');
await guard('a fronts run in progress (recent assign)',
  "insert into public.story_event(story_id, event_id, assigned_by, note) values (118, 8, 'agent', 'fronts-v2: iran: war powers')",
  'the fronts agent wrote a decision in the last 15 minutes');

out(failures ? `front-definitions-sql-pglite: ${failures} FAILED` : 'front-definitions-sql-pglite: all checks passed');
process.exit(failures ? 1 : 0);
