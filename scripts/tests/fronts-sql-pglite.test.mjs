// Runs the two hand-pasted fronts SQL files end to end on PGlite (Postgres 17) against a minimal
// copy of the fronts schema (events, stories, story_event + stubbed RPCs):
//   scripts/maintenance/2026-10-02-ado-595-new-fronts.sql        (ADO-595)
//   scripts/maintenance/2026-10-01-ado-592-hegseth-pentagon-front.sql (ADO-592, run second)
// Checks: headline placement, idempotent re-run, all-or-nothing apply, priority guards, the
// kushners-deals hand-edit guard, the header's ROLLBACK-after-error recovery step, and the rollback
// statements.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/fronts-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('fronts-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const FRONTS = fs.readFileSync(path.join(repo, 'scripts/maintenance/2026-10-02-ado-595-new-fronts.sql'), 'utf8');
const HEGSETH = fs.readFileSync(path.join(repo, 'scripts/maintenance/2026-10-01-ado-592-hegseth-pentagon-front.sql'), 'utf8');

const SCHEMA = String.raw`
create table public.events(
  id bigserial primary key, slug text unique, name text, dek text, alarm_level smallint, tier text,
  lifecycle text default 'open', publish_state text, published_at timestamptz, started_at timestamptz,
  created_by text, sweep_pattern text, sweep_coword text, sweep_priority smallint not null default 100,
  sweep_summary boolean not null default false, main_line_alarm_floor smallint, agent_pattern text,
  updated_at timestamptz);
create table public.stories(id bigint primary key, status text, primary_headline text, summary_neutral text, main_line boolean default false);
create table public.story_event(story_id bigint primary key references public.stories(id),
  event_id bigint references public.events(id) on delete cascade, assigned_by text, confidence numeric);
create function public.refresh_tracker_derived() returns table(rows_changed int) language sql as 'select 0';
create function public.front_agent_candidates(p_slug text, p_limit int) returns table(pool_size bigint) language sql as 'select 0::bigint';
insert into public.events(id, slug, name, dek, alarm_level, tier, publish_state, started_at, created_by, sweep_pattern, sweep_coword, sweep_priority) values
 (10,'qatar-jet','The Qatar Jet','d',4,'major','published','2025-07-01','human','qatar','(jet|747|air force one|plane|boeing)',10),
 (13,'kushners-deals','Kushner''s Deals','Sovereign wealth keeps landing with the son-in-law. Gulf money, withheld disclosures, and a family business that never stopped running.',3,'standard','published','2025-04-09','human','kushner',null,20),
 (9,'trump-crypto','Trump Crypto','d',4,'major','published','2025-01-20','human','(crypto|memecoin|meme coin|\$TRUMP|world liberty|stablecoin|bitcoin|binance)','(trump|kushner|witkoff|white house|president)',30),
 (14,'election-suppression','Election Suppression','d',5,'flagship','published','2025-03-25','human','(voter roll|mail-in)','(election|vote|voter)',50),
 (8,'iran','Iran','d',5,'flagship','published','2025-06-13','human','\miran(ian)?\M','^(?!.*iranian revolution)',80);
select setval('public.events_id_seq', 20);
`;

