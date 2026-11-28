// Shared pieces of the Netlify scheduled functions that start a GitHub workflow with a
// workflow_dispatch call: rss-prod-trigger (ADO-637) and health-check-trigger (ADO-639).
// Lives outside netlify/functions so Netlify does not deploy it as a function of its own; each
// function's bundle pulls it in through the relative import.
// Setup + token rules: docs/guides/rss-prod-external-trigger.md

import { postDiscord, COLORS } from '../../scripts/lib/discord.js';

// The first sentence of a failure alert. unknown_deploy_context means GitHub was never called, so the
// text must not blame GitHub (sends troubleshooting toward the token instead of the deploy check).
export function describeFailure(result, what) {
  if (result?.reason === 'unknown_deploy_context') {
    return `Netlify's deploy context was not recognized, so ${what} was not started (GitHub was not called): unknown_deploy_context.`;
  }
  return `GitHub did not start ${what}: ${result?.status ? `${result.status} ` : ''}${result?.reason}.`;
}

// One fine-grained token (Actions read/write on this repo) serves every trigger function.
export const TOKEN_ENV = 'RSS_TRIGGER_GITHUB_TOKEN';

// Fetch errors can quote the Authorization header ("Headers.append: \"Bearer <token>\" is an invalid
// header value"), and no scrubber can promise to catch every mangled form. So no raw error text or
// response body ever leaves this module: only a fixed code chosen here.
export function classifyFetchError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  if (err?.name === 'TypeError' && /header|ByteString/i.test(String(err?.message))) return 'invalid_token_format';
  return 'fetch_failed';
}

// POSTs `body` to a workflow's dispatches URL.
// Returns { ok, status?, reason?, detail? } where detail is only ever a fixed code. Never throws.
export async function dispatchWorkflow(url, token, body, fetchImpl = fetch, userAgent = 'ttracker-netlify-trigger') {
  if (!token || !String(token).trim()) return { ok: false, reason: 'missing_token' };
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(token).trim()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': userAgent,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, reason: 'network_error', detail: classifyFetchError(err) };
  }
  // GitHub answers 204 (or 200 when it returns run details): any 2xx means the run was started.
  if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
  // The status code alone identifies the problem (see the guide's Troubleshooting); the body is never read.
  try { await res.body?.cancel?.(); } catch { /* nothing to free */ }
  return { ok: false, status: res.status, reason: 'github_rejected' };
}

// Netlify's runtime global first; process.env if a runner ever lacks it (never a ReferenceError).
export const readEnv = (key) => globalThis.Netlify?.env?.get(key) ?? process.env[key];

// Netlify schedules only the published production deploy, but "Run now" works on any deploy: the test
// branch deploy, a deploy preview, or an older production deploy in the history. Only the CURRENT
// published production deploy may start a PROD run. A known other deploy is a quiet skip; a missing or
// unrecognized context/published flag fails closed AND alerts, so a runtime change can't silently stop runs.
const NON_PROD_CONTEXTS = new Set(['deploy-preview', 'branch-deploy', 'dev', 'preview-server']);

// Returns 'dispatch' | 'skip:<why>' | 'unknown'
export function deployDecision(context) {
  const deploy = context?.deploy;
  if (deploy?.context === 'production') {
    if (deploy.published === true) return 'dispatch';
    if (deploy.published === false) return 'skip:unpublished production deploy';
    return 'unknown';
  }
  if (NON_PROD_CONTEXTS.has(deploy?.context)) return `skip:deploy context '${deploy.context}'`;
  return 'unknown';
}

// The whole scheduled-function handler. Both triggers use it, so they share one set of
// fail-closed and alert rules.
//   tag       log prefix, e.g. 'rss-prod-trigger'
//   dispatch  (token) => dispatchWorkflow(...) result
//   title     Discord alert title
//   what      what was not started, for describeFailure ("the RSS run")
//   impact    optional sentence saying what the reader loses while it is broken
export function makeTriggerHandler({ tag, dispatch, title, what, impact = '' }) {
  return async (req, context) => {
    const decision = deployDecision(context);
    if (decision.startsWith('skip:')) {
      console.warn(`[${tag}] skipped: ${decision.slice(5)} is not the published production deploy`);
      return new Response('skipped: not the published production deploy', { status: 200 });
    }
    const result = decision === 'dispatch'
      ? await dispatch(readEnv(TOKEN_ENV))
      : { ok: false, reason: 'unknown_deploy_context' };
    if (result.ok) return new Response(null, { status: 204 });

    // 401 = token expired/revoked, 403/404 = wrong scope, 422 = the workflow on main rejects the call.
    console.error(`[${tag}] dispatch failed`, JSON.stringify(result));
    // Nobody reads function logs, so every failed run pings Discord until it is fixed.
    // The 8 s cap keeps dispatch (15 s) + alert inside Netlify's 30 s scheduled-function limit.
    await postDiscord({
      title,
      description: `${describeFailure(result, what)} ${impact ? `${impact} ` : ''}` +
        'Fix: docs/guides/rss-prod-external-trigger.md (Troubleshooting).',
      color: COLORS.error,
    }, { webhookUrl: readEnv('DISCORD_WEBHOOK_URL'), envLabel: undefined, timeoutMs: 8000 });
    return new Response('dispatch failed', { status: 500 });
  };
}
