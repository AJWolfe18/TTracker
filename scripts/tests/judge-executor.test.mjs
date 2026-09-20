// ADO-583: the Judge executor is the only thing that writes Judge verdicts to the database now.
// These tests pin the contract between the agent's verdict file and the writes: strict validation,
// survivor/loser rules, the per-run cap, no chained merges, immediate logging of executed merges,
// idempotent re-runs (state seeded from story_merge_audit), failed-twice escalation to `uncertain`
// for deterministic failures only (transport failures are `transient:`), survivor orientation checked
// against first_seen_at, candidates === verdicts, heartbeat on an empty run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SCHEMA, MERGE_CAP, validateVerdictFile, mergeDecision, buildLogRow, heartbeatRow,
  deferredRationale, buildDigest, envFromSupabaseUrl, executeVerdicts, chooseSurvivor, makeClient,
} from '../clustering/execute-judge-verdicts.js';
import { parseInboxBranch, actionForExit, MAX_FILE_BYTES } from '../clustering/process-judge-inbox.js';

const RUN = 'judge-2026-09-19T21-04-44.950Z';
const pair = (a, b, verdict, extra = {}) => ({
  story_id_a: a, story_id_b: b, headline_a: `A${a}`, headline_b: `B${b}`, verdict, confidence: 0.9,
  rationale: `same event ${a}/${b}`, centroid_sim: 0.93, evidence_as_of: '2026-09-19T13:39:37.279+00:00', ...extra,
});
const merge = (survivor, loser, extra = {}) => pair(Math.min(survivor, loser), Math.max(survivor, loser), 'merge', { survivor_id: survivor, loser_id: loser, ...extra });
const doc = (verdicts, extra = {}) => ({ schema: SCHEMA, run_id: RUN, environment: 'test', dry_run: false, candidates: verdicts.length, verdicts, ...extra });

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
  // candidates must equal the verdict count: a run cut short is rejected whole (review finding 5)
  assert.ok(validateVerdictFile(doc([pair(1, 2, 'keep')], { candidates: 30 })).some((p) => p.includes('candidates')));
  assert.ok(validateVerdictFile(doc([pair(1, 2, 'keep')], { candidates: undefined })).some((p) => p.includes('candidates')));
  assert.ok(validateVerdictFile(doc([pair(1, 2, 'keep')], { candidates: '1' })).some((p) => p.includes('candidates')));
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

