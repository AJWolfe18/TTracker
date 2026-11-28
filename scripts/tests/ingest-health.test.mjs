// ADO-597: the daily ingest health check names a PROD that stores no article text, sources with
// empty excerpts, and active feeds gone silent; stays quiet when healthy; checks once a day; reports
// a failed read instead of swallowing it; and never selects content or reads without a limit.
import assert from 'node:assert/strict';
import { runIngestHealth, buildIngestAlert, shouldCheck } from '../monitoring/alert-ingest-health.js';
import { grantedClaimStub } from './fixtures/granted-claim.mjs';

const NOON = Date.parse('2026-10-03T12:00:00Z');
const silent = () => {};
// The daily run (ADO-639): the Netlify-started workflow_dispatch run
const env = { SUPABASE_URL: 'https://db.test/', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://d.test/h', GITHUB_EVENT_NAME: 'workflow_dispatch' };

// fetchImpl: `route(url)` returns rows (or an Error / {status, body}); records every call.
// The per-feed stale read (ADO-625) goes to `stale(url)` instead, healthy (no rows) by default.
// `supabase` is the daily claim (ADO-645), always granted: these tests are about the check.
function harness(route, stale = () => []) {
  const supabase = grantedClaimStub();
  const seen = { queries: [], discord: [], rpc: supabase.calls };
  const fetchImpl = async (url, init) => {
    if (url === env.DISCORD_WEBHOOK_URL) { seen.discord.push(JSON.parse(init.body).embeds[0]); return new Response(null, { status: 204 }); }
    const u = new URL(url);
    seen.queries.push(u);
    const r = u.searchParams.has('last_item_published_at') ? stale(u) : route(u);
    if (r instanceof Error) throw r;
    if (r && r.status) return new Response(r.body, { status: r.status });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  return { seen, fetchImpl, supabase };
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
  const { seen, fetchImpl, supabase } = harness(healthy);
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
  assert.equal(r.state, 'healthy');
  assert.equal(seen.discord.length, 0);
  for (const q of seen.queries) {
    assert.ok(Number(q.searchParams.get('limit')) > 0, `unbounded read: ${q}`);
    assert.ok(!/content|embedding/.test(q.searchParams.get('select')), `selects a big column: ${q}`);
  }
  // duplicate source names (two Guardian feeds) are checked once
  assert.equal(seen.queries.filter((q) => q.searchParams.get('source_name') === 'eq.The Guardian').length, 1);
  // ADO-645: claims the day first, marks it done after
  assert.deepEqual(seen.rpc.map((c) => c.fn), ['claim_daily_check', 'finish_daily_check']);
  assert.deepEqual(seen.rpc[0].args, { p_check_name: 'ingest_health', p_slot_date: '2026-10-03', p_run_id: seen.rpc[0].args.p_run_id, p_force: false });
  assert.equal(seen.rpc[1].args.p_status, 'done');
}

// --- the October 2 PROD state: no content, Votebeat empty, Reason silent -> one message naming all three
{
  const { seen, fetchImpl, supabase } = harness((u) => {
    if (table(u) === 'feed_registry') return FEEDS;
    if (u.searchParams.get('content') === 'not.is.null') return [];
    if (u.searchParams.get('or')) return [{ source_name: 'Votebeat' }, { source_name: 'Votebeat' }];
    if (u.searchParams.get('source_name') === 'eq.Reason') return [];
    return [{ id: 'art-1' }];
  });
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
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
  const { fetchImpl, supabase } = harness((u) => (table(u) === 'feed_registry' ? FEEDS : []));
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
  assert.equal(r.findings.recentArticles, false);
  assert.equal(r.findings.recentWithContent, true);
  assert.deepEqual(r.findings.silentSources, ['NYT Politics', 'Reason', 'The Guardian']);
}

// --- a failed read is reported, never swallowed, and the other checks still run
{
  const { seen, fetchImpl, supabase } = harness((u) => (table(u) === 'feed_registry' ? { status: 500, body: 'boom' } : healthy(u)));
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
  assert.equal(r.state, 'problems');
  assert.match(seen.discord[0].description, /Could not read: silent-feed check, feed list \(500 boom\)/);
  assert.equal(r.findings.recentWithContent, true);
  // a check with a failed read did not finish: the day stays open for a later run (Codex P2)
  assert.equal(seen.rpc.at(-1).args.p_status, 'failed');
}

// --- one failed per-source read names that source; the sources after it are still checked
{
  const { seen, fetchImpl, supabase } = harness((u) => {
    if (table(u) === 'feed_registry') return FEEDS;
    if (u.searchParams.get('source_name') === 'eq.NYT Politics') return new Error('timeout');
    if (u.searchParams.get('source_name') === 'eq.The Guardian') return [];
    return healthy(u);
  });
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
  assert.deepEqual(r.findings.readErrors, ['silent-feed check for NYT Politics (timeout)']);
  assert.deepEqual(r.findings.silentSources, ['The Guardian'], 'Reason and The Guardian were still checked after NYT failed');
  assert.match(seen.discord[0].description, /The Guardian/);
}

// --- ADO-601: an active feed with 5+ failed fetches is named as stopped, with its count; fresh feeds are not
{
  const feeds = [{ source_name: 'NYT Politics', failure_count: 0 }, { source_name: 'Time', failure_count: 7 }, { source_name: 'Reason', failure_count: 4 }];
  const { seen, fetchImpl, supabase } = harness((u) => (table(u) === 'feed_registry' ? feeds : healthy(u)));
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
  assert.deepEqual(r.findings.quarantinedSources, ['Time (7 failed fetches)']);
  assert.equal(r.state, 'problems');
  assert.match(seen.discord[0].description, /Feeds failing every fetch\*\* \(5\+ failed fetches in a row; retried once a day and still failing\): Time \(7 failed fetches\)/);
  assert.ok(!/Reason/.test(seen.discord[0].description), 'a feed under the threshold is not named');
}
// --- a source whose only feed is stopped is named once (as stopped), not also as silent; a source with
//     one stopped and one working feed is still checked for silence
{
  const feeds = [{ source_name: 'Time', failure_count: 7 }, { source_name: 'The Guardian', failure_count: 5 }, { source_name: 'The Guardian', failure_count: 0 }];
  const { seen, fetchImpl, supabase } = harness((u) => {
    if (table(u) === 'feed_registry') return feeds;
    if (u.searchParams.get('source_name')) return [];
    return healthy(u);
  });
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
  assert.deepEqual(r.findings.silentSources, ['The Guardian']);
  assert.equal(seen.queries.filter((q) => q.searchParams.get('source_name') === 'eq.Time').length, 0, 'a stopped-only source is not read for silence');
  assert.ok(!/no article in 7 days:\*\* Time/.test(seen.discord[0].description));
}

// --- ADO-625 stale feeds: a working feed whose newest item is old is named even though its source
//     still gets articles (Politico Top vs Politico Congress); a silent source or a stopped feed is not
//     named twice; the read is bounded and filters on the silent window
{
  const staleRows = [
    { feed_name: 'Politico Top', source_name: 'Politico', failure_count: 0 },
    { feed_name: 'Reason Latest', source_name: 'Reason', failure_count: 0 },
    { feed_name: 'Time Politics', source_name: 'Time', failure_count: 9 },
    { feed_name: 'Axios Politics', source_name: 'Axios', failure_count: 0 },
  ];
  const feeds = [...FEEDS, { source_name: 'Politico' }, { source_name: 'Axios' }];
  const { seen, fetchImpl, supabase } = harness((u) => {
    if (table(u) === 'feed_registry') return feeds;
    if (u.searchParams.get('or')) return [];
    if (u.searchParams.get('source_name') === 'eq.Reason') return [];
    if (u.searchParams.get('source_name') === 'eq.Axios') return { status: 500, body: 'flaky' };
    return [{ id: 'art-1' }];
  }, () => staleRows);
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
  assert.deepEqual(r.findings.staleFeeds, ['Politico Top'], 'a source whose silence read failed (Axios) is unverified, not stale');
  assert.match(seen.discord[0].description, /Feeds with no new item in 7 days\*\* \(their source still gets new articles\): Politico Top\./);
  const q = seen.queries.find((x) => x.searchParams.has('last_item_published_at'));
  assert.equal(q.searchParams.get('last_item_published_at'), `lt.${new Date(NOON - 7 * 24 * 3600000).toISOString()}`);
  assert.ok(Number(q.searchParams.get('limit')) > 0);
}

// --- ADO-625 before migration 131: the column is missing on PROD -> stale check skipped quietly
//     (no "could not read" line every day); any other failure of that read is still reported
{
  const missing = { status: 400, body: '{"code":"42703","message":"column feed_registry.last_item_published_at does not exist"}' };
  const { seen, fetchImpl, supabase } = harness(healthy, () => missing);
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: NOON });
  assert.equal(r.state, 'healthy');
  assert.equal(seen.discord.length, 0);
  // ...and a stopped feed is then described as NOT retried, with the manual reset
  const h1 = harness((u) => (table(u) === 'feed_registry' ? [...FEEDS, { source_name: 'Time', failure_count: 7 }] : healthy(u)), () => missing);
  const r1 = await runIngestHealth({ env, fetchImpl: h1.fetchImpl, supabase: h1.supabase, log: silent, now: NOON });
  assert.equal(r1.findings.retryActive, false);
  assert.match(h1.seen.discord[0].description, /Feeds failing every fetch\*\* \(5\+ failed fetches in a row\): Time \(7 failed fetches\)\. Nothing retries them until migration 131/);
  const h2 = harness(healthy, () => ({ status: 500, body: 'boom' }));
  const r2 = await runIngestHealth({ env, fetchImpl: h2.fetchImpl, supabase: h2.supabase, log: silent, now: NOON });
  assert.match(r2.findings.readErrors.join(' '), /stale-feed check \(500 boom\)/);
}

