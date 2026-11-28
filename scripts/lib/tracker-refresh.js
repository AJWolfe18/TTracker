/**
 * The batched main-line refresh loop (ADO-638), shared by scripts/maintenance/refresh-tracker.js
 * (every pipeline workflow) and scripts/fronts/front-agent-db.js (the fronts routine).
 * Dependency-free on purpose: the cloud routine sandbox has no npm install step. It needs only an
 * object with rpc(fn, args) -> { data, error } (a supabase-js client, or a small fetch adapter).
 *
 * refresh_tracker_derived(p_max_rows) (migration 136) changes at most p_max_rows main_line flags per
 * call and says more_pending when the batch was full. The API cancels a statement after ~8 seconds,
 * so a backlog is drained in small calls instead of one long one.
 */

// Each call pays a fixed ~2.5 s to evaluate the rule view, plus ~50 ms per changed row
// (PROD catch-up of November 27, 2026: 358 rows in 21.3 s). 50 rows is ~5 s, under the
// API's ~8 second limit with room to spare; 150 (~10 s) would time out every time.
export const DEFAULT_BATCH = 50;
export const MIN_BATCH = 10;
// The workflow steps allow 5 minutes; stop asking for more after 4 so the
// alert and skip row are still written inside the step.
export const DEFAULT_BUDGET_MS = 4 * 60 * 1000;

/** True for a statement the database cancelled for running too long. */
export function isTimeoutError(error) {
  return error?.code === '57014' || /statement timeout/i.test(String(error?.message ?? ''));
}

/** True when the API has no refresh_tracker_derived(p_max_rows) yet (migration 136 not applied). */
function isMissingBatchSignature(error) {
  return error?.code === 'PGRST202' || error?.code === '42883';
}

const firstRow = (data) => (Array.isArray(data) ? data[0] : data);

/**
 * Drain the main-line backlog in batches.
 * @returns {Promise<{rows_changed:number|null, took_ms:number|null, calls:number, pending:boolean, legacy:boolean, batch:number}>}
 *   pending = rows were still waiting when the time budget ran out.
 *   legacy  = migration 136 is missing, so the old one-shot call ran instead.
 * @throws on an RPC error that halving cannot fix (non-timeout, or a timeout at MIN_BATCH); the error's
 *   `applied` = { rows_changed, calls } already committed by earlier batches of this run
 */
export async function refreshTracker(supabase, {
  batch = DEFAULT_BATCH,
  minBatch = MIN_BATCH,
  budgetMs = DEFAULT_BUDGET_MS,
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const started = now();
  let size = batch;
  let rows = 0;
  let took = 0;
  let calls = 0;
  const outOfTime = () => now() - started >= budgetMs;
  const done = (pending) => ({ rows_changed: rows, took_ms: took, calls, pending, legacy: false, batch: size });
  for (;;) {
    const { data, error } = await supabase.rpc('refresh_tracker_derived', { p_max_rows: size });
    if (error) {
      if (calls === 0 && isMissingBatchSignature(error)) {
        // Script shipped before the migration: the old call, exactly as before ADO-638.
        const legacy = await supabase.rpc('refresh_tracker_derived');
        if (legacy.error) throw new Error(legacy.error.message);
        const row = firstRow(legacy.data);
        return { rows_changed: row?.rows_changed ?? null, took_ms: row?.took_ms ?? null, calls: 1, pending: false, legacy: true, batch: size };
      }
      if (isTimeoutError(error) && size > minBatch) {
        size = Math.max(minBatch, Math.floor(size / 2));
        log(`refresh-tracker: batch timed out, retrying with ${size} rows`);
        if (outOfTime()) return done(true);
        continue;
      }
      // Batches before this one are committed: say so, the alert must not claim nothing changed.
      throw Object.assign(new Error(error.message), { applied: { rows_changed: rows, calls } });
    }
    calls += 1;
    const row = firstRow(data);
    rows += row?.rows_changed ?? 0;
    took += row?.took_ms ?? 0;
    if (!row?.more_pending) return done(false);
    if (outOfTime()) return done(true);
  }
}
