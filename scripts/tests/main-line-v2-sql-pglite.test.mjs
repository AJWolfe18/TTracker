// Runs migration 126 (ADO-594 S4: main-line rule v2) on PGlite (Postgres 17) against a minimal copy
// of the tracker schema with the REAL refresh_tracker_derived() and tracker_stats sliced out of
// migration 113, then migrations 122 (v1.3), 123 (action labels) and 126 in the order they ship.
// Checks: every rule v2 branch, v2 == v1.3 while nothing is labeled, the 40-story gold sample
// (PRD 14.3), the refresh's drop-off and tally still working, grants, idempotent re-run, and that
// 126 refuses to apply without 123.
// Not part of qa:smoke: @electric-sql/pglite is not a declared dependency, so the test SKIPS
// (exit 0) when it is missing. Run: node scripts/tests/main-line-v2-sql-pglite.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('main-line-v2-sql-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const read = (f) => fs.readFileSync(path.join(repo, 'migrations', f), 'utf8');
const M113 = read('113_tracker_precompute.sql');
const V13 = read('122_main_line_rule_v1_3.sql');
const LABELS = read('123_story_action_labels.sql');
const V2 = read('126_main_line_rule_v2.sql');
const GOLD = JSON.parse(fs.readFileSync(path.join(repo, 'scripts/tests/fixtures/action-label-gold.json'), 'utf8')).stories;

// Migration 113 PART B (tracker_stats) and PART D (refresh_tracker_derived), verbatim.
const slice = (from, to) => {
  const a = M113.indexOf(from); const b = M113.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error(`migration 113 marker not found: ${from} / ${to}`);
  return M113.slice(a, b);
};
const REAL_REFRESH = slice('-- PART B:', '-- PART C:') + slice('-- PART D:', '-- PART E:');

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(id bigserial primary key, slug text unique, name text, publish_state text,
  lifecycle text not null default 'open', main_line_alarm_floor smallint);
create table public.stories(id bigint primary key, status text not null default 'active', primary_headline text,
  summary_neutral text default 'summary', first_seen_at timestamptz not null default now(),
  alarm_level smallint, severity text, main_line boolean not null default false);
create table public.story_event(story_id bigint primary key references public.stories(id) on delete cascade,
  event_id bigint not null references public.events(id) on delete cascade);
create table public.tracker_pin(source text, entity_id text, pin text, primary key (source, entity_id));
create table public.scotus_cases(id bigint primary key, is_public boolean, decided_at date, ruling_impact_level smallint);
create table public.executive_orders(id bigint primary key, is_public boolean, date date, alarm_level smallint);
create table public.pardons(id bigint primary key, is_public boolean, pardon_date date, corruption_level smallint);
create view public.v_tracker_main_line_rule as select id, false as main_line from public.stories;
insert into public.events(id, slug, name, publish_state, lifecycle) values
  (1, 'iran', 'Iran', 'published', 'open'),
  (2, 'election-suppression', 'Election Suppression', 'published', 'open'),
  (3, 'ice-deportations', 'ICE & Deportations', 'published', 'open'),
  (9, 'draft-front', 'Draft', 'draft', 'open');
