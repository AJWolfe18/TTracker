# PROD Post-Deployment Audit Plan (Revised)

**Date:** 2026-01-07
**Status:** AUDIT IN PROGRESS
**Context:** Post-deployment review - need to distinguish real bugs from "ghost hunting"

---

## Phase 0: Reality Check - Is PROD Running RSS?

**CRITICAL QUESTION:** Is PROD supposed to be running the RSS/stories system, or is it still legacy?

Per documented architecture, during migration: `TEST = RSS system, PROD = legacy`.

If PROD is still legacy, then "missing RPCs" are **expected** and the real issue is **traffic leaking to PROD**.

### Query 0a: Are RSS Tables Present in PROD?

```sql
-- Run this FIRST in PROD Supabase
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'stories',
    'articles',
    'article_story',
    'job_queue',
    'feed_registry',
    'budgets',
    'ingest_rejections'
  )
ORDER BY table_name;
```

### Query 0b: Check Supabase Migration History

```sql
-- Check if migrations were tracked via Supabase CLI
SELECT *
FROM supabase_migrations.schema_migrations
ORDER BY inserted_at;
```

### Query 0c: RSS "Sentinel" Validation (Shape Check)

Table presence alone is misleading (half-created, abandoned, copied over). Check shape + intent:

```sql
-- Run in PROD - checks for specific columns (each separate for actionable results)
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='job_queue'
          AND column_name='status') AS job_queue_has_status,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='stories'
          AND column_name='latest_article_published_at') AS stories_has_latest_pub,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='articles'
          AND column_name='guid') AS articles_has_guid,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='articles'
          AND column_name='feed_id') AS articles_has_feed_id;
```

### Query 0d: Recent Activity Check (Only if tables exist)

Tables + sentinels can still be dead weight. Check if RSS is *actually* in use:

```sql
-- Tells you whether RSS is actively writing data
SELECT
  (SELECT max(created_at) FROM public.articles)  AS articles_latest_created_at,
  (SELECT max(created_at) FROM public.stories)   AS stories_latest_created_at,
  (SELECT max(created_at) FROM public.job_queue) AS jobs_latest_created_at;
```

**Interpretation:**
- **Tables=true, Sentinels=true, Activity=recent:** PROD is live RSS → missing RPCs are P1 blockers
- **Tables=true, Sentinels=true, Activity=null/ancient:** RSS objects exist but not active → verify intent
- **Tables=true, Sentinels=false:** PROD has drift/partial deploy → treat as "not reliably RSS"
- **Tables=false:** PROD is legacy → missing RPCs expected → real bug is env misrouting

---

## Reordered Priority List

### P0 - STOP THE BLEEDING (Do First)

#### 1. Hardcoded PROD Fallbacks = MOST DANGEROUS

**Philosophy Change:** Don't "fallback to PROD" → **Fail closed with loud error**

If config is missing, safest behavior is "do nothing", NOT "write to prod".

**Files to fix:**
- `public/dashboard-utils.js` - lines 16-17
- `public/dashboard.js` - line 67
- `scripts/daily-tracker-supabase.js` - lines 32-33

**Current (DANGEROUS):**
```javascript
const SUPABASE_URL = window.SUPABASE_URL || 'https://osjbulmltfpcoldydexg.supabase.co';
```

