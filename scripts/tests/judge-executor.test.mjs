// ADO-583: the Judge executor is the only thing that writes Judge verdicts to the database now.
// These tests pin the contract between the agent's verdict file and the writes: strict validation,
// survivor/loser rules, the per-run cap, no chained merges, immediate logging of executed merges,
// idempotent re-runs, failed-twice escalation to `uncertain`, heartbeat on an empty run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCHEMA, MERGE_CAP, validateVerdictFile, mergeDecision, buildLogRow, heartbeatRow,
  deferredRationale, buildDigest, envFromSupabaseUrl, executeVerdicts,
} from '../clustering/execute-judge-verdicts.js';

const RUN = 'judge-2026-09-19T21-04-44.950Z';
const pair = (a, b, verdict, extra = {}) => ({
  story_id_a: a, story_id_b: b, headline_a: `A${a}`, headline_b: `B${b}`, verdict, confidence: 0.9,
  rationale: `same event ${a}/${b}`, centroid_sim: 0.93, evidence_as_of: '2026-09-19T13:39:37.279+00:00', ...extra,
});
const merge = (survivor, loser, extra = {}) => pair(Math.min(survivor, loser), Math.max(survivor, loser), 'merge', { survivor_id: survivor, loser_id: loser, ...extra });
const doc = (verdicts, extra = {}) => ({ schema: SCHEMA, run_id: RUN, environment: 'test', dry_run: false, verdicts, ...extra });

// --- validation -----------------------------------------------------------------------------
{
  assert.deepEqual(validateVerdictFile(doc([pair(1, 2, 'keep'), merge(3, 4)])), []);
  assert.ok(validateVerdictFile(null).length);
  assert.ok(validateVerdictFile(doc([], { schema: 'nope' })).some((p) => p.includes('schema')));
  assert.ok(validateVerdictFile(doc([], { run_id: 'judge-2026-09-19' })).some((p) => p.includes('run_id')));
  assert.ok(validateVerdictFile(doc([], { environment: 'staging' })).some((p) => p.includes('environment')));
  assert.ok(validateVerdictFile(doc([], { dry_run: 'false' })).some((p) => p.includes('dry_run')));
  // environment must agree with the branch AND with the database the job was handed
  assert.ok(validateVerdictFile(doc([]), { expectedEnv: 'prod' }).some((p) => p.includes('branch/workflow environment')));
  assert.ok(validateVerdictFile(doc([], { environment: 'prod' }), { supabaseUrl: 'https://wnrjrywpcadwutfykflu.supabase.co' }).some((p) => p.includes('SUPABASE_URL')));
  assert.deepEqual(validateVerdictFile(doc([]), { expectedEnv: 'test', supabaseUrl: 'https://wnrjrywpcadwutfykflu.supabase.co' }), []);
  // per-verdict rules
  assert.ok(validateVerdictFile(doc([pair(1, 1, 'keep')])).some((p) => p.includes('equals')));
  assert.ok(validateVerdictFile(doc([pair(1, 2, 'keep'), pair(2, 1, 'keep')])).some((p) => p.includes('duplicate')));
  assert.ok(validateVerdictFile(doc([pair(1, 2, 'maybe')])).some((p) => p.includes('verdict')));
  assert.ok(validateVerdictFile(doc([pair(1, 2, 'keep', { confidence: 1.5 })])).some((p) => p.includes('confidence')));
  assert.ok(validateVerdictFile(doc([pair(1, 2, 'keep', { rationale: '  ' })])).some((p) => p.includes('rationale')));
  assert.ok(validateVerdictFile(doc([pair(1, 2, 'merge')])).some((p) => p.includes('survivor_id')));
  assert.ok(validateVerdictFile(doc([merge(1, 9, { story_id_a: 1, story_id_b: 2 })])).some((p) => p.includes('two stories of the pair')));
  assert.ok(validateVerdictFile(doc([merge(1, 1, { story_id_a: 1, story_id_b: 2 })])).some((p) => p.includes('two stories of the pair')));
  assert.equal(envFromSupabaseUrl('https://wnrjrywpcadwutfykflu.supabase.co'), 'test');
  assert.equal(envFromSupabaseUrl('https://something-else.supabase.co'), 'prod');
}

