# TTRC-266 Dependency Audit Results
**Date:** 2025-11-16
**Phase:** 0C (Pre-Implementation)
**Status:** Complete

---

## Executive Summary

**Scope:** RSS job migration from worker to inline GitHub Actions
**Impact:** ~85% of worker functionality moves to inline (RSS + clustering + enrichment)
**Worker Status:** Remains ACTIVE for article.enrich (~700 jobs/month, TTRC-234)
**Timeline:** Worker removal deferred to TTRC-267

---

## Worker Job Handler Inventory

### 🚀 MIGRATING to Inline (TTRC-266)

| Job Type | Location | Dependency | New Home |
|----------|----------|------------|----------|
| `fetch_feed` | scripts/job-queue-worker.js:63 | scripts/rss/fetch_feed.js | scripts/rss-tracker-supabase.js |
| `fetch_all_feeds` | scripts/job-queue-worker.js:64 | scripts/rss/fetch_feed.js | scripts/rss-tracker-supabase.js |
| `story.cluster` | scripts/job-queue-worker.js:71 | scripts/story-cluster-handler.js | scripts/rss-tracker-supabase.js + get_unclustered_articles RPC |
| `story.cluster.batch` | scripts/job-queue-worker.js:72 | scripts/story-cluster-handler.js | scripts/rss-tracker-supabase.js (batch clustering) |
| `story.enrich` | scripts/job-queue-worker.js:73 | OpenAI + enrichment logic | **Copied inline** (extraction deferred to TTRC-267) |

**Migration Pattern:** DB-centric (no story-cluster-handler dependency in inline script)

---

### ✅ STAYING Active (TTRC-234 Embeddings)

| Job Type | Location | Purpose | Usage | Status |
|----------|----------|---------|-------|--------|
| `article.enrich` | scripts/job-queue-worker.js:77 | Generate article embeddings for semantic search | ~700 jobs/month | **CRITICAL - MUST KEEP WORKER RUNNING** |

**Note:** Worker cannot be stopped until article.enrich migration complete (TTRC-267 or separate story)

---

### ❌ DEAD CODE (0 usage, cleanup in TTRC-267)

| Job Type | Location | Last Active | Reason for Deprecation |
|----------|----------|-------------|------------------------|
| `story.lifecycle` | scripts/job-queue-worker.js:74 | Unknown | Automated lifecycle via clustering |
| `story.split` | scripts/job-queue-worker.js:75 | Never used | Feature never activated |
| `story.merge` | scripts/job-queue-worker.js:76 | Never used | Feature never activated |
| `process_article` | scripts/job-queue-worker.js:78 | Unknown | Replaced by attach_or_create_article RPC |

**Cleanup Plan:** Remove in TTRC-267 after RSS automation proven stable

---

## GitHub Actions Impact

### Current State (.github/workflows/job-scheduler.yml)

```yaml
schedule:
  - cron: '0 */2 * * *'  # RSS every 2 hours → WILL BE DISABLED
  - cron: '5 * * * *'    # Lifecycle hourly → WILL BE DISABLED (dead code)
```

**Actions:**
1. Comment out `schedule-rss` job (lines 9-22)
2. Comment out `schedule-lifecycle` job (lines 23-36) - dead code
3. Add deprecation notice pointing to new workflows

### New State (TTRC-266)

**Created:**
- `.github/workflows/rss-tracker-test.yml` - TEST automation (manual + temp 2h schedule)
- `.github/workflows/rss-tracker-prod.yml` - PROD automation (auto 2h schedule)

**Modified:**
- `.github/workflows/job-scheduler.yml` - RSS/lifecycle triggers commented out

---

## Edge Function Impact

### supabase/functions/rss-enqueue/index.ts

**Current Responsibilities:**
- Creates `fetch_feed` jobs → **DEPRECATED in TTRC-266**
- Creates `fetch_all_feeds` jobs → **DEPRECATED in TTRC-266**
- Creates `story.lifecycle` jobs → **DEAD CODE**
- Creates `story.merge` jobs → **DEAD CODE**

**Status:** Edge function becomes obsolete for RSS jobs but kept for 30-day rollback period

**Removal:** TTRC-267 (after inline automation proven stable)

---

## Database Schema Impact

### job_queue Table

**Before TTRC-266:**
- Active job types: fetch_feed, fetch_all_feeds, story.cluster, story.enrich, **article.enrich**
- Claimed by: scripts/job-queue-worker.js (manual execution)

**After TTRC-266:**
- Active job types: **article.enrich ONLY** (~700/month)
- Claimed by: scripts/job-queue-worker.js (still running for embeddings)

**Status:** Table MUST remain active until TTRC-267

