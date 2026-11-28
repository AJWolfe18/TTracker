// Migration 138 (ADO-642: the main line moves to tracker_main_line) on PGlite (Postgres 17) with
// the realistic dataset of fixtures/tracker-dataset.mjs, on top of 136 + 137.
// Checks: the backfill copies today's main line; the homepage queries return the same stories in
// the same order, as anon, through an index-driven plan with no sort; a refresh writes the side
// table and never stories (no new row versions, no trigger calls) yet ends where 137 ends; batches
// are newest first with honest more_pending; delete cascades; grants and RLS; on_main_line; re-run.
// Skips (exit 0) when @electric-sql/pglite is missing (not a declared dependency).
// Run: node scripts/tests/tracker-main-line-table-pglite.test.mjs
import assert from 'node:assert/strict';
import { migration, pgliteOrSkip, testRunner } from './fixtures/pglite.mjs';
import { trackerDb, makeDrift, plan, refresh, timeQuery } from './fixtures/tracker-dataset.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const PGlite = await pgliteOrSkip('tracker-main-line-table-pglite');
const { test, passed } = testRunner(out);

const M137 = migration('137_refresh_tracker_diff_plan.sql');
const M138 = migration('138_tracker_main_line_table.sql');

// The stories queries src/lib/timeline.ts sends (buildSourcePath), as plain SQL.
const homepage = (where) => `SELECT id, primary_headline, first_seen_at, alarm_level, severity, front_name, front_slug
  FROM public.v_tracker_stories
 WHERE first_seen_at >= '2025-01-20' AND ${where}
 ORDER BY first_seen_at DESC, id DESC LIMIT 60`;
const afterCursor = (c) => `(first_seen_at < '${c.first_seen_at.toISOString()}'
  OR (first_seen_at = '${c.first_seen_at.toISOString()}' AND id < ${c.id}))`;

const rows = async (db, sql) => (await db.query(sql)).rows;
const ids = async (db, sql) => (await db.query(sql)).rows.map((r) => Number(r.id));
const SIDE_IDS = 'select story_id as id from public.tracker_main_line order by 1';
// 137's answer: stories flagged on and in scope (out-of-scope rows are never on the homepage).
const FLAG_IDS = `select id from public.stories
  where main_line and status = 'active' and summary_neutral is not null order by 1`;
const versions = async (db) => (await db.query(
  "select md5(string_agg(id || ':' || xmin::text || ':' || main_line, ',' order by id)) as h from public.stories")).rows[0].h;

// Today's PROD shape: 136 + 137, refreshed, nothing pending.
const before = await trackerDb(PGlite);
await before.exec(M137);
const after = await before.clone();
const applied = await after.exec(M138);

// The cursor of a deep page: 25 pages of 60 into the main line.
const deep = (await before.query(`select first_seen_at, id from public.stories
  where main_line and status = 'active' and summary_neutral is not null
  order by first_seen_at desc, id desc offset 1499 limit 1`)).rows[0];
const QUERIES = {
  'main line, page 1': homepage('main_line IS TRUE'),
  'main line, page 26': homepage(`main_line IS TRUE AND ${afterCursor(deep)}`),
  'main line, Did only': homepage("main_line IS TRUE AND (action_label IS NULL OR action_label IN ('did'))"),
  'alarm 4+, page 1': homepage("(alarm_level >= 4 OR (alarm_level IS NULL AND severity IN ('critical','severe')))"),
};

await test('backfill copies the main line as it is now; verify query', async () => {
  assert.deepEqual(await ids(after, SIDE_IDS), await ids(before, 'select id from public.stories where main_line order by 1'));
  const { side_rows, on_stories, ...checks } = applied.find((r) => r.fields[0]?.name === 'side_rows')?.rows[0];
  assert.equal(side_rows, on_stories);
  assert.ok(side_rows > 1000);
  assert.deepEqual(checks, { spine_index: true, old_index: false, anon_can_call: false, service_can_call: true });
});

