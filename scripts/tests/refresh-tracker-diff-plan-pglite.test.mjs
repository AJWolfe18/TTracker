// Migration 137 (ADO-638 follow-up) on PGlite (Postgres 17) with a realistic dataset
// (fixtures/tracker-dataset.mjs: 30,000 stories, fronts, pins, the real rule view from 126).
// 136 added ORDER BY/LIMIT to the diff and the planner swapped hash joins for a newest-first walk
// over every story; with nothing to change it never stops early (0.6 s -> 5.7 s on PROD).
// Checks: 137 changes exactly the rows 136 changes, call by call, for batch sizes NULL, 7 and 50
// (more_pending included); its plans no longer walk stories_pkey backwards; a steady-state batched
// call costs about what the no-LIMIT diff costs; grants, bad input, idempotent re-run, verify query.
// Skips (exit 0) when @electric-sql/pglite is missing (not a declared dependency).
// Run: node scripts/tests/refresh-tracker-diff-plan-pglite.test.mjs
import assert from 'node:assert/strict';
import { migration, pgliteOrSkip, testRunner } from './fixtures/pglite.mjs';
import { trackerDb, makeDrift, plan, refresh, timeQuery } from './fixtures/tracker-dataset.mjs';

const out = (s) => process.stdout.write(`${s}\n`);
const PGlite = await pgliteOrSkip('refresh-tracker-diff-plan-pglite');
const { test, passed } = testRunner(out);

const M136 = migration('136_refresh_tracker_batches.sql');
const M137 = migration('137_refresh_tracker_diff_plan.sql');

/** One statement of a migration's function body, with p_max_rows replaced so it can be EXPLAINed. */
function statement(sql, from, to, batch) {
  const a = sql.indexOf(from);
  const b = sql.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`statement not found: ${from}`);
  return sql.slice(a, b).trim().replace(/;$/, '').replace(/\bp_max_rows\b/g, String(batch)).replace(/\bv_left\b/g, String(batch));
}
const STEP1_136 = statement(M136, 'UPDATE public.stories s\n     SET main_line = c.main_line', 'GET DIAGNOSTICS n_apply', 50);
const STEP1_137 = statement(M137, 'WITH changed AS MATERIALIZED', 'GET DIAGNOSTICS n_apply', 50);
const STEP2_136 = statement(M136, 'UPDATE public.stories s\n     SET main_line = false', 'GET DIAGNOSTICS n_drop', 50);
const STEP2_137 = statement(M137, 'WITH out_of_scope AS MATERIALIZED', 'GET DIAGNOSTICS n_drop', 50);
const DIFF_NO_LIMIT = `SELECT r.id, r.main_line FROM public.v_tracker_main_line_rule r
  JOIN public.stories s2 ON s2.id = r.id WHERE s2.main_line IS DISTINCT FROM r.main_line`;

const flagsHash = async (db) => (await db.query(
  "select md5(string_agg(id || ':' || main_line, ',' order by id)) as h from public.stories")).rows[0].h;
const pending = async (db) => Number((await db.query(`select
  (select count(*) from (${DIFF_NO_LIMIT}) d)
  + (select count(*) from public.stories where main_line and not (status = 'active' and summary_neutral is not null)) as n`)).rows[0].n);

// Steady state (refreshed, nothing pending) with 136 applied, the state PROD is in today.
const base = await trackerDb(PGlite);
assert.equal(await pending(base), 0, 'fixture should start in steady state');

// A backlog: ~70 rule changes plus 12 main-line stories closed (they must drop off).
const backlog = await base.clone();
await makeDrift(backlog, 70);
await backlog.exec(`update public.stories set status = 'closed'
  where id in (select id from public.stories where main_line order by id desc limit 12)`);
await backlog.exec('analyze');
const BACKLOG = await pending(backlog);
assert.ok(BACKLOG > 50, `backlog should be over one 50-row batch, got ${BACKLOG}`);