**Cleanup:** Remove RSS-related job records after 30 days (query: `DELETE FROM job_queue WHERE job_type IN ('fetch_feed', 'fetch_all_feeds', 'story.cluster', 'story.enrich') AND created_at < NOW() - INTERVAL '30 days'`)

---

## Dependency Graph

### scripts/rss/fetch_feed.js
- **Used by:** job-queue-worker.js (DEPRECATED after TTRC-266)
- **Used by:** rss-tracker-supabase.js (NEW in TTRC-266)
- **Status:** Stays active, dual-use during transition
- **Dependencies:** feed_registry table, article upsert RPC

### scripts/story-cluster-handler.js
- **Used by:** job-queue-worker.js (DEPRECATED after TTRC-266)
- **Used by:** rss-tracker-supabase.js (NO - using DB-centric approach)
- **Status:** DEPRECATED for inline script (uses get_unclustered_articles RPC instead)
- **Removal:** TTRC-267 or keep for backfill scripts

### scripts/enrichment/* (scraper.js, prompts.js)
- **Used by:** job-queue-worker.js (still active for article.enrich)
- **Used by:** rss-tracker-supabase.js (NEW - enrichment copied inline)
- **Status:** Stays active, dual-use
- **Dependencies:** OpenAI API, article scraping

---

## Search Results Summary

### enqueueJob
- **Found in:** scripts/utils/job-helpers.js (1 file)
- **Usage:** Helper function for creating job_queue records
- **Impact:** Will not be used by inline script (no job creation)

### job_queue
- **Found in:** 82 files (migrations, scripts, docs)
- **Active Usage:**
  - scripts/job-queue-worker.js (CRITICAL - still needed for article.enrich)
  - scripts/backfill-* scripts (manual operations)
  - migrations/* (schema definitions)
- **Impact:** Table and worker remain active

### story-cluster-handler
- **Found in:** 9 files
- **Usage Pattern:**
  - Worker: `clusteringHandlers['story.cluster'](payload, supabase)`
  - Inline: Will NOT import (using DB-centric `get_unclustered_articles` RPC)
- **Impact:** Handler logic stays for worker, not used by inline script

### job-queue-worker
- **Found in:** 9 files (workflows, scripts)
- **Active Workflows:** None currently (manual execution only)
- **Impact:** Worker MUST continue running for article.enrich until TTRC-267

---

## Risk Assessment

### ✅ LOW RISK (Well-Defined Migration)
- RSS feed fetching (idempotent, ETag caching)
- Article clustering (DB-centric, no external dependencies)
- Story enrichment (budget caps, cooldown guards)

### ⚠️ MEDIUM RISK (Dual Responsibilities)
- Worker must stay running for article.enrich (can't stop during TTRC-266)
- fetch_feed.js used by both worker and inline (dual-use during transition)

### ❌ HIGH RISK (Don't Do This)
- Stopping worker before TTRC-267 → Breaks article.enrich (700 jobs/month)
- Removing job_queue table → Breaks embeddings feature
- Deleting edge function before 30-day rollback period → No emergency fallback

---

## TTRC-267 Scope (Follow-up Work)

### Code Cleanup
- [ ] Extract enrichment logic into `scripts/enrichment/enrich-stories.js`
- [ ] Remove dead handlers (lifecycle, split, merge) from worker
- [ ] Clean up commented RSS code in job-scheduler.yml
- [ ] Remove edge function rss-enqueue (after 30-day rollback period)

### Worker Migration Decision
**Option A:** Migrate article.enrich to inline (similar to RSS pattern)
**Option B:** Keep worker for embeddings (separate concern from RSS)
**Decision:** Deferred to TTRC-267 planning

### Database Cleanup
- [ ] Archive old RSS job records (30+ days old)
- [ ] Consider: Remove job_queue table IF article.enrich migrated
- [ ] Consider: Remove get_runnable_count, claim_runnable_job RPCs IF worker stopped

---

## Conclusion

**Worker Deprecation:** RSS jobs only (85% of worker functionality)
**Worker Removal:** TTRC-267 (after article.enrich migration decision)
**Job Queue:** Stays active for embeddings (~700 jobs/month)
**Edge Function:** Obsolete for RSS, kept for rollback safety
**Dead Code:** Lifecycle, split, merge handlers (0 usage, cleanup in TTRC-267)

**CRITICAL:** Worker MUST keep running until article.enrich migration complete. Do NOT stop worker in TTRC-266.

---

**Audit Conducted By:** Claude Code
**Verified By:** [Awaiting manual review]
**Next Step:** Phase 1 - Create migration 034 (rss_tracker_inline.sql)