await test('homepage queries return the same stories in the same order, read as anon', async () => {
  for (const [name, sql] of Object.entries(QUERIES)) {
    const want = await rows(before, sql);
    assert.equal(want.length, 60, `${name}: a full page`);
    await after.exec('set role anon');
    try {
      assert.deepEqual(await rows(after, sql), want, name);
    } finally {
      await after.exec('reset role');
    }
  }
});

await test('homepage plans are index-driven: spine index in page order, no sort, no stories seq scan', async () => {
  for (const [name, sql] of Object.entries(QUERIES)) {
    const p = await plan(after, sql);
    assert.match(p, /Index (Only )?Scan using idx_stories_tracker_spine on stories/, `${name}\n${p}`);
    assert.doesNotMatch(p, /Sort/, `${name}\n${p}`);
    assert.doesNotMatch(p, /Seq Scan on stories/, `${name}\n${p}`);
  }
  const ms = {
    before: await timeQuery(before, QUERIES['main line, page 1'], [], 5),
    after: await timeQuery(after, QUERIES['main line, page 1'], [], 5),
  };
  out(`      page 1 ms: before=${ms.before.toFixed(1)} after=${ms.after.toFixed(1)}`);
});

// src/lib/timeline.ts cursor pages, with and without the first_seen_at <= cursor bound it adds
// (implied by the cursor OR, so it may change the plan but never the rows).
const cursorPage = (c, bounded) => homepage(c === null ? 'main_line IS TRUE'
  : `main_line IS TRUE${bounded ? ` AND first_seen_at <= '${c.first_seen_at.toISOString()}'` : ''} AND ${afterCursor(c)}`);
async function walkMainLine(db, bounded) {
  const pages = [];
  let cursor = null;
  for (;;) {
    const page = await rows(db, cursorPage(cursor, bounded));
    if (page.length) pages.push(page.map((r) => r.id));
    if (page.length < 60) return pages;
    cursor = page[59];
  }
}

await test('cursor bound: every page identical with and without it, ties included, before and after 138', async () => {
  for (const [label, source] of [['137 only', before], ['138', after]]) {
    const db = await source.clone();
    // Six stories share one timestamp across the boundary of pages 1 and 2 (rows 58-63).
    const tie = await rows(db, `${homepage('main_line IS TRUE').replace('LIMIT 60', 'OFFSET 57 LIMIT 6')}`);
    await db.query('update public.stories set first_seen_at = $1 where id = any($2)',
      [tie[0].first_seen_at, tie.map((r) => r.id)]);
    const plain = await walkMainLine(db, false);
    const bounded = await walkMainLine(db, true);
    assert.deepEqual(bounded, plain, `${label}: same pages`);
    const all = (await rows(db, homepage('main_line IS TRUE').replace('LIMIT 60', ''))).map((r) => r.id);
    assert.deepEqual(bounded.flat(), all, `${label}: no gaps or duplicates across ${bounded.length} pages`);
    assert.ok(bounded.length > 26);
    const boundary = [...bounded[0].slice(-3), ...bounded[1].slice(0, 3)];
    assert.deepEqual(boundary, tie.map((r) => Number(r.id)).sort((a, b) => b - a), `${label}: tie split by id`);
  }
});

