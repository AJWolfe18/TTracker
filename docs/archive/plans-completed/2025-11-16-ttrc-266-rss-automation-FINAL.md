# TTRC-266: RSS Worker Automation - FINAL IMPLEMENTATION PLAN

**Status:** Ready for Implementation
**Created:** 2025-11-16
**Last Updated:** 2025-11-16
**Estimated Effort:** 10-12 hours active work + 48h monitoring
**Timeline:** 5-6 days

---

## 🎯 Executive Summary

### Goal
Automate RSS ingestion, clustering, and enrichment via inline GitHub Actions pattern (like EO tracker). Worker remains running for article.enrich jobs until TTRC-267.

### Scope Boundaries

**IN SCOPE (TTRC-266):**
- ✅ RSS feed fetching automation
- ✅ Article clustering automation (using existing story-cluster-handler.js)
- ✅ Story enrichment automation
- ✅ Database migration (run_stats, locks, ETag tracking)
- ✅ GitHub Actions workflows (TEST + PROD)
- ✅ Mark worker DEPRECATED (not removed)

**OUT OF SCOPE (TTRC-267):**
- ❌ article.enrich migration (~700 jobs/month)
- ❌ Worker shutdown/removal
- ❌ job_queue table removal
- ❌ Dead code cleanup (lifecycle/split/merge handlers)

### Key Architecture Change

**BEFORE:**
```
GitHub Actions (cron) → Supabase Edge Function (rss-enqueue)
  → job_queue → Manual Worker Process
  → Stories + Articles
```

**AFTER:**
```
GitHub Actions (cron) → Inline Script (rss-tracker-supabase.js)
  ├── Fetch RSS feeds (ETag caching)
  ├── Cluster articles → stories
  └── Enrich stories (budget caps)
  → Stories + Articles
```

**Worker status:** DEPRECATED for RSS, still serves article.enrich until TTRC-267

---

## 🚨 Critical Fixes Applied

This plan incorporates fixes for **14 critical issues** identified during review:

### Issues #1-8 (Architectural):
1. ✅ Worker scope clarified (RSS only, keep for embeddings)
2. ✅ increment_budget treated as hard pre-req (no auto-create)
3. ✅ finalizeRunStats single call site (status flag pattern)
4. ✅ CJS runtime pattern (no top-level await)
5. ✅ get_stories_needing_enrichment added to validation
6. ✅ feeds_skipped_lock added (track concurrency separately from failures)
7. ✅ TEST schedule temporary (24 runs / 48h realistic)
8. ✅ Worker marked DEPRECATED not STOPPED (still needed for embeddings)

### Issues #9-14 (Runtime Blockers):
9. ✅ OpenAI client initialization added to constructor
10. ✅ clusterArticles() implementation (not stubbed)
11. ✅ pg_proc_check RPC created for validation
12. ✅ Service role key for admin schema access
13. ✅ failure_count column validation added
14. ✅ Status semantics clarified (partial_success vs skipped_budget)

---

## 📋 Implementation Phases

### Phase 0: Pre-Validation & Dependency Audit (2 hours)

#### Part A: Database Validation Script (1h)

**File:** `scripts/validate-rpc-dependencies.js`

**Purpose:** Verify all database dependencies exist before starting implementation

```javascript
const { createClient } = require('@supabase/supabase-js');

// Required RPCs (hard fail if missing)
const REQUIRED_RPCS = [
  {
    name: 'increment_budget',
    minArgs: 3,
    source: 'migration 008 (budget system)',
    critical: true
  },
  {
    name: 'upsert_article_and_enqueue_jobs',
    minArgs: 1,
    source: 'migration 003 (article upsert)',
    critical: true
  },
  {
    name: 'get_stories_needing_enrichment',
    minArgs: 1,
    source: 'migration 019 (enrichment helpers)',
    critical: true
  },
  // acquire/release_feed_lock created by migration 030
];

// Required tables
const REQUIRED_TABLES = [
  { name: 'budgets', source: 'migration 008' },
  { name: 'feed_registry', source: 'migration 001' },
  { name: 'articles', source: 'migration 001' },
  { name: 'stories', source: 'migration 001' },
  { name: 'article_story', source: 'migration 001' },
  { name: 'job_queue', source: 'migration 009 (still needed for embeddings)' },
];

// Required columns (FIX #13 - added failure_count)
const REQUIRED_COLUMNS = [
  {
    table: 'feed_registry',
    columns: ['etag', 'last_modified', 'failure_count', 'is_active', 'tier']
  },
  {
    table: 'articles',
    constraint: 'UNIQUE (url_hash, published_date)'
  },
];

async function validateDatabase(supabase, environment) {
  console.log(`\n=== Validating ${environment} Database ===\n`);

  const results = {
    rpcs: [],
    tables: [],
    columns: [],
    errors: [],
  };

  // 1. Validate RPCs (FIX #11 - using pg_proc_check RPC)
  for (const rpc of REQUIRED_RPCS) {
    try {
      const { data, error } = await supabase
        .rpc('pg_proc_check', { proc_name: rpc.name });

      if (error || !data || data.length === 0) {
        results.errors.push({
          type: 'RPC_MISSING',
          name: rpc.name,
          source: rpc.source,
          message: `RPC ${rpc.name} not found. Apply ${rpc.source} first.`,
        });
        results.rpcs.push({ name: rpc.name, exists: false });
      } else if (data[0].arg_count < rpc.minArgs) {
        results.errors.push({
          type: 'RPC_WRONG_SIGNATURE',
          name: rpc.name,
          expected: `>= ${rpc.minArgs} args`,
          actual: `${data[0].arg_count} args`,
        });
        results.rpcs.push({ name: rpc.name, exists: true, valid: false });
      } else {
        results.rpcs.push({ name: rpc.name, exists: true, valid: true });
      }
    } catch (err) {
      results.errors.push({
        type: 'RPC_CHECK_FAILED',
        name: rpc.name,
        error: err.message,
      });
    }
  }

  // 2. Validate tables
  for (const table of REQUIRED_TABLES) {
    const { data, error } = await supabase
      .from(table.name)
      .select('*')
      .limit(1);

    if (error && error.code === '42P01') {
      // Table doesn't exist
      results.errors.push({
        type: 'TABLE_MISSING',
        name: table.name,
        source: table.source,
      });
      results.tables.push({ name: table.name, exists: false });
    } else {
      results.tables.push({ name: table.name, exists: true });
    }
  }

  // 3. Validate columns (FIX #13)
  for (const colCheck of REQUIRED_COLUMNS) {
    const { data, error } = await supabase
      .rpc('check_columns_exist', {
        table_name: colCheck.table,
        column_names: colCheck.columns,
      });

    if (error || !data) {
      results.errors.push({
        type: 'COLUMN_CHECK_FAILED',
        table: colCheck.table,
        columns: colCheck.columns,
      });
    } else if (!data.all_exist) {
      results.errors.push({
        type: 'COLUMNS_MISSING',
        table: colCheck.table,
        missing: data.missing_columns,
      });
      results.columns.push({
        table: colCheck.table,
        exists: false,
        missing: data.missing_columns
      });
    } else {
      results.columns.push({ table: colCheck.table, exists: true });
    }
  }

  return results;
}

async function main() {
  // Validate both TEST and PROD
  const testClient = createClient(
    process.env.SUPABASE_TEST_URL,
    process.env.SUPABASE_TEST_SERVICE_ROLE_KEY  // FIX #12 - service role
  );

  const prodClient = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY  // FIX #12
  );

  const testResults = await validateDatabase(testClient, 'TEST');
  const prodResults = await validateDatabase(prodClient, 'PROD');

  // Output report
  console.log('\n=== VALIDATION REPORT ===\n');
  console.log(JSON.stringify({ test: testResults, prod: prodResults }, null, 2));

  // Hard fail if critical errors
  const allErrors = [...testResults.errors, ...prodResults.errors];
  if (allErrors.length > 0) {
    console.error('\n❌ VALIDATION FAILED\n');
    console.error('Fix these issues before proceeding with TTRC-266:\n');
    allErrors.forEach(err => {
      console.error(`  - ${err.type}: ${err.message || JSON.stringify(err)}`);
    });
    process.exit(1);
  }

  console.log('\n✅ VALIDATION PASSED\n');
  console.log('All dependencies exist. Safe to proceed with TTRC-266.');
}

main().catch(err => {
  console.error('Validation script failed:', err);
  process.exit(1);
});
```

