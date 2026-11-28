/**
 * Once-a-day gate for checks that run inside the 6-hourly RSS Pipeline Health Check
 * (alert-ingest-health.js, ADO-597; the Stories needs-review digest, ADO-602).
 *
 * The daily run is the workflow_dispatch run that the Netlify scheduled function
 * netlify/functions/health-check-trigger.mjs starts at 13:23 UTC (ADO-639), plus any run Josh starts
 * by hand. GitHub's own scheduled runs never check any more: since November 7, 2026 GitHub starts the
 * cron only around 07:00 and 20:00 UTC, so the old "scheduled run starting 12:00-17:59 UTC" gate
 * skipped both checks November 8-24, and letting a late scheduled run check as well could post the
 * same digest twice.
 */

// The daily digest slots end at this UTC hour (dailySlot). The Netlify run starts after it.
export const DAILY_SLOT_END_HOUR_UTC = 12;
const DAY_MS = 24 * 3600000;

/**
 * Once a day: only a workflow_dispatch run checks (the Netlify daily start, or a manual run).
 * Scheduled runs normally do not (a late GitHub run would post a second time), push-triggered runs never
 * do (scripts/rss/**, migrations/**), and a run with no GitHub event (a local run) does not either.
 * DAILY_CHECK_FALLBACK=1 makes any run check. The health check workflow's "Daily run watchdog" step sets
 * it on the first scheduled run after 14:00 UTC when no workflow_dispatch run happened that day, so a
 * Netlify trigger that never fired cannot silently stop the daily checks (ADO-639 review). Set it by
 * hand to run either daily check locally.
 * @param {object} [opts]
 * @param {boolean} [opts.force] - the caller's own override (e.g. INGEST_HEALTH_FORCE=1)
 */
export function isDailyCheckRun({ env = process.env, force = false } = {}) {
  return force || env.GITHUB_EVENT_NAME === 'workflow_dispatch' || env.DAILY_CHECK_FALLBACK === '1';
}

/** Why a run skipped its daily check, for the log line. One wording for every daily check. */
export function dailyCheckSkipNote(env = process.env) {
  return `checks only on a workflow_dispatch run (the Netlify daily start or a manual run); this is a ${env.GITHUB_EVENT_NAME || 'local'} run`;
}

/**
 * The fixed 24-hour slot a daily digest reports: from 12:00 UTC the day before the most recent one,
 * to that most recent 12:00 UTC at or before `now`. Back-to-back daily runs therefore report adjacent
 * slots with no gap and no overlap, whenever after 12:00 UTC they start.
 * @returns {{start: Date, end: Date}} start inclusive, end exclusive
 */
export function dailySlot(now = Date.now()) {
  const d = new Date(now);
  let end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAILY_SLOT_END_HOUR_UTC);
  if (end > now) end -= DAY_MS;
  return { start: new Date(end - DAY_MS), end: new Date(end) };
}
