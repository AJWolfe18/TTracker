// ADO-637: start the PROD RSS workflow every 2 hours from Netlify.
// Since August 27, 2026 GitHub's own scheduler fires our `17 */2 * * *` cron only 4-6 times a day
// (repo-wide; same onset reported by other projects). A workflow_dispatch call starts a run at once,
// so this scheduled function makes that call. GitHub's schedule stays as a backup; the workflow's
// concurrency group keeps the two from running together.
//
// Fires only on the published production deploy (main / trumpytracker.com): Netlify never runs
// scheduled functions on branch deploys (test) or exposes them by URL.
// `scheduled: 'true'` makes the run obey the ENABLE_PROD_SCHEDULES kill switch like the cron.
// Setup + token rules: docs/guides/rss-prod-external-trigger.md

import { postDiscord, COLORS } from '../../scripts/lib/discord.js';

export const DISPATCH_URL =
  'https://api.github.com/repos/AJWolfe18/TTracker/actions/workflows/rss-tracker-prod.yml/dispatches';
export const TOKEN_ENV = 'RSS_TRIGGER_GITHUB_TOKEN';

// Fetch errors can quote the Authorization header ("Headers.append: \"Bearer <token>\" is an invalid
// header value"), and no scrubber can promise to catch every mangled form. So no raw error text or
// response body ever leaves this function: only a fixed code chosen here.
export function classifyFetchError(err) {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return 'timeout';
  if (err?.name === 'TypeError' && /header|ByteString/i.test(String(err?.message))) return 'invalid_token_format';
  return 'fetch_failed';
}

// Returns { ok, status?, reason?, detail? } where detail is only ever a fixed code. Never throws.
export async function dispatchRssRun(token, fetchImpl = fetch) {
  if (!token || !String(token).trim()) return { ok: false, reason: 'missing_token' };
  let res;
  try {
    res = await fetchImpl(DISPATCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${String(token).trim()}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'ttracker-rss-prod-trigger',
      },
      body: JSON.stringify({ ref: 'main', inputs: { scheduled: 'true' } }),
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
const readEnv = (key) => globalThis.Netlify?.env?.get(key) ?? process.env[key];

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

export default async (req, context) => {
  const decision = deployDecision(context);
  if (decision.startsWith('skip:')) {
    console.warn(`[rss-prod-trigger] skipped: ${decision.slice(5)} is not the published production deploy`);
    return new Response('skipped: not the published production deploy', { status: 200 });
  }
  const result = decision === 'dispatch'
    ? await dispatchRssRun(readEnv(TOKEN_ENV))
    : { ok: false, reason: 'unknown_deploy_context' };
  if (!result.ok) {
    // 401 = token expired/revoked, 403/404 = wrong scope, 422 = workflow input missing on main.
    console.error('[rss-prod-trigger] dispatch failed', JSON.stringify(result));
    // Nobody reads function logs: ping the channel the workflow failure alerts already use, so an
    // expired token can't quietly drop PROD back to GitHub's 4-6 runs a day. Repeats every 2 hours
    // until fixed. 8s cap keeps dispatch (15s) + alert inside the 30s scheduled-function limit.
    await postDiscord({
      title: 'RSS PROD trigger (Netlify) failed',
      description: `GitHub did not start the RSS run: ${result.status ?? ''} ${result.reason}. ` +
        'Fix: docs/guides/rss-prod-external-trigger.md (Troubleshooting).',
      color: COLORS.error,
    }, { webhookUrl: readEnv('DISCORD_WEBHOOK_URL'), envLabel: undefined, timeoutMs: 8000 });
    return new Response('dispatch failed', { status: 500 });
  }
  return new Response(null, { status: 204 });
};

// Every 2 hours at minute 47 UTC: half an hour off GitHub's :17 cron so the two rarely meet.
export const config = { schedule: '47 */2 * * *' };