**Decision Gate:** If validation fails, STOP and fix source migrations first

---

#### Part B: Dependency Audit (1h)

**Search patterns:**
```bash
grep -rn "enqueueJob" scripts/ supabase/ --include="*.js"
grep -rn "job_queue" scripts/ supabase/ --include="*.js" --include="*.ts"
grep -rn '"story.enrich"' scripts/
grep -rn '"article.enrich"' scripts/
grep -rn "job-queue-worker" .github/
```

**Document findings in TTRC-266 JIRA comment:**

```markdown
## Worker Dependency Audit Results

### Active job types (MUST preserve):
- **article.enrich:** ~700 jobs/month (TTRC-234 embeddings)
  - Worker: MUST stay running until TTRC-267
  - Queue: MUST stay active
  - Impact: Worker cannot be fully stopped in TTRC-266

### RSS job types (MIGRATING to inline):
- fetch_feed → GitHub Actions inline script
- fetch_all_feeds → GitHub Actions inline script
- story.cluster → GitHub Actions inline script
- story.enrich → GitHub Actions inline script

### Dead job types (safe to remove in TTRC-267):
- story.lifecycle (0 usage last 30 days)
- story.split (0 usage last 30 days)
- story.merge (0 usage last 30 days)

### Scripts referencing worker:
- [List each file with status: keeping/updating/deprecating]
- Example: `scripts/backfill-enrichment.js` - Status: keeping (uses worker methods)

### Conclusion:
- Worker deprecation: TTRC-266 (mark as DEPRECATED for RSS)
- Worker shutdown: TTRC-267 (after embeddings migration)
- Full cleanup: TTRC-267 (remove dead code + worker)
```

**Decision Gate:** Audit must be complete and documented before modifying worker code or job-scheduler.yml

---

### Phase 1: Database Migration 030 (1 hour)

**File:** `migrations/030_rss_tracker_inline.sql`

**Prerequisites Check:** Validates that required migrations are already applied

```sql
-- ============================================================================
-- Migration 030: RSS Tracker Inline Automation Infrastructure
-- ============================================================================
-- Created: 2025-11-16
-- Ticket: TTRC-266
-- Purpose: Support inline GitHub Actions RSS automation
--
-- PREREQUISITES (must exist before running this migration):
-- - budgets table (migration 008)
-- - increment_budget() RPC (migration 008)
-- - get_stories_needing_enrichment() RPC (migration 019)
-- - feed_registry table with etag, last_modified, failure_count columns
--
-- If any are missing, the validation script (Phase 0) will catch them.
-- ============================================================================

BEGIN;

-- 1. Verify prerequisites (FIX #2 - no auto-create, hard fail instead)
DO $$
BEGIN
  -- Check budgets table
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE tablename = 'budgets' AND schemaname = 'public'
  ) THEN
    RAISE EXCEPTION 'budgets table not found. Apply migration 008 (budget system) first.';
  END IF;

  -- Check increment_budget RPC
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'increment_budget'
  ) THEN
    RAISE EXCEPTION 'increment_budget() RPC not found. Apply migration 008 first.';
  END IF;

  -- Check get_stories_needing_enrichment RPC (FIX #5)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'get_stories_needing_enrichment'
  ) THEN
    RAISE EXCEPTION 'get_stories_needing_enrichment() RPC not found. Apply migration 019 first.';
  END IF;

  RAISE NOTICE 'Prerequisites verified. Proceeding with migration 030.';
END $$;

-- 2. Create admin schema if not exists (for run_stats)
CREATE SCHEMA IF NOT EXISTS admin;

-- 3. Admin run stats table (FIX #6, #14 - enhanced schema with skipped_lock and status semantics)
CREATE TABLE IF NOT EXISTS admin.run_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'prod')),
  run_started_at TIMESTAMPTZ NOT NULL,
  run_finished_at TIMESTAMPTZ,

  -- Status semantics (FIX #14):
  -- 'success': All operations completed successfully
  -- 'partial_success': Feed processing succeeded, but enrichment skipped due to budget
  -- 'failed': Exception thrown, run aborted
  -- 'skipped_budget': Budget exhausted before any work (rare)
  status TEXT NOT NULL CHECK (status IN ('success', 'partial_success', 'failed', 'skipped_budget')),

  -- Feed processing stats
  feeds_total INTEGER DEFAULT 0,
  feeds_processed INTEGER DEFAULT 0,
  feeds_succeeded INTEGER DEFAULT 0,
  feeds_failed INTEGER DEFAULT 0,
  feeds_skipped_lock INTEGER DEFAULT 0,  -- FIX #6: Not a failure, just concurrency skip
  feeds_304_cached INTEGER DEFAULT 0,
  feeds_by_tier JSONB,  -- Example: {"T1": 5, "T2": 10, "T3": 3}

  -- Story/article stats
  stories_clustered INTEGER DEFAULT 0,
  stories_enriched INTEGER DEFAULT 0,
  enrichment_skipped_budget INTEGER DEFAULT 0,

  -- Cost tracking
  total_openai_cost_usd NUMERIC(10,4) DEFAULT 0,

  -- Error details
  error_summary TEXT,
  details JSONB,  -- Per-feed errors, per-story failures, etc.

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_run_stats_env_started
  ON admin.run_stats(environment, run_started_at DESC);

CREATE INDEX IF NOT EXISTS idx_run_stats_status
  ON admin.run_stats(status, environment);

COMMENT ON TABLE admin.run_stats IS
  'Tracks inline RSS tracker runs (TTRC-266). Replaces job_queue monitoring for RSS jobs. Worker still handles article.enrich until TTRC-267.';

COMMENT ON COLUMN admin.run_stats.status IS
  'success = all good | partial_success = feeds ok, enrichment skipped budget | failed = exception | skipped_budget = budget hit immediately';

-- 4. Advisory lock functions (per-feed concurrency control)
CREATE OR REPLACE FUNCTION acquire_feed_lock(feed_id_param BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  -- Non-blocking lock: returns true if acquired, false if already held
  -- Lock key: (1, feed_id) for RSS namespace
  -- Uses pg_try_advisory_lock (non-blocking) not pg_advisory_lock (blocking)
  RETURN pg_try_advisory_lock(1, feed_id_param::INTEGER);
END;
$$;

CREATE OR REPLACE FUNCTION release_feed_lock(feed_id_param BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN pg_advisory_unlock(1, feed_id_param::INTEGER);
END;
$$;

COMMENT ON FUNCTION acquire_feed_lock IS
  'Non-blocking per-feed lock to prevent concurrent RSS fetches of same feed. Returns true if acquired, false if held by another process.';

-- 5. ETag cache tracking column
ALTER TABLE feed_registry
  ADD COLUMN IF NOT EXISTS last_304_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_feed_registry_304
  ON feed_registry(last_304_at)
  WHERE last_304_at IS NOT NULL;

COMMENT ON COLUMN feed_registry.last_304_at IS
  'Last time HTTP 304 Not Modified was received (cache hit tracking for observability)';

-- 6. Validation helper RPC (FIX #11 - needed by validation script)
CREATE OR REPLACE FUNCTION pg_proc_check(proc_name TEXT)
RETURNS TABLE (arg_count INTEGER)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT p.pronargs::INTEGER
  FROM pg_proc p
  WHERE p.proname = proc_name
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION pg_proc_check IS
  'Helper for validation script to check RPC existence and arg count';

-- 7. Column existence checker (FIX #13 - validate failure_count and other columns)
CREATE OR REPLACE FUNCTION check_columns_exist(
  table_name TEXT,
  column_names TEXT[]
)
RETURNS TABLE (all_exist BOOLEAN, missing_columns TEXT[])
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  existing_columns TEXT[];
  missing TEXT[];
BEGIN
  -- Get existing columns for table
  SELECT ARRAY_AGG(column_name::TEXT)
  INTO existing_columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = check_columns_exist.table_name
    AND column_name = ANY(column_names);

  -- Find missing columns
  SELECT ARRAY_AGG(col)
  INTO missing
  FROM UNNEST(column_names) AS col
  WHERE col NOT IN (SELECT UNNEST(COALESCE(existing_columns, ARRAY[]::TEXT[])));

  RETURN QUERY SELECT
    (COALESCE(ARRAY_LENGTH(missing, 1), 0) = 0) AS all_exist,
    COALESCE(missing, ARRAY[]::TEXT[]) AS missing_columns;
END;
$$;

COMMENT ON FUNCTION check_columns_exist IS
  'Helper for validation script to verify required columns exist on a table';

-- 8. Grant permissions for service role (FIX #12)
-- Note: Service role bypasses RLS, but we grant explicitly for clarity
GRANT ALL ON admin.run_stats TO service_role;
GRANT EXECUTE ON FUNCTION acquire_feed_lock(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION release_feed_lock(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION pg_proc_check(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION check_columns_exist(TEXT, TEXT[]) TO service_role;

-- Also grant to authenticated for manual testing/debugging
GRANT SELECT ON admin.run_stats TO authenticated;

COMMIT;

-- ============================================================================
-- Post-migration verification
-- ============================================================================
-- Run these queries to verify migration succeeded:
--
-- SELECT * FROM admin.run_stats LIMIT 1;  -- Should return empty table
-- SELECT acquire_feed_lock(1);  -- Should return true
-- SELECT release_feed_lock(1);  -- Should return true
-- SELECT * FROM pg_proc_check('increment_budget');  -- Should return arg count
-- ============================================================================
```

