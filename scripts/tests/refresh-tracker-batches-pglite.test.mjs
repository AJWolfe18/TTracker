// Runs migration 136 (ADO-638: refresh_tracker_derived in batches) on PGlite (Postgres 17) against a
// minimal tracker schema with the REAL 113 tracker_stats + refresh_tracker_derived() sliced out of
// migration 113, then 136 on top. The rule view is stubbed by a table, so any target flags can be set.
// Checks: a batched drain ends exactly where the old one-shot refresh ends (rule rows + drop-offs +
// tally); newest ids go first; more_pending is honest; the no-argument call is the old behaviour;
// a bad batch size is refused; grants; idempotent re-run; and the verify query.
// Skips (exit 0) when @electric-sql/pglite is missing (not a declared dependency).
// Run: node scripts/tests/refresh-tracker-batches-pglite.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = (s) => process.stdout.write(`${s}\n`);

let PGlite;
try {
  ({ PGlite } = await import(pathToFileURL(path.join(repo, 'node_modules/@electric-sql/pglite/dist/index.js')).href));
} catch {
  out('refresh-tracker-batches-pglite: SKIP (@electric-sql/pglite not installed)');
  process.exit(0);
}

const read = (f) => fs.readFileSync(path.join(repo, 'migrations', f), 'utf8');
const M113 = read('113_tracker_precompute.sql');
const M136 = read('136_refresh_tracker_batches.sql');
const slice = (from, to) => {
  const a = M113.indexOf(from); const b = M113.indexOf(to);
  if (a < 0 || b < 0 || b <= a) throw new Error(`migration 113 marker not found: ${from} / ${to}`);
  return M113.slice(a, b);
};
const REAL_113 = slice('-- PART B:', '-- PART C:') + slice('-- PART D:', '-- PART E:');

const SCHEMA = String.raw`
create role anon; create role authenticated; create role service_role;
create table public.events(id bigserial primary key, publish_state text, lifecycle text not null default 'open');
create table public.stories(id bigint primary key, status text not null default 'active',
  summary_neutral text default 'summary', first_seen_at timestamptz not null default now(),
  alarm_level smallint, severity text, main_line boolean not null default false);
create table public.scotus_cases(id bigint primary key, is_public boolean, decided_at date, ruling_impact_level smallint);
create table public.executive_orders(id bigint primary key, is_public boolean, date date, alarm_level smallint);
create table public.pardons(id bigint primary key, is_public boolean, pardon_date date, corruption_level smallint);
-- Stub rule: the target flag per in-scope story, set by the test.
create table public.rule_truth(id bigint primary key, main_line boolean not null);
create view public.v_tracker_main_line_rule as select id, main_line from public.rule_truth;
insert into public.events(publish_state, lifecycle) values ('published', 'open'), ('published', 'resolved');
insert into public.executive_orders values (1, true, now()::date, 5);
`;

// 400 active stories with target flags; 330 differ from the stored flag. Plus 25 out-of-scope stories
// (closed or unenriched) still flagged on, which must drop off. Total pending = 355.
const SEED = String.raw`
insert into public.stories(id, alarm_level, main_line)
  select g, (g % 5) + 1, (g % 6 = 0) from generate_series(1, 400) g;
insert into public.rule_truth(id, main_line)
  select g, (g % 6 = 0) <> (g % 40 < 33) from generate_series(1, 400) g;
insert into public.stories(id, status, summary_neutral, main_line)
  select g, case when g % 2 = 0 then 'closed' else 'active' end,
         case when g % 2 = 0 then 'summary' else null end, true
    from generate_series(1001, 1025) g;
`;

async function fresh({ with136 = true } = {}) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(REAL_113);
  await db.exec(SEED);
  if (with136) await db.exec(M136);
  return db;
}
const flags = async (db) => (await db.query('select id, main_line from public.stories order by id')).rows.map((r) => `${r.id}:${r.main_line}`).join(',');
const stats = async (db) => (await db.query('select developments, alarm5_last30, open_fronts from public.tracker_stats where id = 1')).rows[0];
const pending = async (db) => Number((await db.query(`select
  (select count(*) from public.stories s join public.rule_truth r using (id) where s.main_line is distinct from r.main_line)
  + (select count(*) from public.stories where main_line and not (status = 'active' and summary_neutral is not null)) as n`)).rows[0].n);
const call = async (db, n) => (await db.query(n === undefined
  ? 'select * from public.refresh_tracker_derived()'
  : 'select * from public.refresh_tracker_derived($1)', n === undefined ? [] : [n])).rows[0];

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; out(`  ok  ${name}`); }
  catch (e) { out(`  FAIL ${name}`); throw e; }
};

