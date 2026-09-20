// ADO-577: Discord helper never throws / never posts without a URL; needs-review alert
// posts only when something is flagged and names the record + reason.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { postDiscord, summarizeList, COLORS } from '../lib/discord.js';
import { buildAlert, runNeedsReviewAlert, runCli, DOMAINS } from '../monitoring/alert-needs-review.js';

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
  const env = { SUPABASE_URL: 'https://fake.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', DISCORD_WEBHOOK_URL: 'https://d.test/h', ALERT_WINDOW_HOURS: '26' };
  const seen = { queries: [], discord: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.hostname === 'd.test') { seen.discord.push(JSON.parse(init.body)); return new Response(null, { status: 204 }); }
    seen.queries.push(u);
    assert.equal(init.headers.apikey, 'k');
    if (u.pathname.endsWith('/scotus_cases')) return new Response(JSON.stringify([{ id: 9, case_name_short: 'X v. Y', low_confidence_reason: 'r' }]), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const silent = () => {};
  const r1 = await runNeedsReviewAlert({ env, argv: ['--domain', 'scotus'], fetchImpl, log: silent });
  assert.deepEqual(r1, { flagged: 1, posted: true });
  assert.equal(seen.discord.length, 1);
  assert.ok(seen.discord[0].embeds[0].description.includes('X v. Y - r'));
  const q = seen.queries[0];
  assert.equal(q.searchParams.get('needs_manual_review'), 'eq.true');
  assert.equal(q.searchParams.get('manual_reviewed_at'), 'is.null');
  assert.ok(q.searchParams.get('enriched_at').startsWith('gt.'));
  assert.ok(q.searchParams.get('select') && !q.searchParams.get('select').includes('*'));

  // default window = 7 days (a late or skipped run cannot lose a flag); override still honoured
  {
    const NOW = Date.parse('2026-09-20T12:00:00Z');
    const { ALERT_WINDOW_HOURS: _drop, ...noWindow } = env;
    await runNeedsReviewAlert({ env: noWindow, argv: ['--domain', 'scotus'], fetchImpl, log: silent, now: NOW });
    assert.equal(seen.queries.at(-1).searchParams.get('enriched_at'), 'gt.2026-09-13T12:00:00.000Z');
    await runNeedsReviewAlert({ env: { ...env, ALERT_ENV: 'test' }, argv: ['--domain', 'scotus'], fetchImpl, log: silent, now: NOW });
    assert.equal(seen.queries.at(-1).searchParams.get('enriched_at'), 'gt.2026-09-19T10:00:00.000Z');
    const testEmbed = seen.discord.at(-1).embeds[0];
    assert.ok(testEmbed.title.startsWith('[TEST] SCOTUS:'), testEmbed.title);
    assert.ok(testEmbed.description.includes('https://test--taupe-capybara-0ff2ed.netlify.app/admin.html'));
    assert.ok(!seen.discord[0].embeds[0].title.startsWith('[TEST]'));
    seen.queries.length = 1; seen.discord.length = 1;
  }

  // quiet domain -> nothing posted
  const r2 = await runNeedsReviewAlert({ env, argv: ['--domain', 'eo'], fetchImpl, log: silent });
  assert.deepEqual(r2, { flagged: 0, posted: false });
  assert.ok(seen.queries[1].searchParams.get('select').includes('executive_orders_enrichment_log(notes,created_at)'));
  assert.equal(seen.queries[1].searchParams.get('executive_orders_enrichment_log.limit'), '1');
  assert.equal(seen.discord.length, 1);

  // pardons uses needs_review
  await runNeedsReviewAlert({ env, argv: ['--domain', 'pardons'], fetchImpl, log: silent });
  assert.equal(seen.queries[2].searchParams.get('needs_review'), 'eq.true');

  await assert.rejects(() => runNeedsReviewAlert({ env, argv: [], fetchImpl, log: silent }), /--domain/);
  assert.deepEqual(Object.keys(DOMAINS), ['scotus', 'eo', 'pardons']);
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