**Apply to TEST first, then verify with validation script pass**

---

### Phase 2: Core Fixes (1 hour)

#### Fix 1: ETag Column Update (15 min)

**File:** `scripts/rss/fetch_feed.js`
**Line:** ~265 (inside HTTP 304 handler)

```javascript
// BEFORE:
if (response.status === 304) {
  await supabase.from('feed_registry')
    .update({
      etag: response.headers.get('etag'),
      last_modified: response.headers.get('last-modified')
    })
    .eq('id', feed.id);
}

// AFTER:
if (response.status === 304) {
  await supabase.from('feed_registry')
    .update({
      etag: response.headers.get('etag'),
      last_modified: response.headers.get('last-modified'),
      last_304_at: new Date().toISOString()  // Track cache hits for observability
    })
    .eq('id', feed.id);

  console.log(`Feed ${feed.id} returned 304 Not Modified (cache hit)`);
}
```

---

#### Fix 2: Idempotency Guards (45 min)

**A. Article Clustering - Prevent Duplicate Mappings**

**File:** `scripts/story-cluster-handler.js` (or wherever clustering lives)

```javascript
/**
 * Attach article to story with idempotency guard
 * Prevents duplicate article_story mappings on re-runs
 */
async function attachArticleToStory(articleId, storyId, similarityScore, supabase) {
  // Check if article already mapped to ANY story
  const { data: existing, error: checkError } = await supabase
    .from('article_story')
    .select('story_id, matched_at')
    .eq('article_id', articleId)
    .single();

  if (checkError && checkError.code !== 'PGRST116') {
    // Real error (not just "not found")
    throw checkError;
  }

  if (existing) {
    if (existing.story_id === storyId) {
      // Already mapped to this story - idempotent
      return {
        alreadyMapped: true,
        sameStory: true,
        message: `Article ${articleId} already in story ${storyId}`
      };
    } else {
      // Mapped to different story - could be normal (article moved) or edge case
      console.log(`Article ${articleId} already in story ${existing.story_id}, not ${storyId}`);
      return {
        alreadyMapped: true,
        sameStory: false,
        existingStoryId: existing.story_id
      };
    }
  }

  // Safe to insert
  const { error: insertError } = await supabase
    .from('article_story')
    .insert({
      article_id: articleId,
      story_id: storyId,
      similarity_score: similarityScore,
      is_primary_source: false,  // Can be updated later
      matched_at: new Date().toISOString()
    });

  if (insertError) {
    // Could be race condition duplicate - log but don't fail
    if (insertError.code === '23505') {
      // Unique constraint violation
      console.log(`Race condition: Article ${articleId} mapped concurrently`);
      return { alreadyMapped: true, raceCondition: true };
    }
    throw insertError;
  }

  return { alreadyMapped: false, inserted: true };
}

module.exports = { attachArticleToStory };
```

**B. Enrichment Cooldown Guard**

**File:** `scripts/enrichment/enrich-stories.js` (to be created/extracted)

```javascript
const ENRICHMENT_COOLDOWN_HOURS = 24;

/**
 * Check if story should be enriched based on cooldown
 * Prevents re-enriching recently enriched stories on re-runs
 */
function shouldEnrichStory(story) {
  if (!story.last_enriched_at) {
    return {
      should: true,
      reason: 'never_enriched'
    };
  }

  const lastEnriched = new Date(story.last_enriched_at);
  const hoursSince = (Date.now() - lastEnriched.getTime()) / (1000 * 60 * 60);

  if (hoursSince < ENRICHMENT_COOLDOWN_HOURS) {
    return {
      should: false,
      reason: 'cooldown',
      hoursRemaining: Math.ceil(ENRICHMENT_COOLDOWN_HOURS - hoursSince),
      lastEnrichedAt: story.last_enriched_at
    };
  }

  return {
    should: true,
    reason: 'cooldown_expired',
    hoursSinceLastEnrich: Math.floor(hoursSince)
  };
}

module.exports = { shouldEnrichStory, ENRICHMENT_COOLDOWN_HOURS };
```

---

### Phase 3: Extract Enrichment Module (3-4 hours)

**Goal:** Create `scripts/enrichment/enrich-stories.js` as single source of truth

**Strategy:** Best effort extraction with documented blockers if coupling too deep

#### Step 1: Audit Dependencies (1h)

**Source:** `scripts/job-queue-worker.js` lines 378-548 (enrichStory method)

**Dependencies to extract:**
1. OpenAI client config
2. Article scraping (already in `scripts/enrichment/scraper.js`)
3. Entity extraction (buildEntityCounter, toTopEntities)
4. Category mapping (UI_TO_DB dictionary)
5. Budget tracking integration
6. Prompts (already in `scripts/enrichment/prompts.js`)

**Check for blockers:**
- Circular dependencies on worker class?
- Access to `this.supabase` / `this.openai` (can parameterize)
- Shared state or side effects?

#### Step 2: Extract or Document (2-3h)

**If extraction possible:**

**File:** `scripts/enrichment/enrich-stories.js`