select setval('public.events_id_seq', 20);
insert into public.executive_orders values (1, true, now()::date, 5);
`;

// Rule v2 cases: [id, note, alarm_level, severity, front slug or '-', label, actor, pin, want]
const CASES = [
  // pins
  [1, 'coverage with force_show stays on', 1, null, '-', 'coverage', 'other', 'force_show', true],
  [2, 'did by trump at 5 with force_hide is off', 5, null, '-', 'did', 'trump', 'force_hide', false],
  // coverage
  [3, 'coverage front member at 5 goes off', 5, null, 'iran', 'coverage', 'administration', null, false],
  [4, 'coverage loose end by trump at 5 is off', 5, null, '-', 'coverage', 'trump', null, false],
  // front members (v1.3)
  [10, 'unlabeled front member at 4 on', 4, null, 'iran', null, null, null, true],
  [11, 'unlabeled front member at 3 off', 3, null, 'election-suppression', null, null, null, false],
  [12, 'said by trump front member at 4 on', 4, null, 'iran', 'said', 'trump', null, true],
  [13, 'did by other front member at 4 on (fronts take any actor)', 4, null, 'ice-deportations', 'did', 'other', null, true],
  [14, 'did by ally front member at 3 off', 3, null, 'iran', 'did', 'ally', null, false],
  [15, 'did by administration front member at 3 off (front bar is 4)', 3, null, 'election-suppression', 'did', 'administration', null, false],
  [16, 'front member, null alarm, severity severe, on', null, 'severe', 'iran', 'did', 'other', null, true],
  // unlabeled loose ends (v1.3)
  [20, 'unlabeled loose end at 5 stays on', 5, null, '-', null, null, null, true],
  [21, 'unlabeled loose end at 4 off', 4, null, '-', null, null, null, false],
  [22, 'unlabeled loose end, null alarm, severity critical, on', null, 'critical', '-', null, null, null, true],
  // labeled loose ends, his side
  [30, 'did by administration at 3 on', 3, null, '-', 'did', 'administration', null, true],
  [31, 'did by trump at 2 off', 2, null, '-', 'did', 'trump', null, false],
  [32, 'did by trump, null alarm, severity moderate, on', null, 'moderate', '-', 'did', 'trump', null, true],
  [33, 'said by trump at 3 off', 3, null, '-', 'said', 'trump', null, false],
  [34, 'said by trump at 4 on', 4, null, '-', 'said', 'trump', null, true],
  [35, 'said by administration at 5 on', 5, null, '-', 'said', 'administration', null, true],
  // labeled loose ends, not his side
  [40, 'ally did at 5 loose end goes off', 5, null, '-', 'did', 'ally', null, false],
  [41, 'other did at 5 loose end goes off', 5, null, '-', 'did', 'other', null, false],
  [42, 'other said at 5 loose end goes off', 5, null, '-', 'said', 'other', null, false],
  [43, 'label without actor at 5 loose end is off (unclear actor = other)', 5, null, '-', 'did', null, null, false],
  // unpublished front = loose end
  [50, 'draft-front member, did by administration at 3, on as a loose end', 3, null, 'draft-front', 'did', 'administration', null, true],
  [51, 'draft-front member, unlabeled at 4, off as a loose end', 4, null, 'draft-front', null, null, null, false],
  [52, 'draft-front member, ally did at 5, off as a loose end', 5, null, 'draft-front', 'did', 'ally', null, false],
];

// PRD 14.3 sample: TEST alarm levels (read October 4, 2026) and fronts as in the PRD table.
const GOLD_ALARM = {
  17254: 2, 17253: 2, 17252: 2, 17251: 2, 17250: 2, 17249: 2, 17248: 3, 17247: 2, 17246: 2, 17245: 4,
  17244: 2, 17243: 3, 17242: 2, 17241: 3, 17240: 4, 17239: 2, 17238: 2, 17237: 3, 17236: 2, 17235: 2,
  17234: 4, 17233: 3, 17232: 2, 17231: 3, 17230: 4, 17229: 3, 17228: 2, 17227: 2, 17226: 3, 17225: 2,
  17224: 2, 17223: 2, 17222: 2, 17221: 2, 17220: 2, 17219: 1, 17218: 4, 17217: 3, 17216: 3, 17215: 1,
};
const GOLD_FRONT = { 17245: 'election-suppression', 17231: 'election-suppression', 17234: 'iran' };
// Expected v2 on top of v1.3. Differs from the PRD's v2 column (written against v1.2) on two rows:
// 17234 is ON (front member at 4; D4 superseded by v1.3) and 17231 is OFF (alarm 3, floor retired).
const GOLD_ON = [17234, 17240, 17245];

let failures = 0;
const check = (ok, label) => { if (!ok) failures += 1; out(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`); };
const count = async (db, q) => Number((await db.query(q)).rows[0].n);
async function run(db, sql) { try { await db.exec(sql); return null; } catch (e) { return e.message; } }
// The migration's own last result set (its refresh), not a second refresh run afterwards.
const applyRefresh = async (db, sql) => (await db.exec(sql)).find((r) => r.fields[0]?.name === 'rows_changed')?.rows[0];
const mainLine = async (db) => Object.fromEntries((await db.query('select id, main_line from public.stories')).rows.map((r) => [r.id, r.main_line]));

