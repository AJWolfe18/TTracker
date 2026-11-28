// ADO-638: scripts/maintenance/refresh-tracker.js drains a main_line backlog in batches, halves the
// batch on a statement timeout, falls back to the one-shot call before migration 136, never throws
// out of main(), and alerts Discord (plus a pipeline_skips row) on failure or when it falls behind.
// Run: node scripts/tests/refresh-tracker.test.mjs
import assert from 'node:assert/strict';
import { main, failedAlert } from '../maintenance/refresh-tracker.js';
import { refreshTracker, isTimeoutError, DEFAULT_BATCH, MIN_BATCH } from '../lib/tracker-refresh.js';
import { PIPELINES, REASONS } from '../lib/skip-reasons.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); passed += 1; process.stdout.write(`  ok  ${name}\n`); }
  catch (e) { process.stdout.write(`  FAIL ${name}\n`); throw e; }
};

// A fake supabase whose rpc answers from a script of responses and records each call's args.
function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      const next = responses.shift();
      if (!next) throw new Error('unexpected extra rpc call');
      return typeof next === 'function' ? next(args) : next;
    },
  };
}
const ok = (rows_changed, more_pending, took_ms = 100) => ({ data: [{ rows_changed, took_ms, more_pending }], error: null });
const timeout = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } };

await test('steady state: one call with the default batch, nothing pending', async () => {
  const c = fakeClient([ok(3, false)]);
  const r = await refreshTracker(c);
  assert.deepEqual(c.calls, [{ fn: 'refresh_tracker_derived', args: { p_max_rows: DEFAULT_BATCH } }]);
  assert.deepEqual(r, { rows_changed: 3, took_ms: 100, calls: 1, pending: false, legacy: false, batch: DEFAULT_BATCH });
});

await test('backlog: repeats while more_pending and sums the batches', async () => {
  const c = fakeClient([ok(150, true), ok(150, true), ok(40, false)]);
  const r = await refreshTracker(c);
  assert.equal(c.calls.length, 3);
  assert.equal(r.rows_changed, 340);
  assert.equal(r.took_ms, 300);
  assert.equal(r.pending, false);
});

await test('timeout halves the batch and retries, down to MIN_BATCH', async () => {
  const c = fakeClient([timeout, timeout, ok(12, true), ok(5, false)]);
  const r = await refreshTracker(c);
  assert.deepEqual(c.calls.map((x) => x.args.p_max_rows), [50, 25, 12, 12]);
  assert.equal(r.rows_changed, 17);
  assert.equal(r.batch, 12);
  const c2 = fakeClient([timeout, timeout, timeout, timeout]);
  await assert.rejects(refreshTracker(c2), /statement timeout/);
  assert.deepEqual(c2.calls.map((x) => x.args.p_max_rows), [50, 25, 12, MIN_BATCH]);
});

await test('non-timeout error is thrown at once (no halving)', async () => {
  const c = fakeClient([{ data: null, error: { code: '42501', message: 'permission denied' } }]);
  await assert.rejects(refreshTracker(c), /permission denied/);
  assert.equal(c.calls.length, 1);
});

await test('before migration 136: falls back to the one-shot no-argument call', async () => {
  const c = fakeClient([{ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }, { data: [{ rows_changed: 7, took_ms: 900 }], error: null }]);
  const r = await refreshTracker(c);
  assert.deepEqual(c.calls[1], { fn: 'refresh_tracker_derived', args: undefined });
  assert.equal(r.legacy, true);
  assert.equal(r.rows_changed, 7);
  assert.equal(r.pending, false);
});

await test('PGRST202 after a successful batch is a real error, not a fallback', async () => {
  const c = fakeClient([ok(150, true), { data: null, error: { code: 'PGRST202', message: 'gone' } }]);
  await assert.rejects(refreshTracker(c), /gone/);
});

await test('time budget: stops with pending=true when more is still waiting', async () => {
  let t = 0;
  const c = fakeClient([() => { t += 3000; return ok(150, true); }, () => { t += 3000; return ok(150, true); }]);
  const r = await refreshTracker(c, { budgetMs: 5000, now: () => t });
  assert.equal(r.calls, 2);
  assert.equal(r.pending, true);
  assert.equal(r.rows_changed, 300);
});

await test('isTimeoutError matches the code or the message only', () => {
  assert.equal(isTimeoutError({ code: '57014' }), true);
  assert.equal(isTimeoutError({ message: 'canceling statement due to statement timeout' }), true);
  assert.equal(isTimeoutError({ code: '42501', message: 'permission denied' }), false);
  assert.equal(isTimeoutError(null), false);
});

