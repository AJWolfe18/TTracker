// ADO-577: Discord helper never throws / never posts without a URL; needs-review alert
// posts only when something is flagged and names the record + reason.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { postDiscord, postDiscordReported, summarizeList, COLORS } from '../lib/discord.js';
import { buildAlert, runNeedsReviewAlert, runCli, DOMAINS, isReminderDay, storiesSlot } from '../monitoring/alert-needs-review.js';
import { dailySlot } from '../lib/daily-check-window.js';

// --- postDiscord -----------------------------------------------------------
{
  // no URL -> no call, false
  let calls = 0;
  assert.equal(await postDiscord({ title: 'x' }, { webhookUrl: '', fetchImpl: async () => { calls++; return new Response(null, { status: 204 }); } }), false);
  assert.equal(calls, 0);
  // no title -> false
  assert.equal(await postDiscord({}, { webhookUrl: 'https://d.test/h', fetchImpl: async () => new Response(null, { status: 204 }) }), false);
  // happy path: embed shape
  let sent = null;
  const ok = await postDiscord({ title: 'T', description: 'D', color: COLORS.info, fields: [{ name: 'a', value: 'b' }] }, { webhookUrl: 'https://d.test/h', fetchImpl: async (url, init) => { sent = { url, init }; return new Response(null, { status: 204 }); } });
  assert.equal(ok, true);
  assert.equal(sent.url, 'https://d.test/h');
  assert.equal(sent.init.method, 'POST');
  const body = JSON.parse(sent.init.body);
  assert.equal(body.embeds[0].title, 'T');
  assert.equal(body.embeds[0].description, 'D');
  assert.equal(body.embeds[0].color, COLORS.info);
  assert.equal(body.embeds[0].fields.length, 1);
  assert.ok(body.embeds[0].timestamp);
  // non-2xx -> false, no throw
  assert.equal(await postDiscord({ title: 'T' }, { webhookUrl: 'https://d.test/h', fetchImpl: async () => new Response('rate limited', { status: 429 }) }), false);
  // network error -> false, no throw
  assert.equal(await postDiscord({ title: 'T' }, { webhookUrl: 'https://d.test/h', fetchImpl: async () => { throw new Error('ECONNRESET'); } }), false);
  // a webhook that never answers is aborted at timeoutMs -> false, no throw (Codex P1 on #161)
  const hang = async (_u, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const started = Date.now();
  assert.equal(await postDiscord({ title: 'T' }, { webhookUrl: 'https://d.test/h', fetchImpl: hang, timeoutMs: 50 }), false);
  assert.ok(Date.now() - started < 2000);
  // every POST carries an abort signal (default timeout applies when none is passed)
  let signal = null;
  await postDiscord({ title: 'T' }, { webhookUrl: 'https://d.test/h', fetchImpl: async (_u, init) => { signal = init.signal; return new Response(null, { status: 204 }); } });
  assert.ok(signal instanceof AbortSignal);
  // caps: title 256, description 4000
  let capped = null;
  await postDiscord({ title: 'x'.repeat(300), description: 'y'.repeat(5000) }, { webhookUrl: 'https://d.test/h', fetchImpl: async (_u, init) => { capped = JSON.parse(init.body).embeds[0]; return new Response(null, { status: 204 }); } });
  assert.equal(capped.title.length, 256);
  assert.equal(capped.description.length, 4000);
  // a TEST run can never look like a PROD alert: envLabel 'test' prefixes the title; prod / unset does not
  const titleFor = async (envLabel) => { let t = null; await postDiscord({ title: 'T' }, { webhookUrl: 'https://d.test/h', envLabel, fetchImpl: async (_u, init) => { t = JSON.parse(init.body).embeds[0].title; return new Response(null, { status: 204 }); } }); return t; };
  assert.equal(await titleFor('test'), '[TEST] T');
  assert.equal(await titleFor('prod'), 'T');
  assert.equal(await titleFor(undefined), 'T');
}

// --- postDiscordReported: a lost new-work alert is never silent (Codex P1 on #151) ---
{
  const run = async ({ env, fetchImpl }) => {
    const seen = { written: [], errors: [] };
    const ok = await postDiscordReported({ title: 'EO fetch: 1 new executive order' }, { env, fetchImpl, write: (s) => seen.written.push(s), logError: (s) => seen.errors.push(s) });
    return { ok, ...seen };
  };
  const up = async () => new Response(null, { status: 204 });
  const down = async () => new Response('rate limited', { status: 429 });
  const actions = { GITHUB_ACTIONS: 'true', DISCORD_WEBHOOK_URL: 'https://d.test/h' };

  // delivered -> nothing reported
  assert.deepEqual(await run({ env: actions, fetchImpl: up }), { ok: true, written: [], errors: [] });
  // POST failed in Actions -> stderr line + error annotation on the run
  const failed = await run({ env: actions, fetchImpl: down });
  assert.equal(failed.ok, false);
  assert.match(failed.errors[0], /NOT delivered \(the webhook POST failed\): EO fetch: 1 new executive order/);
  assert.match(failed.written[0], /^::error title=Discord alert not delivered::Discord alert NOT delivered/);
  // missing secret in Actions -> reported, not a silent no-op
  const noSecret = await run({ env: { GITHUB_ACTIONS: 'true' }, fetchImpl: up });
  assert.equal(noSecret.ok, false);
  assert.match(noSecret.written[0], /DISCORD_WEBHOOK_URL is not set/);
  // local run without the secret -> silent no-op, as postDiscord
  assert.deepEqual(await run({ env: {}, fetchImpl: up }), { ok: false, written: [], errors: [] });
  // local run with the secret but Discord down -> stderr only, no workflow command
  const localDown = await run({ env: { DISCORD_WEBHOOK_URL: 'https://d.test/h' }, fetchImpl: down });
  assert.equal(localDown.errors.length, 1);
  assert.equal(localDown.written.length, 0);
  // workflow-command escaping keeps a multi-line title on one annotation line
  const nl = [];
  await postDiscordReported({ title: '50% done\nsecond line' }, { env: actions, fetchImpl: down, write: (s) => nl.push(s), logError: () => {} });
  assert.match(nl[0], /50%25 done%0Asecond line\n$/);

  // the three fetchers use the reported variant for their new-work alert
  for (const rel of ['../executive-orders-tracker-supabase.js', '../ingest/doj-pardons-scraper.js', '../scotus/fetch-cases.js']) {
    const src = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
    assert.match(src, /await postDiscordReported\(\{/, `${rel} must report an undelivered alert`);
    assert.doesNotMatch(src, /await postDiscord\(\{/, `${rel} still calls plain postDiscord`);
  }
}

// --- summarizeList -----------------------------------------------------------
assert.equal(summarizeList(['a', 'b']), 'a, b');
assert.equal(summarizeList(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5), 'a, b, c, d, e and 2 more');
assert.equal(summarizeList([]), '');
assert.equal(summarizeList(null), '');

// --- buildAlert ----------------------------------------------------------------
assert.equal(buildAlert('scotus', []), null);
{
  const NOW = Date.parse('2026-09-20T12:00:00Z');
  const a = buildAlert('scotus', [{ id: 1, case_name_short: 'Trump v. Someone', low_confidence_reason: 'vote split unclear — 6-3 or 7-2', enriched_at: '2026-09-17T12:00:00Z' }], { origin: 'https://t.example', now: NOW });
  assert.equal(a.title, 'SCOTUS: 1 enrichment waiting for review (0 new)');
  assert.ok(a.description.includes('• Trump v. Someone - vote split unclear - 6-3 or 7-2'), a.description);
  // enriched inside the last 26h -> marked NEW and counted
  const fresh = buildAlert('scotus', [{ id: 2, case_name_short: 'A v. B', enriched_at: '2026-09-20T01:00:00Z' }, { id: 1, case_name_short: 'C v. D', enriched_at: '2026-09-15T01:00:00Z' }], { now: NOW });
  assert.equal(fresh.title, 'SCOTUS: 2 enrichments waiting for review (1 new)');
  assert.ok(fresh.description.includes('• NEW A v. B'));
  assert.ok(fresh.description.includes('• C v. D'));
  assert.ok(!a.description.includes('—'), 'no em dashes');
  assert.ok(a.description.includes('https://t.example/admin.html (SCOTUS tab)'));
  assert.equal(a.color, COLORS.warning);
}
{
  // the EO reason lives on the newest flagged LOG row (notes), embedded in the same request
  const a = buildAlert('eo', [{ id: 'eo_1', order_number: 14999, title: 'Some Order', enrichment_meta: { review_reason: 'WRONG PLACE' }, executive_orders_enrichment_log: [{ notes: 'conflicting sections' }] }]);
  assert.ok(a.description.includes('• EO 14999: Some Order - conflicting sections'));
  assert.ok(!a.description.includes('WRONG PLACE'));
  assert.ok(buildAlert('eo', [{ id: 'eo_2', order_number: 15000, title: 'No Log', executive_orders_enrichment_log: [] }]).description.includes('• EO 15000: No Log\n'));
  const p = buildAlert('pardons', [{ id: 3, recipient_name: 'Someone', enrichment_meta: null }]);
  assert.equal(p.title, 'Pardons: 1 enrichment waiting for review (0 new)');
  assert.ok(p.description.includes('• Someone\n'));
  const many = buildAlert('pardons', Array.from({ length: 12 }, (_, i) => ({ id: i, recipient_name: `P${i}` })));
  assert.ok(many.description.includes('and 2 more'));
}
assert.throws(() => buildAlert('nope', [{}]), /unknown domain/);

// --- runNeedsReviewAlert -------------------------------------------------------
{
  // Thursday, September 24, 2026 12:00 UTC (not a reminder day) and the Monday after
  const THU = Date.parse('2026-09-24T12:00:00Z');
  const MON = Date.parse('2026-09-28T17:00:00Z'); // 12 PM CT
  const hoursAgo = (h, from = THU) => new Date(from - h * 3600000).toISOString();
  assert.equal(isReminderDay(THU), false);
  assert.equal(isReminderDay(MON), true);
  assert.equal(isReminderDay(Date.parse('2026-09-28T03:00:00Z')), false, 'Sunday 10 PM CT is still Sunday');

  const env = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://d.test/h' };
  const seen = { queries: [], headers: [], discord: [] };
  let scotusRows = [];
  let scotusTotal = null;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'd.test') { seen.discord.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    seen.queries.push(u);
    seen.headers.push(init.headers);
    assert.equal(init.headers.apikey, 'k');
    const json = { 'Content-Type': 'application/json' };
    if (u.pathname.endsWith('/scotus_cases')) {
      const total = scotusTotal ?? scotusRows.length;
      return new Response(JSON.stringify(scotusRows), { status: 200, headers: { ...json, 'Content-Range': `0-${Math.max(scotusRows.length - 1, 0)}/${total}` } });
    }
    return new Response('[]', { status: 200, headers: { ...json, 'Content-Range': '*/0' } });
  };
  const silent = () => {};
  const run = (domain, now, extraEnv = {}) => runNeedsReviewAlert({ env: { ...env, ...extraEnv }, argv: ['--domain', domain], fetchImpl, log: silent, now });

  // a recent flag posts on any day
  scotusRows = [{ id: 9, case_name_short: 'X v. Y', low_confidence_reason: 'r', enriched_at: hoursAgo(3) }];
  assert.deepEqual(await run('scotus', THU), { flagged: 1, due: true, posted: true });
  assert.equal(seen.discord.length, 1);
  assert.ok(seen.discord[0].embeds[0].description.includes('NEW X v. Y - r'));
  const q = seen.queries[0];
  assert.equal(q.searchParams.get('needs_manual_review'), 'eq.true');
  assert.equal(q.searchParams.get('manual_reviewed_at'), 'is.null');
  assert.equal(q.searchParams.get('enriched_at'), null, 'no age filter: an unreviewed flag never ages out of the queue (Codex P1 on #151)');
  assert.equal(seen.headers[0].Prefer, 'count=exact');
  assert.ok(q.searchParams.get('select') && !q.searchParams.get('select').includes('*'));

  // a 6-day-old flag is still "recent" (7-day default window): a late or skipped run cannot lose it
  scotusRows = [{ id: 9, case_name_short: 'X v. Y', enriched_at: hoursAgo(6 * 24) }];
  assert.equal((await run('scotus', THU)).due, true);

  // older flags only: quiet midweek, reminded on Monday, with the true total from Content-Range
  scotusRows = Array.from({ length: 50 }, (_, i) => ({ id: i, case_name_short: `Old ${i}`, enriched_at: hoursAgo(30 * 24 + i) }));
  scotusTotal = 57;
  const posts = seen.discord.length;
  assert.deepEqual(await run('scotus', THU), { flagged: 57, due: false, posted: false });
  assert.equal(seen.discord.length, posts, 'no post midweek for older flags alone');
  assert.deepEqual(await run('scotus', MON), { flagged: 57, due: true, posted: true });
  const monday = seen.discord.at(-1).embeds[0];
  assert.equal(monday.title, 'SCOTUS: 57 enrichments waiting for review (0 new)');
  assert.ok(monday.description.includes('… and 47 more'), monday.description);
  assert.ok(monday.description.includes('57 of these have been waiting more than 7 days (reminded every Monday until reviewed).'));

  // a new flag on top of a backlog posts midweek and names the backlog
  scotusRows = [{ id: 99, case_name_short: 'Fresh v. Case', enriched_at: hoursAgo(1) }, ...scotusRows.slice(0, 49)];
  assert.equal((await run('scotus', THU)).due, true);
  const mixed = seen.discord.at(-1).embeds[0];
  assert.equal(mixed.title, 'SCOTUS: 57 enrichments waiting for review (1 new)');
  assert.ok(mixed.description.includes('• NEW Fresh v. Case'));
  assert.ok(mixed.description.includes('56 of these have been waiting more than 7 days'));
  // 50 recent rows fetched out of 70: the unfetched 20 may be recent too, so no older-count claim
  scotusRows = Array.from({ length: 50 }, (_, i) => ({ id: i, case_name_short: `Recent ${i}`, enriched_at: hoursAgo(1 + i) }));
  scotusTotal = 70;
  await run('scotus', THU);
  const busy = seen.discord.at(-1).embeds[0];
  assert.equal(busy.title, 'SCOTUS: 70 enrichments waiting for review (26 new)');
  assert.ok(!busy.description.includes('waiting more than'), 'must not claim unfetched rows are old');
  scotusTotal = null;

  // ALERT_WINDOW_HOURS still sets the recent window; ALERT_ENV=test titles [TEST] and links the TEST site
  scotusRows = [{ id: 9, case_name_short: 'X v. Y', enriched_at: hoursAgo(30) }];
  assert.equal((await run('scotus', THU, { ALERT_WINDOW_HOURS: '26' })).due, false);
  assert.equal((await run('scotus', THU, { ALERT_ENV: 'test' })).due, true);
  const testEmbed = seen.discord.at(-1).embeds[0];
  assert.ok(testEmbed.title.startsWith('[TEST] SCOTUS:'), testEmbed.title);
  assert.ok(testEmbed.description.includes('https://test--taupe-capybara-0ff2ed.netlify.app/admin.html'));
  assert.ok(!seen.discord[0].embeds[0].title.startsWith('[TEST]'));

  // quiet domain -> nothing posted, even on Monday
  const before = { q: seen.queries.length, d: seen.discord.length };
  assert.deepEqual(await run('eo', MON), { flagged: 0, due: false, posted: false });
  const eoQuery = seen.queries[before.q];
  assert.ok(eoQuery.searchParams.get('select').includes('executive_orders_enrichment_log(notes,created_at)'));
  assert.equal(eoQuery.searchParams.get('executive_orders_enrichment_log.limit'), '1');
  assert.equal(eoQuery.searchParams.get('enriched_at'), null);
  assert.equal(seen.discord.length, before.d);

  // pardons uses needs_review, no age filter
  await run('pardons', THU);
  assert.equal(seen.queries.at(-1).searchParams.get('needs_review'), 'eq.true');
  assert.equal(seen.queries.at(-1).searchParams.get('enriched_at'), null);

  await assert.rejects(() => runNeedsReviewAlert({ env, argv: [], fetchImpl, log: silent }), /--domain/);
  assert.deepEqual(Object.keys(DOMAINS), ['scotus', 'eo', 'pardons', 'stories']);
}

// --- stories (ADO-602): daily digest of the Stories agent's own flags, no open queue ---
{
  // the slot is fixed (yesterday 12:00 UTC to today 12:00 UTC), wherever in the window the run starts
  assert.deepEqual(dailySlot(Date.parse('2026-10-12T12:00:00Z')), { start: new Date('2026-10-11T12:00:00Z'), end: new Date('2026-10-12T12:00:00Z') });
  assert.deepEqual(dailySlot(Date.parse('2026-10-12T17:59:00Z')), { start: new Date('2026-10-11T12:00:00Z'), end: new Date('2026-10-12T12:00:00Z') });
  // a manual run before 12:00 UTC reports the last complete slot
  assert.deepEqual(dailySlot(Date.parse('2026-10-12T06:10:00Z')), { start: new Date('2026-10-10T12:00:00Z'), end: new Date('2026-10-11T12:00:00Z') });
  // runs almost 30h apart (12:00 one day, 17:59 the next) still report adjacent slots: no gap
  assert.equal(dailySlot(Date.parse('2026-10-11T12:00:00Z')).end.getTime(), dailySlot(Date.parse('2026-10-12T17:59:00Z')).start.getTime());

  // The Stories slot is dailySlot shifted 6h earlier (yesterday 06:00 to today 06:00 UTC): every story
  // created in it has finished long before the 12:00-17:59 digest looks (Codex P2, PR #190)
  assert.deepEqual(storiesSlot(Date.parse('2026-10-12T12:30:00Z')), { start: new Date('2026-10-11T06:00:00Z'), end: new Date('2026-10-12T06:00:00Z') });
  assert.equal(storiesSlot(Date.parse('2026-10-11T12:00:00Z')).end.getTime(), storiesSlot(Date.parse('2026-10-12T17:59:00Z')).start.getTime(), 'adjacent slots, no gap');

  const DAILY = Date.parse('2026-10-12T12:30:00Z'); // inside the once-a-day health check window
  const at = (iso) => new Date(iso).toISOString();
  // Fake PostgREST that applies the flag, status and created_at filters, so the test proves the query
  // keeps unflagged thin_source rows, failed runs and rows outside the slot out
  const log = [
    { id: 41, story_id: 17301, needs_manual_review: true, status: 'completed', notes: 'factual error: wrong vote count — 52-48, not 51-49', created_at: at('2026-10-12T03:30:00Z'), stories: { primary_headline: 'Senate passes the budget bill — barely' } },
    { id: 40, story_id: 17300, needs_manual_review: false, status: 'completed', notes: 'thin_source', created_at: at('2026-10-12T02:30:00Z'), stories: { primary_headline: 'Thin story' } },
    { id: 39, story_id: 17299, needs_manual_review: true, status: 'completed', notes: 'old flag', created_at: at('2026-10-11T00:30:00Z'), stories: { primary_headline: 'Day before story' } },
    { id: 42, story_id: 17302, needs_manual_review: true, status: 'completed', notes: 'next slot', created_at: at('2026-10-12T06:10:00Z'), stories: { primary_headline: 'Tomorrow digest story' } },
    { id: 38, story_id: 17298, needs_manual_review: true, status: 'failed', notes: 'run died', created_at: at('2026-10-12T01:00:00Z'), stories: { primary_headline: 'Failed run story' } },
  ];
  const seen = { queries: [], discord: [] };
  let table = log;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'd.test') { seen.discord.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    seen.queries.push(u);
    assert.ok(u.pathname.endsWith('/stories_enrichment_log'));
    const created = u.searchParams.getAll('created_at');
    const gte = Date.parse(created.find((c) => c.startsWith('gte.')).slice(4));
    const lt = Date.parse(created.find((c) => c.startsWith('lt.')).slice(3));
    const rows = table.filter((r) => (u.searchParams.get('needs_manual_review') !== 'eq.true' || r.needs_manual_review)
      && (u.searchParams.get('status') !== 'eq.completed' || r.status === 'completed')
      && Date.parse(r.created_at) >= gte && Date.parse(r.created_at) < lt);
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json', 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/${rows.length}` } });
  };
  const env = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://d.test/h' };
  const run = (now = DAILY, extraEnv = {}) => runNeedsReviewAlert({ env: { ...env, ...extraEnv }, argv: ['--domain', 'stories'], fetchImpl, log: () => {}, now });

  // a flagged row alerts with the headline and the agent's note; the unflagged thin_source row, the
  // failed run and the flags outside the slot do not
  assert.deepEqual(await run(), { flagged: 1, due: true, posted: true });
  const q = seen.queries[0];
  assert.equal(q.searchParams.get('needs_manual_review'), 'eq.true');
  assert.equal(q.searchParams.get('status'), 'eq.completed');
  assert.deepEqual(q.searchParams.getAll('created_at'), ['gte.2026-10-11T06:00:00.000Z', 'lt.2026-10-12T06:00:00.000Z']);
  assert.ok(q.searchParams.get('select').includes('stories(primary_headline)'));
  assert.ok(!q.searchParams.get('select').includes('*'));
  const embed = seen.discord[0].embeds[0];
  assert.equal(embed.title, 'Stories: the agent flagged 1 enrichment for review (stories started October 11 6:00 UTC to October 12 6:00 UTC)');
  assert.ok(embed.description.includes('• Story 17301: Senate passes the budget bill - barely - factual error: wrong vote count - 52-48, not 51-49'), embed.description);
  for (const left of ['Thin story', 'thin_source', 'Day before story', 'Tomorrow digest story', 'Failed run story']) assert.ok(!embed.description.includes(left), left);
  assert.ok(embed.description.includes('https://trumpytracker.com/admin.html (Stories tab)'));
  assert.ok(!/[—–]/.test(embed.description), 'no em or en dashes, in the headline or the note');
  assert.equal(embed.color, COLORS.warning);

  // a thin_source row with no flag, alone in the slot -> nothing posted
  table = [log[1]];
  assert.deepEqual(await run(), { flagged: 0, due: false, posted: false });
  // empty slot -> nothing posted
  table = [];
  assert.deepEqual(await run(), { flagged: 0, due: false, posted: false });
  assert.equal(seen.discord.length, 1);

  // once a day: the other 6-hourly runs and push runs do not query at all; a manual run checks
  table = log;
  const queries = seen.queries.length;
  assert.deepEqual(await run(Date.parse('2026-10-12T06:10:00Z')), { flagged: 0, due: false, posted: false });
  assert.deepEqual(await run(DAILY, { GITHUB_EVENT_NAME: 'push' }), { flagged: 0, due: false, posted: false });
  assert.equal(seen.queries.length, queries);
  assert.equal((await run(Date.parse('2026-10-12T06:10:00Z'), { GITHUB_EVENT_NAME: 'workflow_dispatch' })).posted, true);
  assert.ok(seen.discord.at(-1).embeds[0].description.includes('Day before story'), 'the manual run reported the last complete slot');
  // the ingest health override does not force the Stories digest (no coupling to the RSS monitor)
  assert.equal((await run(Date.parse('2026-10-12T06:10:00Z'), { INGEST_HEALTH_FORCE: '1' })).due, false);

  // a flagged run-level row (no story) still names something
  assert.ok(buildAlert('stories', [{ id: 5, story_id: null, notes: 'n' }]).description.includes('• Log row 5 - n'));

  // Codex P2 (PR #190): a story that starts just before 12:00 UTC is still running when that day's
  // digest looks. It belongs to the NEXT slot (created after 06:00), so it is reported once it has
  // finished, on the next day, instead of being missed by both.
  const straddle = { id: 50, story_id: 17400, needs_manual_review: true, status: 'running', notes: 'late', created_at: at('2026-10-12T11:55:00Z'), stories: { primary_headline: 'Still running at the digest' } };
  const justIn = { id: 51, story_id: 17401, needs_manual_review: true, status: 'completed', notes: 'edge', created_at: at('2026-10-12T05:59:00Z'), stories: { primary_headline: 'Started 05:59' } };
  table = [straddle, justIn];
  const before = seen.discord.length;
  assert.deepEqual(await run(), { flagged: 1, due: true, posted: true });
  assert.ok(seen.discord.at(-1).embeds[0].description.includes('Started 05:59'));
  straddle.status = 'completed'; // finished at 12:05, after the digest above
  assert.deepEqual(await run(Date.parse('2026-10-13T12:30:00Z')), { flagged: 1, due: true, posted: true });
  const nextDay = seen.discord.at(-1).embeds[0].description;
  assert.ok(nextDay.includes('Still running at the digest') && !nextDay.includes('Started 05:59'), 'reported once, the next day');
  assert.equal(seen.discord.length, before + 2);

  // Codex P2 (PR #190): every flag in a slot is named, since the slot is never reported again
  table = Array.from({ length: 40 }, (_, i) => ({ id: 100 + i, story_id: 18000 + i, needs_manual_review: true, status: 'completed',
    notes: 'x'.repeat(200), created_at: at(`2026-10-12T0${i % 6}:${String(10 + i).padStart(2, '0')}:00Z`), stories: { primary_headline: 'h'.repeat(120) } }));
  assert.deepEqual(await run(), { flagged: 40, due: true, posted: true });
  const many = seen.discord.at(-1).embeds[0].description;
  for (let i = 0; i < 40; i++) assert.ok(many.includes(`Story ${18000 + i}`), `Story ${18000 + i} named`);
  assert.ok(many.length <= 3800 && !many.includes('not listed here'), `${many.length} chars`);
  // a story flagged on several runs is named once in the short list
  const repeats = buildAlert('stories', [...Array.from({ length: 10 }, (_, i) => ({ id: i, story_id: 30000 + i, notes: 'n' })),
    { id: 20, story_id: 31000, notes: 'n' }, { id: 21, story_id: 31000, notes: 'n' }, { id: 22, story_id: 30000, notes: 'n' }], { now: DAILY });
  assert.ok(repeats.description.includes('Also flagged: Story 31000\n'), repeats.description);
  // too many even for ids: the remainder is counted, with a query that finds exactly those rows, and
  // the whole message fits the budget even with a long site origin
  const longOrigin = `https://${'x'.repeat(90)}.netlify.app`;
  const huge = buildAlert('stories', Array.from({ length: 400 }, (_, i) => ({ id: i, story_id: 20000 + i, notes: 'n' })), { now: DAILY, total: 400, origin: longOrigin });
  assert.ok(huge.description.length <= 3800, `${huge.description.length} chars`);
  assert.ok(huge.description.endsWith('nothing to mark as reviewed.'), 'footer intact');
  assert.match(huge.description, /… and \d+ more not listed here: stories_enrichment_log rows with needs_manual_review=true, status=completed, created_at from 2026-10-11T06:00:00.000Z to 2026-10-12T06:00:00.000Z/);
  // a capped query never sends a partial digest: it throws, and runCli posts "could not run"
  const capped = async (url, init) => (new URL(url).hostname === 'd.test' ? fetchImpl(url, init)
    : new Response('[]', { status: 200, headers: { 'Content-Range': '0-499/612' } }));
  await assert.rejects(runNeedsReviewAlert({ env, argv: ['--domain', 'stories'], fetchImpl: capped, log: () => {}, now: DAILY }), /query cap/);

  // wired into the once-a-day RSS health check on main (reads PROD), with a follow-up so a dead digest is never silent
  const wf = readFileSync(fileURLToPath(new URL('../../.github/workflows/rss-health-check.yml', import.meta.url)), 'utf8');
  assert.match(wf, /id: stories_review[\s\S]*node scripts\/monitoring\/alert-needs-review\.js --domain stories/);
  assert.match(wf, /steps\.stories_review\.outcome == 'failure'/);
}

// --- runCli: a check that cannot run is never silent ----------------------------
{
  const silent = () => {};
  const posted = [];
  const discordUp = async (url, init = {}) => { posted.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); };
  const discordDown = async () => new Response('nope', { status: 500 });
  const noCreds = { SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', DISCORD_WEBHOOK_URL: 'https://d.test/h' };

  // cannot run + Discord reachable -> its own message, exit 0
  assert.equal(await runCli({ env: noCreds, argv: ['--domain', 'pardons'], fetchImpl: discordUp, log: silent, logError: silent }), 0);
  assert.equal(posted.length, 1);
  assert.match(posted[0].embeds[0].title, /could not run \(pardons\)/);
  assert.match(posted[0].embeds[0].description, /not set/);

  // cannot run + Discord down or no webhook -> exit 1 (the step goes red)
  assert.equal(await runCli({ env: noCreds, argv: ['--domain', 'pardons'], fetchImpl: discordDown, log: silent, logError: silent }), 1);
  assert.equal(await runCli({ env: { ...noCreds, DISCORD_WEBHOOK_URL: '' }, argv: ['--domain', 'eo'], fetchImpl: discordUp, log: silent, logError: silent }), 1);

  // a failed query is reported the same way
  const queryFails = async (url, init = {}) => (new URL(url).hostname === 'd.test' ? discordUp(url, init) : new Response('boom', { status: 500 }));
  const env = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://d.test/h' };
  assert.equal(await runCli({ env, argv: ['--domain', 'scotus'], fetchImpl: queryFails, log: silent, logError: silent }), 0);
  assert.match(posted[1].embeds[0].description, /query failed: 500/);

  // records flagged but the alert cannot be delivered -> exit 1 (never a green step over a lost alert)
  const flaggedRows = JSON.stringify([{ id: 7, recipient_name: 'Someone', enriched_at: new Date().toISOString() }]);
  const flaggedDiscordDown = async (url) => (new URL(url).hostname === 'd.test' ? new Response('nope', { status: 500 }) : new Response(flaggedRows, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.equal(await runCli({ env, argv: ['--domain', 'pardons'], fetchImpl: flaggedDiscordDown, log: silent, logError: silent }), 1);
  const flaggedNoWebhook = async () => new Response(flaggedRows, { status: 200, headers: { 'Content-Type': 'application/json' } });
  assert.equal(await runCli({ env: { ...env, DISCORD_WEBHOOK_URL: '' }, argv: ['--domain', 'pardons'], fetchImpl: flaggedNoWebhook, log: silent, logError: silent }), 1);

  // healthy run -> exit 0, nothing extra posted
  const healthy = async (url, init = {}) => (new URL(url).hostname === 'd.test' ? discordUp(url, init) : new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.equal(await runCli({ env, argv: ['--domain', 'eo'], fetchImpl: healthy, log: silent, logError: silent }), 0);
  assert.equal(posted.length, 2);

  // project rule: no console.log in production code
  assert.doesNotMatch(readFileSync(fileURLToPath(new URL('../monitoring/alert-needs-review.js', import.meta.url)), 'utf8'), /console\.log\(/);
}

console.log('discord-alerts: ok');
