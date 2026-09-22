/**
 * Executive order date mapping (ADO-589).
 *
 * `executive_orders.date` is the SIGNING date (schema doc + the site labels it
 * "Signed"). The Federal Register API returns both `signing_date` and
 * `publication_date`; publication usually trails signing by 1-3 days, and the
 * tracker used to store publication_date here, so every EO showed a late
 * "Signed" date. Keep the mapping in one place so it cannot regress silently.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True only for a real calendar date in YYYY-MM-DD form. A format-only check
 * accepted 2026-09-31, which PostgreSQL rejects and which would fail the whole
 * tracker insert (Codex P1, ADO-589).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidIsoDate(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function validOrNull(value) {
  return isValidIsoDate(value) ? value : null;
}

/**
 * Pick the value to store in `executive_orders.date` for a NEW Federal Register
 * item. Order of preference: signing_date, then publication_date, then `today`.
 * Invalid values are skipped, never stored.
 * @param {{signing_date?: string|null, publication_date?: string|null}} item
 * @param {string} today - YYYY-MM-DD fallback (the tracker's run date)
 * @returns {string}
 */
export function pickEoDate(item, today) {
  return validOrNull(item?.signing_date)
    || validOrNull(item?.publication_date)
    || today;
}

/**
 * Decide what the backfill should do for an EXISTING row. Unlike pickEoDate this
 * never falls back to publication_date: a rejected signing date must not
 * overwrite a date that may already be correct (Codex P1, ADO-589).
 * @param {string|null} currentDate - the row's current `date`
 * @param {unknown} signingDate - signing_date from the Federal Register API
 * @returns {{action: 'missing'|'invalid'|'noop'|'update', to?: string}}
 */
export function resolveBackfillDate(currentDate, signingDate) {
  if (signingDate == null || signingDate === '') return { action: 'missing' };
  if (!isValidIsoDate(signingDate)) return { action: 'invalid' };
  if (signingDate === currentDate) return { action: 'noop' };
  return { action: 'update', to: signingDate };
}