// --- survivor orientation (review finding 4) -------------------------------------------------
{
  const rows = [{ id: 3, first_seen_at: '2026-09-10T00:00:00Z' }, { id: 4, first_seen_at: '2026-09-01T00:00:00Z' }];
  assert.deepEqual(chooseSurvivor(rows, 3, 4), { survivorId: 4, loserId: 3 }, 'older first_seen_at survives even with the larger id');
  assert.deepEqual(chooseSurvivor([{ id: 3, first_seen_at: '2026-09-01T00:00:00Z' }, { id: 4, first_seen_at: '2026-09-01T00:00:00+00:00' }], 4, 3), { survivorId: 3, loserId: 4 }, 'tie -> smaller id');
  assert.deepEqual(chooseSurvivor([{ id: 3, first_seen_at: null }, { id: 4, first_seen_at: '2026-09-01T00:00:00Z' }], 3, 4), { survivorId: 3, loserId: 4 }, 'unreadable timestamp -> smaller id');
  assert.equal(chooseSurvivor([{ id: 3, first_seen_at: '2026-09-01T00:00:00Z' }], 3, 4), null, 'missing story -> null, merge_stories reports it');
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
function fakeClient({ existing = [], audit = [], auditAfter = null, ages = null, agesStatus = 200, mergeResults = {}, rpcStatus = () => 200, insertStatus = () => 201, failedBefore = () => false, loggedAfterInsert = null, updateStatus = 200 } = {}) {
  const calls = { rpc: [], inserts: [], gets: [], updates: [] };
  return {
    calls,
    get: async (path) => {
      calls.gets.push(path);
      if (path.includes('rationale=like.failed')) return { ok: true, status: 200, json: failedBefore(path) ? [{ id: 1 }] : [], text: '' };
      if (path.startsWith('/story_merge_audit')) { // auditAfter = what the table holds once a merge call has been made
        return { ok: true, status: 200, json: auditAfter && calls.rpc.length ? auditAfter : audit, text: '' };
      }
      if (path.startsWith('/stories')) {
        if (agesStatus !== 200) return { ok: false, status: agesStatus, json: null, text: 'down' };
        // default: the smaller id is the older story, which is how the merge() helper orients verdicts
        const ids = path.match(/id=in\.\((\d+),(\d+)\)/).slice(1).map(Number);
        return { ok: true, status: 200, json: ages || ids.map((id) => ({ id, first_seen_at: new Date(Date.UTC(2026, 0, 1) + id * 1000).toISOString() })), text: '' };
      }
      // loggedAfterInsert = what the log holds once an insert has been SENT (a commit behind a lost response); 'down' = the read fails
      if (loggedAfterInsert && calls.inserts.length) {
        if (loggedAfterInsert === 'down') return { ok: false, status: 503, json: null, text: 'down' };
        return { ok: true, status: 200, json: loggedAfterInsert, text: '' };
      }
      return { ok: true, status: 200, json: existing, text: '' };
    },
    update: async (table, query, body) => {
      calls.updates.push({ table, query, body });
      return updateStatus === 200 ? { ok: true, status: 200, json: [{ id: 1 }], text: '' } : { ok: false, status: updateStatus, json: null, text: 'boom' };
    },
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      const key = `${args.p_loser_id}->${args.p_survivor_id}`;
      const status = rpcStatus(key);
      if (status !== 200) return { ok: false, status, json: { message: 'upstream down' }, text: 'upstream down' };
      const r = key in mergeResults ? mergeResults[key] : { ok: true, skipped: false };
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

{ // transport failures are `transient:`, never `failed:`, and never escalate - even when the pair failed before (finding 2)
  const c = fakeClient({ rpcStatus: (k) => (k === '4->3' ? 503 : 200), mergeResults: { '6->5': 'not the merge_stories shape' }, failedBefore: () => true });
  const s = await executeVerdicts(doc([merge(3, 4), merge(5, 6)]), { client: c, env: 'prod', discord: async () => true, log: quiet });
  assert.equal(s.transient, 2); assert.equal(s.failed, 0); assert.equal(s.escalated, 0); assert.equal(s.digest_sent, false);
  const rows = c.calls.inserts.flat();
  assert.ok(rows.find((r) => r.story_id_a === 3).rationale.startsWith('transient: http_503 - '));
  assert.ok(rows.find((r) => r.story_id_a === 5).rationale.startsWith('transient: unreadable_response - '));
  assert.ok(rows.every((r) => r.verdict === 'merge' && r.merged === false), 'stays merge/merged=false so verdict memory retries it');
  assert.ok(!c.calls.gets.some((g) => g.includes('rationale=like.failed')), 'the failed-before lookup is not even made for a transport failure');
  // the stories read failing is the same class of failure: no merge attempted, transient row
  const c2 = fakeClient({ agesStatus: 503 });
  const s2 = await executeVerdicts(doc([merge(3, 4)]), { client: c2, env: 'prod', discord: async () => true, log: quiet });
  assert.equal(c2.calls.rpc.length, 0); assert.equal(s2.transient, 1);
  assert.ok(c2.calls.inserts.flat()[0].rationale.startsWith('transient: http_503 reading stories - '));
}

{ // a merge whose response was lost but which committed (audit row exists) is logged merged=true, not transient
  const c = fakeClient({ rpcStatus: () => 504, auditAfter: [{ loser_id: 4, survivor_id: 3 }] });
  const s = await executeVerdicts(doc([merge(3, 4), merge(5, 6)]), { client: c, env: 'prod', discord: async () => true, log: quiet });
  const rows = c.calls.inserts.flat();
  const r34 = rows.find((r) => r.story_id_a === 3); const r56 = rows.find((r) => r.story_id_a === 5);
  assert.equal(r34.merged, true); assert.equal(r34.rationale, 'same event 3/4');
  assert.equal(r56.merged, false); assert.ok(r56.rationale.startsWith('transient: http_504 - '));
  assert.equal(s.recovered, 1); assert.equal(s.transient, 1);
}

{ // review P1: 2->1 commits behind a 504, then 3->1 must NOT execute in the same run (no chained merges)
  const c = fakeClient({ rpcStatus: (k) => (k === '2->1' ? 504 : 200), auditAfter: [{ loser_id: 2, survivor_id: 1 }] });
  const s = await executeVerdicts(doc([merge(1, 2), merge(1, 3), merge(5, 6)]), { client: c, env: 'prod', discord: async () => true, log: quiet });
  assert.deepEqual(c.calls.rpc.map((r) => `${r.args.p_loser_id}->${r.args.p_survivor_id}`), ['2->1', '6->5'], '3->1 is never sent');
  const rows = c.calls.inserts.flat();
  const r12 = rows.find((r) => r.story_id_a === 1 && r.story_id_b === 2);
  const r13 = rows.find((r) => r.story_id_a === 1 && r.story_id_b === 3);
  assert.equal(r12.merged, true, 'the merge that committed behind the 504 is logged merged=true at once');
  assert.deepEqual(c.calls.inserts[0].map((r) => [r.story_id_b, r.merged]), [[2, true]], 'logged immediately, before the next verdict is touched');
  assert.ok(r13.rationale.startsWith('deferred: chained merge (story 1 already merged this run)'));
  assert.equal(s.merged, 2); assert.equal(s.recovered, 1); assert.equal(s.deferred, 1); assert.equal(s.transient, 0);
  // same when the audit table does NOT (yet) show the merge: unknown state -> both stories are held out
  const c2 = fakeClient({ rpcStatus: (k) => (k === '2->1' ? 504 : 200) });
  const s2 = await executeVerdicts(doc([merge(1, 2), merge(1, 3), merge(2, 9)]), { client: c2, env: 'prod', discord: async () => true, log: quiet });
  assert.deepEqual(c2.calls.rpc.map((r) => `${r.args.p_loser_id}->${r.args.p_survivor_id}`), ['2->1'], 'neither story 1 nor story 2 is merged again this run');
  assert.equal(s2.transient, 1); assert.equal(s2.deferred, 2);
  assert.equal(s2.unconfirmed, 1, 'an unresolved merge is reported so the CLI exits 1 and the next poll reconciles it');
  assert.equal(s.unconfirmed, 0, 'a merge confirmed from the audit table is not left open');
}

{ // Codex P1: a merge that commits AFTER its `transient:` row was logged is reconciled on the next poll, not skipped
  const c = fakeClient({ existing: [{ id: 77, story_id_a: 3, story_id_b: 4, merged: false }, { id: 78, story_id_a: 1, story_id_b: 2, merged: false }], audit: [{ loser_id: 4, survivor_id: 3 }] });
  const s = await executeVerdicts(doc([merge(3, 4), pair(1, 2, 'keep')]), { client: c, env: 'prod', discord: async () => true, log: quiet });
  assert.equal(c.calls.rpc.length, 0, 'never re-merged'); assert.equal(c.calls.inserts.length, 0, 'no second row for the pair');
  assert.equal(c.calls.updates.length, 1);
  const u = c.calls.updates[0];
  assert.equal(u.table, 'clustering_judge_log'); assert.ok(u.query.includes('id=eq.77') && u.query.includes('merged=is.false'));
  assert.deepEqual(u.body, { merged: true, verdict: 'merge', rationale: 'same event 3/4' }, 'the transient: prefix is replaced by the real rationale');
  assert.equal(s.reconciled, 1); assert.equal(s.skipped_logged, 1); assert.equal(s.unconfirmed, 0);
  // the executor flipped the orientation in the first attempt: the audit row is the authority, and the row says so
  const cf = fakeClient({ existing: [{ id: 5, story_id_a: 3, story_id_b: 4, merged: false }], audit: [{ loser_id: 3, survivor_id: 4 }] });
  await executeVerdicts(doc([merge(3, 4)]), { client: cf, env: 'prod', discord: async () => true, log: quiet });
  assert.ok(cf.calls.updates[0].body.rationale.endsWith('[executor: survivor/loser flipped - story 4 is older]'));
  // already merged=true -> plain skip, no write
  const c2 = fakeClient({ existing: [{ id: 77, story_id_a: 3, story_id_b: 4, merged: true }], audit: [{ loser_id: 4, survivor_id: 3 }] });
  const s2 = await executeVerdicts(doc([merge(3, 4)]), { client: c2, env: 'prod', discord: async () => true, log: quiet });
  assert.equal(c2.calls.updates.length, 0); assert.equal(s2.skipped_logged, 1); assert.equal(s2.reconciled, 0);
  // a failed reconcile write is a runtime failure (exit 1): the branch stays and the next poll tries again
  const c3 = fakeClient({ existing: [{ id: 77, story_id_a: 3, story_id_b: 4, merged: false }], audit: [{ loser_id: 4, survivor_id: 3 }], updateStatus: 503 });
  await assert.rejects(() => executeVerdicts(doc([merge(3, 4)]), { client: c3, env: 'prod', discord: async () => true, log: quiet }), /could not be reconciled/);
}

{ // Codex P1: a log insert that committed behind a lost response is not inserted again
  const c = fakeClient({ insertStatus: (rows, n) => (n === 0 ? 504 : 201), loggedAfterInsert: [{ story_id_a: 2, story_id_b: 1 }] }); // only 1/2 landed (order-insensitive)
  const s = await executeVerdicts(doc([pair(1, 2, 'keep'), pair(5, 6, 'keep')]), { client: c, env: 'test', discord: async () => true, log: quiet });
  assert.equal(c.calls.inserts.length, 2);
  assert.deepEqual(c.calls.inserts[1].map((r) => [r.story_id_a, r.story_id_b]), [[5, 6]], 'the retry carries only the rows the log does not have');
  assert.equal(s.logged, 2);
  // everything landed -> no retry at all
  const c2 = fakeClient({ insertStatus: () => 504, loggedAfterInsert: [{ story_id_a: 1, story_id_b: 2 }, { story_id_a: 5, story_id_b: 6 }] });
  await executeVerdicts(doc([pair(1, 2, 'keep'), pair(5, 6, 'keep')]), { client: c2, env: 'test', discord: async () => true, log: quiet });
  assert.equal(c2.calls.inserts.length, 1);
  // same for the heartbeat row
  const c3 = fakeClient({ insertStatus: () => 504, loggedAfterInsert: [{ story_id_a: null, story_id_b: null }] });
  const s3 = await executeVerdicts(doc([]), { client: c3, env: 'test', discord: async () => true, log: quiet });
  assert.equal(c3.calls.inserts.length, 1); assert.equal(s3.heartbeat, true);
  // the log cannot be read after an ambiguous response -> never retry blind; fail the run, the next poll skips what landed
  const c4 = fakeClient({ insertStatus: () => 504, loggedAfterInsert: 'down' });
  await assert.rejects(() => executeVerdicts(doc([pair(1, 2, 'keep')]), { client: c4, env: 'test', discord: async () => true, log: quiet }), /bulk log insert/);
  assert.equal(c4.calls.inserts.length, 1);
}

{ // orientation: the agent swapped survivor/loser -> the executor flips it and says so on the row (finding 4)
  const c = fakeClient({ ages: [{ id: 3, first_seen_at: '2026-09-01T00:00:00Z' }, { id: 4, first_seen_at: '2026-09-10T00:00:00Z' }] });
  const s = await executeVerdicts(doc([merge(4, 3)]), { client: c, env: 'test', discord: async () => true, log: quiet }); // agent says 4 survives; 3 is older
  assert.deepEqual(c.calls.rpc[0].args, { p_loser_id: 4, p_survivor_id: 3, p_run_id: RUN });
  assert.equal(s.flipped, 1); assert.equal(s.merged, 1);
  const row = c.calls.inserts[0][0];
  assert.equal(row.merged, true);
  assert.ok(row.rationale.startsWith('same event 3/4') && row.rationale.endsWith('[executor: survivor/loser flipped - story 3 is older]'));
  // correct orientation is left alone
  const c2 = fakeClient();
  const s2 = await executeVerdicts(doc([merge(3, 4)]), { client: c2, env: 'test', discord: async () => true, log: quiet });
  assert.equal(s2.flipped, 0); assert.equal(c2.calls.inserts[0][0].rationale, 'same event 3/4');
  assert.ok(c2.calls.gets.some((g) => g === '/stories?select=id,first_seen_at&id=in.(3,4)'), 'one narrow read per merge (egress: two columns, two rows)');
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

{ // re-run after "merge executed, log insert died": state is seeded from story_merge_audit (findings 1 + 3)
  const c = fakeClient({ audit: [{ loser_id: 4, survivor_id: 3 }] }); // 4->3 merged in the first attempt, nothing logged
  const s = await executeVerdicts(doc([merge(3, 4), merge(3, 9), merge(5, 6)]), { client: c, env: 'prod', discord: async () => true, log: quiet });
  assert.deepEqual(c.calls.rpc.map((r) => `${r.args.p_loser_id}->${r.args.p_survivor_id}`), ['6->5'], '3<-4 is not re-merged and 3<-9 is not chained onto it');
  assert.equal(s.recovered, 1); assert.equal(s.merged, 1); assert.equal(s.deferred, 1);
  const rows = c.calls.inserts.flat();
  const r34 = rows.find((r) => r.story_id_a === 3 && r.story_id_b === 4);
  assert.equal(r34.merged, true, 'the executed merge gets its merged=true row (admin unmerge is driven from it)');
  assert.equal(r34.verdict, 'merge');
  assert.ok(rows.find((r) => r.story_id_b === 9).rationale.startsWith('deferred: chained merge (story 3 already merged this run)'));
  assert.ok(c.calls.gets.some((g) => g.startsWith('/story_merge_audit?select=loser_id,survivor_id&run_id=eq.')), 'audit read is narrow and keyed by run_id');
  // merges from an earlier attempt count toward the cap
  const ten = Array.from({ length: 10 }, (_, i) => ({ loser_id: 1001 + i * 2, survivor_id: 1000 + i * 2 }));
  const c2 = fakeClient({ audit: ten, existing: ten.map((m) => ({ story_id_a: m.survivor_id, story_id_b: m.loser_id })) });
  const s2 = await executeVerdicts(doc([merge(5, 6)]), { client: c2, env: 'prod', discord: async () => true, log: quiet });
  assert.equal(c2.calls.rpc.length, 0); assert.equal(s2.deferred, 1);
  assert.ok(c2.calls.inserts.flat()[0].rationale.startsWith('deferred: run cap of 10 reached'));
  // a dry run never merges, so it never reads the audit table or story ages
  const c3 = fakeClient();
  await executeVerdicts(doc([merge(3, 4)], { dry_run: true }), { client: c3, env: 'test', discord: async () => true, log: quiet });
  assert.ok(!c3.calls.gets.some((g) => g.startsWith('/story_merge_audit')) && !c3.calls.gets.some((g) => g.startsWith('/stories')));
}

{ // the real client asks PostgREST not to echo inserted rows back (finding 8)
  const seen = [];
  const client = makeClient({ supabaseUrl: 'https://example.supabase.co/', serviceKey: 'k', fetchImpl: async (url, init) => { seen.push({ url, init }); return { status: 201, ok: true, text: async () => '' }; } });
  const r = await client.insert('clustering_judge_log', [{ a: 1 }]);
  assert.equal(r.status, 201);
  assert.equal(seen[0].init.headers.Prefer, 'return=minimal');
  assert.equal(seen[0].url, 'https://example.supabase.co/rest/v1/clustering_judge_log');
  // the reconcile write is a PATCH scoped by the query string
  await client.update('clustering_judge_log', 'id=eq.77&merged=is.false&select=id', { merged: true });
  assert.equal(seen[1].init.method, 'PATCH');
  assert.equal(seen[1].url, 'https://example.supabase.co/rest/v1/clustering_judge_log?id=eq.77&merged=is.false&select=id');
  assert.equal(seen[1].init.body, JSON.stringify({ merged: true }));
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
  // review P0: privileged code must come from the default branch; an inbox branch contributes ONE json file
  const code = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'); // comments may mention "push"
  assert.ok(!/^\s+(push|pull_request|pull_request_target|create):/m.test(code) && /^\s+schedule:/m.test(code) && /^\s+workflow_dispatch:/m.test(code), 'never push-triggered: a push run would take its workflow + code from the pushed branch');
  assert.ok(code.includes('uses: actions/checkout@v4') && !/^\s+ref:/m.test(code), 'checkout has no ref: default branch on schedule, never an inbox branch');
  assert.ok(!/git (checkout|switch|worktree|merge|pull)/.test(code), 'no step checks an inbox branch out');
  const stepOf = (needle) => { const i = code.indexOf(needle); assert.ok(i > 0, `workflow has ${needle}`); const from = code.lastIndexOf('- name:', i); const to = code.indexOf('- name:', i); return code.slice(from, to < 0 ? undefined : to); };
  assert.ok(!stepOf('process-judge-inbox.js collect').includes('secrets.'), 'the step that touches inbox branches has no secrets in scope');
  const prodStep = stepOf('secrets.SUPABASE_SERVICE_KEY');
  assert.ok(prodStep.includes("github.ref == 'refs/heads/main'") && prodStep.includes('execute "$RUNNER_TEMP/judge-inbox" prod'), 'PROD secrets only reach code from main');
  const inboxSrc = readFileSync(new URL('../clustering/process-judge-inbox.js', import.meta.url), 'utf8');
  assert.ok(inboxSrc.includes("'cat-file', 'blob'") && !/'(checkout|switch|worktree)'/.test(inboxSrc), 'verdict files are copied with git cat-file; nothing is checked out');
  assert.ok(inboxSrc.includes("new URL('./execute-judge-verdicts.js', import.meta.url)"), 'the executor that runs is the trusted checkout\'s own copy');
  assert.ok(wf.includes('secrets.SUPABASE_TEST_SERVICE_KEY') && wf.includes('secrets.SUPABASE_SERVICE_KEY'), 'service keys come from GitHub secrets');
  // finding 6: nothing derived from the branch name is expression-interpolated into a run script
  // (env: mappings are fine - the shell never parses those; "KEY: ${{ ... }}" lines are the env form)
  const interpolated = wf.split('\n').filter((l) => /\$\{\{\s*(steps\.meta\.outputs\.file|github\.ref_name|github\.head_ref)/.test(l) && !/^\s*[A-Z_]+:\s*\$\{\{/.test(l));
  assert.deepEqual(interpolated, [], 'branch-derived values reach run scripts through env only');
  // branch names are shape-checked in trusted code before they become a path
  assert.deepEqual(parseInboxBranch(`judge-run/prod/${RUN}`), { env: 'prod', runId: RUN });
  assert.deepEqual(parseInboxBranch(`judge-run/test/${RUN}`), { env: 'test', runId: RUN });
  for (const bad of [`judge-run/staging/${RUN}`, `judge-run/prod/${RUN}/x`, 'judge-run/prod/../../etc', `judge-run/prod/${RUN};rm -rf`, 'judge-run/prod/$(id)', `judge-rejected/prod/${RUN}`, '', null]) {
    assert.equal(parseInboxBranch(bad), null, `rejects ${bad}`);
  }
  assert.equal(actionForExit(0), 'delete'); assert.equal(actionForExit(2), 'park'); assert.equal(actionForExit(1), 'keep'); assert.equal(actionForExit(null), 'keep');
  assert.equal(MAX_FILE_BYTES, 1024 * 1024);
  const execSrc = readFileSync(new URL('../clustering/execute-judge-verdicts.js', import.meta.url), 'utf8');
  assert.ok(/verdict file rejected[^\n]*process\.exit\(2\)/.test(execSrc), 'a rejected file exits 2 (parked once), a runtime failure exits 1 (retried)');
  // finding 10: the prompt no longer points at renumbered steps or at a DB it does not write
  const prompt = readFileSync(new URL('../../docs/features/clustering-judge/prompt-v1.md', import.meta.url), 'utf8');
  assert.ok(!prompt.includes('DISCORD_WEBHOOK_SET') && !prompt.includes('pings a human (Step 7)') && !prompt.includes('no DB writes, no log rows'));
  assert.ok(prompt.includes('equals the number of verdicts'), 'prompt states the candidates rule the executor enforces');
}

console.log('judge-executor: all checks passed');