// [id, headline, expected front after both files ('-' = no front)]
const CASES = [
  [1, 'Kushner’s Affinity Partners raises $5 billion from Saudi fund', 'kushners-deals'],
  [2, 'Witkoff meets Putin in Moscow', '-'],
  [3, 'Witkoff family firm World Liberty gets $2 billion stablecoin deal', '-'], // Trump Crypto (not filed by these files)
  [4, 'Charles Kushner summoned by France over antisemitism letter', '-'],
  [5, 'Investigating Steve Witkoff’s Sprawling Financial Empire', 'kushners-deals'],
  [6, 'Netanyahu urges Trump to strike Iran', 'israel-gaza'],
  [7, 'US and Israel strike Iran nuclear sites', '-'], // Iran
  [8, 'UN commission concludes Israel committed genocide in Gaza', 'israel-gaza'],
  [9, 'Pro-Palestinian students face deportation', '-'],
  [10, 'AIPAC super PAC spends $30 million in Michigan primary', 'israel-gaza'],
  [11, 'RFK Jr. fires all 17 members of CDC vaccine panel', 'rfk-hhs'],
  [12, 'Kennedy Center board votes to add Trump’s name', '-'],
  [13, 'Sen. John Kennedy grills nominee', '-'],
  [14, 'C.D.C. Website No Longer Rejects Possible Link Between Autism and Vaccines', 'rfk-hhs'],
  [15, 'Trump ties Tylenol to autism', 'rfk-hhs'],
  [16, 'Hegseth says Pentagon will investigate Israel leak', 'israel-gaza'], // Israel 75 beats Hegseth 90 (fronts file runs first)
  [17, 'RFK Stadium deal approved by DC council', '-'],
  [18, 'Kushner returns to Israel to save the Gaza ceasefire', 'israel-gaza'],
  [19, 'Kushner Board of Peace seat costs $1 billion', '-'],
  [20, 'Trump’s Name Joins Kennedy’s on Performing Arts Center’s Facade', '-'],
  [21, 'Witkoff says Iran deal is close', '-'],
  [22, 'Kushner and Witkoff push Gaza ceasefire deal', 'israel-gaza'],
  [23, 'Witkoff presents Ukraine peace deal', '-'],
  [24, 'Iran pushes back after Israeli strikes', '-'],
  [25, 'Iran pulls out of talks after Israel attack', '-'],
  [26, 'Tehran under pressure as Israel hits Fordow', 'israel-gaza'],
  [27, 'Israel issues urgent warning on Iran', '-'],
  [28, 'The Kushners’ Gulf windfall', 'kushners-deals'],
  [29, 'Sen. Kennedy grills Fed nominee', '-'],
  [30, 'Trump pressured by Netanyahu to strike Iran', 'israel-gaza'],
  [31, 'Israel lobbies Congress for more Iran strikes', 'israel-gaza'],
  [32, 'Kennedy, other Trump officials balk at requests to testify', '-'],
  [33, 'Witkoff family took $500 million from Abu Dhabi fund as Gaza talks stalled', 'kushners-deals'],
  [34, 'Trump urged Netanyahu to hold off on Iran strike', '-'],
  [35, 'Trump pushed back on Netanyahu’s Iran plan', '-'],
  [36, 'Netanyahu pulled back from Iran strike after Trump call', '-'],
  [37, 'Israel under pressure from Trump over Iran', '-'],
  [38, 'Kushner unveils $112 billion Gaza reconstruction plan', 'israel-gaza'],
  [39, 'Witkoff: Iran deal would unfreeze $6 billion', '-'],
  [40, 'Netanyahu pushes Trump toward Iran strike', 'israel-gaza'],
  [41, 'Israeli strike hits Tehran', 'israel-gaza'],
  [42, 'Israel pressured by Trump to accept Iran deal', '-'],
  [43, 'Hegseth fires the Army and Air Force JAGs', 'hegseth-pentagon'],
  [44, 'Pentagon NATO summit opens in Brussels', '-'],
];
// existing Kushner members filed by the August 24, 2026 'kushner' sweep (member gate)
const EXISTING = [[100, 'Kushner firm took Gulf money'], [101, 'Inside the Kushners’ Gulf windfall']];

let failures = 0;
const check = (ok, label) => { if (!ok) failures += 1; out(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };

async function makeDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  for (const [id, h] of CASES) await db.query('insert into public.stories(id,status,primary_headline) values ($1,$2,$3)', [id, 'active', h]);
  for (const [id, h] of EXISTING) {
    await db.query("insert into public.stories(id,status,primary_headline) values ($1,'active',$2)", [id, h]);
    await db.query("insert into public.story_event values ($1, 13, 'agent', 0.8)", [id]);
  }
  return db;
}
// Runs a file as one paste. No automatic ROLLBACK: a failure is followed by runbookRecover(), which
// checks the session really is stuck in the failed transaction and then does what the file header
// tells the operator to do (ROLLBACK; on its own).
async function run(db, sql) {
  try { await db.exec(sql); return null; } catch (e) { return e.message; }
}
async function runbookRecover(db, label) {
  let stuck = false;
  try { await db.query('select 1'); } catch (e) { stuck = /current transaction is aborted/.test(e.message); }
  check(stuck, `${label}: session is left in the failed transaction (why the header says ROLLBACK first)`);
  await db.exec('ROLLBACK;');
  let ok = true;
  try { await db.query('select 1'); } catch { ok = false; }
  check(ok, `${label}: ROLLBACK; recovers the session`);
}
const count = async (db, q) => Number((await db.query(q)).rows[0].n);

