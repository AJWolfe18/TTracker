// ADO-625: stopped feeds (failure_count >= 5) are retried once a day; healthy-feed selection is
// unchanged; a missing migration-131 column never breaks selection or the existing feed updates;
// per-feed liveness is the newest item date in the feed itself.
import assert from 'node:assert/strict';
import {
  selectFeeds, newestItemPublishedAt, stampFeedLiveness, stampFeedFailure,
  QUARANTINE_FAILURES, RETRY_AFTER_MS, MAX_RETRY_FEEDS_PER_RUN,
} from '../rss/feed-health.js';

const NOW = Date.parse('2026-10-11T20:00:00Z');
const quiet = { warn: () => {} };
const DAY = 24 * 3600000;

// Minimal in-memory feed_registry behind the supabase-js query-builder calls feed-health.js uses.
function fakeDb(rows, { retryError = null, updateError = null } = {}) {
  const calls = [];
  const db = {
    calls,
    from(table) {
      assert.equal(table, 'feed_registry');
      const q = { filters: [], orders: [], limitN: Infinity, orExpr: null, update: null };
      const run = () => {
        if (q.update) {
          calls.push({ update: q.update, filters: q.filters });
          return { error: updateError };
        }
        if (q.orExpr && retryError) return { data: null, error: retryError };
        let out = rows.filter((r) => q.filters.every(([op, col, v]) => (
          op === 'eq' ? r[col] === v : op === 'lt' ? r[col] < v : op === 'gte' ? r[col] >= v : true)));
        if (q.orExpr) {
          const before = q.orExpr.match(/last_failed_at\.lt\.(.+)$/)[1];
          out = out.filter((r) => r.last_failed_at == null || r.last_failed_at < before);
        }
        for (const [col, { ascending, nullsFirst }] of [...q.orders].reverse()) {
          out = [...out].sort((a, b) => {
            if (a[col] == null && b[col] == null) return 0;
            if (a[col] == null) return nullsFirst ? -1 : 1;
            if (b[col] == null) return nullsFirst ? 1 : -1;
            return (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1);
          });
        }
        calls.push({ select: true, or: q.orExpr, filters: q.filters });
        return { data: out.slice(0, q.limitN), error: null };
      };
      const b = {
        select: () => b,
        update: (fields) => { q.update = fields; return b; },
        eq: (c, v) => { q.filters.push(['eq', c, v]); return b; },
        lt: (c, v) => { q.filters.push(['lt', c, v]); return b; },
        gte: (c, v) => { q.filters.push(['gte', c, v]); return b; },
        or: (expr) => { q.orExpr = expr; return b; },
        order: (c, o) => { q.orders.push([c, o]); return b; },
        limit: (n) => { q.limitN = n; return b; },
        then: (res, rej) => Promise.resolve(run()).then(res, rej),
      };
      return b;
    },
  };
  return db;
}

const iso = (ms) => new Date(ms).toISOString();
const feed = (id, extra) => ({ id, is_active: true, failure_count: 0, last_fetched_at: iso(NOW - id * 1000), last_failed_at: null, ...extra });

// --- stopped-and-due (failed > 24h ago, or never stamped) is retried; stopped-and-not-due is not;
//     inactive stopped feeds are never retried; retries come after the healthy feeds
{
  const rows = [
    feed(1), feed(2),
    feed(10, { failure_count: 5, last_failed_at: iso(NOW - RETRY_AFTER_MS - 60000) }), // due
    feed(11, { failure_count: 7, last_failed_at: iso(NOW - 3600000) }),               // failed 1h ago
    feed(12, { failure_count: 5, last_failed_at: null }),                              // pre-131 stop: due now
    feed(13, { failure_count: 9, is_active: false, last_failed_at: null }),            // inactive
  ];
  const { feeds, retryCount } = await selectFeeds(fakeDb(rows), { maxFeeds: 30, now: NOW, log: quiet });
  assert.deepEqual(feeds.map((f) => f.id), [2, 1, 12, 10], 'healthy (oldest fetch first), then due retries (never-stamped first)');
  assert.equal(retryCount, 2);
}

