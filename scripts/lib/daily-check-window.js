/**
 * Once-a-day gate for checks that run inside the 6-hourly RSS Pipeline Health Check
 * (alert-ingest-health.js, ADO-597; the Stories needs-review digest, ADO-602).
 *
 * The health check is scheduled every 6 hours (0, 6, 12, 18 UTC), so exactly one scheduled run
 * starts in [12:00, 18:00) even when GitHub starts it late (an exact-hour match skipped the whole
 * day whenever the 12:00 run slipped past 13:00).
 */

export const CHECK_WINDOW_UTC = Object.freeze([12, 18]);
const DAY_MS = 24 * 3600000;

/**
 * Once a day: the scheduled run that starts in the 12:00-17:59 UTC window. Manual runs always check.
 * Push-triggered runs of the health workflow (scripts/rss/**, migrations/**) never do, or a push
 * inside the window would post the same thing twice.
 * @param {object} [opts]
 * @param {boolean} [opts.force] - the caller's own override (e.g. INGEST_HEALTH_FORCE=1)
 */
export function isDailyCheckRun({ env = process.env, now = Date.now(), force = false } = {}) {
  if (force || env.GITHUB_EVENT_NAME === 'workflow_dispatch') return true;
  if (env.GITHUB_EVENT_NAME === 'push') return false;
  const h = new Date(now).getUTCHours();
  return h >= CHECK_WINDOW_UTC[0] && h < CHECK_WINDOW_UTC[1];
}

/**
 * The fixed 24-hour slot a daily digest reports: from the window's start hour (12:00 UTC) the day
 * before the most recent one, to that most recent 12:00 UTC at or before `now`. Back-to-back daily
 * runs therefore report adjacent slots with no gap and no overlap, wherever in the window they start.
 * @returns {{start: Date, end: Date}} start inclusive, end exclusive
 */
export function dailySlot(now = Date.now()) {
  const d = new Date(now);
  let end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), CHECK_WINDOW_UTC[0]);
  if (end > now) end -= DAY_MS;
  return { start: new Date(end - DAY_MS), end: new Date(end) };
}
