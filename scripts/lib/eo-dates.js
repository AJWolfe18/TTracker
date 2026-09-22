/**
 * Executive order date mapping (ADO-589).
 *
 * `executive_orders.date` is the SIGNING date (schema doc + the site labels it
 * "Signed"). The Federal Register API returns both `signing_date` and
 * `publication_date`; publication usually trails signing by 1-3 days, and the
 * tracker used to store publication_date here, so every EO showed a late
 * "Signed" date. Keep the mapping in one place so it cannot regress silently.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDateOrNull(value) {
  return typeof value === 'string' && ISO_DATE.test(value) ? value : null;
}

/**
 * Pick the value to store in `executive_orders.date` for a Federal Register item.
 * Order of preference: signing_date, then publication_date, then `today`.
 * @param {{signing_date?: string|null, publication_date?: string|null}} item
 * @param {string} today - YYYY-MM-DD fallback (the tracker's run date)
 * @returns {string}
 */
export function pickEoDate(item, today) {
  return isoDateOrNull(item?.signing_date)
    || isoDateOrNull(item?.publication_date)
    || today;
}
