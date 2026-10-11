// ADO-586: the routine silence check alerts on a stale Judge or Stories log, stays quiet when
// both are fresh, reports a failed read instead of swallowing it, and always reads a bounded query.
// ADO-624: SCOTUS, EO, Pardons and the Election front agent are covered too; the weekday-only
// routines (SCOTUS, EO) never alert over a weekend.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildSilenceAlert, runRoutineSilenceAlert, silenceHours, ROUTINES } from '../monitoring/alert-routine-silence.js';

const NOW = Date.parse('2026-09-20T18:00:00Z'); // a Sunday
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const silent = () => {};
const env = { SUPABASE_URL: 'https://db.test/', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://d.test/h' };

// The four ADO-624 routines, fresh, so the Judge/Stories cases below only have to name their own tables.
const FRESH_NEW = {
  scotus_enrichment_log: [{ ran_at: hoursAgo(2) }],
  'routine_heartbeats:eo': [{ created_at: hoursAgo(2) }],
  pardons_enrichment_log: [{ ran_at: hoursAgo(2) }],
  'routine_heartbeats:fronts': [{ created_at: hoursAgo(2) }],
};
const NEW_FRESH_RESULTS = ['scotus', 'eo', 'pardons', 'fronts'].map((key) => ({ key, state: 'fresh', posted: false }));

// fetchImpl that serves each log table from `tables` and records every call
function harness(tables) {
  const seen = { queries: [], discord: [] };
  const fetchImpl = async (url, init) => {
    if (url === env.DISCORD_WEBHOOK_URL) { seen.discord.push(JSON.parse(init.body).embeds[0]); return new Response(null, { status: 204 }); }
    const u = new URL(url);
    seen.queries.push(u);
    let table = u.pathname.split('/').pop();
    if (table === 'routine_heartbeats') table += `:${u.searchParams.get('routine').replace('eq.', '')}`;
    const t = table in tables ? tables[table] : FRESH_NEW[table];
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
  assert.deepEqual(r, [{ key: 'judge', state: 'fresh', posted: false }, { key: 'stories', state: 'fresh', posted: false }, ...NEW_FRESH_RESULTS]);
  assert.equal(seen.discord.length, 0);
  // bounded reads only: newest row, never an unlimited select
  assert.equal(seen.queries.length, 6);
  for (const q of seen.queries) {
    const col = q.searchParams.get('select');
    assert.ok(['created_at', 'ran_at'].includes(col));
    assert.equal(q.searchParams.get('limit'), '1');
    assert.equal(q.searchParams.get('order'), `${col}.desc`);
  }
  // only the cloud agents' own rows count for SCOTUS and Pardons; heartbeats are per routine
  assert.equal(seen.queries[2].searchParams.get('run_source'), 'eq.cloud-agent');
  assert.equal(seen.queries[4].searchParams.get('run_source'), 'eq.cloud-agent');
  assert.equal(seen.queries[3].searchParams.get('routine'), 'eq.eo');
  assert.equal(seen.queries[5].searchParams.get('routine'), 'eq.fronts');
  // a manual merge row must not hide a silent Judge agent
  assert.equal(seen.queries[0].searchParams.get('source'), 'eq.judge-agent');
}

// --- stale Judge only ------------------------------------------------------
{
  const { seen, fetchImpl } = harness({ clustering_judge_log: [{ created_at: hoursAgo(13) }], stories_enrichment_log: [{ created_at: hoursAgo(2) }] });
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r.map((x) => x.state), ['silent', 'fresh', 'fresh', 'fresh', 'fresh', 'fresh']);
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
  assert.deepEqual(r.map((x) => x.state), ['fresh', 'silent', 'fresh', 'fresh', 'fresh', 'fresh']);
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
  assert.deepEqual(r.map((x) => x.state), ['read_failed', 'read_failed', 'fresh', 'fresh', 'fresh', 'fresh']);
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
  assert.deepEqual(r.map((x) => x.state), ['read_failed', 'fresh', 'fresh', 'fresh', 'fresh', 'fresh']);
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
    return new Response(JSON.stringify([{ created_at: hoursAgo(100), ran_at: hoursAgo(100) }]), { status: 200 });
  };
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r.map((x) => x.posted), [false, false, false, false, false, false]);
  const r2 = await runRoutineSilenceAlert({ env: { ...env, DISCORD_WEBHOOK_URL: '' }, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r2.map((x) => x.state), ['silent', 'silent', 'silent', 'silent', 'silent', 'silent']);
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
  assert.deepEqual(ROUTINES.map((r) => [r.key, r.hours, Boolean(r.weekdaysOnly)]), [
    ['judge', 12, false], ['stories', 6, false], ['scotus', 30, true], ['eo', 30, true], ['pardons', 30, false], ['fronts', 30, false],
  ]);
}