// main(): exit path, skip rows and alerts
function harness(responses, env = {}) {
  const h = { skips: [], alerts: [], out: [], err: [] };
  h.run = () => main({
    env: { ALERT_ENV: 'prod', ...env },
    client: fakeClient(responses),
    alert: async (embed, opts) => { h.alerts.push({ embed, opts }); return true; },
    skip: async (_sb, row) => { h.skips.push(row); },
    out: (s) => h.out.push(s),
    err: (s) => h.err.push(s),
  });
  return h;
}

await test('main success: logs the grep-compatible line, no skip, no alert', async () => {
  const h = harness([ok(150, true), ok(2, false)]);
  await h.run();
  assert.match(h.out.at(-1), /^refresh_tracker_derived rows_changed=152 took_ms=200 calls=2$/);
  assert.equal(h.skips.length, 0);
  assert.equal(h.alerts.length, 0);
});

await test('main failure: FAILED line, refresh_failed skip row, red Discord alert, never throws', async () => {
  const h = harness([{ data: null, error: { code: '42501', message: 'permission denied for function' } }],
    { GITHUB_WORKFLOW: 'RSS Tracker - PROD', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9' });
  await h.run();
  assert.match(h.err.at(-1), /^refresh-tracker: FAILED \(previous flags remain\): permission denied/);
  assert.deepEqual(h.skips.map((s) => [s.pipeline, s.reason]), [[PIPELINES.TRACKER_REFRESH, REASONS.REFRESH_FAILED]]);
  assert.equal(h.alerts.length, 1);
  const { embed, opts } = h.alerts[0];
  assert.equal(embed.title, 'Homepage refresh failed (RSS Tracker - PROD)');
  assert.match(embed.description, /permission denied/);
  assert.equal(embed.fields[0].value, '[View Logs](https://github.com/o/r/actions/runs/9)');
  assert.equal(opts.envLabel, 'prod');
});

await test('main behind: refresh_behind skip row and amber alert; TEST label passed through', async () => {
  let t = 0;
  const responses = Array.from({ length: 200 }, () => () => { t += 2000; return ok(150, true); });
  const h = { skips: [], alerts: [] };
  // Budget is the script default (4 minutes): 2 s per fake call, so it stops after 120 calls.
  const realNow = Date.now;
  Date.now = () => t;
  try {
    await main({
      env: { ALERT_ENV: 'test' },
      client: fakeClient(responses),
      alert: async (embed, opts) => { h.alerts.push({ embed, opts }); return true; },
      skip: async (_sb, row) => { h.skips.push(row); },
      out: () => {}, err: () => {},
    });
  } finally { Date.now = realNow; }
  assert.deepEqual(h.skips.map((s) => s.reason), [REASONS.REFRESH_BEHIND]);
  assert.equal(h.skips[0].metadata.calls, 120);
  assert.equal(h.alerts[0].embed.title, 'Homepage refresh fell behind');
  assert.equal(h.alerts[0].opts.envLabel, 'test');
});

await test('main without credentials skips quietly (no client, no alert)', async () => {
  const errs = [];
  await main({ env: {}, err: (s) => errs.push(s), alert: () => { throw new Error('no alert expected'); } });
  assert.match(errs[0], /not set/);
});

await test('a failure after committed batches says how much already went through', async () => {
  const c = fakeClient([ok(150, true), ok(150, true), { data: null, error: { code: '40P01', message: 'deadlock detected' } }]);
  const e = await refreshTracker(c).catch((x) => x);
  assert.deepEqual(e.applied, { rows_changed: 300, calls: 2 });
  const h = harness([ok(150, true), { data: null, error: { code: '40P01', message: 'deadlock detected' } }]);
  await h.run();
  assert.match(h.alerts[0].embed.description, /^It updated 150 stories in 1 batches before the error/);
  assert.doesNotMatch(h.alerts[0].embed.description, /keep their previous values/);
  assert.deepEqual(h.skips[0].metadata.applied, { rows_changed: 150, calls: 1 });
  const first = harness([{ data: null, error: { code: '42501', message: 'denied' } }]);
  await first.run();
  assert.match(first.alerts[0].embed.description, /keep their previous values/, 'nothing committed: the old wording');
});

await test('failedAlert truncates long errors', () => {
  const e = failedAlert('x'.repeat(1000), undefined, {});
  assert.ok(e.description.length < 500);
  assert.equal(e.fields, undefined);
});

await test('skip-reason constants exist (typos fail here, not in the DB)', () => {
  assert.equal(REASONS.REFRESH_BEHIND, 'refresh_behind');
  assert.equal(REASONS.REFRESH_FAILED, 'refresh_failed');
});

process.stdout.write(`refresh-tracker: ${passed} passed\n`);
