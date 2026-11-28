// ADO-639: the Netlify scheduled function that dispatches the RSS Pipeline Health Check once a day.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fn, { dispatchHealthCheck, DISPATCH_URL, config } from '../../netlify/functions/health-check-trigger.mjs';
import { deployDecision, TOKEN_ENV } from '../../netlify/lib/github-dispatch.mjs';
import { isDailyCheckRun, dailySlot } from '../lib/daily-check-window.js';

const TOKEN = 'github_pat_TEST_SECRET_VALUE';
const PROD = { deploy: { context: 'production', published: true } };
const fakeFetch = (status, body = '') => {
  const calls = [];
  let cancelled = 0;
  let read = 0;
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      status,
      text: async () => { read += 1; return body; },
      json: async () => { read += 1; return JSON.parse(body || '{}'); },
      body: { cancel: async () => { cancelled += 1; } },
    };
  };
  return { impl, calls, cancelled: () => cancelled, read: () => read };
};

// --- schedule + target
assert.equal(config.schedule, '23 13 * * *', 'once a day at 13:23 UTC');
assert.equal(config.path, undefined, 'scheduled functions must not have a URL path');
assert.equal(DISPATCH_URL, 'https://api.github.com/repos/AJWolfe18/TTracker/actions/workflows/rss-health-check.yml/dispatches');
assert.equal(TOKEN_ENV, 'RSS_TRIGGER_GITHUB_TOKEN', 'same token as the RSS trigger: nothing new to set up');
{
  // the run lands after the 12:00 UTC slot boundary, so it reports the slot that just ended,
  // and back-to-back daily runs report adjacent slots
  const [min, hour] = config.schedule.split(' ').map(Number);
  const run = Date.UTC(2026, 10, 25, hour, min);
  assert.ok(hour >= 12, 'after the 12:00 UTC slot end');
  assert.equal(dailySlot(run).end.toISOString(), '2026-11-25T12:00:00.000Z');
  assert.equal(dailySlot(run).end.getTime(), dailySlot(run + 24 * 3600000).start.getTime(), 'no gap, no overlap');
  assert.ok(![0, 17, 41, 47].includes(min), 'off the top of the hour and the other crons/triggers');
}
// the run it starts is a workflow_dispatch run, the only kind the daily checks accept
assert.equal(isDailyCheckRun({ env: { GITHUB_EVENT_NAME: 'workflow_dispatch' } }), true);
assert.equal(isDailyCheckRun({ env: { GITHUB_EVENT_NAME: 'schedule' } }), false);
assert.equal(isDailyCheckRun({ env: { GITHUB_EVENT_NAME: 'push' } }), false);
{
  // the workflow it dispatches accepts workflow_dispatch and declares no inputs (an unknown input is a 422)
  const wf = readFileSync(fileURLToPath(new URL('../../.github/workflows/rss-health-check.yml', import.meta.url)), 'utf8');
  const on = wf.slice(wf.indexOf('\non:'), wf.indexOf('\njobs:'));
  assert.match(on, /^\s+workflow_dispatch:\s*$/m);
  assert.ok(!/inputs:/.test(on), 'no inputs on the health check workflow');
}

// --- no token: no request, clear reason
{
  const f = fakeFetch(204);
  assert.deepEqual(await dispatchHealthCheck(undefined, f.impl), { ok: false, reason: 'missing_token' });
  assert.deepEqual(await dispatchHealthCheck('', f.impl), { ok: false, reason: 'missing_token' });
  assert.deepEqual(await dispatchHealthCheck('   ', f.impl), { ok: false, reason: 'missing_token' });
  assert.equal(f.calls.length, 0);
}

// --- request shape: POST, bearer token, main ref and NO inputs
{
  const f = fakeFetch(204);
  assert.deepEqual(await dispatchHealthCheck(TOKEN, f.impl), { ok: true, status: 204 });
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, DISPATCH_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers.Accept, 'application/vnd.github+json');
  assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.equal(init.headers['Content-Type'], 'application/json');
  assert.equal(init.headers['User-Agent'], 'ttracker-health-check-trigger');
  assert.deepEqual(JSON.parse(init.body), { ref: 'main' });
  assert.ok(init.signal, 'request has a timeout');
  // pasted with whitespace: trimmed for the header
  const g = fakeFetch(204);
  await dispatchHealthCheck(` ${TOKEN}\n`, g.impl);
  assert.equal(g.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
}

// --- 200 (run details) also counts as started
assert.deepEqual(await dispatchHealthCheck(TOKEN, fakeFetch(200, '{}').impl), { ok: true, status: 200 });

// --- GitHub rejections: status + fixed reason only; the body is never read or returned
for (const status of [400, 401, 403, 404, 422, 500]) {
  const f = fakeFetch(status, `{"message":"echo ${TOKEN}"}`);
  const r = await dispatchHealthCheck(TOKEN, f.impl);
  assert.deepEqual(r, { ok: false, status, reason: 'github_rejected' });
  assert.equal(f.read(), 0, 'body never read');
  assert.equal(f.cancelled(), 1, 'body released');
}