**Fixed - UI (Show banner, don't brick page):**
```javascript
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  document.body.innerHTML = `
    <div style="padding:16px;font-family:system-ui;background:#fee;border:2px solid #c00;">
      <h2>⚠️ FATAL: Missing Supabase configuration</h2>
      <p>This page will not run without SUPABASE_URL and SUPABASE_ANON_KEY.</p>
      <p>Check supabase-browser-config.js is loading correctly.</p>
    </div>`;
  throw new Error("Missing required configuration");
}
```

**Fixed - Scripts/CLI (Throw immediately):**
```javascript
const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
```

#### 1b. Centralized Env Validation (lib/env-validation.js)

**Standardize so it doesn't get reimplemented 12 ways.** All scripts import this:

```javascript
// lib/env-validation.js - THE ONLY PLACE THIS LOGIC LIVES
const PROD_REF = "osjbulmltfpcoldydexg";
const TEST_REF = "wnrjrywpcadwutfykflu"; // Update with actual test ref

function validateEnv() {
  const TARGET_ENV = process.env.TARGET_ENV;
  if (!TARGET_ENV) throw new Error("Missing TARGET_ENV (prod|test)");

  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("Missing SUPABASE_URL");

  const ref = (url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i) || [])[1];
  if (!ref) throw new Error(`Could not parse Supabase project ref from URL: ${url}`);

  if (TARGET_ENV === "prod" && ref !== PROD_REF) throw new Error(`TARGET_ENV=prod but ref=${ref}`);
  if (TARGET_ENV === "test" && ref !== TEST_REF) throw new Error(`TARGET_ENV=test but ref=${ref}`);

  return { TARGET_ENV, url, ref };
}

module.exports = { validateEnv, PROD_REF, TEST_REF };
```

**Usage in scripts:**
```javascript
const { validateEnv } = require('../lib/env-validation');
validateEnv(); // Throws if misconfigured
```

**This eliminates:** "one script forgot the guard."

#### 1c. GitHub Environments (Optional but Recommended)

Lock secrets to GitHub Environments for reduced blast radius:

```yaml
jobs:
  run:
    environment: prod  # or 'test'
```

- Put PRODUCTION secrets only in `prod` environment
- Put TEST secrets only in `test` environment
- Add required reviewers for `prod` (forces deliberate click)

**This prevents:** Wrong secrets even being available to misconfigured workflow.

#### 2. Workflow Branch Guards (Cheap Insurance)

Relying on runtime env detection is fragile when secrets or env vars drift.

**Files needing `if: github.ref == 'refs/heads/main'`:**
- `.github/workflows/daily-tracker.yml`
- `.github/workflows/executive-orders-tracker.yml`
- `.github/workflows/process-manual-article.yml`

#### 3. Universal Kill-Switch (Apply to ALL Scheduled Workflows)

Make it concrete, at the **job level** (so nothing runs), and **default to safe** (must be explicitly true):

```yaml
# Apply this pattern to EVERY scheduled workflow that can mutate state
jobs:
  run:
    if: github.ref == 'refs/heads/main' && vars.ENABLE_PROD_SCHEDULES == 'true'
```

**Apply to ALL of these:**
- `rss-tracker-prod.yml`
- `job-scheduler.yml`
- `story-merge.yml`
- `daily-tracker.yml`
- `executive-orders-tracker.yml`

**During audit:** Set `ENABLE_PROD_SCHEDULES=false` in GitHub repo variables.

**Alternative (most foolproof):** Temporarily remove `schedule:` trigger - visible in git diff.

**Prevents:** job spam, runaway OpenAI spend, noisy failures obscuring audit signal.

---

### P1 - RPC Audit (Only if PROD Has RSS Tables)

#### Improved Queries Using `regprocedure` (Handles Overloads)

```sql
-- Query 1: List callable function SIGNATURES (avoids overload ambiguity)
SELECT
  p.oid::regprocedure AS signature,
  n.nspname AS schema,
  p.proname AS name
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY 1;
```

```sql
-- Query 2: Check critical RPC SIGNATURES exist (public schema)
SELECT p.oid::regprocedure AS signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'find_similar_stories',
    'claim_next_job',
    'finish_job',
    'get_embedding_similarities',
    'increment_story_entities',
    'update_story_latest_article_published_at',
    'recompute_story_centroids',
    'update_story_lifecycle_states',
    'upsert_article_and_enqueue_jobs',
    'get_unclustered_articles',
    'increment_budget_with_limit',
    'acquire_feed_lock',
    'release_feed_lock',
    'log_run_stats'
  )
ORDER BY 1;
```

```sql
-- Query 2b: "Where is it actually?" (check ALL schemas, catches misplaced functions)
SELECT n.nspname AS schema, p.oid::regprocedure AS signature
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.proname IN (
  'find_similar_stories','claim_next_job','finish_job','get_embedding_similarities',
  'increment_story_entities','update_story_latest_article_published_at',
  'recompute_story_centroids','update_story_lifecycle_states'
)
ORDER BY 1, 2;
```

If Query 2 shows "missing" but Query 2b finds it in another schema, you have a schema scope issue, not a missing RPC.

```sql
-- Query 2c: Permission sanity check ("exists" ≠ "works")
-- Run for each critical function signature found in Query 2
-- Replace the regprocedure with actual signatures from your audit
SELECT
  has_function_privilege('anon', 'public.find_similar_stories(vector,integer)'::regprocedure, 'execute') AS anon_can_exec,
  has_function_privilege('authenticated', 'public.find_similar_stories(vector,integer)'::regprocedure, 'execute') AS auth_can_exec;

-- Repeat for other critical functions:
-- public.upsert_article_and_enqueue_jobs(...)
-- public.get_unclustered_articles(integer)
-- etc.
```

**This catches:** "function exists but everything 403s" class of outage.

```sql
-- Query 3: Articles schema
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'articles'
ORDER BY ordinal_position;
```

```sql
-- Query 4: Stories schema
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'stories'
ORDER BY ordinal_position;
```

```sql
-- Query 5: Extensions
SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pgcrypto', 'vector', 'pg_stat_statements');
```

---

### P2 - RPC Catch-up Migration (If Needed)

**Only after P0 complete AND Query 0 confirms RSS tables exist in PROD.**

#### Extract from TEST

```sql
-- For each missing RPC, run in TEST:
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'FUNCTION_NAME';
```

#### Migration Guardrails

When creating `050_missing_rpc_functions.sql`:

1. Use `CREATE OR REPLACE FUNCTION ...`
2. Set `SECURITY DEFINER` and `SET search_path` only where required
3. Grant execute narrowly
4. **DO NOT ship `exec_sql`** to PROD (security risk)

---

### P3 - Migration Reconciliation (Baseline Approach)

**Don't try to resurrect 001-025.** Instead:

1. Create **baseline schema snapshot** from canonical DB (TEST or PROD)
2. **Store as documentation, NOT executable migration:**
   ```
   schema/baseline_prod_2026-01-07.sql
   schema/baseline_test_2026-01-07.sql
   ```
3. Generate via schema-only dump (or Supabase Studio export)
4. Don't run it like a migration unless rebuilding from scratch
5. Keep incremental migrations from that point forward

This gives deterministic environment recreation without hunting lost files.

---

### P4 - CI "Ban PROD Refs" Lint (Prevent Repeat Incidents)

Add a CI step that catches hardcoded PROD URLs early. **Broaden to catch all forms:**

```yaml
# .github/workflows/lint-prod-refs.yml
name: Lint PROD References
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check for hardcoded PROD refs
        run: |
          PROD_REF="osjbulmltfpcoldydexg"

          # Patterns to catch: ref alone, full hostname, functions URL
          PATTERNS="$PROD_REF|$PROD_REF\.supabase\.co"

          # Explicit allowlist (where PROD ref IS expected)
          ALLOWED_FILES="lib/env-validation.js|supabase-browser-config.js"

          # Search in frontend and scripts, excluding allowed files
          MATCHES=$(grep -rEn "$PATTERNS" public/ scripts/ .github/ --include="*.js" --include="*.yml" | grep -vE "$ALLOWED_FILES" || true)

          if [ -n "$MATCHES" ]; then
            echo "❌ FAIL: Found hardcoded PROD Supabase ref in non-config files:"
            echo "$MATCHES"
            echo ""
            echo "These should use environment variables, not hardcoded values."
            echo "If this is intentional, add the file to ALLOWED_FILES in this workflow."
            exit 1
          fi
          echo "✅ PASS: No hardcoded PROD refs found in forbidden locations"
```

**This catches:**
- Project ref alone (`osjbulmltfpcoldydexg`)
- Full hostname (`osjbulmltfpcoldydexg.supabase.co`)
- Functions URL form

**Explicit allowlist** prevents bypass via fuzzy `grep -v "config"`.

---

## Recommended Execution Sequence

| Step | Action | Blocker? |
|------|--------|----------|
| 0 | **PROD reality check** - run Query 0a/0b/0c/0d | YES |
| 1 | **Kill-switch** - set `ENABLE_PROD_SCHEDULES=false` | NO |
| 2 | **Create lib/env-validation.js** - centralized validation | NO |
| 3 | **Remove PROD fallbacks** (fail closed banner/throw) | NO |
| 4 | **Add workflow branch guards** to all workflows | NO |
| 5 | **RPC signature audit** (Query 1, 2, 2b, 2c for permissions) | Depends on Step 0 |
| 6 | **050 catch-up migration** (only RPCs required by deployed code) | Depends on Step 5 |
| 7 | **Baseline schema snapshot** (documentation, not migration) | NO |
| 8 | **CI "Ban PROD Refs" lint** + DB contract validation | NO |
| 9 | **GitHub Environments** (optional - lock secrets to envs) | NO |
| 10 | **Re-enable workflows** (set `ENABLE_PROD_SCHEDULES=true`) | Depends on all above |

---

## Files to Modify

### Phase 0 (Stop the Bleeding)

| File | Change |
|------|--------|
| `lib/env-validation.js` | **CREATE** - Centralized TARGET_ENV + project ref validation |
| `public/dashboard-utils.js` | Remove PROD fallback → fail closed with banner |
| `public/dashboard.js` | Remove PROD fallback → fail closed with banner |
| `scripts/daily-tracker-supabase.js` | Remove PROD fallback → import `validateEnv()` |
| `scripts/rss-tracker-supabase.js` | Import `validateEnv()` at startup |
| `scripts/enrichment/*.js` | Import `validateEnv()` at startup |
| `.github/workflows/daily-tracker.yml` | Add branch guard + kill-switch |
| `.github/workflows/executive-orders-tracker.yml` | Add branch guard + kill-switch |
| `.github/workflows/process-manual-article.yml` | Add branch guard |
| `.github/workflows/rss-tracker-prod.yml` | Add kill-switch: `&& vars.ENABLE_PROD_SCHEDULES == 'true'` |
| `.github/workflows/job-scheduler.yml` | Add kill-switch |
| `.github/workflows/story-merge.yml` | Add kill-switch |

### Phase 1 (After Audit)

| File | Change |
|------|--------|
| `migrations/050_missing_rpc_functions.sql` | **CREATE** - Define missing RPCs (no exec_sql!) |
| `.github/workflows/test-manual-article.yml` | Fix SERVICE_KEY → ANON_KEY |
| `.github/workflows/rss-tracker-test.yml` | Update artifact action to v4 |

### Phase 2 (Reconciliation + Prevention)

| File | Change |
|------|--------|
| `schema/baseline_prod_2026-01-07.sql` | **CREATE** - Schema snapshot (documentation only) |
| `schema/baseline_test_2026-01-07.sql` | **CREATE** - Schema snapshot (documentation only) |
| `.github/workflows/lint-prod-refs.yml` | **CREATE** - CI lint for hardcoded PROD refs |
| `.github/workflows/pre-deploy-check.yml` | **CREATE** - CI DB contract validation |

### Phase 3 (Optional - GitHub Environments)

| Change | Notes |
|--------|-------|
| Create `prod` environment | Add PROD secrets here only |
| Create `test` environment | Add TEST secrets here only |
| Add required reviewers to `prod` | Forces deliberate click for prod jobs |
| Update workflows with `environment: prod/test` | Lock jobs to correct env |

---

## Decision Tree After Query 0

```
Query 0a: RSS tables in PROD?
│
├─ NO (empty/few tables) ──────────────────────────────────┐
│   │                                                       │
│   └→ PROD is legacy                                      │
│      Real bug = traffic leaking to PROD                  │
│      Fix = Remove hardcoded PROD fallbacks (P0)          │
│      Fix = Add TARGET_ENV validation (P0)                │
│      Missing RPCs = expected, not a bug                  │
│                                                          │
└─ YES (tables exist) ─────────────────────────────────────┤
    │                                                       │
    └→ Run Query 0c (sentinel check)                       │
       │                                                    │
       ├─ Sentinels=FALSE ─────────────────────────────────┐
       │   │                                                │
       │   └→ PROD has drift/partial deploy                │
       │      Treat as "not reliably RSS"                  │
       │      Fix = Reconcile schema first                 │
       │      Fix = Remove hardcoded fallbacks (P0)        │
       │                                                   │
       └─ Sentinels=TRUE ──────────────────────────────────┐
           │                                                │
           └→ PROD is live RSS system                      │
              Missing RPCs = P1 blockers                   │
              Fix = 050 catch-up migration                 │
              Fix = hardcoded fallbacks still P0           │
```

---

## Risk Matrix (Revised)

| Issue | Severity | If Left Unfixed |
|-------|----------|-----------------|
| Hardcoded PROD fallbacks | **CRITICAL** | Test run → "why is prod on fire?" |
| Missing TARGET_ENV validation | **CRITICAL** | Secrets drift → wrong env gets written |
| Missing branch guards | HIGH | Wrong env workflow triggers |
| Missing RPCs (if RSS live) | HIGH | Clustering at 17%; job queue fails |
| Missing RPCs (if legacy) | LOW | Expected behavior, not a bug |
| Schema drift | MEDIUM | Future migrations may fail |

---

## Two Changes That Prevent Repeat Incidents

1. **Explicit TARGET_ENV + project-ref validation everywhere that can write data**
   - Every script declares intent (`TARGET_ENV=prod` or `test`)
   - URL must match declared target's project ref
   - Mismatches throw immediately

2. **CI "ban prod ref strings" + DB contract check before deploy**
   - `lint-prod-refs.yml` blocks hardcoded PROD URLs
   - `pre-deploy-check.yml` validates required RPCs + columns exist
