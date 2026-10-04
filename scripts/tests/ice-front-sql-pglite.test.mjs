// Runs the two ADO-608 hand-pasted SQL files end to end on PGlite (Postgres 17) against a minimal
// copy of the tracker schema (events, stories, story_event, tracker_pin + a real refresh):
//   migrations/122_main_line_rule_v1_3.sql                (main-line rule v1.3)
//   scripts/maintenance/2026-10-03-ado-608-ice-front.sql  (ICE & Deportations front)
// Checks: every rule v1.3 branch, ICE headline placement next to competing fronts, idempotent
// re-run, all-or-nothing apply, the priority and existing-slug guards, and the rollback.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/ice-front-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('ice-front-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const RULE = fs.readFileSync(path.join(repo, 'migrations/122_main_line_rule_v1_3.sql'), 'utf8');
const ICE = fs.readFileSync(path.join(repo, 'scripts/maintenance/2026-10-03-ado-608-ice-front.sql'), 'utf8');

// refresh_tracker_derived mirrors migration 113's main_line write (the tally part is not needed).
const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(
  id bigserial primary key, slug text unique, name text, dek text, alarm_level smallint, tier text,
  lifecycle text default 'open', publish_state text, published_at timestamptz, started_at timestamptz,
  created_by text, sweep_pattern text, sweep_coword text, sweep_priority smallint not null default 100,
  sweep_summary boolean not null default false, main_line_alarm_floor smallint, agent_pattern text,
  updated_at timestamptz);
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
insert into public.events(id, slug, name, alarm_level, tier, publish_state, sweep_pattern, sweep_coword, sweep_priority, sweep_summary, main_line_alarm_floor) values
 (14,'election-suppression','Election Suppression',5,'flagship','published','(voter roll|polls?|polling)','(election|vote|voter|voting|ballot|midterm|poll)',50,true,3),
 (12,'the-courts','The Courts',4,'major','published','(contempt|def(y|ies|ied|iance))','(judge|court)',70,false,null),
 (8,'iran','Iran',5,'flagship','published','\miran(ian)?\M','^(?!.*iranian revolution)',80,false,null),
 (30,'draft-front','Draft',4,'major','draft','zzzdraft',null,95,false,null);
