// ADO-637: start the PROD RSS workflow every 2 hours from Netlify.
// Since August 27, 2026 GitHub's own scheduler fires our `17 */2 * * *` cron only 4-6 times a day
// (repo-wide; same onset reported by other projects). A workflow_dispatch call starts a run at once,
// so this scheduled function makes that call. GitHub's schedule stays as a backup; the workflow's
// concurrency group keeps the two from running together.
//
// Fires only on the published production deploy (main / trumpytracker.com): Netlify never runs
// scheduled functions on branch deploys (test) or exposes them by URL.
// `scheduled: 'true'` makes the run obey the ENABLE_PROD_SCHEDULES kill switch like the cron.
// Token, deploy guard, dispatch call and failure alert are shared with health-check-trigger (ADO-639).
// Setup + token rules: docs/guides/rss-prod-external-trigger.md

import { dispatchWorkflow, makeTriggerHandler } from '../lib/github-dispatch.mjs';

export const DISPATCH_URL =
  'https://api.github.com/repos/AJWolfe18/TTracker/actions/workflows/rss-tracker-prod.yml/dispatches';

// Returns { ok, status?, reason?, detail? } where detail is only ever a fixed code. Never throws.
export function dispatchRssRun(token, fetchImpl) {
  return dispatchWorkflow(DISPATCH_URL, token, { ref: 'main', inputs: { scheduled: 'true' } }, fetchImpl, 'ttracker-rss-prod-trigger');
}

// A failure repeats the alert every 2 hours until fixed, so an expired token can't quietly drop
// PROD back to GitHub's 4-6 runs a day.
export default makeTriggerHandler({
  tag: 'rss-prod-trigger',
  dispatch: dispatchRssRun,
  title: 'RSS PROD trigger (Netlify) failed',
  what: 'the RSS run',
});

// Every 2 hours at minute 47 UTC: half an hour off GitHub's :17 cron so the two rarely meet.
export const config = { schedule: '47 */2 * * *' };
