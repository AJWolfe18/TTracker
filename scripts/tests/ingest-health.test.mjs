// ADO-597: the daily ingest health check names a PROD that stores no article text, sources with
// empty excerpts, and active feeds gone silent; stays quiet when healthy; checks once a day; reports
// a failed read instead of swallowing it; and never selects content or reads without a limit.
import assert from 'node:assert/strict';
import { runIngestHealth, buildIngestAlert, shouldCheck } from '../monitoring/alert-ingest-health.js';

const NOON = Date.parse('2026-10-03T12:00:00Z');
const silent = () => {};
const env = { SUPABASE_URL: 'https://db.test/', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://d.test/h' };

// fetchImpl: `route(url)` returns rows (or an Error / {status, body}); records every call
function harness(route) {
  const seen = { queries: [], discord: [] };
  const fetchImpl = async (url, init) => {
    if (url === env.DISCORD_WEBHOOK_URL) { seen.discord.push(JSON.parse(init.body).embeds[0]); return new Response(null, { status: 204 }); }
    const u = new URL(url);
    seen.queries.push(u);
    const r = route(u);
    if (r instanceof Error) throw r;
    if (r && r.status) return new Response(r.body, { status: r.status });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  return { seen, fetchImpl };
}
const table = (u) => u.pathname.split('/').pop();
const FEEDS = [{ source_name: 'NYT Politics' }, { source_name: 'Reason' }, { source_name: 'The Guardian' }, { source_name: 'The Guardian' }];

// healthy PROD: content stored, no empty excerpts, every source fresh
const healthy = (u) => {
  if (table(u) === 'feed_registry') return FEEDS;
  if (u.searchParams.get('or')) return [];
  return [{ id: 'art-1' }];
};

// --- healthy: no message, and every read is bounded and never selects content -----------
{
  const { seen, fetchImpl } = harness(healthy);
  const r = await runIngestHealth({ env, fetchImpl, log: silent, now: NOON });
  assert.equal(r.state, 'healthy');
  assert.equal(seen.discord.length, 0);
  for (const q of seen.queries) {
    assert.ok(Number(q.searchParams.get('limit')) > 0, `unbounded read: ${q}`);
    assert.ok(!/content|embedding/.test(q.searchParams.get('select')), `selects a big column: ${q}`);
  }
  // duplicate source names (two Guardian feeds) are checked once
  assert.equal(seen.queries.filter((q) => q.searchParams.get('source_name') === 'eq.The Guardian').length, 1);
}

// --- the October 2 PROD state: no content, Votebeat empty, Reason silent -> one message naming all three
{
  const { seen, fetchImpl } = harness((u) => {
    if (table(u) === 'feed_registry') return FEEDS;
    if (u.searchParams.get('content') === 'not.is.null') return [];
    if (u.searchParams.get('or')) return [{ source_name: 'Votebeat' }, { source_name: 'Votebeat' }];
    if (u.searchParams.get('source_name') === 'eq.Reason') return [];
    return [{ id: 'art-1' }];
  });
  const r = await runIngestHealth({ env, fetchImpl, log: silent, now: NOON });
  assert.equal(r.state, 'problems');
  assert.equal(seen.discord.length, 1);
  const d = seen.discord[0].description;
  assert.match(d, /No article from the last 24 hours stored its text/);
  assert.match(d, /Votebeat/);
  assert.ok(!/Votebeat, Votebeat/.test(d), 'sources are de-duplicated');
  assert.match(d, /no article in 7 days:\*\* Reason/);
  assert.ok(!/NYT Politics/.test(d.split('no article in')[1] ?? ''), 'fresh feeds are not listed as silent');
}

// --- no articles at all in 24h: content check does not fire on an empty table (silent feeds will)
{
  const { fetchImpl } = harness((u) => (table(u) === 'feed_registry' ? FEEDS : []));
  const r = await runIngestHealth({ env, fetchImpl, log: silent, now: NOON });
  assert.equal(r.findings.recentArticles, false);
  assert.equal(r.findings.recentWithContent, true);
  assert.deepEqual(r.findings.silentSources, ['NYT Politics', 'Reason', 'The Guardian']);
}

// --- a failed read is reported, never swallowed, and the other checks still run
{
  const { seen, fetchImpl } = harness((u) => (table(u) === 'feed_registry' ? { status: 500, body: 'boom' } : healthy(u)));
  const r = await runIngestHealth({ env, fetchImpl, log: silent, now: NOON });
  assert.equal(r.state, 'problems');
  assert.match(seen.discord[0].description, /Could not read: silent-feed check, feed list \(500 boom\)/);
  assert.equal(r.findings.recentWithContent, true);
}

// --- one failed per-source read names that source; the sources after it are still checked
{
  const { seen, fetchImpl } = harness((u) => {
    if (table(u) === 'feed_registry') return FEEDS;
    if (u.searchParams.get('source_name') === 'eq.NYT Politics') return new Error('timeout');
    if (u.searchParams.get('source_name') === 'eq.The Guardian') return [];
    return healthy(u);
  });
  const r = await runIngestHealth({ env, fetchImpl, log: silent, now: NOON });
  assert.deepEqual(r.findings.readErrors, ['silent-feed check for NYT Politics (timeout)']);
  assert.deepEqual(r.findings.silentSources, ['The Guardian'], 'Reason and The Guardian were still checked after NYT failed');
  assert.match(seen.discord[0].description, /The Guardian/);
}

// --- once a day: the scheduled run starting 12:00-17:59 UTC checks (late starts included),
//     manual runs always do, push-triggered runs never do
assert.equal(shouldCheck({ env: {}, now: NOON }), true);
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'schedule' }, now: Date.parse('2026-10-03T13:05:00Z') }), true, 'a 12:00 run GitHub started late still checks');
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'schedule' }, now: Date.parse('2026-10-03T11:59:00Z') }), false);
assert.equal(shouldCheck({ env: {}, now: Date.parse('2026-10-03T18:00:00Z') }), false);
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'push' }, now: Date.parse('2026-10-03T12:30:00Z') }), false, 'a push inside the window must not post a second time');
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch' }, now: Date.parse('2026-10-03T18:00:00Z') }), true);
assert.equal(shouldCheck({ env: { INGEST_HEALTH_FORCE: '1' }, now: Date.parse('2026-10-03T06:00:00Z') }), true);
{
  const { seen, fetchImpl } = harness(healthy);
  const r = await runIngestHealth({ env, fetchImpl, log: silent, now: Date.parse('2026-10-03T06:00:00Z') });
  assert.equal(r.state, 'skipped');
  assert.equal(seen.queries.length, 0, 'a skipped run reads nothing');
}

// --- missing credentials: throws so the workflow's follow-up step reports a dead monitor
await assert.rejects(() => runIngestHealth({ env: {}, log: silent, now: NOON }), /not set/);

// --- healthy findings build no alert
assert.equal(buildIngestAlert({ recentArticles: true, recentWithContent: true, emptyExcerptSources: [], silentSources: [], silentDays: 7, readErrors: [] }), null);

console.log('ingest-health.test: all assertions passed');