select setval('public.events_id_seq', 40);
`;

// Rule v1.3 cases: [id, headline, alarm_level, severity, front slug or '-', pin or null, want main_line]
const RULE_CASES = [
  [1, 'loose end at 4', 4, null, '-', null, false],
  [2, 'loose end at 5', 5, null, '-', null, true],
  [3, 'front member at 3 (was on via the election floor)', 3, null, 'election-suppression', null, false],
  [4, 'front member at 4, not a new peak', 4, null, 'iran', null, true],
  [5, 'front opening at 2 (was on as the opening)', 2, null, 'the-courts', null, false],
  [6, 'front member with null alarm, severity severe', null, 'severe', 'iran', null, true],
  [7, 'front member with null alarm, severity moderate', null, 'moderate', 'iran', null, false],
  [8, 'draft front member at 4 counts as a loose end', 4, null, 'draft-front', null, false],
  [9, 'force_show at 1', 1, null, '-', 'force_show', true],
  [10, 'force_hide at 5 in a front', 5, null, 'iran', 'force_hide', false],
  [11, 'Iran strikes at 5', 5, null, 'iran', null, true],
];
// ICE placement cases (no front yet): [id, headline, want slug or '-']
const ICE_CASES = [
  [101, 'ICE agent shoots and wounds man at traffic stop in Austin, Texas', 'ice-deportations'],
  [102, 'Trump’s deportations to third countries violate human rights, UN experts warn', 'ice-deportations'],
  [103, 'ICE Deportees Are Vanishing Into Salvadoran Prisons', 'ice-deportations'],
  [104, 'Alligator Alcatraz held detainees in cages the size of phone booths', 'ice-deportations'],
  [105, 'Supreme Court lets Trump continue deporting people to 3rd countries', 'ice-deportations'],
  [106, 'Stephen Miller leads push to accelerate removal of migrant children', 'ice-deportations'],
  [107, 'Justice Department Scraps Dozens of School Desegregation Cases', '-'],
  [108, 'Service members told to vote as Pentagon office closes', '-'],
  [109, 'Ice storm knocks out power across North Texas', '-'],
  [110, 'Hockey legend endorses Senate candidate', '-'],
  [111, 'FBI raids Bolton home in classified documents probe', '-'],
  // 112-114 match ICE AND a front that wins the overlap: the targeted sweep leaves them unfiled
  // (their own front's sweep files them), so ICE must not take them
  [112, 'Ban ICE from polls now, civil rights groups argue', '-'],
  [113, 'Appeals court signals support for contempt inquiry on deportation flights', '-'],
  [114, 'Iran deports Afghan migrants after US strikes', 'ice-deportations'], // ICE (72) beats Iran (80)
  [119, 'Iran says US strikes killed 40', '-'],
  [115, 'Trump officials ignore court order on asylum seekers', 'ice-deportations'],
  [116, 'Masked agents detain student outside Tufts', 'ice-deportations'],
  [117, 'Immigration judges fired in latest purge', 'ice-deportations'],
  [118, 'Nonimmigrant visa fee hike takes effect', '-'],
  // weather/sports "ice" only excludes a headline with no immigration word (code review, October 3)
  [120, 'Ice Cube slams ICE raids', 'ice-deportations'],
  [121, 'Judge puts ICE detention expansion on ice', 'ice-deportations'],
  [122, 'Noem on thin ice as ICE raids draw backlash', 'ice-deportations'],
  [123, 'Hockey star detained by ICE at the airport', 'ice-deportations'],
  [124, 'Ice storm warning: ICE says Texas offices close Friday', '-'],
  // generic words alone (border, agents, arrests, raids) do not rescue weather/sports "ice" (review round 2)
  [125, 'Ice storm closes border crossings in Maine', '-'],
  [126, 'Sea ice retreat sparks Arctic border dispute', '-'],
  [127, "Hockey free agents: who's still on ice", '-'],
  [128, 'Ice storm grounds ICE agents in Minneapolis', 'ice-deportations'],
];
const ALREADY = [[150, 'Deportation flights land as judge weighs contempt', 'the-courts']]; // filed earlier, must not move

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
  const slugId = async (slug) => (await db.query('select id from public.events where slug = $1', [slug])).rows[0].id;
  for (const [id, h, a, sev, front, pin] of RULE_CASES) {
    await db.query('insert into public.stories(id, primary_headline, alarm_level, severity) values ($1,$2,$3,$4)', [id, h, a, sev]);
    if (front !== '-') await db.query("insert into public.story_event values ($1, $2, 'human', 1)", [id, await slugId(front)]);
    if (pin) await db.query("insert into public.tracker_pin values ('stories', $1, $2)", [String(id), pin]);
  }
  for (const [id, h] of ICE_CASES) await db.query('insert into public.stories(id, primary_headline, alarm_level) values ($1,$2,4)', [id, h]);
  for (const [id, h, front] of ALREADY) {
    await db.query('insert into public.stories(id, primary_headline, alarm_level) values ($1,$2,4)', [id, h]);
    await db.query("insert into public.story_event values ($1, $2, 'agent', 0.8)", [id, await slugId(front)]);
  }
  // an inactive and an unenriched story at 5: outside the view, main_line never written
  await db.exec("insert into public.stories(id, status, primary_headline, alarm_level) values (200,'closed','closed at 5',5)");
  await db.exec("insert into public.stories(id, primary_headline, summary_neutral, alarm_level) values (201,'unenriched at 5',null,5)");
  return db;
}
const placement = async (db) => Object.fromEntries((await db.query(
  'select st.id, e.slug from public.stories st left join public.story_event se on se.story_id = st.id left join public.events e on e.id = se.event_id')).rows
  .map((r) => [r.id, r.slug ?? '-']));

out('ice-front-sql-pglite');
{
  const db = await makeDb();
  // 1. Rule v1.3
  check(await run(db, RULE) === null, 'migration 122 applies');
  const ml = Object.fromEntries((await db.query('select id, main_line from public.stories')).rows.map((r) => [r.id, r.main_line]));
  const wrong = RULE_CASES.filter(([id, , , , , , want]) => ml[id] !== want).map(([id, h]) => `${id} (${h}) = ${ml[id]}`);
  check(wrong.length === 0, `rule v1.3 on ${RULE_CASES.length} cases${wrong.length ? ': ' + wrong.join('; ') : ''}`);
  check(ml[200] === false && ml[201] === false, 'closed and unenriched stories stay off');
  check(await count(db, 'select count(*) n from public.events where main_line_alarm_floor is not null') === 0, 'election floor cleared');
  check(await run(db, RULE) === null, 'migration 122 re-run succeeds');

  // 2. ICE front
  check(await run(db, ICE) === null, 'ICE front file applies');
  const got = await placement(db);
  const bad = [...ICE_CASES, ...ALREADY].filter(([id, , want]) => got[id] !== want).map(([id, , want]) => `${id} got ${got[id]} want ${want}`);
  check(bad.length === 0, `placement of ${ICE_CASES.length + ALREADY.length} headlines${bad.length ? ': ' + bad.join('; ') : ''}`);
  check(got[3] === 'election-suppression' && got[4] === 'iran', 'existing members untouched');
  const ice = (await db.query("select name, tier, alarm_level, publish_state, sweep_priority, main_line_alarm_floor from public.events where slug = 'ice-deportations'")).rows[0];
  check(ice && ice.name === 'ICE & Deportations' && ice.tier === 'flagship' && ice.alarm_level === 5 && ice.publish_state === 'published'
    && ice.sweep_priority === 72 && ice.main_line_alarm_floor === null, 'front row values');
  check(await count(db, `select count(*) n from public.story_event se join public.events e on e.id = se.event_id
    join public.stories st on st.id = se.story_id where e.slug = 'ice-deportations'
    and not (coalesce(st.primary_headline,'') ~* e.agent_pattern or coalesce(st.summary_neutral,'') ~* e.agent_pattern)`) === 0,
    'members_outside_pattern is 0');
  check(await count(db, "select count(*) n from public.stories where id = 101 and main_line") === 1, 'ICE member at alarm 4 is on the main line after the refresh');

  // 3. Idempotent re-run
  const before = await count(db, 'select count(*) n from public.story_event');
  check(await run(db, ICE) === null, 'ICE file re-run succeeds');
  check(await count(db, 'select count(*) n from public.story_event') === before, 're-run files nothing new');

  // 4. Rollback (file footer)
  await db.exec("BEGIN; DELETE FROM public.events WHERE slug = 'ice-deportations'; SELECT * FROM public.refresh_tracker_derived(); COMMIT;");
  const after = await placement(db);
  check(ICE_CASES.filter(([, , w]) => w === 'ice-deportations').every(([id]) => after[id] === '-'), 'rollback returns every ICE story to no front');
  check(await count(db, 'select count(*) n from public.stories where id = 101 and main_line') === 0, 'rollback takes them off the main line');
}

// 5. All-or-nothing: a failing refresh leaves no front and no assignment behind.
{
  const db = await makeDb();
  await db.exec("create or replace function public.refresh_tracker_derived() returns table(rows_changed int) language plpgsql as $$ begin raise exception 'refresh broke'; end $$;");
  const err = await run(db, ICE);
  check(err !== null && err.includes('refresh broke'), 'failing refresh stops the ICE apply');
  await runbookRecover(db, 'failing refresh');
  check(await count(db, "select count(*) n from public.events where slug = 'ice-deportations'") === 0, 'no front left behind');
  const err2 = await run(db, RULE);
  check(err2 !== null && err2.includes('refresh broke'), 'failing refresh stops migration 122');
  await runbookRecover(db, 'migration 122 failing refresh');
  check(await count(db, "select count(*) n from public.events where main_line_alarm_floor = 3") === 1, 'migration 122 changed nothing (floor kept)');
}

// 6. Guards
{
  const db = await makeDb();
  await db.exec("insert into public.events(slug, name, sweep_pattern, sweep_priority) values ('squatter', 'S', 'zzz', 72)");
  const err = await run(db, ICE);
  check(err !== null && err.includes('sweep priority 72 already taken by squatter'), 'refuses when 72 is taken');
  await runbookRecover(db, 'priority clash');
  check(await count(db, "select count(*) n from public.events where slug = 'ice-deportations'") === 0, 'nothing written on a clash');
}
{
  const db = await makeDb();
  await db.exec("insert into public.events(slug, name, dek, sweep_pattern, sweep_priority) values ('ice-deportations', 'ICE', 'hand edit', 'ice', 99)");
  const err = await run(db, ICE);
  check(err !== null && err.includes('already exists with different values'), 'refuses to overwrite a hand-edited front');
  await runbookRecover(db, 'existing slug');
  check((await db.query("select dek from public.events where slug = 'ice-deportations'")).rows[0].dek === 'hand edit', 'hand edit kept');
}

out(failures ? `ice-front-sql-pglite: ${failures} FAILED` : 'ice-front-sql-pglite: all checks passed');
process.exit(failures ? 1 : 0);