async function baseDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(REAL_REFRESH);
  await db.exec(V13);
  await db.exec(LABELS);
  return db;
}
async function addStory(db, id, alarm, sev, front, label, actor, pin) {
  await db.query('insert into public.stories(id, primary_headline, alarm_level, severity) values ($1, $2, $3, $4)', [id, `story ${id}`, alarm, sev]);
  if (label || actor) await db.query('update public.stories set action_label = $2, action_actor = $3 where id = $1', [id, label, actor]);
  if (front !== '-') await db.query('insert into public.story_event select $1, id from public.events where slug = $2', [id, front]);
  if (pin) await db.query("insert into public.tracker_pin values ('stories', $1, $2)", [String(id), pin]);
}

out('main-line-v2-sql-pglite');

// 1. 126 needs 123's columns: refuses cleanly without them.
{
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(REAL_REFRESH);
  await db.exec(V13);
  const err = await run(db, V2);
  check(err !== null && /action_label/.test(err), 'migration 126 refuses to apply before 123');
  await db.exec('ROLLBACK;');
  const def = (await db.query("select pg_get_viewdef('public.v_tracker_main_line_rule') as d")).rows[0].d;
  check(!/action_label/.test(def), 'failed apply leaves the v1.3 view in place');
  await db.close();
}

// 2. Every rule v2 branch
{
  const db = await baseDb();
  for (const [id, , a, sev, front, label, actor, pin] of CASES) await addStory(db, id, a, sev, front, label, actor, pin);
  // outside the view: a closed story that was on the line, and an unenriched one
  await db.exec("insert into public.stories(id, status, alarm_level, main_line) values (90, 'closed', 5, true)");
  await db.exec("insert into public.stories(id, summary_neutral, alarm_level) values (91, null, 5)");

  check(await run(db, V2) === null, 'migration 126 applies');
  const ml = await mainLine(db);
  const wrong = CASES.filter(([id, , , , , , , , want]) => ml[id] !== want).map(([id, note]) => `${id} (${note}) = ${ml[id]}`);
  check(wrong.length === 0, `rule v2 on ${CASES.length} cases${wrong.length ? ': ' + wrong.join('; ') : ''}`);
  for (const [id, note, , , , , , , want] of CASES.filter(([id]) => [1, 3, 20, 30, 33, 34, 40, 50].includes(id))) {
    check(ml[id] === want, `${note}`);
  }
  check(ml[90] === false && ml[91] === false, 'closed story drops off, unenriched story stays off (real refresh step 2)');
  const stats = (await db.query('select developments, alarm5_last30, open_fronts from public.tracker_stats where id = 1')).rows[0];
  check(stats && stats.open_fronts === 3 && stats.alarm5_last30 >= 1, `real refresh still writes the tally (${JSON.stringify(stats)})`);

  const comment = (await db.query("select obj_description('public.v_tracker_main_line_rule'::regclass) as c")).rows[0].c;
  check(/v2, migration 126/.test(comment), 'view comment names rule v2');
  const anon = (await db.query("select has_table_privilege('anon', 'public.v_tracker_main_line_rule', 'select') as g")).rows[0].g;
  const svc = (await db.query("select has_table_privilege('service_role', 'public.v_tracker_main_line_rule', 'select') as g")).rows[0].g;
  check(anon === false && svc === true, 'view is service_role only');

  // 3. Idempotent re-run: same result, nothing rewritten
  const again = await applyRefresh(db, V2);
  check(Object.keys(again)[0] === 'rows_changed' && again.rows_changed === 0, `re-run first column rows_changed = 0 (${JSON.stringify(again)})`);
  const ml2 = await mainLine(db);
  check(CASES.every(([id]) => ml2[id] === ml[id]), 're-run leaves every flag as it was');

  // 4. Labels arriving later move a row at the next refresh (no migration needed)
  await db.exec("update public.stories set action_label = 'coverage', action_actor = 'administration' where id = 10");
  await db.exec("update public.stories set action_label = 'did', action_actor = 'other' where id = 20");
  await db.exec("update public.stories set action_label = 'did', action_actor = 'administration' where id = 21");
  await db.query('select * from public.refresh_tracker_derived()');
  const ml3 = await mainLine(db);
  check(ml3[10] === false && ml3[20] === false && ml3[21] === true, 'backfilled labels take effect on the next refresh');
  await db.close();
}

