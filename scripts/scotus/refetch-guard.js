/**
 * SCOTUS re-fetch guard: what to do when a CourtListener cluster lands on a docket that already
 * has a scotus_cases row (ADO-603).
 *
 * fetch-cases.js dedupes on docket_number, and one docket can carry several decisions months
 * apart. Louisiana v. Callais (24-109) was enriched on April 5, 2026 from the June 2025
 * reargument order; the April 29, 2026 merits opinion then landed on the same row, replaced the
 * text and decided_at, and the stale "punted to reargument" write-up stayed published because
 * nothing re-queued the enrichment.
 *
 * - 'refresh': same decision (same cluster, or a CourtListener revision with the same date).
 *   Fetch-owned columns refresh as before; the enrichment stands.
 * - 'new_decision': a different cluster with a LATER date_filed. Refresh, and re-queue the
 *   enrichment so the agent writes about the decision the row now holds.
 * - 'older_decision': a different cluster with an EARLIER date_filed. Skip it: writing it would
 *   put an older decision's text under a newer write-up.
 */

/** @param {string|null|undefined} d - YYYY-MM-DD or an ISO timestamp */
const day = (d) => (d ? String(d).slice(0, 10) : null);

/**
 * @param {{ courtlistener_cluster_id: number|null, decided_at: string|null }} existing - the row
 * @param {{ clusterId: number, dateFiled: string|null }} incoming - the cluster being processed
 * @returns {'refresh'|'new_decision'|'older_decision'}
 */
export function classifyRefetch(existing, { clusterId, dateFiled }) {
  if (existing.courtlistener_cluster_id === clusterId) return 'refresh';
  const have = day(existing.decided_at);
  const got = day(dateFiled);
  if (!have || !got || have === got) return 'refresh';
  return got > have ? 'new_decision' : 'older_decision';
}

/**
 * Columns that put a row back in the SCOTUS agent's queue (enrichment_status pending; the agent
 * rewrites enriched_at and prompt_version on success). Same mechanic as the hand-run ADO-580 reset.
 * The earlier decision's review stamp is cleared too: the needs-review alert skips rows with
 * manual_reviewed_at set, so a stamp left over would hide a flag the agent raises on the new text.
 * Editorial copy and is_public are untouched: the case stays published until the agent rewrites it.
 */
export const REQUEUE_COLUMNS = Object.freeze({
  enrichment_status: 'pending',
  enriched_at: null,
  prompt_version: null,
  manual_reviewed_at: null,
  manual_review_note: null,
});
