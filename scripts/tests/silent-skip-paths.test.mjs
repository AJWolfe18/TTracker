/**
 * ADO-466 AC #6: Unit tests for silent-skip paths.
 *
 * Covers all 4 HIGH severity call sites + the recordSkip helper itself.
 *
 * Run: node scripts/tests/silent-skip-paths.test.mjs
 */

// Env shim so RSSTracker constructor doesn't throw during import
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.local';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'test-key';

import assert from 'node:assert/strict';
import { recordSkip, PIPELINES, REASONS } from '../lib/skip-reasons.js';
import { enrichStory } from '../enrichment/enrich-stories-inline.js';
import { processArticleItemAtomic } from '../rss/fetch_feed.js';
import { RSSTracker } from '../rss-tracker-supabase.js';

// ---------- Mock supabase ----------

/**
 * Build a mock supabase client that records inserts and returns configured
 * query results. Pass `queryResponses` to customize what chains resolve to:
 *   {
 *     'articles:fetch': { data: [...], error: null },   // default fetch
 *     'budgets:single': { data: { spent_usd: 999 } },   // .single() call
 *     'article_story:fetch': { data: [] }                // fetch article_story
 *   }
 */
function createMockSupabase(queryResponses = {}) {
  const inserts = [];

  const makeChain = (table) => {
    const chain = {
      _table: table,
      insert(row) {
        inserts.push({ table, row });
        return Promise.resolve({ error: null });
      },
      select() { return chain; },
      update() { return chain; },
      delete() { return chain; },
      eq() { return chain; },
      neq() { return chain; },
      gte() { return chain; },
      lt() { return chain; },
      lte() { return chain; },
      or() { return chain; },
      is() { return chain; },
      in() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      range() { return chain; },
      single() {
        const key = `${table}:single`;
        return Promise.resolve(queryResponses[key] || { data: null, error: null });
      },
      then(resolve, reject) {
        const key = `${table}:fetch`;
        const result = queryResponses[key] || { data: [], error: null };
        return Promise.resolve(result).then(resolve, reject);
      }
    };
    return chain;
  };

  return {
    from: (table) => makeChain(table),
    _inserts: inserts
  };
}

// ---------- Test runner ----------

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ---------- Tests ----------

test('recordSkip inserts expected row shape into pipeline_skips', async () => {
  const sb = createMockSupabase();
  await recordSkip(sb, {
    pipeline: PIPELINES.RSS_FETCH,
    reason: REASONS.FRESHNESS_FILTER,
    entity_type: 'article_url',
    entity_id: 'https://test.local/x',
    metadata: { age_hours: 120 }
  });
  assert.equal(sb._inserts.length, 1, 'expected exactly 1 insert');
  assert.equal(sb._inserts[0].table, 'pipeline_skips');
  const row = sb._inserts[0].row;
  assert.equal(row.pipeline, 'rss_fetch');
  assert.equal(row.reason, 'freshness_filter');
  assert.equal(row.entity_type, 'article_url');
  assert.equal(row.entity_id, 'https://test.local/x');
  assert.deepEqual(row.metadata, { age_hours: 120 });
});

test('recordSkip coerces numeric entity_id to string, preserves 0', async () => {
  const sb = createMockSupabase();
  await recordSkip(sb, { pipeline: 'p', reason: 'r', entity_id: 42 });
  await recordSkip(sb, { pipeline: 'p', reason: 'r', entity_id: 0 });
  await recordSkip(sb, { pipeline: 'p', reason: 'r', entity_id: null });
  assert.equal(sb._inserts[0].row.entity_id, '42');
  assert.equal(sb._inserts[1].row.entity_id, '0', '0 must be preserved, not null');
  assert.equal(sb._inserts[2].row.entity_id, null);
});

test('recordSkip never throws on supabase insert error', async () => {
  const sb = {
    from: () => ({
      insert: () => Promise.resolve({ error: { message: 'constraint violation' } })
    })
  };
  // Must not throw
  await recordSkip(sb, { pipeline: 'p', reason: 'r' });
});

test('recordSkip never throws on thrown insert', async () => {
  const sb = {
    from: () => ({ insert: () => { throw new Error('fatal'); } })
  };
  // Must not throw
  await recordSkip(sb, { pipeline: 'p', reason: 'r' });
});

test('recordSkip no-ops when pipeline or reason missing', async () => {
  const sb = createMockSupabase();
  await recordSkip(sb, { pipeline: '', reason: 'r' });
  await recordSkip(sb, { pipeline: 'p', reason: null });
  await recordSkip(sb, { reason: 'r' });
  assert.equal(sb._inserts.length, 0);
});

test('recordSkip no-ops when supabase client missing', async () => {
  // Just verify it doesn't throw
  await recordSkip(null, { pipeline: 'p', reason: 'r' });
  await recordSkip({}, { pipeline: 'p', reason: 'r' });
});