// --- merge decision -------------------------------------------------------------------------
{
  const t = new Set([10]);
  assert.deepEqual(mergeDecision({ dryRun: true, executed: 0, touched: t, survivorId: 1, loserId: 2 }), { action: 'log', reason: 'dry_run' });
  assert.deepEqual(mergeDecision({ dryRun: false, executed: MERGE_CAP, touched: t, survivorId: 1, loserId: 2 }), { action: 'log', reason: 'cap_reached' });
  assert.deepEqual(mergeDecision({ dryRun: false, executed: 0, touched: t, survivorId: 10, loserId: 2 }), { action: 'log', reason: 'chained' });
  assert.deepEqual(mergeDecision({ dryRun: false, executed: 0, touched: t, survivorId: 1, loserId: 10 }), { action: 'log', reason: 'chained' });
  assert.deepEqual(mergeDecision({ dryRun: false, executed: 3, touched: t, survivorId: 1, loserId: 2 }), { action: 'merge' });
  assert.equal(MERGE_CAP, 10, 'cap mirrors migration 101');
}

// --- row shapes -----------------------------------------------------------------------------
{
  const v = pair(5, 6, 'keep');
  const row = buildLogRow(v, { runId: RUN, dryRun: true });
  assert.equal(row.source, 'judge-agent');
  assert.equal(row.run_id, RUN);
  assert.equal(row.verdict, 'keep');
  assert.equal(row.merged, false);
  assert.equal(row.dry_run, true);
  assert.equal(row.evidence_as_of, v.evidence_as_of, 'watermark echoed verbatim');
  assert.ok(!('evidence_as_of' in buildLogRow(pair(5, 6, 'keep', { evidence_as_of: undefined }), { runId: RUN, dryRun: false })), 'key omitted when the RPC gave none');
  assert.ok(!('survivor_id' in row) && !('loser_id' in row), 'no non-columns leak into the insert');
  const hb = heartbeatRow(RUN, false);
  assert.equal(hb.story_id_a, null); assert.equal(hb.story_id_b, null); assert.equal(hb.merged, false);
  assert.ok(deferredRationale('cap_reached', v).startsWith('deferred: run cap of 10 reached - '));
  assert.ok(deferredRationale('chained', v, 99).includes('story 99 already merged this run'));
  assert.equal(deferredRationale('dry_run', v), v.rationale);
  assert.equal(buildDigest([], { runId: RUN, env: 'prod' }), null);
  const d = buildDigest([pair(1, 2, 'uncertain')], { runId: RUN, env: 'prod' });
  assert.ok(d.title.includes('1 uncertain'));
  assert.ok(d.description.includes('trumpytracker.com/admin.html') && d.description.includes('#1 vs #2'));
}

// --- executeVerdicts against a fake PostgREST ----------------------------------------------
function fakeClient({ existing = [], mergeResults = {}, insertStatus = () => 201, failedBefore = () => false } = {}) {
  const calls = { rpc: [], inserts: [], gets: [] };
  return {
    calls,
    get: async (path) => {
      calls.gets.push(path);
      if (path.includes('rationale=like.failed')) return { ok: true, status: 200, json: failedBefore(path) ? [{ id: 1 }] : [], text: '' };
      return { ok: true, status: 200, json: existing, text: '' };
    },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      const key = `${args.p_loser_id}->${args.p_survivor_id}`;
      const r = mergeResults[key] || { ok: true, skipped: false };
      return { ok: true, status: 200, json: r, text: JSON.stringify(r) };
    },
    insert: async (table, rows) => {
      const status = insertStatus(rows, calls.inserts.length);
      calls.inserts.push(rows);
      return { ok: status < 300, status, json: rows, text: status === 201 ? '' : 'boom' };
    },
  };
}
const quiet = () => {};

