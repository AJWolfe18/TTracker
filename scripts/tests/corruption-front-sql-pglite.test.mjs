// Runs the ADO-610 hand-pasted SQL file end to end on PGlite (Postgres 17) against a minimal copy of
// the tracker schema (events, event_updates, stories, story_event, tracker_pin + a real refresh with
// main-line rule v1.3 from migration 122):
//   scripts/maintenance/2026-10-04-ado-610-trump-corruption-front.sql
// Checks: the merge moves every old member (hand-seeded ones too), retires the four old fronts,
// headline placement for the kept and new sweep branches next to competing fronts, idempotent
// re-run, the rollback restores the exact starting state, all-or-nothing apply, and every guard.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/corruption-front-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('corruption-front-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const RULE = fs.readFileSync(path.join(repo, 'migrations/122_main_line_rule_v1_3.sql'), 'utf8');
const MERGE = fs.readFileSync(path.join(repo, 'scripts/maintenance/2026-10-04-ado-610-trump-corruption-front.sql'), 'utf8');

// The four old fronts carry their real TEST/PROD sweep values (read October 4, 2026), so the kept
// branches are tested against the rules they replace. Competing fronts are simplified.
const KUSHNER_COWORD = String.raw`^(?!.*\m(world liberty|wlfi|usd1|crypto\w*|memecoins?|meme coins?|stablecoins?|bitcoin|binance|charles kushner|josh kushner|tony kushner|thrive capital)\M)(?=.*\m(affinity|business (deal|deals|dealings|interests|ties|empire)|dealings|money|windfalls?|payday|payments?|fundrais\w*|investors?|investment (firm|fund|company)|private equity|profit\w*|conflicts? of interest|ethics?|hotels?|resorts?|real estate|financial (empire|interests?|ties|disclosures?|stakes?|dealings)|disclos\w*|empire|probes?|investigat\w*|(saudi|qatari|emirati|abu dhabi|uae|gulf|foreign|sovereign) (money|fund|funds|investors?|investment|cash|royals?|backers?|wealth)|pif|public investment fund|electronic arts|paramount|warner|sazan|albania\w*|serbia\w*|belgrade)\M)`;
const KUSHNER_AGENT = String.raw`\m(kushner\w*|witkoff\w*|affinity partners)\M|\m(jared|special envoys?|board of peace)\M`;

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(
  id bigserial primary key, slug text unique, name text, dek text, alarm_level smallint, tier text,
  lifecycle text default 'open', publish_state text, published_at timestamptz, started_at timestamptz,
  created_by text, sweep_pattern text, sweep_coword text, sweep_priority smallint not null default 100,
  sweep_summary boolean not null default false, main_line_alarm_floor smallint, agent_pattern text,
  updated_at timestamptz);
create table public.event_updates(id bigserial primary key,
  event_id bigint not null references public.events(id) on delete cascade, headline text);
create table public.stories(id bigint primary key, status text default 'active', primary_headline text,
  summary_neutral text default 'summary', alarm_level smallint, severity text, main_line boolean not null default false);
create table public.story_event(story_id bigint primary key references public.stories(id) on delete cascade,
  event_id bigint not null references public.events(id) on delete cascade, assigned_by text, confidence numeric);
create table public.tracker_pin(source text, entity_id text, pin text, primary key (source, entity_id));
create view public.v_tracker_main_line_rule as select id, false as main_line from public.stories;
create function public.refresh_tracker_derived() returns table(rows_changed int) language plpgsql as $$
declare n int;
begin
  update public.stories s set main_line = r.main_line
    from public.v_tracker_main_line_rule r
   where r.id = s.id and s.main_line is distinct from r.main_line;
  get diagnostics n = row_count;
  return query select n;