// Reference end state: the OLD 113 function, one shot.
const ref = await fresh({ with136: false });
assert.equal(await pending(ref), 355, 'seed should leave 355 pending changes');
const refRow = (await ref.query('select * from public.refresh_tracker_derived()')).rows[0];
const REF_FLAGS = await flags(ref);
const REF_STATS = await stats(ref);

await test('old 113 one-shot changes all 355 rows (reference)', async () => {
  assert.equal(refRow.rows_changed, 355);
  assert.equal(await pending(ref), 0);
});

await test('batched drain (37 per call) ends exactly where the one-shot refresh ends', async () => {
  const db = await fresh();
  let total = 0; let calls = 0; let row;
  do { row = await call(db, 37); total += row.rows_changed; calls += 1; assert.ok(row.rows_changed <= 37); } while (row.more_pending && calls < 50);
  assert.equal(total, 355);
  assert.equal(calls, 10, '355 rows at 37 per call = 9 full batches + 1 partial');
  assert.equal(row.more_pending, false);
  assert.equal(await flags(db), REF_FLAGS);
  assert.deepEqual(await stats(db), REF_STATS);
});

await test('newest story ids go first; the batch spills into drop-offs only when rule rows run out', async () => {
  const db = await fresh();
  const before = (await db.query('select s.id from public.stories s join public.rule_truth r using (id) where s.main_line <> r.main_line order by s.id desc limit 10')).rows.map((r) => r.id);
  const row = await call(db, 10);
  assert.equal(row.rows_changed, 10);
  assert.equal(row.more_pending, true);
  const changed = (await db.query('select s.id from public.stories s join public.rule_truth r using (id) where s.main_line = r.main_line and s.id = any($1)', [before])).rows.length;
  assert.equal(changed, 10, 'the 10 highest pending rule ids were the ones changed');
  // Drain the 330 rule rows exactly, then the drop-offs come next.
  const rest = await call(db, 320);
  assert.equal(rest.rows_changed, 320);
  assert.equal(Number((await db.query('select count(*) n from public.stories where main_line and not (status = \'active\' and summary_neutral is not null)')).rows[0].n), 25);
  const spill = await call(db, 30);
  assert.equal(spill.rows_changed, 25, 'all 25 drop-offs in one batch of 30');
  assert.equal(spill.more_pending, false);
});

await test('exactly-full last batch reports more_pending, the next call returns 0 and false', async () => {
  const db = await fresh();
  const a = await call(db, 355);
  assert.equal(a.rows_changed, 355);
  assert.equal(a.more_pending, true);
  const b = await call(db, 355);
  assert.equal(b.rows_changed, 0);
  assert.equal(b.more_pending, false);
});

await test('no-argument call is the old behaviour: everything at once, more_pending false', async () => {
  const db = await fresh();
  const row = await call(db);
  assert.equal(row.rows_changed, 355);
  assert.equal(row.more_pending, false);
  assert.equal(await flags(db), REF_FLAGS);
  assert.deepEqual(await stats(db), REF_STATS);
  const again = await call(db);
  assert.equal(again.rows_changed, 0, 'steady state touches nothing');
});

await test('the tally refreshes on every batch call', async () => {
  const db = await fresh();
  await db.exec('delete from public.tracker_stats');
  await call(db, 5);
  assert.deepEqual(await stats(db), REF_STATS, 'tally counts do not depend on main_line');
});

await test('batch size 0 or negative is refused with 22023', async () => {
  const db = await fresh();
  for (const n of [0, -5]) {
    await assert.rejects(call(db, n), (e) => e.code === '22023' && /p_max_rows/.test(e.message));
  }
  assert.equal(await pending(db), 355, 'nothing changed');
});

await test('grants: service_role only; anon and authenticated cannot execute', async () => {
  const db = await fresh();
  const q = async (role) => (await db.query(`select has_function_privilege('${role}', 'public.refresh_tracker_derived(integer)', 'execute') as ok`)).rows[0].ok;
  assert.equal(await q('service_role'), true);
  assert.equal(await q('anon'), false);
  assert.equal(await q('authenticated'), false);
});

await test('re-running 136 is idempotent and the verify query reports one 1-argument function', async () => {
  const db = await fresh();
  const res = await db.exec(M136);
  const verify = res.find((r) => r.fields[0]?.name === 'refresh_fn')?.rows[0];
  assert.deepEqual(verify, { refresh_fn: 1, batch_arg: 1 });
  const n = Number((await db.query("select count(*) n from pg_proc where proname = 'refresh_tracker_derived'")).rows[0].n);
  assert.equal(n, 1);
});

out(`refresh-tracker-batches-pglite: ${passed} passed`);