// --- once a day (ADO-639): only a workflow_dispatch run checks (the Netlify daily start at 13:23 UTC,
//     or a manual run), whatever the hour. GitHub's scheduled runs never do, even inside the old
//     12:00-17:59 UTC window (a late one would post a second time); push runs and local runs never do.
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch' } }), true);
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'schedule' } }), false, 'a scheduled run never checks, even a late one at 13:05 UTC');
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'push' } }), false, 'a push must not post a second time');
assert.equal(shouldCheck({ env: {} }), false, 'a local run without the override does not check');
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'schedule', INGEST_HEALTH_FORCE: '1' } }), true, 'INGEST_HEALTH_FORCE=1 still forces a check');
assert.equal(shouldCheck({ env: { INGEST_HEALTH_FORCE: '1' } }), true);
assert.equal(shouldCheck({ env: { GITHUB_EVENT_NAME: 'schedule', INGEST_HEALTH_FORCE: 'true' } }), false, 'only the exact value 1 forces');
for (const [event, hour] of [['schedule', '13:05'], ['schedule', '07:02'], ['push', '13:30']]) {
  const { seen, fetchImpl, supabase } = harness(healthy);
  const logged = [];
  const r = await runIngestHealth({ env: { ...env, GITHUB_EVENT_NAME: event }, fetchImpl, supabase, log: (l) => logged.push(l), now: Date.parse(`2026-10-03T${hour}:00Z`) });
  assert.equal(r.state, 'skipped', `${event} at ${hour}`);
  assert.equal(seen.queries.length, 0, 'a skipped run reads nothing');
  assert.equal(seen.rpc.length, 0, 'and claims nothing');
  assert.match(logged[0], new RegExp(`workflow_dispatch run.*this is a ${event} run`));
}
{
  // the dispatch run checks at any hour, including the Netlify start time
  const { seen, fetchImpl, supabase } = harness(healthy);
  const r = await runIngestHealth({ env, fetchImpl, supabase, log: silent, now: Date.parse('2026-10-03T13:23:00Z') });
  assert.equal(r.state, 'healthy');
  assert.ok(seen.queries.length > 0);
}

// --- missing credentials: throws so the workflow's follow-up step reports a dead monitor
await assert.rejects(() => runIngestHealth({ env: {}, log: silent, now: NOON }), /not set/);

// --- healthy findings build no alert
assert.equal(buildIngestAlert({ recentArticles: true, recentWithContent: true, emptyExcerptSources: [], silentSources: [], silentDays: 7, readErrors: [] }), null);

console.log('ingest-health.test: all assertions passed');
