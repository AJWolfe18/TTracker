// ADO-639: start the RSS Pipeline Health Check once a day from Netlify, so its two daily checks
// (ingest health, ADO-597, and the Stories flag digest, ADO-602) run. Those checks only run on a
// workflow_dispatch run; why, and the history: scripts/lib/daily-check-window.js.
//
// Same rules as rss-prod-trigger.mjs (shared in ../lib/github-dispatch.mjs): same token, only the
// current published production deploy dispatches, no raw error text or response body is ever logged.
// The body is the ref alone: the workflow's only input, force (ADO-645), is optional and stays off,
// so this run obeys the daily claim. GitHub rejects unknown inputs (422), so never send others.
// Setup + token rules: docs/guides/rss-prod-external-trigger.md

import { dispatchWorkflow, makeTriggerHandler } from '../lib/github-dispatch.mjs';

export const DISPATCH_URL =
  'https://api.github.com/repos/AJWolfe18/TTracker/actions/workflows/rss-health-check.yml/dispatches';

// Returns { ok, status?, reason?, detail? } where detail is only ever a fixed code. Never throws.
export function dispatchHealthCheck(token, fetchImpl) {
  return dispatchWorkflow(DISPATCH_URL, token, { ref: 'main' }, fetchImpl, 'ttracker-health-check-trigger');
}

export default makeTriggerHandler({
  tag: 'health-check-trigger',
  dispatch: dispatchHealthCheck,
  title: 'RSS health check trigger (Netlify) failed',
  what: 'the RSS Pipeline Health Check',
  impact: 'The daily ingest health check and Stories flag digest did not run today.',
});

// Once a day at 13:23 UTC (7:23 AM Central in winter, 8:23 AM in summer). After 12:00 UTC so the
// daily digest slots (dailySlot / storiesSlot, ending 12:00 and 06:00 UTC) are complete; minute 23
// stays clear of the top of the hour (GitHub's busiest), the RSS trigger's :47 and GitHub's :17 and :41 crons.
export const config = { schedule: '23 13 * * *' };