```javascript
const { buildUserPayload, SYSTEM_PROMPT } = require('./prompts.js');
const { enrichArticlesForSummary } = require('./scraper.js');
const { shouldEnrichStory, ENRICHMENT_COOLDOWN_HOURS } = require('./enrich-stories.js');

// Extracted from worker - category mapping
const UI_TO_DB_CATEGORIES = {
  'Corruption & Scandals': 'corruption_scandals',
  'Democracy & Elections': 'democracy_elections',
  'Policy & Legislation': 'policy_legislation',
  'Justice & Legal': 'justice_legal',
  'Executive Actions': 'executive_actions',
  'Foreign Policy': 'foreign_policy',
  'Corporate & Financial': 'corporate_financial',
  'Civil Liberties': 'civil_liberties',
  'Media & Disinformation': 'media_disinformation',
  'Epstein & Associates': 'epstein_associates',
  'Other': 'other'
};

// Extracted from worker - entity extraction
function buildEntityCounter(articles) {
  const counter = {};

  for (const article of articles) {
    // Extract entities from title, description, content
    const text = [
      article.title,
      article.description,
      article.content
    ].filter(Boolean).join(' ');

    // Simple entity extraction (can be enhanced)
    const words = text.split(/\s+/);
    const capitalized = words.filter(w => /^[A-Z][a-z]+/.test(w));

    capitalized.forEach(entity => {
      counter[entity] = (counter[entity] || 0) + 1;
    });
  }

  return counter;
}

function toTopEntities(counter, limit = 10) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([entity]) => entity);
}

/**
 * Enrich a single story with OpenAI-generated summaries, categories, etc.
 * Idempotent: respects enrichment cooldown, safe to call multiple times
 */
async function enrichStory(storyId, { supabase, openaiClient }) {
  try {
    // 1. Fetch story + articles
    const { data: story, error: fetchError } = await supabase
      .from('stories')
      .select(`
        *,
        articles:article_story(
          article:articles(*)
        )
      `)
      .eq('id', storyId)
      .single();

    if (fetchError) throw fetchError;
    if (!story) throw new Error(`Story ${storyId} not found`);

    // Flatten articles array
    const articles = story.articles?.map(as => as.article).filter(Boolean) || [];
    if (articles.length === 0) {
      return { skipped: 'no_articles', storyId };
    }

    // 2. Check cooldown (idempotency guard)
    const cooldownCheck = shouldEnrichStory(story);
    if (!cooldownCheck.should) {
      return {
        skipped: 'cooldown',
        storyId,
        ...cooldownCheck
      };
    }

    // 3. Scrape full article content (TTRC-258/260)
    const enrichedArticles = await enrichArticlesForSummary(articles);

    // 4. Build OpenAI payload
    const entities = buildEntityCounter(enrichedArticles);
    const topEntities = toTopEntities(entities, 10);
    const userPayload = buildUserPayload(enrichedArticles, topEntities, story);

    // 5. Call OpenAI
    const response = await openaiClient.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPayload }
      ],
      temperature: 0.7,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });

    // 6. Parse response
    const content = response.choices[0].message.content;
    const enrichment = JSON.parse(content);

    // 7. Map UI categories to DB enum
    if (enrichment.category && UI_TO_DB_CATEGORIES[enrichment.category]) {
      enrichment.category = UI_TO_DB_CATEGORIES[enrichment.category];
    } else {
      enrichment.category = 'other';
    }

    // 8. Save to database
    const { error: updateError } = await supabase
      .from('stories')
      .update({
        summary_neutral: enrichment.summary_neutral,
        summary_spicy: enrichment.summary_spicy,
        primary_actor: enrichment.primary_actor,
        severity: enrichment.severity,
        category: enrichment.category,
        last_enriched_at: new Date().toISOString(),
      })
      .eq('id', storyId);

    if (updateError) throw updateError;

    // 9. Estimate cost
    const tokensUsed = response.usage?.total_tokens || 0;
    const costPerToken = 0.000002; // GPT-4o-mini ~$0.002 per 1K tokens
    const estimatedCost = (tokensUsed / 1000) * 0.002;

    return {
      success: true,
      storyId,
      enrichment,
      cost: estimatedCost,
      tokensUsed
    };

  } catch (error) {
    console.error(`Story ${storyId} enrichment failed:`, error);
    return {
      success: false,
      storyId,
      error: error.message,
      cost: 0
    };
  }
}

module.exports = {
  enrichStory,
  shouldEnrichStory,
  buildEntityCounter,
  toTopEntities,
  UI_TO_DB_CATEGORIES,
  ENRICHMENT_COOLDOWN_HOURS
};
```

**If blockers found:**

1. Document in TTRC-266 comment:
   ```markdown
   ## Enrichment Extraction Blockers

   Attempted to extract enrichment logic from job-queue-worker.js into
   scripts/enrichment/enrich-stories.js but encountered:

   - [Specific circular dependency issue]
   - [Shared state problem]
   - [Other coupling issue]

   **Decision:** Copying logic inline for TTRC-266, refactoring in TTRC-267
   ```

2. Create TTRC-267 subtask: "Extract enrichment into shared module"

3. Copy enrichStory() into inline script with clear comment:
   ```javascript
   // TODO TTRC-267: Extract to scripts/enrichment/enrich-stories.js
   // Currently copied from job-queue-worker.js due to [specific blockers]
   async function enrichStory(storyId, { supabase, openaiClient }) {
     // ... copied logic
   }
   ```

---

### Phase 4: Create Inline Script (2-3 hours)

**File:** `scripts/rss-tracker-supabase.js`

**All runtime fixes applied:** #9, #10, #12