// A batch of 7 still compares a dozen calls in a row; a batch of 1 made ~80 calls, most of the run time.
for (const batch of [null, 7, 50]) {
  await test(`batch ${batch ?? 'NULL'}: 137 changes the same rows as 136, call by call`, async () => {
    const old = await backlog.clone();
    const neu = await backlog.clone();
    await neu.exec(M137);
    let calls = 0; let total = 0;
    for (;;) {
      const a = await refresh(old, batch);
      const b = await refresh(neu, batch);
      calls += 1;
      assert.deepEqual({ rows: b.rows_changed, more: b.more_pending }, { rows: a.rows_changed, more: a.more_pending }, `call ${calls}`);
      assert.equal(await flagsHash(neu), await flagsHash(old), `stories flags after call ${calls}`);
      total += b.rows_changed;
      if (!b.more_pending || calls > BACKLOG + 2) break;
    }
    assert.equal(total, BACKLOG);
    assert.equal(await pending(neu), 0);
    if (batch === 50) assert.equal(calls, 2, `${BACKLOG} rows at 50 per call = 1 full batch + 1 partial`);
  });
}

await test('plan: 136 walks stories_pkey backwards (the regression this fixes)', async () => {
  assert.match(await plan(base, STEP1_136), /Index Scan Backward using stories_pkey/);
});

await test('plan: 137 steps 1 and 2 find changed rows with no backwards walk or merge join', async () => {
  for (const sql of [STEP1_137, STEP2_137]) {
    const p = await plan(base, sql);
    assert.doesNotMatch(p, /Index Scan Backward using stories_pkey/, p);
    assert.doesNotMatch(p, /Merge Join/, p);
    assert.match(p, /CTE Scan on (changed|out_of_scope)/, p);
  }
  assert.match(await plan(base, STEP1_137), /Hash Join/, 'the diff is a hash join, like 113');
  assert.match(await plan(base, STEP2_136), /Index Scan Backward using stories_pkey/, 'sanity: 136 step 2 did walk backwards');
});

await test('timing: a steady-state batched call costs about what the no-LIMIT diff costs', async () => {
  const neu = await base.clone();
  await neu.exec(M137);
  const ms = {
    old50: await timeQuery(base, 'select * from public.refresh_tracker_derived(50)', [], 5),
    new50: await timeQuery(neu, 'select * from public.refresh_tracker_derived(50)', [], 5),
    newAll: await timeQuery(neu, 'select * from public.refresh_tracker_derived()', [], 5),
    diff: await timeQuery(neu, DIFF_NO_LIMIT, [], 5),
  };
  out(`      ms: 136(50)=${ms.old50.toFixed(0)} 137(50)=${ms.new50.toFixed(0)} 137(NULL)=${ms.newAll.toFixed(0)} diff alone=${ms.diff.toFixed(0)}`);
  assert.ok(ms.new50 < ms.old50, '137 is faster than 136 in steady state');
  // Loose bound (timing is noisy): within 30% (+5 ms) of the unbatched call, which uses the 113 plan.
  assert.ok(ms.new50 <= ms.newAll * 1.3 + 5, '137(50) is close to the no-LIMIT call');
});

await test('refuses a batch size below 1; grants are service_role only', async () => {
  const neu = await base.clone();
  await neu.exec(M137);
  for (const n of [0, -5]) {
    await assert.rejects(refresh(neu, n), (e) => e.code === '22023' && /p_max_rows/.test(e.message));
  }
  const can = async (role) => (await neu.query(`select has_function_privilege('${role}', 'public.refresh_tracker_derived(integer)', 'execute') as ok`)).rows[0].ok;
  assert.equal(await can('service_role'), true);
  assert.equal(await can('anon'), false);
  assert.equal(await can('authenticated'), false);
});

await test('re-running 137 is idempotent and the verify query confirms this version', async () => {
  const neu = await base.clone();
  await neu.exec(M137);
  const res = await neu.exec(M137);
  const verify = res.find((r) => r.fields[0]?.name === 'refresh_fn')?.rows[0];
  assert.deepEqual(verify, { refresh_fn: 1, batch_arg: 1, cheap_diff: true });
  const before = await base.clone();
  const old = (await before.exec(`select bool_and(prosrc like '%changed AS MATERIALIZED%') as cheap_diff
    from pg_proc where proname = 'refresh_tracker_derived'`))[0].rows[0];
  assert.equal(old.cheap_diff, false, 'the verify column tells 136 and 137 apart');
});

out(`refresh-tracker-diff-plan-pglite: ${passed()} passed`);