{ // live run: merges execute in order, older story survives as the agent said, each logged at once
  const c = fakeClient();
  const s = await executeVerdicts(doc([pair(1, 2, 'keep'), merge(3, 4), pair(7, 8, 'uncertain'), merge(5, 6)]), { client: c, env: 'test', discord: async () => true, log: quiet });
  assert.equal(s.merged, 2);
  assert.deepEqual(c.calls.rpc.map((r) => `${r.args.p_loser_id}->${r.args.p_survivor_id}`), ['4->3', '6->5']);
  assert.ok(c.calls.rpc.every((r) => r.args.p_run_id === RUN), 'p_run_id passed so the DB cap applies');
  // two immediate one-row inserts (merged=true) + one bulk insert with the two non-merge rows
  assert.equal(c.calls.inserts.length, 3);
  assert.deepEqual(c.calls.inserts[0].map((r) => [r.story_id_a, r.merged]), [[3, true]]);
  assert.deepEqual(c.calls.inserts[1].map((r) => [r.story_id_a, r.merged]), [[5, true]]);
  assert.deepEqual(c.calls.inserts[2].map((r) => r.verdict).sort(), ['keep', 'uncertain']);
  assert.equal(s.logged, 4);
  assert.equal(s.digest_sent, true);
}

{ // dry run: no RPC at all, every row merged=false dry_run=true
  const c = fakeClient();
  const s = await executeVerdicts(doc([merge(3, 4), pair(1, 2, 'keep')], { dry_run: true }), { client: c, env: 'test', discord: async () => true, log: quiet });
  assert.equal(c.calls.rpc.length, 0);
  assert.equal(s.merged, 0);
  assert.ok(c.calls.inserts.flat().every((r) => r.merged === false && r.dry_run === true));
}

{ // cap: the 11th merge is deferred, not executed; no chained merges in one run
  const verdicts = [merge(100, 101), merge(100, 300)]; // 100 just survived a merge -> the second is chained -> deferred
  for (let i = 1; i < 11; i++) verdicts.push(merge(100 + i * 2, 101 + i * 2)); // 9 more execute (10 total), the 11th hits the cap
  const c = fakeClient();
  const s = await executeVerdicts(doc(verdicts), { client: c, env: 'test', discord: async () => true, log: quiet });
  assert.equal(s.merged, 10);
  assert.equal(s.deferred, 2);
  const bulk = c.calls.inserts.at(-1);
  assert.ok(bulk.some((r) => r.rationale.startsWith('deferred: run cap of 10 reached')));
  assert.ok(bulk.some((r) => r.rationale.startsWith('deferred: chained merge (story 100 already merged this run)')));
  assert.ok(bulk.every((r) => r.verdict === 'merge' && r.merged === false), 'deferred merges stay merge/merged=false so verdict memory retries them');
}

{ // merge_stories ok:false -> failed: (first time) / escalated to uncertain (second time); skipped:true logged as skipped
  const c = fakeClient({
    mergeResults: { '4->3': { ok: false, reason: 'survivor_is_merged' }, '6->5': { ok: false, reason: 'loser_not_found' }, '8->7': { ok: true, skipped: true, reason: 'loser_already_merged' } },
    failedBefore: (path) => path.includes('story_id_a.eq.5,story_id_b.eq.6'),
  });
  const s = await executeVerdicts(doc([merge(3, 4), merge(5, 6), merge(7, 8)]), { client: c, env: 'prod', discord: async () => true, log: quiet });
  assert.equal(s.merged, 0); assert.equal(s.failed, 2); assert.equal(s.escalated, 1);
  const rows = c.calls.inserts.flat();
  const r34 = rows.find((r) => r.story_id_a === 3);
  const r56 = rows.find((r) => r.story_id_a === 5);
  const r78 = rows.find((r) => r.story_id_a === 7);
  assert.equal(r34.verdict, 'merge'); assert.ok(r34.rationale.startsWith('failed: survivor_is_merged - '));
  assert.equal(r56.verdict, 'uncertain'); assert.ok(r56.rationale.startsWith('escalated: merge failed twice (loser_not_found)'));
  assert.equal(r78.verdict, 'merge'); assert.ok(r78.rationale.startsWith('skipped: loser_already_merged - '));
  assert.equal(s.digest_sent, true, 'escalated pair goes into the uncertain digest');
}