await test('cursor bound makes page 26 an index range scan', async () => {
  const p = await plan(after, cursorPage(deep, true));
  assert.match(p, /Index Cond: \(\(first_seen_at >= .*\) AND \(first_seen_at <= /, p);
  const line = (txt) => txt.split('\n').filter((l) => /Index (Only )?Scan|Index Cond/.test(l)).slice(0, 2).map((l) => l.trim()).join(' / ');
  out(`      page 26, 138, no bound: ${line(await plan(after, cursorPage(deep, false)))}`);
  out(`      page 26, 138, bound:    ${line(p)}`);
  out(`      page 26, 137, bound:    ${line(await plan(before, cursorPage(deep, true)))}`);
});

// A backlog for the refresh tests: 60 rule changes and 10 main-line stories closed.
async function withBacklog(db) {
  const copy = await db.clone();
  await makeDrift(copy, 60);
  await copy.exec(`update public.stories set status = 'closed'
    where id in (select id from public.stories where main_line order by id desc limit 10)`);
  await copy.exec('analyze');
  return copy;
}
const BACKLOG = 70;
const reference = await withBacklog(before);
assert.equal((await refresh(reference, null)).rows_changed, BACKLOG, '137 reference refresh');

await test('a refresh writes tracker_main_line and never stories, and ends where 137 ends', async () => {
  const db = await withBacklog(after);
  // Stand-in for PROD's two BEFORE UPDATE triggers: counts every stories row update.
  await db.exec(`
    create table public.story_updates(n int not null); insert into public.story_updates values (0);
    create function public.count_story_update() returns trigger language plpgsql as
      $$ begin update public.story_updates set n = n + 1; return new; end $$;
    create trigger count_story_update before update on public.stories
      for each row execute function public.count_story_update();`);
  const stories = await versions(db);
  const row = await refresh(db, null);
  assert.equal(row.rows_changed, BACKLOG);
  assert.equal(row.more_pending, false);
  assert.equal((await db.query('select n from public.story_updates')).rows[0].n, 0, 'no stories row was updated');
  assert.equal(await versions(db), stories, 'no new stories row versions; main_line frozen');
  assert.deepEqual(await ids(db, SIDE_IDS), await ids(reference, FLAG_IDS));
  assert.deepEqual((await db.query('select developments, alarm5_last30, open_fronts from public.tracker_stats')).rows,
    (await reference.query('select developments, alarm5_last30, open_fronts from public.tracker_stats')).rows);
  assert.equal((await refresh(db, null)).rows_changed, 0, 'steady state writes nothing');
  for (const sql of Object.values(QUERIES)) assert.deepEqual(await rows(db, sql), await rows(reference, sql));
});

await test('batches: newest story first, honest more_pending, same end state as one call', async () => {
  const db = await withBacklog(after);
  // Stories whose tracker_main_line row the rule disagrees with, newest first.
  const PENDING = `select coalesce(r.id, m.story_id) as id
      from (select id from public.v_tracker_main_line_rule where main_line) r
      full join public.tracker_main_line m on m.story_id = r.id
     where r.id is null or m.story_id is null
     order by 1 desc`;
  const newest10 = (await ids(db, PENDING)).slice(0, 10);
  const first = await refresh(db, 10);
  assert.deepEqual({ rows: first.rows_changed, more: first.more_pending }, { rows: 10, more: true });
  const left = await ids(db, PENDING);
  assert.equal(left.length, BACKLOG - 10);
  assert.ok(newest10.every((id) => !left.includes(id)), 'the 10 newest pending stories went first');
  const a = await refresh(db, 50);
  assert.deepEqual({ rows: a.rows_changed, more: a.more_pending }, { rows: 50, more: true });
  const b = await refresh(db, 50);
  assert.deepEqual({ rows: b.rows_changed, more: b.more_pending }, { rows: BACKLOG - 60, more: false });
  assert.deepEqual(await ids(db, SIDE_IDS), await ids(reference, FLAG_IDS));
  await assert.rejects(refresh(db, 0), (e) => e.code === '22023');
});

await test('more_pending counts the batch, not the writes (a concurrent refresh wrote some first)', async () => {
  const db = await withBacklog(after);
  // Stand-in for a second refresh that wrote these stories a moment earlier: their insert or delete
  // writes nothing here, exactly like ON CONFLICT DO NOTHING (or a row already gone) after the other
  // refresh's commit.
  await db.exec(`
    create function public.skip_some_writes() returns trigger language plpgsql as $$
      begin
        if tg_op = 'DELETE' then
          if old.story_id % 2 = 0 then return null; end if;
          return old;
        end if;
        if new.story_id % 2 = 0 then return null; end if;
        return new;
      end $$;
    create trigger skip_some_writes before insert or delete on public.tracker_main_line
      for each row execute function public.skip_some_writes();`);
  const first = await refresh(db, 10);
  assert.ok(first.rows_changed < 10, `some of the batch was already written elsewhere (${first.rows_changed} written)`);
  assert.equal(first.more_pending, true, 'a full batch still says call again');
});

await test('deleting a story deletes its tracker_main_line row', async () => {
  const db = await after.clone();
  const [id] = await ids(db, 'select story_id as id from public.tracker_main_line order by 1 limit 1');
  await db.query('delete from public.stories where id = $1', [id]);
  assert.equal((await db.query('select count(*)::int n from public.tracker_main_line where story_id = $1', [id])).rows[0].n, 0);
});

await test('grants and RLS: anon reads only; on_main_line and the refresh are service_role only', async () => {
  const q = async (sql) => (await after.query(sql)).rows[0];
  assert.deepEqual(await q(`select
      has_table_privilege('anon', 'public.tracker_main_line', 'select') as anon_read,
      has_table_privilege('anon', 'public.tracker_main_line', 'insert') as anon_write,
      has_table_privilege('authenticated', 'public.tracker_main_line', 'select') as auth_read,
      (select relrowsecurity from pg_class where oid = 'public.tracker_main_line'::regclass) as rls`),
  { anon_read: true, anon_write: false, auth_read: false, rls: true });
  for (const fn of ['public.on_main_line(public.stories)', 'public.refresh_tracker_derived(integer)']) {
    for (const [role, ok] of [['anon', false], ['authenticated', false], ['service_role', true]]) {
      assert.equal((await q(`select has_function_privilege('${role}', '${fn}', 'execute') as ok`)).ok, ok, `${role} ${fn}`);
    }
  }
});

await test('on_main_line(stories) agrees with tracker_main_line', async () => {
  await after.exec('set role service_role');
  try {
    const viaFn = await ids(after, 'select s.id from public.stories s where public.on_main_line(s) order by 1');
    assert.deepEqual(viaFn, await ids(after, SIDE_IDS));
  } finally {
    await after.exec('reset role');
  }
});

// Codex P2: the backfill copies the frozen stories.main_line, so it must run only on the first apply.
await test('re-running 138 does not bring back a story the rule has since removed', async () => {
  const db = await after.clone();
  const [id] = await ids(db, `select story_id as id from public.tracker_main_line
    where story_id::text not in (select entity_id from public.tracker_pin) order by 1 desc limit 1`);
  // coverage is never on the main line: the rule takes the story off
  await db.query("update public.stories set action_label = 'coverage' where id = $1", [id]);
  await refresh(db, null);
  const onSide = async () => (await ids(db, SIDE_IDS)).includes(id);
  assert.equal(await onSide(), false, 'the refresh removed it');
  assert.equal((await db.query('select main_line from public.stories where id = $1', [id])).rows[0].main_line, true,
    'its frozen legacy flag still says on');
  await db.exec(M138);
  assert.equal(await onSide(), false, 're-applying 138 must not resurrect it from the frozen flag');
});

await test('re-running 138 changes nothing and keeps one policy', async () => {
  const db = await after.clone();
  const sideBefore = await ids(db, SIDE_IDS);
  await db.exec(M138);
  assert.deepEqual(await ids(db, SIDE_IDS), sideBefore);
  assert.equal((await db.query("select count(*)::int n from pg_policies where tablename = 'tracker_main_line'")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname = 'refresh_tracker_derived'")).rows[0].n, 1);
});

out(`tracker-main-line-table-pglite: ${passed()} passed`);
