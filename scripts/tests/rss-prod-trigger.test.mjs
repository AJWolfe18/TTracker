// ADO-637: the Netlify scheduled function that dispatches the PROD RSS workflow.
import assert from 'node:assert/strict';
import fn, { dispatchRssRun, deployDecision, DISPATCH_URL, TOKEN_ENV, config } from '../../netlify/functions/rss-prod-trigger.mjs';

const TOKEN = 'github_pat_TEST_SECRET_VALUE';
const PROD = { deploy: { context: 'production', published: true } };
const fakeFetch = (status, body = '') => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { status, text: async () => body, body: { cancel: async () => {} } };
  };
  return { impl, calls };
};

// schedule + target
assert.equal(config.schedule, '47 */2 * * *');
assert.equal(config.path, undefined, 'scheduled functions must not have a URL path');
assert.equal(DISPATCH_URL, 'https://api.github.com/repos/AJWolfe18/TTracker/actions/workflows/rss-tracker-prod.yml/dispatches');
assert.equal(TOKEN_ENV, 'RSS_TRIGGER_GITHUB_TOKEN');

// no token: no request, clear reason
{
  const f = fakeFetch(204);
  assert.deepEqual(await dispatchRssRun(undefined, f.impl), { ok: false, reason: 'missing_token' });
  assert.deepEqual(await dispatchRssRun('', f.impl), { ok: false, reason: 'missing_token' });
  assert.equal(f.calls.length, 0);
}

// request shape: POST, bearer token, main ref, scheduled input as the STRING 'true'
{
  const f = fakeFetch(204);
  assert.deepEqual(await dispatchRssRun(TOKEN, f.impl), { ok: true, status: 204 });
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, DISPATCH_URL);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers.Accept, 'application/vnd.github+json');
  assert.equal(init.headers['X-GitHub-Api-Version'], '2022-11-28');
  assert.deepEqual(JSON.parse(init.body), { ref: 'main', inputs: { scheduled: 'true' } });
  assert.ok(init.signal, 'request has a timeout');
}

// 200 (run details) also counts as started
assert.deepEqual(await dispatchRssRun(TOKEN, fakeFetch(200, '{}').impl), { ok: true, status: 200 });

// GitHub rejections: status + fixed reason only; the body (which could echo anything) is never returned
for (const status of [401, 403, 404, 422]) {
  const r = await dispatchRssRun(TOKEN, fakeFetch(status, `echo ${TOKEN}`).impl);
  assert.deepEqual(r, { ok: false, status, reason: 'github_rejected' });
}

// network error / timeout: no throw
{
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  assert.deepEqual(await dispatchRssRun(TOKEN, async () => { throw timeout; }), { ok: false, reason: 'network_error', detail: 'timeout' });
  assert.deepEqual(await dispatchRssRun(TOKEN, async () => { throw new TypeError('fetch failed'); }), { ok: false, reason: 'network_error', detail: 'fetch_failed' });
}

// handler: reads env, 204 on success, 500 + error log + Discord alert on failure
{
  const HOOK = 'https://discord.test/webhook';
  const realFetch = globalThis.fetch;
  const realError = console.error;
  const logged = [];
  let calls = [];
  // GitHub answers `githubStatus`; the Discord webhook answers 204
  const route = (githubStatus) => async (url, init) => {
    calls.push({ url, init });
    if (url === HOOK) return { ok: true, status: 204, text: async () => '' };
    return { status: githubStatus, text: async () => '{"message":"Bad credentials"}' };
  };
  const env = (vars) => { globalThis.Netlify = { env: { get: (k) => vars[k] } }; };
  try {
    console.error = (...a) => logged.push(a.join(' '));

    // success: one GitHub call, no alert
    env({ [TOKEN_ENV]: TOKEN, DISCORD_WEBHOOK_URL: HOOK });
    globalThis.fetch = route(204);
    assert.equal((await fn(undefined, PROD)).status, 204);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, DISPATCH_URL);
    assert.equal(logged.length, 0);

    // 401: logged without the token, Discord alerted without the token
    calls = [];
    globalThis.fetch = route(401);
    assert.equal((await fn(undefined, PROD)).status, 500);
    assert.match(logged[0], /dispatch failed.*401/);
    assert.ok(!logged[0].includes(TOKEN));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, HOOK);
    const alert = JSON.parse(calls[1].init.body).embeds[0];
    assert.equal(alert.title, 'RSS PROD trigger (Netlify) failed');
    assert.match(alert.description, /401 github_rejected/);
    assert.ok(!calls[1].init.body.includes(TOKEN));

    // missing token: no GitHub call, still alerts
    calls = [];
    env({ DISCORD_WEBHOOK_URL: HOOK });
    assert.equal((await fn(undefined, PROD)).status, 500);
    assert.match(logged[1], /missing_token/);
    assert.deepEqual(calls.map((c) => c.url), [HOOK]);

    // no webhook configured: failure still returns 500, no alert attempted
    calls = [];
    env({ [TOKEN_ENV]: TOKEN });
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