{ // DB-side cap response stops further merge attempts
  const c = fakeClient({ mergeResults: { '4->3': { ok: false, reason: 'run_merge_cap_reached', cap: 10 } } });
  const s = await executeVerdicts(doc([merge(3, 4), merge(5, 6)]), { client: c, env: 'test', discord: async () => true, log: quiet });
  assert.equal(c.calls.rpc.length, 1, 'after run_merge_cap_reached the executor stops calling merge_stories');
  assert.equal(s.deferred, 2); assert.equal(s.failed, 0);
}

{ // idempotent re-run: pairs already logged for this run_id are skipped, not re-merged
  const c = fakeClient({ existing: [{ story_id_a: 3, story_id_b: 4 }] });
  const s = await executeVerdicts(doc([merge(3, 4), pair(1, 2, 'keep')]), { client: c, env: 'test', discord: async () => true, log: quiet });
  assert.equal(c.calls.rpc.length, 0); assert.equal(s.skipped_logged, 1); assert.equal(s.logged, 1);
}

{ // empty run -> heartbeat row once; a second attempt does not duplicate it
  const c = fakeClient();
  const s = await executeVerdicts(doc([]), { client: c, env: 'test', discord: async () => true, log: quiet });
  assert.equal(s.heartbeat, true); assert.equal(c.calls.inserts.length, 1);
  assert.equal(c.calls.inserts[0][0].story_id_a, null);
  const c2 = fakeClient({ existing: [{ story_id_a: null, story_id_b: null }] });
  const s2 = await executeVerdicts(doc([]), { client: c2, env: 'test', discord: async () => true, log: quiet });
  assert.equal(s2.heartbeat, true); assert.equal(c2.calls.inserts.length, 0);
}

{ // log write retry ladder: 2 failures then success without evidence_as_of; 3 failures -> throws
  let n = 0;
  const c = fakeClient({ insertStatus: () => (++n < 3 ? 500 : 201) });
  await executeVerdicts(doc([pair(1, 2, 'keep')]), { client: c, env: 'test', discord: async () => true, log: quiet });
  assert.equal(c.calls.inserts.length, 3);
  assert.ok('evidence_as_of' in c.calls.inserts[1][0] && !('evidence_as_of' in c.calls.inserts[2][0]), 'third attempt drops the watermark');
  const c3 = fakeClient({ insertStatus: () => 500 });
  await assert.rejects(() => executeVerdicts(doc([pair(1, 2, 'keep')]), { client: c3, env: 'test', discord: async () => true, log: quiet }), /bulk log insert/);
}

// --- the workflow + prompt agree with the script ---------------------------------------------
{
  const wf = readFileSync(new URL('../../.github/workflows/judge-executor.yml', import.meta.url), 'utf8');
  assert.ok(wf.includes('- "judge-run/**"'), 'workflow fires on judge-run/** pushes');
  assert.ok(wf.includes('scripts/clustering/execute-judge-verdicts.js'), 'workflow runs the executor');
  assert.ok(wf.includes('JUDGE_EXPECTED_ENV: test') && wf.includes('JUDGE_EXPECTED_ENV: prod'), 'both environments wired');
  assert.ok(wf.includes('secrets.SUPABASE_TEST_SERVICE_KEY') && wf.includes('secrets.SUPABASE_SERVICE_KEY'), 'service keys come from GitHub secrets');
  assert.ok(!/osjbulmltfpcoldydexg/.test(wf), 'no PROD project ref in the workflow');
}

console.log('judge-executor: all checks passed');