```javascript
// ============================================================================
// RSS TRACKER - INLINE GITHUB ACTIONS AUTOMATION
// ============================================================================
// Created: 2025-11-16
// Ticket: TTRC-266
// Purpose: Automate RSS ingestion, clustering, enrichment via GitHub Actions
//
// Replaces:
// - Manual job-queue-worker.js execution for RSS jobs
// - Edge function rss-enqueue job creation
// - job_queue table for RSS jobs (still used for article.enrich)
//
// Runtime: 5-min hard cap, 8-min GitHub Actions timeout
// Trigger: Every 2 hours via GitHub Actions cron schedule
// Auth: Uses service role key for admin.run_stats access (FIX #12)
// ============================================================================

const crypto = require('crypto');  // FIX #4
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');  // FIX #9
const { enrichStory } = require('./enrichment/enrich-stories.js');
const { fetchFeed } = require('./rss/fetch_feed.js');
const { clusterArticle } = require('./story-cluster-handler.js');  // FIX #10

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  MAX_FEEDS_PER_RUN: 30,
  MAX_RUNTIME_MS: 4 * 60 * 1000,  // 4 minutes (leave 1-min safety margin)
  AVG_COST_PER_STORY: 0.003,      // ~$0.003 per story enrichment
  DAILY_BUDGET_LIMIT: 5.00,        // $5/day cap
  ENV: process.env.ENVIRONMENT || 'test',
};

// ============================================================================
// RSS TRACKER CLASS
// ============================================================================

class RSSTracker {
  constructor() {
    // FIX #12: Use service role key for admin schema access
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY  // NOT anon key
    );

    // FIX #9: Initialize OpenAI client
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    // Run metadata
    this.runId = crypto.randomUUID();  // FIX #4
    this.runStatus = null;  // FIX #3: Track status flag
    this.startTime = Date.now();

    // Stats tracking (FIX #6, #14)
    this.stats = {
      feeds_total: 0,
      feeds_processed: 0,
      feeds_succeeded: 0,
      feeds_failed: 0,
      feeds_skipped_lock: 0,  // FIX #6: Separate from failures
      feeds_304_cached: 0,
      feeds_by_tier: {},
      stories_clustered: 0,
      stories_enriched: 0,
      enrichment_skipped_budget: 0,
      total_openai_cost_usd: 0,
    };
  }

  // ==========================================================================
  // MAIN RUN METHOD
  // ==========================================================================

  async run() {
    try {
      console.log(`[${this.runId}] Starting RSS tracker (${CONFIG.ENV})`);

      // 1. Initialize run_stats row
      await this.initializeRunStats();

      // 2. Select feeds (scheduling policy)
      const feeds = await this.selectFeeds();
      this.stats.feeds_total = feeds.length;
      console.log(`[${this.runId}] Processing ${feeds.length} feeds`);

      if (feeds.length === 0) {
        console.log(`[${this.runId}] No feeds to process`);
        await this.finalizeRunStats('success');
        return;
      }

      // 3. Process feeds (with runtime guard)
      for (const feed of feeds) {
        if (this.isRuntimeExceeded()) {
          console.log(`[${this.runId}] Runtime guard triggered, stopping feed processing`);
          break;
        }
        await this.processFeed(feed);
      }

      // 4. Cluster new articles (FIX #10 - not stubbed)
      if (!this.isRuntimeExceeded()) {
        await this.clusterArticles();
      }

      // 5. Enrich stories (with budget check)
      if (!this.isRuntimeExceeded()) {
        await this.enrichStories();
      }

      // 6. Finalize (FIX #3 - single call site)
      const finalStatus = this.runStatus || 'success';
      await this.finalizeRunStats(finalStatus);

      const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
      console.log(`[${this.runId}] Run complete: ${finalStatus} (${duration}s)`);

    } catch (error) {
      console.error(`[${this.runId}] Run failed:`, error);
      await this.finalizeRunStats('failed', error.message);
      throw error;
    }
  }

  // ==========================================================================
  // FEED SELECTION & SCHEDULING
  // ==========================================================================

  async selectFeeds() {
    // Feed scheduling policy:
    // - Max 30 feeds per run
    // - Ordered by staleness (last_fetched_at ASC, nulls first)
    // - Only active feeds
    // - Exclude broken feeds (failure_count >= 5) - FIX #13

    const { data: feeds, error } = await this.supabase
      .from('feed_registry')
      .select('*')
      .eq('is_active', true)
      .lt('failure_count', 5)  // FIX #13: Validated in Phase 0
      .order('last_fetched_at', { ascending: true, nullsFirst: true })
      .limit(CONFIG.MAX_FEEDS_PER_RUN);

    if (error) {
      console.error(`[${this.runId}] Failed to select feeds:`, error);
      throw error;
    }

    return feeds || [];
  }

  isRuntimeExceeded() {
    const elapsed = Date.now() - this.startTime;
    return elapsed > CONFIG.MAX_RUNTIME_MS;
  }

  // ==========================================================================
  // FEED PROCESSING
  // ==========================================================================

  async processFeed(feed) {
    const feedLog = `Feed ${feed.id} (${feed.source_name})`;

    try {
      // 1. Acquire advisory lock (FIX #6 - non-blocking)
      const { data: lockAcquired, error: lockError } = await this.supabase
        .rpc('acquire_feed_lock', { feed_id_param: feed.id });

      if (lockError) {
        console.error(`[${this.runId}] ${feedLog} lock error:`, lockError);
        this.stats.feeds_failed++;
        return;
      }

      if (!lockAcquired) {
        // Lock held by another process - not a failure, just skip
        console.log(`[${this.runId}] ${feedLog} locked by another run, skipping`);
        this.stats.feeds_skipped_lock++;  // FIX #6: Track separately
        return;
      }

      try {
        // 2. Fetch feed (handles ETag, 304, compliance, deduplication)
        const result = await fetchFeed(feed.id, this.supabase);

        this.stats.feeds_processed++;

        // 3. Track outcome (FIX #6 - 304 is success, not failure)
        if (result.status === '304') {
          this.stats.feeds_304_cached++;
          this.stats.feeds_succeeded++;
        } else if (result.status === 'success') {
          this.stats.feeds_succeeded++;
        } else {
          this.stats.feeds_failed++;
        }

        // 4. Track by tier (TT-specific observability)
        const tier = `T${feed.tier || 3}`;
        this.stats.feeds_by_tier[tier] = (this.stats.feeds_by_tier[tier] || 0) + 1;

        console.log(
          `[${this.runId}] ${feedLog} ${result.status}: ` +
          `${result.articles_created || 0} new, ${result.articles_dropped || 0} dropped`
        );

      } finally {
        // 5. Always release lock (exception safety)
        await this.supabase.rpc('release_feed_lock', { feed_id_param: feed.id });
      }

    } catch (error) {
      this.stats.feeds_failed++;
      console.error(`[${this.runId}] ${feedLog} failed:`, error.message);

      // Store error details for debugging
      if (!this.errorDetails) this.errorDetails = [];
      this.errorDetails.push({
        feed_id: feed.id,
        feed_name: feed.source_name,
        error: error.message,
      });
    }
  }

  // ==========================================================================
  // ARTICLE CLUSTERING (FIX #10 - implemented, not stubbed)
  // ==========================================================================

  async clusterArticles() {
    try {
      console.log(`[${this.runId}] Starting article clustering`);

      // Get unclustered articles (articles not in article_story)
      const { data: unclusteredArticles, error: fetchError } = await this.supabase
        .from('articles')
        .select('id, title, published_date')
        .not('id', 'in', this.supabase
          .from('article_story')
          .select('article_id')
        )
        .order('published_date', { ascending: false })
        .limit(100);  // Cluster up to 100 articles per run

      if (fetchError) throw fetchError;

      if (!unclusteredArticles || unclusteredArticles.length === 0) {
        console.log(`[${this.runId}] No unclustered articles`);
        return;
      }

      console.log(`[${this.runId}] Clustering ${unclusteredArticles.length} articles`);

      let clustered = 0;
      for (const article of unclusteredArticles) {
        if (this.isRuntimeExceeded()) {
          console.log(`[${this.runId}] Runtime limit hit during clustering`);
          break;
        }

        try {
          // Use existing clustering logic from story-cluster-handler.js
          await clusterArticle(article.id, this.supabase);
          clustered++;
        } catch (error) {
          console.error(`[${this.runId}] Failed to cluster article ${article.id}:`, error.message);
        }
      }

      this.stats.stories_clustered = clustered;
      console.log(`[${this.runId}] Clustered ${clustered} articles`);

    } catch (error) {
      console.error(`[${this.runId}] Clustering phase failed:`, error);
      // Don't fail entire run if clustering fails
    }
  }

  // ==========================================================================
  // STORY ENRICHMENT
  // ==========================================================================

  async enrichStories() {
    try {
      // 1. Get stories needing enrichment (FIX #5 - validated in Phase 0)
      const { data: stories, error: fetchError } = await this.supabase
        .rpc('get_stories_needing_enrichment', { limit_param: 100 });

      if (fetchError) throw fetchError;

      if (!stories || stories.length === 0) {
        console.log(`[${this.runId}] No stories need enrichment`);
        return;
      }

      console.log(`[${this.runId}] ${stories.length} stories need enrichment`);

      // 2. Budget check (single call for batch)
      const predictedCost = stories.length * CONFIG.AVG_COST_PER_STORY;
      const { data: budgetData } = await this.supabase
        .from('budgets')
        .select('spent_usd')
        .eq('day', new Date().toISOString().split('T')[0])
        .single();

      const spentToday = budgetData?.spent_usd || 0;

      if (spentToday + predictedCost > CONFIG.DAILY_BUDGET_LIMIT) {
        console.log(
          `[${this.runId}] Budget check failed: ` +
          `would spend $${predictedCost.toFixed(3)}, ` +
          `already spent $${spentToday.toFixed(2)} of $${CONFIG.DAILY_BUDGET_LIMIT}`
        );
        this.stats.enrichment_skipped_budget = stories.length;

        // FIX #14: Set status to partial_success (feeds succeeded, enrichment skipped)
        this.runStatus = 'partial_success';
        return;
      }

      // 3. Enrich each story
      let enrichedCount = 0;
      let totalCost = 0;

      for (const story of stories) {
        if (this.isRuntimeExceeded()) {
          console.log(`[${this.runId}] Runtime limit hit during enrichment`);
          break;
        }

        try {
          const result = await enrichStory(story.id, {
            supabase: this.supabase,
            openaiClient: this.openai,  // FIX #9
          });

          if (result.success) {
            enrichedCount++;
            totalCost += result.cost || CONFIG.AVG_COST_PER_STORY;
          } else if (result.skipped === 'cooldown') {
            // Skip quietly (already enriched recently - idempotency)
          } else if (result.error) {
            console.error(`[${this.runId}] Story ${story.id} enrichment error:`, result.error);
          }
        } catch (error) {
          console.error(`[${this.runId}] Story ${story.id} enrichment failed:`, error.message);
        }
      }

      this.stats.stories_enriched = enrichedCount;
      this.stats.total_openai_cost_usd = totalCost;

      // 4. Increment budget once for entire batch (FIX #2 - validated in Phase 0)
      if (enrichedCount > 0) {
        const { error: budgetError } = await this.supabase.rpc('increment_budget', {
          day_param: new Date().toISOString().split('T')[0],
          amount_usd: totalCost,
          call_count: enrichedCount
        });

        if (budgetError) {
          console.error(`[${this.runId}] Budget increment failed:`, budgetError);
        }

        console.log(
          `[${this.runId}] Enriched ${enrichedCount} stories, ` +
          `cost: $${totalCost.toFixed(3)}`
        );
      }

    } catch (error) {
      console.error(`[${this.runId}] Enrichment phase failed:`, error);
      // Don't fail entire run if enrichment fails
    }
  }

  // ==========================================================================
  // RUN STATS TRACKING
  // ==========================================================================

  async initializeRunStats() {
    const { error } = await this.supabase
      .from('admin.run_stats')
      .insert({
        id: this.runId,
        environment: CONFIG.ENV,
        run_started_at: new Date().toISOString(),
        status: 'running',
      });

    if (error) {
      console.error(`[${this.runId}] Failed to initialize run_stats:`, error);
      // Don't throw - allow run to continue even if logging fails
    }
  }

  async finalizeRunStats(status, errorSummary = null) {
    // FIX #3: Single finalization point (no multiple calls)

    const details = {
      duration_ms: Date.now() - this.startTime,
      runtime_exceeded: this.isRuntimeExceeded(),
      errors: this.errorDetails || [],
    };

    const { error } = await this.supabase
      .from('admin.run_stats')
      .update({
        run_finished_at: new Date().toISOString(),
        status,
        error_summary: errorSummary,
        details,
        ...this.stats,
      })
      .eq('id', this.runId);

    if (error) {
      console.error(`[${this.runId}] Failed to finalize run_stats:`, error);
    }
  }
}

// ============================================================================
// MAIN EXECUTION (FIX #4 - CJS async pattern)
// ============================================================================

async function main() {
  // Kill switch check
  if (process.env.RSS_TRACKER_RUN_ENABLED === 'false') {
    console.log('RSS tracker disabled via RSS_TRACKER_RUN_ENABLED=false');
    return;
  }

  // Environment validation
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',  // FIX #12
    'OPENAI_API_KEY',              // FIX #9
  ];

  const missing = requiredEnvVars.filter(v => !process.env[v]);
  if (missing.length > 0) {
    console.error('Missing required environment variables:', missing);
    process.exit(1);
  }

  // Run tracker
  const tracker = new RSSTracker();
  await tracker.run();
}

// FIX #4: CJS async wrapper (no top-level await)
main().catch(err => {
  console.error('RSS tracker failed:', err);
  process.exit(1);
});
```