// --- ADO-624: each new routine, fresh / silent / weekend ---------------------------------
{
  const at = (iso) => Date.parse(iso);
  // weekend hours (UTC) are left out only for weekday routines
  assert.equal(silenceHours(at('2026-10-09T16:05:00Z'), at('2026-10-12T12:00:00Z'), false), 67 + 55 / 60);
  assert.equal(silenceHours(at('2026-10-09T16:05:00Z'), at('2026-10-12T12:00:00Z'), true), 19 + 55 / 60);
  assert.equal(silenceHours(at('2026-10-10T03:00:00Z'), at('2026-10-11T23:00:00Z'), true), 0); // all weekend
  assert.equal(silenceHours(at('2026-10-12T10:00:00Z'), at('2026-10-12T09:00:00Z'), true), -1); // clock skew passes through

  const MONDAY_NOON = at('2026-10-12T12:00:00Z');
  const FRIDAY_RUN = '2026-10-09T16:05:00Z';
  const byKey = (key) => ROUTINES.find((r) => r.key === key);
  for (const key of ['scotus', 'eo']) {
    const r = byKey(key);
    // Friday's run, checked Monday before the next run: the weekend is not counted, so fresh
    assert.equal(buildSilenceAlert(r, { newestIso: FRIDAY_RUN, hours: r.hours, now: MONDAY_NOON }), null, `${key} weekend`);
    // fresh on a weekday
    assert.equal(buildSilenceAlert(r, { newestIso: '2026-10-12T16:05:00Z', hours: r.hours, now: at('2026-10-13T12:00:00Z') }), null, `${key} fresh`);
    // Monday's run missed: Friday 16:05 -> Tuesday 22:00 is 53h55m of weekday time, past 30
    const a = buildSilenceAlert(r, { newestIso: FRIDAY_RUN, hours: r.hours, now: at('2026-10-13T22:00:00Z') });
    assert.ok(a, `${key} silent`);
    assert.match(a.description, /53 weekday hours/);
  }
  for (const key of ['pardons', 'fronts']) {
    const r = byKey(key);
    assert.equal(buildSilenceAlert(r, { newestIso: hoursAgo(24), hours: r.hours, now: NOW }), null, `${key} fresh`);
    // daily routines DO count the weekend (NOW is a Sunday)
    assert.ok(buildSilenceAlert(r, { newestIso: hoursAgo(31), hours: r.hours, now: NOW }), `${key} silent over a weekend`);
  }
  // end to end: a stale heartbeat routine posts one message naming it, and each routine reads its own column
  const { seen, fetchImpl } = harness({
    clustering_judge_log: [{ created_at: hoursAgo(1) }], stories_enrichment_log: [{ created_at: hoursAgo(1) }],
    'routine_heartbeats:fronts': [{ created_at: hoursAgo(40) }], pardons_enrichment_log: [{ created_at: hoursAgo(1) }],
  });
  const r = await runRoutineSilenceAlert({ env, fetchImpl, log: silent, now: NOW });
  assert.deepEqual(r.map((x) => x.state), ['fresh', 'fresh', 'fresh', 'fresh', 'silent', 'silent']);
  assert.match(seen.discord[0].title, /Pardons enrichment routine is silent/);
  assert.match(seen.discord[0].description, /No log row found at all/, 'a created_at row does not satisfy the ran_at read');
  assert.match(seen.discord[1].title, /Election front agent routine is silent/);
  // per-routine env override
  const { seen: s2, fetchImpl: f2 } = harness({
    clustering_judge_log: [{ created_at: hoursAgo(1) }], stories_enrichment_log: [{ created_at: hoursAgo(1) }],
    pardons_enrichment_log: [{ ran_at: hoursAgo(40) }],
  });
  await runRoutineSilenceAlert({ env: { ...env, SILENCE_HOURS_PARDONS: '48' }, fetchImpl: f2, log: silent, now: NOW });
  assert.equal(s2.discord.length, 0);
  // an unparseable timestamp is a failed read, never fresh (weekday) or "NaN hours" (daily)
  const { seen: s3, fetchImpl: f3 } = harness({
    clustering_judge_log: [{ created_at: hoursAgo(1) }], stories_enrichment_log: [{ created_at: hoursAgo(1) }],
    scotus_enrichment_log: [{ ran_at: 'not a date' }], pardons_enrichment_log: [{ ran_at: '' }],
  });
  const r3 = await runRoutineSilenceAlert({ env, fetchImpl: f3, log: silent, now: NOW });
  assert.deepEqual(r3.map((x) => x.state), ['fresh', 'fresh', 'read_failed', 'fresh', 'read_failed', 'fresh']);
  assert.ok(s3.discord.every((m) => /unparseable timestamp/.test(m.description) && !/NaN/.test(m.description)));
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