// 5. Nothing labeled: v2 gives exactly v1.3's result
{
  const db = await baseDb();
  for (const [id, , a, sev, front, , , pin] of CASES) await addStory(db, id, a, sev, front, null, null, pin);
  await db.query('select * from public.refresh_tracker_derived()');
  const v13 = await mainLine(db);
  const first = await applyRefresh(db, V2);
  check(first !== undefined, 'migration 126 applies on unlabeled data and returns the refresh row');
  const v2 = await mainLine(db);
  const diff = CASES.filter(([id]) => v13[id] !== v2[id]).map(([id]) => id);
  check(diff.length === 0 && first.rows_changed === 0, `unlabeled rows: v2 == v1.3 on ${CASES.length} cases${diff.length ? ', differs on ' + diff.join(',') : ''}`);
  await db.close();
}

// 6. PRD 14.3 gold sample, labeled with the gold set
{
  const db = await baseDb();
  for (const g of GOLD) await addStory(db, g.id, GOLD_ALARM[g.id], null, GOLD_FRONT[g.id] ?? '-', g.action_label, g.action_actor, null);
  check(GOLD.length === 40 && GOLD.every((g) => GOLD_ALARM[g.id] !== undefined), 'gold fixture has the 40 PRD stories');
  check(await run(db, V2) === null, 'migration 126 applies on the gold sample');
  const ml = await mainLine(db);
  const on = GOLD.filter((g) => ml[g.id]).map((g) => g.id).sort();
  check(JSON.stringify(on) === JSON.stringify(GOLD_ON), `gold sample on the main line: ${on.join(', ')} (want ${GOLD_ON.join(', ')})`);
  check(ml[17240] === true, '17240 did/administration at 4, loose end in the PRD snapshot: on');
  check(ml[17216] === false, '17216 said/trump at 3: off (said bar is 4)');
  check(ml[17245] === true, '17245 did/other at 4 on the Election front: on');
  check(ml[17231] === false, '17231 did/administration at 3 on the Election front: off under v1.3 (PRD v2 column said yes via the retired floor)');
  check(ml[17230] === false && ml[17218] === false, '17230 and 17218 did/other at 4, loose ends: off');
  // On TEST today 17240 sits on the ICE front: same outcome
  await db.exec("insert into public.story_event select 17240, id from public.events where slug = 'ice-deportations'");
  await db.query('select * from public.refresh_tracker_derived()');
  check((await mainLine(db))[17240] === true, '17240 as an ICE front member at 4 (TEST today): on');
  check(await count(db, 'select count(*) n from public.stories where main_line') === 3, 'gold sample main line is 3 stories');
  await db.close();
}

out(failures ? `main-line-v2-sql-pglite: ${failures} FAILED` : 'main-line-v2-sql-pglite: all checks passed');
process.exit(failures ? 1 : 0);