---

### Phase 5: GitHub Actions Workflows (30 min)

#### Workflow 1: TEST (Temporary Schedule)

**File:** `.github/workflows/rss-tracker-test.yml`

```yaml
name: RSS Tracker (TEST)

on:
  workflow_dispatch:  # Manual trigger
  schedule:
    # FIX #7: TEMPORARY schedule for TTRC-266 validation (48h, 24 runs)
    # REMOVE/COMMENT after validation passes
    - cron: '0 */2 * * *'  # Every 2 hours

concurrency:
  group: rss-tracker-test
  cancel-in-progress: true

jobs:
  rss-tracker:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/test'
    timeout-minutes: 8

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run RSS Tracker
        env:
          # FIX #12: Use service role key for admin schema access
          SUPABASE_URL: ${{ secrets.SUPABASE_TEST_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_TEST_SERVICE_ROLE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ENVIRONMENT: test
          RSS_TRACKER_RUN_ENABLED: true
        run: node scripts/rss-tracker-supabase.js

      - name: Report status
        if: always()
        run: |
          echo "RSS tracker run completed"
          echo "Check admin.run_stats table for detailed results"
```

---

#### Workflow 2: PROD (Automatic)

**File:** `.github/workflows/rss-tracker-prod.yml`

```yaml
name: RSS Tracker (PROD)

on:
  workflow_dispatch:  # Manual trigger
  schedule:
    - cron: '0 */2 * * *'  # Every 2 hours (permanent)

concurrency:
  group: rss-tracker-prod
  cancel-in-progress: true

jobs:
  rss-tracker:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    timeout-minutes: 8

    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run RSS Tracker
        env:
          # FIX #12: Use service role key for admin schema access
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          ENVIRONMENT: prod
          RSS_TRACKER_RUN_ENABLED: true
        run: node scripts/rss-tracker-supabase.js

      - name: Report status
        if: always()
        run: |
          echo "RSS tracker run completed"
          echo "Check admin.run_stats table for detailed results"
```