// --- network error / timeout: no throw, fixed codes only (never the error text)
{
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.deepEqual(await dispatchHealthCheck(TOKEN, async () => { throw timeout; }), { ok: false, reason: 'network_error', detail: 'timeout' });
  assert.deepEqual(await dispatchHealthCheck(TOKEN, async () => { throw abort; }), { ok: false, reason: 'network_error', detail: 'timeout' });
  assert.deepEqual(await dispatchHealthCheck(TOKEN, async () => { throw new TypeError('fetch failed'); }), { ok: false, reason: 'network_error', detail: 'fetch_failed' });
  const leaky = async () => { throw new TypeError(`Headers.append: "Bearer ${TOKEN.replace('_SECRET', '\n_SECRET')}" is an invalid header value.`); };
  const r = await dispatchHealthCheck(TOKEN, leaky);
  assert.deepEqual(r, { ok: false, reason: 'network_error', detail: 'invalid_token_format' });
  assert.ok(!JSON.stringify(r).includes('SECRET'));
  // real Node: a token with a line break makes fetch itself throw (no network call)
  assert.deepEqual(await dispatchHealthCheck('github_pat_AB\nC_SECRETPART'), { ok: false, reason: 'network_error', detail: 'invalid_token_format' });
}

// --- handler: reads env, 204 on success, 500 + error log + Discord alert on failure
{
  const HOOK = 'https://discord.test/webhook';
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const logged = [];
  let calls = [];
  const route = (githubStatus) => async (url, init) => {
    calls.push({ url, init });
    if (url === HOOK) return { ok: true, status: 204, text: async () => '' };
    return { status: githubStatus, text: async () => `{"message":"Bad credentials ${TOKEN}"}` };
  };
  const env = (vars) => { globalThis.Netlify = { env: { get: (k) => vars[k] } }; };
  try {
    console.error = (...a) => logged.push(a.join(' '));

    // success: one GitHub call to the health check workflow, no alert
    env({ [TOKEN_ENV]: TOKEN, DISCORD_WEBHOOK_URL: HOOK });
    globalThis.fetch = route(204);
    assert.equal((await fn(undefined, PROD)).status, 204);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, DISPATCH_URL);
    assert.deepEqual(JSON.parse(calls[0].init.body), { ref: 'main' });
    assert.equal(logged.length, 0);

    // 401 and 422: logged and alerted without the token or the response body
    for (const status of [401, 422]) {
      calls = [];
      logged.length = 0;
      globalThis.fetch = route(status);
      assert.equal((await fn(undefined, PROD)).status, 500);
      assert.match(logged[0], new RegExp(`\\[health-check-trigger\\] dispatch failed.*${status}`));
      assert.ok(!logged[0].includes(TOKEN) && !logged[0].includes('Bad credentials'));
      assert.equal(calls.length, 2);
      assert.equal(calls[1].url, HOOK);
      const alert = JSON.parse(calls[1].init.body).embeds[0];
      assert.equal(alert.title, 'RSS health check trigger (Netlify) failed');
      assert.match(alert.description, new RegExp(`${status} github_rejected`));
      assert.match(alert.description, /ingest health check and Stories flag digest did not run/);
      assert.match(alert.description, /rss-prod-external-trigger\.md/);
      assert.ok(!calls[1].init.body.includes(TOKEN) && !calls[1].init.body.includes('Bad credentials'));
      assert.ok(!alert.title.startsWith('[TEST]'));
    }

    // network failure: fixed code in the alert, never the error text
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      if (url === HOOK) return { ok: true, status: 204, text: async () => '' };
      throw new TypeError(`Headers.append: "Bearer ${TOKEN}" is an invalid header value.`);
    };
    assert.equal((await fn(undefined, PROD)).status, 500);
    assert.match(JSON.parse(calls.at(-1).init.body).embeds[0].description, /network_error/);
    assert.ok(!calls.at(-1).init.body.includes(TOKEN));
    assert.ok(!logged.at(-1).includes(TOKEN));

    // missing token: no GitHub call, still alerts
    calls = [];
    env({ DISCORD_WEBHOOK_URL: HOOK });
    globalThis.fetch = route(204);
    assert.equal((await fn(undefined, PROD)).status, 500);
    assert.match(logged.at(-1), /missing_token/);
    assert.deepEqual(calls.map((c) => c.url), [HOOK]);

    // no webhook configured: failure still returns 500, no alert attempted
    calls = [];
    env({ [TOKEN_ENV]: TOKEN });
    globalThis.fetch = route(401);
    assert.equal((await fn(undefined, PROD)).status, 500);
    assert.deepEqual(calls.map((c) => c.url), [DISPATCH_URL]);

    // no Netlify global: falls back to process.env instead of a ReferenceError
    calls = [];
    delete globalThis.Netlify;
    process.env[TOKEN_ENV] = TOKEN;
    globalThis.fetch = route(204);
    assert.equal((await fn(undefined, PROD)).status, 204);
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    delete globalThis.Netlify;
    delete process.env[TOKEN_ENV];
  }
}

