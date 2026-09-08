// ADO-581: front sweep runner - window parsing, result shaping, and the
// never-throw contract (RPC error -> skip row, not a red pipeline).
import assert from 'node:assert/strict';
import { parseArgs, assignFronts, formatResult, DEFAULT_LOOKBACK_HOURS } from '../maintenance/assign-fronts.js';

const NOW = new Date('2026-09-08T12:00:00Z');

// --- parseArgs ---------------------------------------------------------------
{
  const d = parseArgs([], NOW);
  assert.equal(d.since, new Date(NOW.getTime() - DEFAULT_LOOKBACK_HOURS * 3600e3).toISOString());
  assert.match(d.label, /last 48h/);

  assert.deepEqual(parseArgs(['--all'], NOW), { since: null, label: 'all active stories' });
  // --all wins over a window flag
  assert.equal(parseArgs(['--hours', '2', '--all'], NOW).since, null);

  assert.equal(parseArgs(['--hours', '168'], NOW).since, '2026-09-01T12:00:00.000Z');
  assert.equal(parseArgs(['--since', '2026-07-01T00:00:00Z'], NOW).since, '2026-07-01T00:00:00.000Z');

  assert.throws(() => parseArgs(['--since'], NOW), /--since needs an ISO timestamp/);
  assert.throws(() => parseArgs(['--since', 'yesterday'], NOW), /--since needs an ISO timestamp/);
  assert.throws(() => parseArgs(['--hours', '0'], NOW), /--hours needs a positive number/);
  assert.throws(() => parseArgs(['--hours', 'x'], NOW), /--hours needs a positive number/);
}

// --- assignFronts: RPC shape -> result ---------------------------------------
{
  let called = null;
  const supabase = { rpc: async (fn, params) => { called = { fn, params }; return { data: [
    { slug: '_candidates', assigned: 120 },
    { slug: 'election-suppression', assigned: 7 },
    { slug: 'iran', assigned: 3 },
  ], error: null }; } };
  const r = await assignFronts(supabase, '2026-09-06T12:00:00.000Z');
  assert.equal(called.fn, 'assign_fronts_sweep');
  assert.deepEqual(called.params, { p_since: '2026-09-06T12:00:00.000Z' });
  assert.equal(r.candidates, 120);
  assert.equal(r.total, 10);
  assert.deepEqual(r.assigned, { 'election-suppression': 7, iran: 3 });
  assert.equal(formatResult(r), 'assigned 10 of 120 candidates (election-suppression=7, iran=3)');

  // backfill passes null through untouched
  await assignFronts(supabase, null);
  assert.deepEqual(called.params, { p_since: null });

  // quiet run: only the _candidates row
  const quiet = { rpc: async () => ({ data: [{ slug: '_candidates', assigned: 4 }], error: null }) };
  const q = await assignFronts(quiet, null);
  assert.equal(q.total, 0);
  assert.equal(formatResult(q), 'assigned 0 of 4 candidates');

  // empty / null data never explodes
  const empty = { rpc: async () => ({ data: null, error: null }) };
  assert.equal(formatResult(await assignFronts(empty, null)), 'assigned 0 of 0 candidates');
}

// --- assignFronts: RPC error surfaces as a throw (main() records the skip) ---
{
  const failing = { rpc: async () => ({ data: null, error: { message: 'function assign_fronts_sweep does not exist' } }) };
  await assert.rejects(() => assignFronts(failing, null), /assign_fronts_sweep does not exist/);
}

console.log('assign-fronts.test: all assertions passed');