**IMPORTANT (FIX #12):** Ensure these secrets are configured in GitHub:
- `SUPABASE_TEST_SERVICE_ROLE_KEY` (not anon key)
- `SUPABASE_SERVICE_ROLE_KEY` (not anon key)
- `OPENAI_API_KEY`

---

#### Workflow 3: Update job-scheduler.yml

**File:** `.github/workflows/job-scheduler.yml`

**Action:** Comment out RSS triggers ONLY, keep other jobs intact

```yaml
# ============================================================================
# JOB SCHEDULER - Central automation for various background tasks
# ============================================================================
#
# IMPORTANT: RSS automation MOVED to rss-tracker-prod.yml (TTRC-266)
# The RSS-related jobs below are DEPRECATED and will be removed in TTRC-267
# ============================================================================

name: Job Scheduler

on:
  workflow_dispatch:
  schedule:
    # RSS DEPRECATED - See rss-tracker-prod.yml (TTRC-266)
    # - cron: '0 */2 * * *'  # RSS every 2 hours

    # KEEP THESE JOBS ACTIVE:
    - cron: '0 8 * * *'   # Executive Orders tracker (daily 8am UTC)
    - cron: '0 */6 * * *'  # Daily tracker (every 6 hours)

jobs:
  # RSS JOB DEPRECATED (TTRC-266) - Kept for rollback, remove in TTRC-267
  # rss-schedule:
  #   runs-on: ubuntu-latest
  #   if: github.ref == 'refs/heads/main'
  #   steps:
  #     - name: Trigger RSS fetch
  #       run: |
  #         curl -X POST "${{ secrets.SUPABASE_URL }}/functions/v1/rss-enqueue" \
  #           -H "Authorization: Bearer ${{ secrets.EDGE_CRON_TOKEN }}" \
  #           -H "Content-Type: application/json" \
  #           -d '{"kind":"fetch_all_feeds"}'

  # EO TRACKER - KEEP ACTIVE
  eo-tracker:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      - name: Run EO tracker
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: node scripts/executive-orders-tracker-supabase.js

  # DAILY TRACKER - KEEP ACTIVE
  daily-tracker:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v3
      # ... existing daily tracker config
```

---

### Phase 6: TEST Deployment & Monitoring (48 hours)

#### Deployment Steps:

1. **Commit all changes to test branch:**
   ```bash
   git add .
   git commit -m "feat(rss): implement inline GitHub Actions automation (TTRC-266)

   - Add migration 030 (admin.run_stats, advisory locks, validation helpers)
   - Create inline script with all guardrails (budget, runtime, concurrency)
   - Extract enrichment module (or document blockers)
   - Add TEST/PROD workflows
   - Mark worker DEPRECATED for RSS (still serves article.enrich)
   - Fix 14 critical issues (OpenAI init, clustering, auth, status semantics)

   Refs TTRC-266"
   ```

2. **Push to GitHub:**
   ```bash
   git push origin test
   ```

3. **Verify workflow triggers:**
   - Check GitHub Actions tab
   - Workflow should start automatically (2h schedule enabled)

4. **Monitor runs:**
   - Check every 4-6 hours
   - Run monitoring queries (see below)

---

#### Success Criteria (FIX #8 - worker NOT stopped):

- ✅ **Total runs:** 24 (automatic via 2h schedule)
- ✅ **Success rate:** >80% (FIX #14 - partial_success counts as success)
- ✅ **Cost ceiling:** <$0.50 total
- ✅ **Runtime average:** <5 min
- ✅ **Runtime max:** <8 min (no GA timeouts)
- ✅ **Concurrency:** feeds_skipped_lock = 0 (no conflicts)
- ✅ **Budget:** Budget cap triggered at least once (proves guard works)
- ✅ **Cache:** feeds_304_cached > 0, last_304_at populated
- ✅ **Idempotency:** Re-run same timeframe → no duplicate articles
- ✅ **Clustering:** stories_clustered > 0 (FIX #10 - not stubbed)

---

#### Monitoring Queries:

```sql
-- ==================================================
-- Real-time run status
-- ==================================================
SELECT
  environment,
  status,
  run_started_at,
  run_finished_at,
  EXTRACT(EPOCH FROM (run_finished_at - run_started_at)) / 60 as runtime_min,
  feeds_succeeded,
  feeds_failed,
  feeds_skipped_lock,  -- FIX #6
  feeds_304_cached,
  stories_clustered,   -- FIX #10
  stories_enriched,
  total_openai_cost_usd
FROM admin.run_stats
WHERE environment = 'test'
  AND run_started_at > NOW() - INTERVAL '48 hours'
ORDER BY run_started_at DESC;

-- ==================================================
-- Success metrics (FIX #14 - partial_success = success)
-- ==================================================
SELECT
  COUNT(*) as total_runs,
  COUNT(*) FILTER (WHERE status IN ('success', 'partial_success')) as successful,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE status IN ('success', 'partial_success')) / COUNT(*),
    2
  ) as success_rate_pct,
  SUM(total_openai_cost_usd) as total_cost_usd,
  AVG(EXTRACT(EPOCH FROM (run_finished_at - run_started_at)) / 60) as avg_runtime_min,
  MAX(EXTRACT(EPOCH FROM (run_finished_at - run_started_at)) / 60) as max_runtime_min
FROM admin.run_stats
WHERE environment = 'test'
  AND run_started_at > NOW() - INTERVAL '48 hours';

-- ==================================================
-- Cache performance
-- ==================================================
SELECT
  SUM(feeds_304_cached) as cache_hits,
  SUM(feeds_processed) as total_feeds,
  ROUND(
    100.0 * SUM(feeds_304_cached) / NULLIF(SUM(feeds_processed), 0),
    2
  ) as cache_hit_rate_pct,
  COUNT(*) FILTER (WHERE feeds_304_cached > 0) as runs_with_cache_hits
FROM admin.run_stats
WHERE environment = 'test'
  AND run_started_at > NOW() - INTERVAL '48 hours';

-- ==================================================
-- Concurrency check (FIX #6 - should be zero)
-- ==================================================
SELECT
  SUM(feeds_skipped_lock) as total_lock_conflicts,
  COUNT(*) FILTER (WHERE feeds_skipped_lock > 0) as runs_with_conflicts
FROM admin.run_stats
WHERE environment = 'test'
  AND run_started_at > NOW() - INTERVAL '48 hours';
-- Expected: total_lock_conflicts = 0

-- ==================================================
-- Budget behavior
-- ==================================================
SELECT
  COUNT(*) FILTER (WHERE status = 'partial_success') as budget_capped_runs,
  SUM(enrichment_skipped_budget) as total_stories_skipped_budget,
  MAX(total_openai_cost_usd) as max_cost_single_run
FROM admin.run_stats
WHERE environment = 'test'
  AND run_started_at > NOW() - INTERVAL '48 hours';

-- ==================================================
-- Clustering stats (FIX #10 - should be > 0)
-- ==================================================
SELECT
  SUM(stories_clustered) as total_articles_clustered,
  AVG(stories_clustered) as avg_per_run,
  COUNT(*) FILTER (WHERE stories_clustered > 0) as runs_with_clustering
FROM admin.run_stats
WHERE environment = 'test'
  AND run_started_at > NOW() - INTERVAL '48 hours';

-- ==================================================
-- Error analysis
-- ==================================================
SELECT
  status,
  error_summary,
  COUNT(*) as occurrences,
  ARRAY_AGG(DISTINCT run_started_at ORDER BY run_started_at DESC) as run_times
FROM admin.run_stats
WHERE environment = 'test'
  AND run_started_at > NOW() - INTERVAL '48 hours'
  AND status = 'failed'
GROUP BY status, error_summary;
```

---

#### Abort Conditions (Roll Back):

- ❌ Data loss detected (articles/stories missing)
- ❌ Runaway costs (>$0.50 in 48h)
- ❌ Success rate <50% (worse than moderate tolerance)
- ❌ Duplicate articles created (idempotency broken)
- ❌ Frequent GA timeouts (>8 min repeatedly)
- ❌ Clustering not working (stories_clustered = 0 consistently)

---

#### Post-Monitoring Actions:

1. **Remove temporary TEST schedule (FIX #7):**
   ```yaml
   # In rss-tracker-test.yml:
   # on:
   #   workflow_dispatch:
   #   schedule:  # COMMENTED OUT after validation
   #     - cron: '0 */2 * * *'
   ```

2. **Document results in TTRC-266:**
   - Success rate: X%
   - Total cost: $X.XX
   - Runtime stats
   - Cache hit rate
   - Concurrency conflicts (should be 0)
   - Any issues found

3. **Create handoff doc (if needed):**
   `/docs/handoffs/2025-11-16-ttrc-266-rss-automation.md`

---

### Phase 7: PROD Deployment (30 min)

#### Steps:

1. **Create deployment branch from main:**
   ```bash
   git checkout main && git pull
   git checkout -b deploy/ttrc-266-rss-automation
   ```

2. **Cherry-pick tested commits from test:**
   ```bash
   # Get commit hashes from test branch
   git log test --oneline -10

   # Cherry-pick in order
   git cherry-pick <migration-030-commit>
   git cherry-pick <etag-fix-commit>
   git cherry-pick <enrichment-module-commit>
   git cherry-pick <inline-script-commit>
   git cherry-pick <workflows-commit>
   git cherry-pick <worker-deprecation-commit>
   ```

3. **Create PR:**
   ```bash
   gh pr create \
     --title "feat: Automate RSS via GitHub Actions inline pattern (TTRC-266)" \
     --body-file .github/PR_TEMPLATE.md
   ```

**PR Description Template:**

```markdown
## Summary
Migrates RSS ingestion, clustering, and enrichment to inline GitHub Actions automation (EO tracker pattern). Worker remains running for article.enrich jobs until TTRC-267.

## Architecture Change

**BEFORE:**
```
GA cron → Edge Function → job_queue → Manual Worker → DB
```

**AFTER:**
```
GA cron → Inline Script (rss-tracker-supabase.js) → DB
```

## Changes Made

### Database (Migration 030):
- admin.run_stats table (enhanced observability)
- Advisory lock functions (per-feed concurrency)
- last_304_at column (cache hit tracking)
- Validation helper RPCs

### Code:
- **scripts/rss-tracker-supabase.js:** Inline automation script
- **scripts/enrichment/enrich-stories.js:** Extracted module
- **scripts/rss/fetch_feed.js:** ETag column update
- **scripts/job-queue-worker.js:** Marked DEPRECATED for RSS

### Workflows:
- **.github/workflows/rss-tracker-test.yml:** TEST (manual)
- **.github/workflows/rss-tracker-prod.yml:** PROD (auto 2h)
- **.github/workflows/job-scheduler.yml:** RSS triggers removed

### Guardrails:
- Runtime cap: 5-min hard, 8-min GA timeout
- Budget cap: $5/day, predicted cost check
- Concurrency: Advisory locks + GA concurrency group
- Idempotency: Article upsert, clustering checks, enrichment cooldown
- Kill switch: RSS_TRACKER_RUN_ENABLED env var

## Critical Fixes Applied
- ✅ FIX #9: OpenAI client initialization
- ✅ FIX #10: Clustering implemented (not stubbed)
- ✅ FIX #11: pg_proc_check RPC for validation
- ✅ FIX #12: Service role key for admin schema access
- ✅ FIX #13: failure_count column validation
- ✅ FIX #14: Status semantics (partial_success vs skipped_budget)
- ✅ All architectural fixes (#1-#8) from initial review

## TEST Results (48 hours, 24 runs)

**Success Metrics:**
- Success rate: **X%** (target >80%, partial_success counts as success)
- Total cost: **$X.XX** (target <$0.50)
- Avg runtime: **X.X min** (target <5 min)
- Max runtime: **X.X min** (target <8 min)

**Observability:**
- Cache hit rate: **X%** (304 responses tracked)
- Lock conflicts: **0** (concurrency safe)
- Articles clustered: **X** (FIX #10 verified)
- Duplicate articles: **0** (idempotency verified)

**Budget Behavior:**
- Budget cap triggered: **X times** (guard working)
- Stories skipped due to budget: **X**
- Max cost single run: **$X.XX**

## Scope

### ✅ IN SCOPE (TTRC-266):
- RSS automation complete
- Clustering automation complete
- Enrichment automation complete
- Worker marked DEPRECATED for RSS

### ⏳ OUT OF SCOPE (TTRC-267):
- Worker still runs for article.enrich (~700 jobs/month)
- Worker shutdown deferred
- Dead code removal deferred (lifecycle/split/merge)

## JIRA
Closes TTRC-266

## Acceptance Criteria
[38 checkboxes - see planning doc]

## Rollback Plan
- Keep worker code + old edge function for 30 days
- Kill switch: Set RSS_TRACKER_RUN_ENABLED=false
- Re-enable job-scheduler.yml RSS triggers if needed

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

4. **Merge PR** (triggers Netlify auto-deploy)

5. **Monitor first 3 PROD runs:**
   ```sql
   SELECT * FROM admin.run_stats
   WHERE environment = 'prod'
   ORDER BY run_started_at DESC
   LIMIT 3;
   ```

6. **Mark worker DEPRECATED (FIX #8 - NOT stopped):**

**File:** `scripts/job-queue-worker.js`

```javascript
/*
 * ============================================================================
 * JOB QUEUE WORKER
 * ============================================================================
 *
 * ⚠️ DEPRECATED for RSS jobs as of TTRC-266 (2025-11-16)
 *
 * RSS ingestion, clustering, and enrichment moved to GitHub Actions inline:
 * - See: scripts/rss-tracker-supabase.js
 * - Workflow: .github/workflows/rss-tracker-prod.yml
 * - Runs: Every 2 hours automatically
 *
 * STILL ACTIVE for:
 * - article.enrich jobs (~700/month, TTRC-234 embeddings)
 *
 * REMOVAL PLAN:
 * - TTRC-267: Migrate article.enrich to inline or alternative
 * - TTRC-267: Remove worker + dead code (lifecycle/split/merge handlers)
 * - Keep running until TTRC-267 complete
 *
 * DO NOT STOP THIS WORKER until article.enrich is migrated
 * ============================================================================
 */

const { createClient } = require('@supabase/supabase-js');
// ... rest of worker code unchanged
```

---

## ✅ Acceptance Criteria (All Fixes Applied)

### Pre-Implementation (Phase 0):
- [ ] **AC-1:** Dependency audit complete, documented in TTRC-266
- [ ] **AC-2:** DB validation script created and passed (TEST + PROD)
- [ ] **AC-3:** increment_budget RPC exists (FIX #2 - from migration 008)
- [ ] **AC-4:** get_stories_needing_enrichment RPC exists (FIX #5)
- [ ] **AC-5:** Article unique constraint verified (url_hash, published_date)
- [ ] **AC-6:** failure_count column exists on feed_registry (FIX #13)

### Database (Phase 1):
- [ ] **AC-7:** Migration 030 applied to TEST (no auto-create - FIX #2)
- [ ] **AC-8:** admin.run_stats created with all fields (FIX #6, #14)
- [ ] **AC-9:** Advisory lock RPCs created (acquire/release_feed_lock)
- [ ] **AC-10:** last_304_at column added to feed_registry
- [ ] **AC-11:** pg_proc_check RPC created (FIX #11)
- [ ] **AC-12:** check_columns_exist RPC created (FIX #13)

### Code Quality (Phase 2-4):
- [ ] **AC-13:** ETag column update implemented (fetch_feed.js)
- [ ] **AC-14:** Idempotency guards implemented:
  - Article insertion (existing RPC)
  - Story clustering (article_story check)
  - Enrichment cooldown (24h guard)
- [ ] **AC-15:** Enrichment extracted OR blockers documented
- [ ] **AC-16:** Feed scheduling (max 30, last_fetched_at order)
- [ ] **AC-17:** Runtime guard (break if >4 min)
- [ ] **AC-18:** Budget check (single call, predicted cost)
- [ ] **AC-19:** Advisory locks (per-feed, non-blocking, exception-safe)
- [ ] **AC-20:** finalizeRunStats single call site (FIX #3)
- [ ] **AC-21:** CJS pattern with async main() (FIX #4)
- [ ] **AC-22:** OpenAI client initialized in constructor (FIX #9)
- [ ] **AC-23:** Clustering implemented not stubbed (FIX #10)
- [ ] **AC-24:** Service role key used for admin access (FIX #12)

### Workflows (Phase 5):
- [ ] **AC-25:** rss-tracker-test.yml created (temp 2h schedule - FIX #7)
- [ ] **AC-26:** rss-tracker-prod.yml created (auto 2h)
- [ ] **AC-27:** job-scheduler.yml updated (RSS commented, others intact)
- [ ] **AC-28:** Secrets configured (service role keys - FIX #12)

### TEST Validation (Phase 6):
- [ ] **AC-29:** 24 runs completed in 48h (auto schedule)
- [ ] **AC-30:** Success rate >80% (partial_success = success - FIX #14)
- [ ] **AC-31:** Total cost <$0.50
- [ ] **AC-32:** Avg runtime <5 min
- [ ] **AC-33:** Max runtime <8 min
- [ ] **AC-34:** feeds_skipped_lock = 0 (no conflicts - FIX #6)
- [ ] **AC-35:** Budget cap triggered once (guard verified)
- [ ] **AC-36:** feeds_304_cached > 0, last_304_at populated
- [ ] **AC-37:** Idempotency verified (no duplicates)
- [ ] **AC-38:** stories_clustered > 0 (FIX #10)
- [ ] **AC-39:** Temp TEST schedule removed after validation (FIX #7)

### PROD Deployment (Phase 7):
- [ ] **AC-40:** PR created with full TEST results
- [ ] **AC-41:** PR merged to main
- [ ] **AC-42:** First 3 PROD runs successful
- [ ] **AC-43:** Stories auto-enriching every 2h
- [ ] **AC-44:** Worker marked DEPRECATED for RSS (FIX #8 - NOT stopped)
- [ ] **AC-45:** Worker responsibilities documented (still serves article.enrich)

### Out of Scope (TTRC-267):
- ❌ Worker shutdown (still needed for article.enrich)
- ❌ job_queue removal (still needed for embeddings)
- ❌ Dead code cleanup (lifecycle/split/merge)

---

## 🚨 Known Risks & Mitigation

### Risk 1: Enrichment Extraction Blocked
- **Mitigation:** Document blockers, copy inline with TODO, defer to TTRC-267

### Risk 2: Service Role Key Security
- **Mitigation:** Only in GitHub Actions secrets, never in code

### Risk 3: TEST Failure Rate >50%
- **Mitigation:** Abort, roll back, investigate root cause

### Risk 4: Advisory Locks Not Released
- **Mitigation:** try/finally blocks, connection lifecycle cleanup

### Risk 5: Budget Cap Not Triggered
- **Mitigation:** Manually lower cap to $0.10 during TEST to verify guard

---

## 📦 Deliverables

### Code Created:
1. `scripts/validate-rpc-dependencies.js` (FIX #5, #11, #13)
2. `migrations/030_rss_tracker_inline.sql` (FIX #2, #11, #13)
3. `scripts/enrichment/enrich-stories.js` (or documented blockers)
4. `scripts/rss-tracker-supabase.js` (FIX #3, #4, #9, #10, #12)
5. `.github/workflows/rss-tracker-test.yml` (FIX #7, #12)
6. `.github/workflows/rss-tracker-prod.yml` (FIX #12)

### Code Updated:
1. `scripts/rss/fetch_feed.js` (last_304_at column)
2. `.github/workflows/job-scheduler.yml` (RSS commented)
3. `scripts/job-queue-worker.js` (DEPRECATED header - FIX #8)

### Documentation:
1. TTRC-266 JIRA: Dependency audit results
2. TTRC-266 JIRA: TEST monitoring results
3. PR description: Full TEST results + 45 AC checklist
4. Handoff doc (optional): `/docs/handoffs/2025-11-16-ttrc-266.md`

### JIRA:
1. TTRC-266: Status = "Done"
2. TTRC-267: Created (embeddings + worker removal + cleanup)

---

## ⏱️ Timeline

**Active work:** 10-12 hours
**Calendar time:** 5-6 days

- **Day 1 (3h):** Phase 0-1 (validation, audit, migration)
- **Day 2 (4h):** Phase 2-3 (fixes, enrichment extraction)
- **Day 3 (3h):** Phase 4-5 (inline script, workflows)
- **Day 4-5 (48h):** Phase 6 (auto monitoring via 2h schedule)
- **Day 6 (1h):** Phase 7 (PROD deployment)

**Cost:** $0.25-0.50 (TEST monitoring only)

---

## 🎯 Success Definition

**TTRC-266 is complete when:**

1. ✅ RSS feeds auto-fetch every 2h via GA in PROD
2. ✅ Stories auto-cluster and enrich with OpenAI
3. ✅ Runtime <5 min, cost <$0.20/run consistently
4. ✅ Worker marked DEPRECATED for RSS (still runs for embeddings)
5. ✅ All 45 acceptance criteria met
6. ✅ Zero production issues in first 72 hours
7. ✅ All 14 critical fixes applied and verified

**Follow-up TTRC-267:**
- Migrate article.enrich to inline or separate workflow
- Stop worker process
- Remove deprecated code (worker, old edge function, dead handlers)
- Cleanup after 30-day stability period

---

## 📝 Notes

- **Service role security:** Keys only in GitHub Actions secrets, never committed
- **Rollback safety:** Worker + edge function kept 30 days for rollback
- **Two-phase approach:** TTRC-266 (RSS automation) + TTRC-267 (full cleanup)
- **Kill switch:** RSS_TRACKER_RUN_ENABLED=false to disable
- **Monitoring:** admin.run_stats provides full observability

---

**Last Updated:** 2025-11-16
**Status:** Ready for implementation
**All critical fixes applied:** ✅ (14/14)
