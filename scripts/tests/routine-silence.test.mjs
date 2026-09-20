// ADO-586: the routine silence check alerts on a stale Judge or Stories log, stays quiet when
// both are fresh, reports a failed read instead of swallowing it, and always reads a bounded query.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSilenceAlert, runRoutineSilenceAlert, ROUTINES } from '../monitoring/alert-routine-silence.js';

const NOW = Date.parse('2026-09-20T18:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const silent = () => {};
const env = { SUPABASE_URL: 'https://db.test/', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://d.test/h' };

// fetchImpl that serves each log table from `tables` and records every call
function harness(tables) {
  const seen = { queries: [], discord: [] };
  const fetchImpl = async (url, init) => {
    if (url === env.DISCORD_WEBHOOK_URL) { seen.discord.push(JSON.parse(init.body).embeds[0]); return new Response(null, { status: 204 }); }
    const u = new URL(url);
    seen.queries.push(u);
    const table = u.pathname.split('/').pop();
    const t = tables[table];
    if (t instanceof Error) throw t;
    if (t && t.status) return new Response(t.body, { status: t.status });
    return new Response(JSON.stringify(t), { status: 200 });
  };
  return { seen, fetchImpl };
}

// --- both fresh: no message (quiet runs stay silent) -------------------------
{
  const { seen, fetchImpl } = harness({ clustering_judge_log: [{ created_at: hoursAgo(5) }], stories_enrichment_log: [{ created_at: hoursAgo(1) }] });
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r, [{ key: 'judge', state: 'fresh', posted: false }, { key: 'stories', state: 'fresh', posted: false }]);
  assert.equal(seen.discord.length, 0);
  // bounded reads only: newest row, never an unlimited select
  for (const q of seen.queries) {
    assert.equal(q.searchParams.get('limit'), '1');
    assert.equal(q.searchParams.get('order'), 'created_at.desc');
    assert.equal(q.searchParams.get('select'), 'created_at');
  }
  // a manual merge row must not hide a silent Judge agent
  assert.equal(seen.queries[0].searchParams.get('source'), 'eq.judge-agent');
}

// --- stale Judge only ------------------------------------------------------
{
  const { seen, fetchImpl } = harness({ clustering_judge_log: [{ created_at: hoursAgo(13) }], stories_enrichment_log: [{ created_at: hoursAgo(2) }] });
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r.map((x) => x.state), ['silent', 'fresh']);
  assert.equal(seen.discord.length, 1);
  assert.match(seen.discord[0].title, /Clustering Judge routine is silent/);
  assert.match(seen.discord[0].description, /13 hours/);
  assert.match(seen.discord[0].description, /September 20, 2026/); // Central time, written out
  assert.match(seen.discord[0].description, / CT/);
}

// --- stale Stories only ----------------------------------------------------
{
  const { seen, fetchImpl } = harness({ clustering_judge_log: [{ created_at: hoursAgo(3) }], stories_enrichment_log: [{ created_at: hoursAgo(7) }] });
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r.map((x) => x.state), ['fresh', 'silent']);
  assert.equal(seen.discord.length, 1);
  assert.match(seen.discord[0].title, /Stories enrichment routine is silent/);
}

// --- both stale: one message per routine -----------------------------------
{
  const { seen, fetchImpl } = harness({ clustering_judge_log: [{ created_at: hoursAgo(30) }], stories_enrichment_log: [{ created_at: hoursAgo(30) }] });
  await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.equal(seen.discord.length, 2);
}

// --- failed read is reported, not swallowed, and does not throw -------------
{
  const lines = [];
  const { seen, fetchImpl } = harness({ clustering_judge_log: { status: 500, body: 'boom' }, stories_enrichment_log: new Error('network down') });
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: (l) => lines.push(l), now: NOW });
  assert.deepEqual(r.map((x) => x.state), ['read_failed', 'read_failed']);
  assert.equal(seen.discord.length, 2);
  assert.match(seen.discord[0].title, /could not read its log/);
  assert.match(seen.discord[0].description, /500 boom/);
  assert.match(seen.discord[1].description, /network down/);
  assert.ok(lines.some((l) => /judge: read_failed/.test(l)));
}

// --- PostgREST error object (42501 no grant) is a failed read, not "fresh" ---
{
  const { fetchImpl } = harness({ clustering_judge_log: { code: '42501' }, stories_enrichment_log: [{ created_at: hoursAgo(1) }] });
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r.map((x) => x.state), ['read_failed', 'fresh']);
}

// --- empty table counts as silent -------------------------------------------
{
  const { seen, fetchImpl } = harness({ clustering_judge_log: [], stories_enrichment_log: [{ created_at: hoursAgo(1) }] });
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.equal(r[0].state, 'silent');
  assert.match(seen.discord[0].description, /No log row found at all/);
}

// --- Discord down never throws; no webhook = no post ------------------------
{
  const fetchImpl = async (url) => {
    if (url.startsWith('https://d.test')) throw new Error('discord down');
    return new Response(JSON.stringify([{ created_at: hoursAgo(40) }]), { status: 200 });
  };
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r.map((x) => x.posted), [false, false]);
  const r2 = await runRoutineSilenceAlert({ env: { ...env, DISCORD_WEBHOOK_URL: '' }, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r2.map((x) => x.state), ['silent', 'silent']);
}

// --- thresholds: boundary + env override + missing credentials --------------
{
  const judge = ROUTINES.find((r) => r.key === 'judge');
  assert.equal(buildSilenceAlert(judge, { newestIso: hoursAgo(12), hours: 12, now: NOW }), null);
  assert.ok(buildSilenceAlert(judge, { newestIso: hoursAgo(12.1), hours: 12, now: NOW }));
  const { seen, fetchImpl } = harness({ clustering_judge_log: [{ created_at: hoursAgo(13) }], stories_enrichment_log: [{ created_at: hoursAgo(1) }] });
  await runRoutineSilenceAlert({ env: { ...env, SILENCE_HOURS_JUDGE: '16' }, fetchImpl, log: silent, now: NOW });
  assert.equal(seen.discord.length, 0);
  await assert.rejects(() => runRoutineSilenceAlert({ env: {}, fetchImpl, log: silent, now: NOW }), /not set/);
  assert.deepEqual(ROUTINES.map((r) => [r.key, r.hours]), [['judge', 12], ['stories', 6]]);
}

// --- CLI: a monitor that cannot run exits 1 so the workflow's follow-up step reports it ------
{
  const script = fileURLToPath(new URL('../monitoring/alert-routine-silence.js', import.meta.url));
  // empty strings (not unset) so a local .env cannot fill them back in
  const r = spawnSync(process.execPath, [script], { env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', DISCORD_WEBHOOK_URL: '' }, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not run: SUPABASE_URL/);
  // project rule: no console.log in production code
  assert.doesNotMatch(readFileSync(script, 'utf8'), /console\.log\(/);
}

console.log('routine-silence: ok');