// 1. Fresh apply in the recommended order: fronts file, then Hegseth file.
out('fronts-sql-pglite');
{
  const db = await makeDb();
  check(await run(db, FRONTS) === null, 'ADO-595 file applies');
  check(await run(db, HEGSETH) === null, 'Hegseth file applies after it');
  const rows = (await db.query('select st.id, e.slug from public.stories st left join public.story_event se on se.story_id = st.id left join public.events e on e.id = se.event_id')).rows;
  const got = Object.fromEntries(rows.map((r) => [r.id, r.slug ?? '-']));
  const wrong = CASES.filter(([id, , want]) => got[id] !== want).map(([id, , want]) => `${id} got ${got[id]} want ${want}`);
  check(wrong.length === 0, `placement of ${CASES.length} headlines${wrong.length ? ': ' + wrong.join('; ') : ''}`);
  check(got[100] === 'kushners-deals' && got[101] === 'kushners-deals', 'existing Kushner members stay on the front');
  const outside = await count(db, `select count(*) n from public.story_event se join public.events e on e.id = se.event_id
    join public.stories st on st.id = se.story_id where e.agent_pattern is not null
    and not (coalesce(st.primary_headline,'') ~* e.agent_pattern or coalesce(st.summary_neutral,'') ~* e.agent_pattern)`);
  check(outside === 0, 'members_outside_pattern is 0 on every front');
  const meta = (await db.query("select slug, name, tier, alarm_level, publish_state from public.events where slug in ('kushners-deals','israel-gaza','rfk-hhs','hegseth-pentagon') order by slug")).rows;
  check(meta.map((m) => `${m.slug}:${m.tier}:${m.alarm_level}:${m.publish_state}`).join(' ') ===
    'hegseth-pentagon:flagship:5:published israel-gaza:major:4:published kushners-deals:major:4:published rfk-hhs:major:4:published',
    'tiers, alarms and publish state');
  check(meta.find((m) => m.slug === 'kushners-deals').name === "The Envoys' Deals", "kushners-deals renamed to The Envoys' Deals");

  // 2. Idempotent re-run
  const before = await count(db, 'select count(*) n from public.story_event');
  check(await run(db, FRONTS) === null && await run(db, HEGSETH) === null, 're-run of both files succeeds');
  check(await count(db, 'select count(*) n from public.story_event') === before, 're-run files nothing new');

  // 3. Rollback statements (from the ADO-595 file footer)
  await db.exec(String.raw`
    DELETE FROM public.events WHERE slug IN ('israel-gaza', 'rfk-hhs');
    UPDATE public.events SET name = 'Kushner''s Deals', tier = 'standard', alarm_level = 3,
           sweep_pattern = 'kushner', sweep_coword = NULL, agent_pattern = NULL WHERE slug = 'kushners-deals';
    DELETE FROM public.story_event se USING public.events e, public.stories st
     WHERE se.event_id = e.id AND st.id = se.story_id AND e.slug = 'kushners-deals'
       AND se.assigned_by = 'agent' AND st.primary_headline !~* 'kushner';`);
  const left = (await db.query("select se.story_id from public.story_event se join public.events e on e.id = se.event_id where e.slug = 'kushners-deals' order by 1")).rows.map((r) => r.story_id);
  check(left.join(',') === '1,28,100,101', `rollback leaves only headlines with "kushner" on the front (${left.join(',')})`);
  check(await count(db, "select count(*) n from public.events where slug in ('israel-gaza','rfk-hhs')") === 0, 'rollback removes the new fronts');
}

// 4. All-or-nothing: a failing refresh must leave no front and no assignment behind.
{
  const db = await makeDb();
  await db.exec("create or replace function public.refresh_tracker_derived() returns table(rows_changed int) language plpgsql as $$ begin raise exception 'refresh broke'; end $$;");
  const err = await run(db, FRONTS);
  check(err !== null && err.includes('refresh broke'), 'failing refresh stops the ADO-595 apply');
  await runbookRecover(db, 'failing refresh');
  check(await count(db, "select count(*) n from public.events where slug in ('israel-gaza','rfk-hhs')") === 0, 'no new front left behind');
  check(await count(db, 'select count(*) n from public.story_event') === EXISTING.length, 'no assignment left behind');
  check((await db.query("select name from public.events where slug='kushners-deals'")).rows[0].name === "Kushner's Deals", 'kushners-deals untouched');
}

// 5. Priority guards
{
  const db = await makeDb();
  await db.exec("insert into public.events(slug, name, sweep_pattern, sweep_priority) values ('squatter', 'S', 'zzz', 75)");
  const err = await run(db, FRONTS);
  check(err !== null && err.includes('sweep priority already taken by squatter at 75'), 'ADO-595 file refuses when 75 is taken');
  await runbookRecover(db, 'ADO-595 priority clash');
  check(await count(db, "select count(*) n from public.events where slug in ('israel-gaza','rfk-hhs')") === 0, 'nothing written on a priority clash');
}
{
  const db = await makeDb();
  await db.exec("insert into public.events(slug, name, sweep_pattern, sweep_priority) values ('late', 'L', 'zzz', 95)");
  const err = await run(db, HEGSETH);
  check(err !== null && err.includes('priority 90 or more (late at 95)'), 'Hegseth file refuses when another front sweeps at 90+');
  await runbookRecover(db, 'Hegseth priority clash');
  check(await count(db, "select count(*) n from public.events where slug = 'hegseth-pentagon'") === 0, 'Hegseth front not created on a clash');
}

// 6. Hand-edited kushners-deals is never overwritten
{
  const db = await makeDb();
  await db.exec("update public.events set dek = 'hand edit', sweep_pattern = 'kushner|witkoff' where slug = 'kushners-deals'");
  const err = await run(db, FRONTS);
  check(err !== null && err.includes('not the original kushner'), 'hand-edited kushners-deals makes the file stop');
  await runbookRecover(db, 'hand edit');
  const k = (await db.query("select dek from public.events where slug='kushners-deals'")).rows[0];
  check(k.dek === 'hand edit', 'hand edit kept');
}

out(failures ? `fronts-sql-pglite: ${failures} FAILED` : 'fronts-sql-pglite: all checks passed');
process.exit(failures ? 1 : 0);
