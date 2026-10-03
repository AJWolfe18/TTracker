/**
 * SCOTUS ingestion guard for a CourtListener cluster's date_filed (ADO-493).
 *
 * On February 23, 2026 one fetch imported 1,220 clusters dated 2020 (a sync run with no saved
 * state fell back to the old 2020-01-01 default). They were real 2020 orders, but outside the
 * tracker's scope, and they buried the admin Drafts view. fetch-cases.js now defaults to the
 * start of the October 2024 term and runs every cluster through this check before it is
 * processed, so an out-of-range, missing or future date can never become a row (or move the
 * sync checkpoint). Skipped clusters are logged to pipeline_skips as malformed_decided_at.
 */

/** Start of the October 2024 term: the earliest decision the tracker covers by default. */
export const DEFAULT_SINCE_DATE = '2024-10-01';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {string|null|undefined} dateFiled - cluster.date_filed (YYYY-MM-DD)
 * @param {{ floor: string, now?: number }} opts - floor = the run's since date (YYYY-MM-DD)
 * @returns {string|null} why the cluster must be skipped, or null when the date is usable
 */
export function checkDecidedAt(dateFiled, { floor, now = Date.now() }) {
  if (!dateFiled) return 'no date_filed';
  if (!ISO_DATE.test(dateFiled) || Number.isNaN(Date.parse(`${dateFiled}T00:00:00Z`))) {
    return `unparseable date_filed "${dateFiled}"`;
  }
  // Round-trip catches impossible calendar dates such as 2025-02-30
  if (new Date(`${dateFiled}T00:00:00Z`).toISOString().slice(0, 10) !== dateFiled) {
    return `impossible date_filed "${dateFiled}"`;
  }
  if (floor && dateFiled < floor) return `date_filed ${dateFiled} is before the run's since date ${floor}`;
  // One day of slack for time zones: CourtListener dates are US dates
  const tomorrow = new Date(now + 24 * 3600 * 1000).toISOString().slice(0, 10);
  if (dateFiled > tomorrow) return `date_filed ${dateFiled} is in the future`;
  return null;
}