end $$;
insert into public.events(id, slug, name, alarm_level, tier, publish_state, published_at, sweep_pattern, sweep_coword, sweep_priority, sweep_summary, agent_pattern) values
 (10,'qatar-jet','The Qatar Jet',4,'major','published','2026-08-24','qatar','(jet|747|air force one|plane|boeing)',10,false,null),
 (13,'kushners-deals','The Envoys'' Deals',4,'major','published','2026-10-02','\m(kushner\w*|witkoff\w*|affinity partners)\M',$k$${KUSHNER_COWORD}$k$,20,false,$a$${KUSHNER_AGENT}$a$),
 (9,'trump-crypto','Trump Crypto',4,'major','published','2026-08-24','(crypto|memecoin|meme coin|\$TRUMP|world liberty|stablecoin|bitcoin|binance)','(trump|kushner|witkoff|white house|president)',30,false,null),
 (11,'selling-the-white-house','Selling the White House',4,'major','published','2026-08-24','ballroom',null,40,false,null),
 (14,'election-suppression','Election Suppression',5,'flagship','published','2026-08-24','(voter roll|polls?|polling)','(election|vote|voter|voting|ballot|midterm|poll)',50,false,null),
 (16,'israel-gaza','Israel & Gaza',4,'major','published','2026-10-02','\m(israel|gaza)\M',null,75,false,null),
 (8,'iran','Iran',5,'flagship','published','2026-08-24','\miran(ian)?\M',null,80,false,null),
 (15,'hegseth-pentagon','Hegseth''s Pentagon',5,'flagship','published','2026-10-02','\m(hegseth|pentagon)\M',null,90,false,null);