// Codex P0: no raw error text ever leaves dispatchRssRun - only fixed codes
{
  // mangled forms a scrubber could miss: NUL rendered as a space, a line break inside the token
  for (const quoted of [TOKEN.replace('_SECRET', ' SECRET'), TOKEN.replace('_SECRET', '\n_SECRET')]) {
    const leaky = async () => { throw new TypeError(`Headers.append: "Bearer ${quoted}" is an invalid header value.`); };
    assert.deepEqual(await dispatchRssRun(TOKEN, leaky), { ok: false, reason: 'network_error', detail: 'invalid_token_format' });
  }
  const byteString = async () => { throw new TypeError('Cannot convert argument to a ByteString because the character at index 20 has a value of 10003'); };
  assert.equal((await dispatchRssRun(TOKEN, byteString)).detail, 'invalid_token_format');

  // real Node: a token with a line break makes fetch itself throw (no network call)
  const real = await dispatchRssRun('github_pat_AB\nC_SECRETPART');
  assert.deepEqual(real, { ok: false, reason: 'network_error', detail: 'invalid_token_format' });

  const padded = ` ${TOKEN}\n`; // pasted with whitespace: trimmed for the header
  const f = fakeFetch(204);
  await dispatchRssRun(padded, f.impl);
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(await dispatchRssRun('   ', fakeFetch(204).impl), { ok: false, reason: 'missing_token' });
}

// Codex P0: the Discord webhook URL (the credential) never reaches a log
{
  const { postDiscord, redactWebhook } = await import('../../scripts/lib/discord.js');
  const HOOK = 'https://discord.com/api/webhooks/123456/SECRET-hook_token';
  const warned = [];
  const realWarn = console.warn;
  try {
    console.warn = (...a) => warned.push(a.join(' '));
    const bad = ` ${HOOK}`;
    const ok = await postDiscord({ title: 't' }, { webhookUrl: bad, fetchImpl: async () => { throw new TypeError(`Failed to parse URL from ${bad}`); } });
    assert.equal(ok, false);
    assert.equal(warned.length, 1);
    assert.ok(!warned[0].includes('SECRET-hook_token'), warned[0]);
    assert.match(warned[0], /\[webhook\]/);
  } finally {
    console.warn = realWarn;
  }
  assert.equal(redactWebhook(`x https://discordapp.com/api/webhooks/9/abc-DEF y`, undefined), 'x [webhook] y');
  assert.equal(redactWebhook('plain message', HOOK), 'plain message');
}

// Codex P1: only the CURRENT PUBLISHED production deploy may dispatch ("Run now" works on any deploy)
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
    globalThis.fetch = async (url, init) => { calls.push(url); return { ok: true, status: 204, text: async () => '' }; };

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

    // missing / unknown context or published flag: fail closed, no GitHub call, but alert so it can't go silent
    for (const ctx of [undefined, {}, { deploy: { context: 'something-new' } }, { deploy: { context: 'production' } }]) {
      calls = [];
      assert.equal((await fn(undefined, ctx)).status, 500);
      assert.deepEqual(calls, [HOOK]);
    }
    assert.ok(logs.some((l) => /unknown_deploy_context/.test(l)));
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
    console.warn = realWarn;
    delete globalThis.Netlify;
  }
}

console.log('rss-prod-trigger: all tests passed');