test('PIPELINES and REASONS are frozen and contain expected keys', () => {
  assert.throws(() => { PIPELINES.NEW_KEY = 'x'; }, TypeError);
  assert.throws(() => { REASONS.NEW_KEY = 'x'; }, TypeError);
  const expectedPipelines = ['RSS_FETCH', 'RSS_ENRICHMENT', 'EMBEDDINGS', 'ENTITY_EXTRACTION', 'ENTITY_AGGREGATION', 'STORY_ENRICHMENT'];
  for (const key of expectedPipelines) {
    assert.ok(PIPELINES[key], `missing PIPELINES.${key}`);
    assert.equal(typeof PIPELINES[key], 'string');
  }
  const expectedReasons = ['BUDGET_EXCEEDED', 'FRESHNESS_FILTER', 'NO_ARTICLES', 'NO_ENTITIES', 'EMBEDDING_FAILURE', 'MAX_RETRIES_EXCEEDED', 'PARSE_ERROR', 'API_ERROR'];
  for (const key of expectedReasons) {
    assert.ok(REASONS[key], `missing REASONS.${key}`);
    assert.equal(typeof REASONS[key], 'string');
  }
});

test('HIGH path: story_enrichment + no_articles — enrichStory writes skip then throws', async () => {
  const sb = createMockSupabase({
    'article_story:fetch': { data: [], error: null }
  });
  const openai = { chat: { completions: { create: () => { throw new Error('should not reach openai'); } } } };

  await assert.rejects(
    () => enrichStory({ id: 999, primary_headline: 'test' }, { supabase: sb, openaiClient: openai }),
    /No articles found/
  );

  const skip = sb._inserts.find(i => i.table === 'pipeline_skips');
  assert.ok(skip, 'expected a pipeline_skips row');
  assert.equal(skip.row.pipeline, PIPELINES.STORY_ENRICHMENT);
  assert.equal(skip.row.reason, REASONS.NO_ARTICLES);
  assert.equal(skip.row.entity_type, 'story');
  assert.equal(skip.row.entity_id, '999');
});

test('HIGH path: rss_fetch + freshness_filter — processArticleItemAtomic writes skip for old articles', async () => {
  const db = createMockSupabase();
  const oldItem = {
    link: 'https://test.local/old-article',
    title: 'Old article',
    // normalizePublishedAt reads isoDate first via toStr + ?? chain;
    // toStr(undefined) returns '' (not undefined) so the ?? doesn't fall through to pubDate.
    // Use isoDate to simulate a normal rss-parser item.
    isoDate: '2020-01-01T00:00:00Z'
  };
  const result = await processArticleItemAtomic(oldItem, 'https://feed.local', 'Test Source', 42, db);

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'too_old');

  const skip = db._inserts.find(i => i.table === 'pipeline_skips');
  assert.ok(skip, 'expected a pipeline_skips row');
  assert.equal(skip.row.pipeline, PIPELINES.RSS_FETCH);
  assert.equal(skip.row.reason, REASONS.FRESHNESS_FILTER);
  assert.equal(skip.row.entity_type, 'article_url');
  assert.equal(skip.row.entity_id, 'https://test.local/old-article');
  assert.equal(skip.row.metadata.feed_id, 42);
  assert.equal(skip.row.metadata.source_name, 'Test Source');
  assert.ok(skip.row.metadata.age_hours > 1000, 'should be very old');
});

test('HIGH path: entity_extraction + budget_exceeded — RSSTracker writes skip when spent >= limit', async () => {
  const tracker = new RSSTracker();
  const mockSb = createMockSupabase({
    'budgets:single': { data: { spent_usd: 999 }, error: null }
  });
  tracker.supabase = mockSb;

  await tracker.extractArticleEntitiesPhase();

  const skip = mockSb._inserts.find(i => i.table === 'pipeline_skips');
  assert.ok(skip, 'expected a pipeline_skips row for budget_exceeded');
  assert.equal(skip.row.pipeline, PIPELINES.ENTITY_EXTRACTION);
  assert.equal(skip.row.reason, REASONS.BUDGET_EXCEEDED);
  assert.equal(skip.row.entity_type, 'pipeline');
  assert.equal(skip.row.metadata.spent_usd, 999);
});

test('HIGH path: embeddings + embedding_failure — RSSTracker writes skip when OpenAI throws', async () => {
  const tracker = new RSSTracker();
  const mockSb = createMockSupabase({
    'articles:fetch': {
      data: [{ id: 'art-1', title: 'T', content: 'C', excerpt: null }],
      error: null
    }
  });
  tracker.supabase = mockSb;
  tracker.openai = {
    embeddings: {
      create: () => { throw new Error('openai timeout'); }
    }
  };

  await tracker.enrichArticles();

  const skip = mockSb._inserts.find(i => i.table === 'pipeline_skips');
  assert.ok(skip, 'expected a pipeline_skips row for embedding_failure');
  assert.equal(skip.row.pipeline, PIPELINES.EMBEDDINGS);
  assert.equal(skip.row.reason, REASONS.EMBEDDING_FAILURE);
  assert.equal(skip.row.entity_type, 'article');
  assert.equal(skip.row.entity_id, 'art-1');
  assert.equal(skip.row.metadata.cause, 'api_exception');
  assert.ok(skip.row.metadata.message.includes('timeout'));
  assert.equal(tracker.stats.embedding_failures, 1);
});

// ---------- Run ----------

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    if (err.stack) console.log(`    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`);
    failed++;
  }
}

console.log(`\n${passed}/${tests.length} passed${failed ? `, ${failed} FAILED` : ''}`);
if (failed) process.exit(1);
console.log('[OK] silent-skip-paths');
