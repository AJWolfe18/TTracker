/**
 * Feed selection, daily retry of stopped feeds, and per-feed liveness stamps (ADO-625).
 *
 * A feed with failure_count >= QUARANTINE_FAILURES used to be skipped forever; it is now fetched again
 * once its last failure (feed_registry.last_failed_at, migration 131) is more than RETRY_AFTER_MS old.
 * Retries are added after the normal feeds, so the normal selection (order, MAX_FEEDS_PER_RUN) is
 * unchanged and the 4-minute runtime guard cuts retries first.
 *
 * Every write to the migration-131 columns is its own update and a failure only logs: if the code runs
 * before the migration, failure_count / last_fetched_at updates still land and nothing is retried.
 *
 * Kept free of pipeline imports so the ingest alert and tests can load it.
 */

export const QUARANTINE_FAILURES = 5;
export const RETRY_AFTER_MS = 24 * 3600000;
export const MAX_RETRY_FEEDS_PER_RUN = 5;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * Active feeds for one run: up to maxFeeds healthy feeds (oldest last_fetched_at first, as before),
 * then up to MAX_RETRY_FEEDS_PER_RUN stopped feeds whose last failure is over 24 hours old.
 * @returns {Promise<{feeds: object[], retryCount: number}>}
 */
export async function selectFeeds(supabase, { maxFeeds, now = Date.now(), log = console } = {}) {
  const dueBefore = new Date(now - RETRY_AFTER_MS).toISOString();
  const [{ data, error }, { data: retry, error: retryError }] = await Promise.all([
    supabase
      .from('feed_registry')
      .select('*')
      .eq('is_active', true)
      .lt('failure_count', QUARANTINE_FAILURES)
      .order('last_fetched_at', { ascending: true })
      .limit(maxFeeds),
    supabase
      .from('feed_registry')
      .select('*')
      .eq('is_active', true)
      .gte('failure_count', QUARANTINE_FAILURES)
      .or(`last_failed_at.is.null,last_failed_at.lt.${dueBefore}`)
      .order('last_failed_at', { ascending: true, nullsFirst: true })
      .limit(MAX_RETRY_FEEDS_PER_RUN),
  ]);

  if (error) throw new Error(`Failed to select feeds: ${error.message}`);
  const feeds = data || [];

  if (retryError) {
    // Most likely migration 131 is not applied yet: run the healthy feeds only.
    log.warn(`⚠️ Stopped-feed retry skipped: ${retryError.message}`);
    return { feeds, retryCount: 0 };
  }
  return { feeds: [...feeds, ...(retry || [])], retryCount: retry?.length || 0 };
}

/**
 * True when migration 131 is applied (the column is present in the row) and this feed has no liveness
 * stamp yet: fetch it once without If-None-Match / If-Modified-Since so a 304-forever feed gets stamped.
 */
export function needsUnconditionalFetch(feedRecord) {
  return !!feedRecord && 'last_item_published_at' in feedRecord && feedRecord.last_item_published_at == null;
}

function itemTime(item) {
  for (const raw of [item?.isoDate, item?.pubDate]) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const t = new Date(raw).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

/**
 * Newest item date in a parsed feed (all items, before filter_config). Items without a usable date,
 * and items dated more than 5 minutes ahead, are ignored: neither proves the feed is publishing, and
 * clamping a far-future item to "now" would make a frozen feed that carries one look alive on every
 * fetch (Codex, PR #179). A feed with no usable date returns null and leaves the stamp unchanged.
 * @returns {string|null} ISO timestamp
 */
export function newestItemPublishedAt(items, now = Date.now()) {
  let newest = null;
  for (const item of items || []) {
    const t = itemTime(item);
    if (t === null || t > now + FUTURE_SKEW_MS) continue;
    if (newest === null || t > newest) newest = t;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/** @returns {Promise<boolean>} false when the update failed (already logged) */
async function updateFeed(db, url, fields, what, log, orFilter = null) {
  try {
    let q = db.from('feed_registry').update(fields).eq('feed_url', url);
    if (orFilter) q = q.or(orFilter);
    const { error } = await q;
    if (!error) return true;
    log.warn(`⚠️ Could not stamp ${what} for ${url}: ${error.message}`);
  } catch (err) {
    log.warn(`⚠️ Could not stamp ${what} for ${url}: ${err.message}`);
  }
  return false;
}

/**
 * Stamp last_item_published_at; no-op when the feed carried no usable date. Never throws.
 * Forward only, enforced in the UPDATE itself: a payload whose newest item is not newer than the
 * stored stamp matches no row, so one fetch of back-dated items (Time's feed, October 13, 2026)
 * cannot make a live feed look stale, and two overlapping runs cannot move it backward either.
 * @returns {string|null} the newest item date, or null when there was none or the update failed
 */
export async function stampFeedLiveness(db, url, items, { now = Date.now(), log = console } = {}) {
  const newest = newestItemPublishedAt(items, now);
  if (!newest) return null;
  const ok = await updateFeed(db, url, { last_item_published_at: newest }, 'last_item_published_at', log,
    `last_item_published_at.is.null,last_item_published_at.lt.${newest}`);
  return ok ? newest : null;
}

/** Stamp last_failed_at so a stopped feed is retried 24 hours later. Never throws. */
export async function stampFeedFailure(db, url, { now = Date.now(), log = console } = {}) {
  await updateFeed(db, url, { last_failed_at: new Date(now).toISOString() }, 'last_failed_at', log);
}