// --- healthy-feed selection is exactly as before: same filters, order and cap, retries on top
{
  const rows = Array.from({ length: 35 }, (_, i) => feed(i + 1));
  rows.push(...Array.from({ length: 8 }, (_, i) => feed(100 + i, { failure_count: QUARANTINE_FAILURES })));
  const db = fakeDb(rows);
  const { feeds, retryCount } = await selectFeeds(db, { maxFeeds: 30, now: NOW, log: quiet });
  const healthy = feeds.slice(0, 30);
  assert.ok(healthy.every((f) => f.failure_count < QUARANTINE_FAILURES));
  assert.deepEqual(healthy.map((f) => f.id), rows.slice(0, 35).sort((a, b) => (a.last_fetched_at < b.last_fetched_at ? -1 : 1)).slice(0, 30).map((f) => f.id));
  assert.equal(retryCount, MAX_RETRY_FEEDS_PER_RUN, 'retries are capped per run');
  assert.equal(feeds.length, 30 + MAX_RETRY_FEEDS_PER_RUN);
  assert.deepEqual(db.calls[0].filters, [['eq', 'is_active', true], ['lt', 'failure_count', 5]]);
}

// --- migration 131 not applied: the retry read fails, healthy feeds still run, nothing throws
{
  const rows = [feed(1), feed(10, { failure_count: 5 })];
  const warnings = [];
  const { feeds, retryCount } = await selectFeeds(fakeDb(rows, { retryError: { message: 'column feed_registry.last_failed_at does not exist' } }),
    { maxFeeds: 30, now: NOW, log: { warn: (m) => warnings.push(m) } });
  assert.deepEqual(feeds.map((f) => f.id), [1]);
  assert.equal(retryCount, 0);
  assert.match(warnings[0], /retry skipped/);
}

// --- liveness = newest item in the feed (isoDate, else pubDate); undated items ignored, never "now";
//     future dates clamped to now + 5 minutes; object-shaped dates (xml2js) ignored
{
  const items = [
    { isoDate: '2026-10-01T10:00:00.000Z' },
    { pubDate: 'Thu, 08 Oct 2026 09:00:00 GMT' },
    { isoDate: 'not a date', pubDate: 'Tue, 06 Oct 2026 09:00:00 GMT' },
    { title: 'no date' },
    { pubDate: Object.create(null) },
  ];
  assert.equal(newestItemPublishedAt(items, NOW), '2026-10-08T09:00:00.000Z');
  assert.equal(newestItemPublishedAt([{ title: 'x' }], NOW), null);
  assert.equal(newestItemPublishedAt([], NOW), null);
  assert.equal(newestItemPublishedAt(undefined, NOW), null);
  assert.equal(newestItemPublishedAt([{ isoDate: iso(NOW + 30 * DAY) }], NOW), iso(NOW + 5 * 60000));
}

// --- stamps are separate updates keyed by feed_url and never throw, even on a missing column
{
  const db = fakeDb([]);
  assert.equal(await stampFeedLiveness(db, 'https://f/rss', [{ isoDate: '2026-10-08T09:00:00Z' }], { now: NOW, log: quiet }), '2026-10-08T09:00:00.000Z');
  await stampFeedFailure(db, 'https://f/rss', { now: NOW, log: quiet });
  assert.deepEqual(db.calls.map((c) => c.update), [{ last_item_published_at: '2026-10-08T09:00:00.000Z' }, { last_failed_at: iso(NOW) }]);
  assert.ok(db.calls.every((c) => c.filters[0][1] === 'feed_url' && c.filters[0][2] === 'https://f/rss'));

  const none = fakeDb([]);
  await stampFeedLiveness(none, 'https://f/rss', [{ title: 'undated' }], { now: NOW, log: quiet });
  assert.equal(none.calls.length, 0, 'no usable date -> no write');

  const warnings = [];
  const broken = fakeDb([], { updateError: { message: 'column feed_registry.last_failed_at does not exist' } });
  await stampFeedFailure(broken, 'https://f/rss', { now: NOW, log: { warn: (m) => warnings.push(m) } });
  assert.match(warnings[0], /last_failed_at/);
  const throwing = { from: () => { throw new Error('network down'); } };
  await stampFeedFailure(throwing, 'https://f/rss', { now: NOW, log: quiet });
}

console.log('feed-health.test: all assertions passed');