// --- only the CURRENT PUBLISHED production deploy may dispatch ("Run now" works on any deploy)
assert.equal(deployDecision(PROD), 'dispatch');
assert.match(deployDecision({ deploy: { context: 'production', published: false } }), /^skip:unpublished/);
assert.equal(deployDecision({ deploy: { context: 'production' } }), 'unknown', 'published flag missing fails closed');
assert.equal(deployDecision({ deploy: { context: 'production', published: 'true' } }), 'unknown', 'only boolean true counts');
for (const c of ['branch-deploy', 'deploy-preview', 'dev', 'preview-server']) {
  assert.match(deployDecision({ deploy: { context: c, published: true } }), /^skip:/, c);
}
for (const ctx of [undefined, null, {}, { deploy: null }, { deploy: { context: 'something-new', published: true } }]) {
  assert.equal(deployDecision(ctx), 'unknown');
}
{
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const realWarn = console.warn;
  const logs = [];
  let calls = [];
  const HOOK = 'https://discord.test/webhook';
  try {
    console.error = console.warn = (...a) => logs.push(a.join(' '));
    globalThis.Netlify = { env: { get: (k) => ({ [TOKEN_ENV]: TOKEN, DISCORD_WEBHOOK_URL: HOOK })[k] } };
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 204, text: async () => '' }; };

    const skipped = [
      ...['branch-deploy', 'deploy-preview', 'dev', 'preview-server'].map((c) => ({ deploy: { context: c, published: true } })),
      { deploy: { context: 'production', published: false } }, // older production deploy, "Run now"
    ];
    for (const ctx of skipped) {
      const res = await fn(undefined, ctx);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), 'skipped: not the published production deploy');
    }
    assert.equal(calls.length, 0, 'skipped deploys never call GitHub or Discord');
    assert.ok(logs.every((l) => l.startsWith('[health-check-trigger] skipped')));

    // missing / unknown context or published flag: fail closed, no GitHub call, but alert so it can't go silent
    for (const ctx of [undefined, {}, { deploy: { context: 'something-new' } }, { deploy: { context: 'production' } }]) {
      calls = [];
      assert.equal((await fn(undefined, ctx)).status, 500);
      assert.deepEqual(calls.map((c) => c.url), [HOOK]);
      assert.match(JSON.parse(calls[0].init.body).embeds[0].description, /unknown_deploy_context/);
    }
    assert.ok(logs.some((l) => /unknown_deploy_context/.test(l)));
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    console.warn = realWarn;
    delete globalThis.Netlify;
  }
}

// Review fixes (November 25, 2026): the watchdog's fallback flag opens the daily gate, and the failure
// text never blames GitHub when GitHub was not called.
{
  assert.equal(isDailyCheckRun({ env: { GITHUB_EVENT_NAME: 'schedule', DAILY_CHECK_FALLBACK: '1' } }), true, 'watchdog fallback opens the gate on a scheduled run');
  assert.equal(isDailyCheckRun({ env: { DAILY_CHECK_FALLBACK: '1' } }), true, 'and on a local run');
  assert.equal(isDailyCheckRun({ env: { GITHUB_EVENT_NAME: 'schedule', DAILY_CHECK_FALLBACK: '0' } }), false, 'only the exact value 1 counts');
  const { describeFailure } = await import('../../netlify/lib/github-dispatch.mjs');
  assert.equal(describeFailure({ ok: false, status: 401, reason: 'github_rejected' }, 'the RSS run'), 'GitHub did not start the RSS run: 401 github_rejected.');
  assert.equal(describeFailure({ ok: false, reason: 'missing_token' }, 'the RSS run'), 'GitHub did not start the RSS run: missing_token.', 'no status = no double space');
  const unknown = describeFailure({ ok: false, reason: 'unknown_deploy_context' }, 'the RSS Pipeline Health Check');
  assert.match(unknown, /deploy context was not recognized/);
  assert.match(unknown, /GitHub was not called/);
  // The watchdog step exists, runs only on scheduled main runs, and the job can list runs.
  const wf = readFileSync(fileURLToPath(new URL('../../.github/workflows/rss-health-check.yml', import.meta.url)), 'utf8');
  assert.match(wf, /name: Daily run watchdog[^\n]*\n\s+if: always\(\) && github\.ref == 'refs\/heads\/main' && github\.event_name == 'schedule'/);
  assert.match(wf, /DAILY_CHECK_FALLBACK=1/);
  assert.match(wf, /permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
  assert.ok(wf.indexOf('Daily run watchdog') < wf.indexOf('- name: Ingest health check'), 'watchdog runs before the daily checks');
}

console.log('health-check-trigger: all tests passed');