select setval('public.events_id_seq', 40);
`;

// Members of the old fronts before the merge: [id, headline, alarm, front]. 305 is hand-seeded and
// matches no pattern at all; it must move anyway.
const OLD_MEMBERS = [
  [301, 'Binance Gives Trump Family’s Crypto Firm a Leg Up', 4, 'trump-crypto'],
  [302, 'Qatar jet retrofit costs taxpayers $1 billion', 3, 'qatar-jet'],
  [303, 'Trump Family Safety at Stake in Ballroom Construction Decision', 4, 'selling-the-white-house'],
  [304, 'Kushner firm Affinity takes Saudi money', 4, 'kushners-deals'],
  [305, 'Envoy talks stall in Doha', 2, 'kushners-deals'],
];
// Unassigned headlines: [id, headline, want slug after the targeted sweep, or '-']
const CASES = [
  // new branches
  [101, 'Trump made over 1,000 July stock trades worth up to $270m, filings reveal', 'trump-corruption'],
  [102, 'Reflecting Pool Contractor Blames Its Own Repairs, Not Vandals, for Damage', 'trump-corruption'],
  [103, 'Trump Ally Harold Hamm Strikes Venezuela Oil Deal', 'trump-corruption'],
  [104, 'Kristi Noem’s Agency Gave Her Donor a Lucrative Contract Just Before She Left', 'trump-corruption'],
  [105, '‘Brazen corruption’: critics denounce Trump Media plan to sell priority access to Truth Social posts', 'trump-corruption'],
  [106, 'Trump administration withdraws US from Greco anti-corruption monitoring body', 'trump-corruption'],
  [107, 'Donald Trump Jr.’s Bahamas Wedding Was Secretly Bankrolled by Russian Oligarch Close to Putin', 'trump-corruption'],
  [108, 'Trump’s ‘gold card’ visas were supposed to solve the national debt. They’ve sold only one', 'trump-corruption'],
  [109, 'Japanese megacorp SoftBank donates $50M to Trump’s presidential library', 'trump-corruption'],
  [110, 'Judge Who Struck Down Trump’s Compensation Fund Asks: Will Trump Just Pay Allies Another Way?', 'trump-corruption'],
  [111, 'Capital One says it closed Trump Organization’s accounts after anti-money-laundering review', 'trump-corruption'],
  [112, 'Firm That Planned Trump’s Jan. 6 Rally Received No-Bid Contracts', 'trump-corruption'],
  [113, 'Saudi Arabia-Backed LIV Golf to Hold Tournament at the Trumps’ New Jersey Resort', 'trump-corruption'],
  [114, 'Judge Demands Answers About Plans for Trump’s East Potomac Golf Course', 'trump-corruption'],
  [115, 'Company led by Republican fundraiser pardoned by Trump wins $106m federal contract', 'trump-corruption'],
  // kept branches (the old fronts' rules, folded in)
  [120, 'Trump family crypto firm takes UAE stake', 'trump-corruption'],
  [121, 'Air Force One from Qatar arrives at Andrews', 'trump-corruption'],
  [122, 'Ballroom donors revealed in new filing', 'trump-corruption'],
  [123, 'Witkoff’s son lands Gulf investors for family fund', 'trump-corruption'],
  [124, 'Bitcoin falls below $60,000', '-'],                                   // crypto needs a Trump word
  [125, 'Josh Kushner’s Thrive Capital raises a new investment fund', '-'],   // Kushner co-word exclusion
  // stays out (noise the bare words would bring in)
  [130, 'US TV networks suspend White House pool coverage over Trump media ban', '-'],
  [131, 'How the Pro-Trump Media Ecosystem Is Splintering', '-'],
  [132, 'Democrats coalesce around a message about the cost of corruption', '-'],
  [133, 'LA homelessness non-profit workers arrested over alleged corruption and bribes', '-'],
  [134, 'Kalshi bans ex-Congressman George Santos for insider trading', '-'],
  [135, 'Obama Presidential Library opens in Chicago', '-'],
  [136, '9/11 Victim Compensation Fund extended for first responders', '-'],
  [137, 'BBC seeks to subpoena Trump family members in defamation suit', '-'],
  // overlaps: lower priority number wins; a story another front wins is left unfiled
  [140, 'Company backed by Trump sons looks to sell drone interceptors to Gulf states attacked by Iran', 'trump-corruption'], // 15 beats Iran 80
  [141, 'Trump pardons donor who ran a polling firm', 'trump-corruption'],     // 15 beats Election 50
  [142, 'Qatar mediates Gaza ceasefire talks', '-'],                            // no plane word; Israel wins
  [143, 'A SEAL’s death left doubts. His family thought Hegseth and Trump Jr. would help.', '-'], // no money word; Hegseth wins
];
// Filed earlier in another front and matching the new sweep: must not move.
const ALREADY = [[150, 'Company backed by Trump sons pitches drones to Gulf states amid Iran war', 'iran']];

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
  check(await run(db, RULE) === null, 'setup: migration 122 (rule v1.3) applies');
  const slugId = async (slug) => (await db.query('select id from public.events where slug = $1', [slug])).rows[0].id;
  for (const [id, h, a, front] of OLD_MEMBERS) {
    await db.query('insert into public.stories(id, primary_headline, alarm_level) values ($1,$2,$3)', [id, h, a]);
    await db.query("insert into public.story_event values ($1, $2, 'human', 1)", [id, await slugId(front)]);
  }
  for (const [id, h] of CASES) await db.query('insert into public.stories(id, primary_headline, alarm_level) values ($1,$2,4)', [id, h]);
  for (const [id, h, front] of ALREADY) {
    await db.query('insert into public.stories(id, primary_headline, alarm_level) values ($1,$2,4)', [id, h]);
    await db.query("insert into public.story_event values ($1, $2, 'agent', 0.8)", [id, await slugId(front)]);
  }
  await db.exec('select * from public.refresh_tracker_derived()');
  return db;
}
const placement = async (db) => Object.fromEntries((await db.query(
  'select st.id, e.slug from public.stories st left join public.story_event se on se.story_id = st.id left join public.events e on e.id = se.event_id')).rows
  .map((r) => [r.id, r.slug ?? '-']));
const OLD_SLUGS = "('trump-crypto','qatar-jet','selling-the-white-house','kushners-deals')";
const oldSettings = async (db) => JSON.stringify((await db.query(
  `select slug, publish_state, published_at, sweep_pattern, sweep_coword, sweep_priority, sweep_summary, agent_pattern
     from public.events where slug in ${OLD_SLUGS} order by slug`)).rows);
// The footer's commented rollback, from "-- BEGIN;" to "-- COMMIT;", uncommented.
const footer = MERGE.split('\n-- ROLLBACK')[1].split('\n');
const ROLLBACK = footer.slice(footer.indexOf('-- BEGIN;'), footer.indexOf('-- COMMIT;') + 1).map((l) => l.slice(3)).join('\n');

out('corruption-front-sql-pglite');
{
  const db = await makeDb();
  const start = await placement(db);
  const startSettings = await oldSettings(db);
  const startMain = await count(db, 'select count(*) n from public.stories where main_line');

  // 1. Apply
  check(await run(db, MERGE) === null, 'merge file applies');
  const got = await placement(db);
  check(OLD_MEMBERS.every(([id]) => got[id] === 'trump-corruption'), 'every old member moved, the hand-seeded one included');
  const bad = [...CASES, ...ALREADY].filter(([id, , want]) => got[id] !== want).map(([id, h, want]) => `${id} (${h.slice(0, 40)}) got ${got[id]} want ${want}`);
  check(bad.length === 0, `placement of ${CASES.length + ALREADY.length} headlines${bad.length ? ': ' + bad.join('; ') : ''}`);
  const f = (await db.query("select name, tier, alarm_level, publish_state, published_at, sweep_priority, sweep_coword, main_line_alarm_floor, agent_pattern from public.events where slug = 'trump-corruption'")).rows[0];
  check(f && f.name === 'Trump Corruption' && f.tier === 'flagship' && f.alarm_level === 5 && f.publish_state === 'published'
    && f.published_at && f.sweep_priority === 15 && f.sweep_coword === null && f.main_line_alarm_floor === null && f.agent_pattern, 'front row values');
  check(await count(db, `select count(*) n from public.events where slug in ${OLD_SLUGS}
    and publish_state = 'draft' and sweep_pattern is null and sweep_coword is null and agent_pattern is null`) === 4, 'old fronts retired: draft, no sweep, no agent pattern');
  check(await count(db, `select count(*) n from public.story_event se join public.events e on e.id = se.event_id where e.slug in ${OLD_SLUGS}`) === 0, 'old fronts hold no members');
  check(await count(db, "select count(*) n from public.front_merge_backup_events where merge_tag = 'ado-610'") === 4, 'backup: 4 front rows');
  check(await count(db, "select count(*) n from public.front_merge_backup_story_event where merge_tag = 'ado-610'") === OLD_MEMBERS.length, `backup: ${OLD_MEMBERS.length} moved memberships`);
  check(await count(db, "select count(*) n from public.stories where id in (301, 303, 304, 101) and main_line") === 4, 'moved and swept members at 4 are on the main line');
  check(await count(db, "select count(*) n from public.stories where id in (302, 305) and main_line") === 0, 'moved members below 4 stay off the main line');
  const anonCanRead = await count(db, `select count(*) n from information_schema.role_table_grants
    where grantee in ('anon','authenticated','PUBLIC') and table_name like 'front_merge_backup%'`);
  check(anonCanRead === 0, 'backup tables: no anon/authenticated grants');
  check(await count(db, "select count(*) n from pg_class where relname like 'front_merge_backup%' and relrowsecurity") === 2, 'backup tables: RLS on');

  // 2. Idempotent re-run
  const before = JSON.stringify(await placement(db));
  check(await run(db, MERGE) === null, 'merge file re-run succeeds');
  check(JSON.stringify(await placement(db)) === before, 're-run changes no membership');
  check(await count(db, "select count(*) n from public.front_merge_backup_events where merge_tag = 'ado-610' and publish_state = 'published' and sweep_pattern is not null") === 4,
    're-run keeps the ORIGINAL settings in the backup');

  // 3. Rollback (file footer, uncommented)
  check(ROLLBACK.includes('BEGIN;') && ROLLBACK.includes('COMMIT;'), 'rollback block extracted from the file footer');
  check(await run(db, ROLLBACK) === null, 'rollback runs');
  const after = await placement(db);
  const drift = Object.keys(start).filter((id) => start[id] !== after[id]).map((id) => `${id}: ${start[id]} -> ${after[id]}`);
  check(drift.length === 0, `rollback restores every membership${drift.length ? ': ' + drift.join('; ') : ''}`);
  check(await oldSettings(db) === startSettings, 'rollback restores the old fronts\' exact settings');
  check(await count(db, "select count(*) n from public.events where slug = 'trump-corruption'") === 0, 'rollback removes the front');
  check(await count(db, 'select count(*) n from public.stories where main_line') === startMain, 'rollback restores the main line');
  check(await run(db, MERGE) === null, 'merge applies again after a rollback');
  check((await placement(db))[304] === 'trump-corruption', 'second apply moves members again');
}

// 4. All-or-nothing: a failing refresh leaves nothing behind (no front, no move, no backup tables).
{
  const db = await makeDb();
  await db.exec("create or replace function public.refresh_tracker_derived() returns table(rows_changed int) language plpgsql as $$ begin raise exception 'refresh broke'; end $$;");
  const err = await run(db, MERGE);
  check(err !== null && err.includes('refresh broke'), 'failing refresh stops the apply');
  await runbookRecover(db, 'failing refresh');
  check(await count(db, "select count(*) n from public.events where slug = 'trump-corruption'") === 0, 'no front left behind');
  check(await count(db, `select count(*) n from public.events where slug in ${OLD_SLUGS} and publish_state = 'published' and sweep_pattern is not null`) === 4, 'old fronts untouched');
  check((await placement(db))[304] === 'kushners-deals', 'no membership moved');
  check(await count(db, "select count(*) n from pg_class where relname like 'front_merge_backup%'") === 0, 'backup tables not created');
}

// 5. Guards
const guard = async (label, setup, needle, after) => {
  const db = await makeDb();
  await db.exec(setup);
  const settings = await oldSettings(db);
  const members = JSON.stringify(await placement(db));
  const err = await run(db, MERGE);
  check(err !== null && err.includes(needle), `refuses: ${label}`);
  await runbookRecover(db, label);
  check(await oldSettings(db) === settings && JSON.stringify(await placement(db)) === members, `${label}: nothing changed`);
  if (after) await after(db);
  else check(await count(db, "select count(*) n from public.events where slug = 'trump-corruption'") === 0, `${label}: no front written`);
};
await guard('priority 15 taken', "insert into public.events(slug, name, sweep_pattern, sweep_priority) values ('squatter', 'S', 'zzz', 15)",
  'sweep priority 15 already taken by squatter');
await guard('an old front is missing', "update public.events set slug = 'qatar-jet-renamed' where slug = 'qatar-jet'",
  'old front(s) not found: qatar-jet');
await guard('an old front has editorial updates', "insert into public.event_updates(event_id, headline) values (11, 'approved copy')",
  'have 1 editorial update(s)');
await guard('existing slug with other values',
  "insert into public.events(slug, name, dek, sweep_pattern, sweep_priority) values ('trump-corruption', 'TC', 'hand edit', 'zzz', 99)",
  'already exists with different values', async (db) => {
    check(await count(db, "select count(*) n from public.events where slug = 'trump-corruption' and dek = 'hand edit'") === 1, 'hand edit kept');
  });

out(failures ? `corruption-front-sql-pglite: ${failures} FAILED` : 'corruption-front-sql-pglite: all checks passed');
process.exit(failures ? 1 : 0);
