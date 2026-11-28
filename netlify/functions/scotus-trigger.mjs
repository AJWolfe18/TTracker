// ADO-644: start the daily PROD SCOTUS fetch (scotus-tracker.yml) from Netlify.
// GitHub's cron for it (`47 18 * * *`) started 5 to 9 hours late every day November 20-27, 2026
// (repo-wide degradation since August 27, 2026; see rss-prod-trigger.mjs). A workflow_dispatch call
// starts a run at once. GitHub's cron stays as a backup, moved to 21:47 UTC so it is always due after
// this function's run; the workflow's backup_guard job then skips it, so the fetch and its alerts do
// not repeat.
//
// Same rules as the other triggers (shared in ../lib/github-dispatch.mjs): same token, only the
// current published production deploy dispatches, no raw error text or response body is ever logged.
// The body is the ref alone: the workflow's only input, skip_fetch, defaults to false (a full run).
// No `scheduled` flag is needed: the workflow's ENABLE_PROD_SCHEDULES kill switch covers every event.
// Setup + token rules: docs/guides/rss-prod-external-trigger.md

import { dispatchWorkflow, makeTriggerHandler } from '../lib/github-dispatch.mjs';

export const DISPATCH_URL =
  'https://api.github.com/repos/AJWolfe18/TTracker/actions/workflows/scotus-tracker.yml/dispatches';

// Returns { ok, status?, reason?, detail? } where detail is only ever a fixed code. Never throws.
export function dispatchScotusRun(token, fetchImpl) {
  return dispatchWorkflow(DISPATCH_URL, token, { ref: 'main' }, fetchImpl, 'ttracker-scotus-trigger');
}

export default makeTriggerHandler({
  tag: 'scotus-trigger',
  dispatch: dispatchScotusRun,
  title: 'SCOTUS trigger (Netlify) failed',
  what: 'the daily SCOTUS fetch',
  impact: "Today's SCOTUS fetch now waits for GitHub's late backup run (5 to 9 hours late lately).",
});

// Once a day at 19:47 UTC (1:47 PM Central in winter, 2:47 PM in summer): one hour after the old
// 18:47 cron. 18:47 is also an RSS slot (the RSS trigger fires at :47 on EVEN hours), and both
// workflows end with assign-fronts and refresh-tracker under different concurrency groups, so at the
// same minute they would run those two steps side by side. 19:47 is an odd hour, exactly between two
// RSS runs. It is still after the Court's 10:00 AM ET opinion releases and the SCOTUS agent's
// 16:00 UTC weekday run, the same order as before.
export const config = { schedule: '47 19 * * *' };
