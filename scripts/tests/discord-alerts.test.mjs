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
}

// --- summarizeList -----------------------------------------------------------
assert.equal(summarizeList(['a', 'b']), 'a, b');
assert.equal(summarizeList(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5), 'a, b, c, d, e and 2 more');
assert.equal(summarizeList([]), '');
assert.equal(summarizeList(null), '');

// --- buildAlert ----------------------------------------------------------------
assert.equal(buildAlert('scotus', []), null);
{
  const a = buildAlert('scotus', [{ id: 1, case_name_short: 'Trump v. Someone', low_confidence_reason: 'vote split unclear — 6-3 or 7-2' }], { origin: 'https://t.example' });
  assert.equal(a.title, 'SCOTUS: 1 enrichment flagged for review');
  assert.ok(a.description.includes('• Trump v. Someone - vote split unclear - 6-3 or 7-2'), a.description);
  assert.ok(!a.description.includes('—'), 'no em dashes');
  assert.ok(a.description.includes('https://t.example/admin.html (SCOTUS tab)'));
  assert.equal(a.color, COLORS.warning);
}
{
  const a = buildAlert('eo', [{ id: 'eo_1', order_number: 14999, title: 'Some Order', enrichment_meta: { review_reason: 'conflicting sections' } }]);
  assert.ok(a.description.includes('• EO 14999: Some Order - conflicting sections'));
  const p = buildAlert('pardons', [{ id: 3, recipient_name: 'Someone', enrichment_meta: null }]);
  assert.equal(p.title, 'Pardons: 1 enrichment flagged for review');
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

  // quiet domain -> nothing posted
  const r2 = await runNeedsReviewAlert({ env, argv: ['--domain', 'eo'], fetchImpl, log: silent });
  assert.deepEqual(r2, { flagged: 0, posted: false });
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

  // healthy run -> exit 0, nothing extra posted
  const healthy = async (url, init = {}) => (new URL(url).hostname === 'd.test' ? discordUp(url, init) : new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } }));
  assert.equal(await runCli({ env, argv: ['--domain', 'eo'], fetchImpl: healthy, log: silent, logError: silent }), 0);
  assert.equal(posted.length, 2);

  // project rule: no console.log in production code
  assert.doesNotMatch(readFileSync(fileURLToPath(new URL('../monitoring/alert-needs-review.js', import.meta.url)), 'utf8'), /console\.log\(/);
}

console.log('discord-alerts: ok');
