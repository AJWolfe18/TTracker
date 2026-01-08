# PROD Deployment Runbook

**Created:** 2026-01-05
**Status:** Ready to Execute
**Timeline:** 6-7 hours across 2-3 days
**JIRA Epic:** TTRC-211

---

## Key Decisions

| Decision | Choice |
|----------|--------|
| Legacy Data (717 entries) | **Defer** - import after PROD stable (empty state OK) |
| DB Method | Manual SQL Editor (not CLI) |
| Security Migrations | Run LAST (after schema complete) |
| Workflow Freeze | Hold back cron workflows from main until Phase 6 |

---

## Phase 0: Pre-Flight (45 min)

**JIRA:** [TTRC-360](https://ajwolfe37.atlassian.net/browse/TTRC-360)

### P0 Code Fixes (Do First)

| # | File | Fix |
|---|------|-----|
| 1 | `majestic-zooming-aurora.md:152` | `title` → `headline` in import SQL |
| 2 | `rss-tracker-prod.yml` | Comment out `schedule:` section, merge to main |
| 3 | `job-scheduler.yml` | Add `if: github.ref == 'refs/heads/main'` |
| 4 | `story-merge.yml` | Add `if: github.ref == 'refs/heads/main'` |

### Pre-Flight Checklist

- [ ] Run PROD audit SQL in Supabase Dashboard (see Appendix A)
- [ ] **HARD STOP: Create PROD backup**
  - Supabase Dashboard > Settings > Backups > Create backup
  - **DO NOT proceed if backup fails**
  - Verify backup shows in list before continuing
- [ ] Verify GitHub Secrets exist for PROD:
  - `SUPABASE_URL` = `https://osjbulmltfpcoldydexg.supabase.co`
  - `SUPABASE_SERVICE_KEY`
  - `OPENAI_API_KEY`
  - `EDGE_CRON_TOKEN`
- [ ] **WORKFLOW FREEZE:**
  - `rss-tracker-prod.yml` → Merge to main with cron COMMENTED OUT
  - `job-scheduler.yml`, `story-merge.yml` → Stay on test branch until Phase 6

---

## Phase 1: Schema Migrations (2.5 hrs)

**JIRA:** [TTRC-360](https://ajwolfe37.atlassian.net/browse/TTRC-360)

Run in Supabase SQL Editor, groups A-F.

### Group A: Foundation (001-007)
```
001_rss_system_PRODUCTION_READY.sql
002_job_queue_functions.sql
003_atomic_article_upsert.sql
004_fix_generated_columns_and_constraints.sql
005_fix_rss_schema_drift.sql
005a_fix_rss_function_alignment.sql
006_PROD_clustering_complete.sql
007_articles_canonical_final.sql
```

**GATE:** Verify tables exist:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN ('articles', 'stories', 'article_story', 'feed_registry');
-- Should return 4 rows
```

### Group B: Job Queue (008-017)
```
008_job_queue_critical_columns.sql
009_atomic_job_claiming.sql
010_fix_rpc_generated_column.sql
011_fix_story_headlines_ttrc169_SENIOR_DEV_VERSION.sql
012_fix_job_queue_ttrc172.sql
013_fix_payload_hash_partial_unique.sql
014_fix_claim_returns_null.sql
015_monitoring_and_helpers.sql
016_fix_job_queue_active_state.sql
017_runnable_count_function.sql
```

### Group C: Cleanup (018a-019)

**WARNING: 018b must run ALONE**
```
018a_legacy_cleanup.sql
018b_create_index_no_transaction.sql  <-- RUN ALONE, NO OTHER STATEMENTS
018c_functions_grants_cleanup.sql
018d_verification_queries.sql
018e_fix_generated_column.sql
019_story_enrichment_helpers.sql
```

If 018b fails with "cannot run in transaction", run via psql or remove CONCURRENTLY.

### Group D: Clustering (020-022_1)
```
020_story_reopen_support.sql
021_fix_clustering_rpc.sql
021a_adjust_threshold.sql
022_clustering_v2_schema.sql
022_1_clustering_v2_expert_fixes.sql
```

**GATE:** Verify pgvector extension:
```sql
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
-- Should return 1 row
```

### Group E: Enrichment (023-027)
```
023_eo_enrichment_schema.sql
024_include_stale_in_candidate_generation.sql
025_story_merge_audit.sql
026_story_split_audit.sql
026.1_story_split_audit_hardening.sql
027_add_merged_into_status.sql
```

**SKIP 028, 029** - they have bugs, superseded by 032.

**GATE:** Run smoke tests from `migrations/032_APPLY_INSTRUCTIONS.md`

### Group F: Fixes (030-045)
```
030_fix_upsert_rpc_return_type.sql
031_fix_digest_schema_qualification.sql
032_fix_digest_migration_028.sql
033_validation_helpers.sql
034_rss_tracker_inline.sql
035_fix_unclustered_articles_rpc.sql
036_move_run_stats_to_public.sql
037_enrichment_failed_tracking.sql
038_smart_error_tracking.sql
039_fix_enqueue_rpc_partial_index.sql
040_fix_payload_hash_generated_column.sql
041_add_articles_unique_constraint.sql
042_unclustered_articles_require_embedding.sql
043_increment_story_entities.sql
044_run_stats_entities_extracted.sql
045_add_topic_slug.sql
```

---

## Phase 2: Edge Functions (45 min)

**JIRA:** [TTRC-361](https://ajwolfe37.atlassian.net/browse/TTRC-361)

### Set Edge Function Secrets

Supabase Dashboard > Edge Functions > Secrets:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ADMIN_API_KEY`

### Deploy 5 Functions (NOT articles-manual)

```bash
supabase functions deploy stories-active --project-ref osjbulmltfpcoldydexg
supabase functions deploy stories-detail --project-ref osjbulmltfpcoldydexg
supabase functions deploy stories-search --project-ref osjbulmltfpcoldydexg
supabase functions deploy queue-stats --project-ref osjbulmltfpcoldydexg
supabase functions deploy rss-enqueue --project-ref osjbulmltfpcoldydexg

# DO NOT deploy articles-manual - still uses political_entries table
```

### Smoke Test Each Endpoint

```bash
curl "https://osjbulmltfpcoldydexg.supabase.co/functions/v1/stories-active"
curl "https://osjbulmltfpcoldydexg.supabase.co/functions/v1/queue-stats"
```

---

## Phase 3: Frontend + RSS (45 min)

**JIRA:** [TTRC-361](https://ajwolfe37.atlassian.net/browse/TTRC-361)

### Deploy Frontend

1. [ ] Create deployment branch from main
2. [ ] Cherry-pick tested commits from test
3. [ ] Create PR to main, merge
4. [ ] Verify trumpytracker.com loads (will show "No Stories Found" - expected)

### Validate Pipeline Before First Run

```sql
-- Test enqueue works (adjust function name if different in PROD audit)
SELECT enqueue_fetch_job('fetch_feed', '{"test": true}'::jsonb);

-- Test claim works
SELECT * FROM claim_runnable_job();

-- Clean up test job
DELETE FROM job_queue WHERE payload->>'test' = 'true';
```

### First RSS Run

```bash
gh workflow run "RSS Tracker - PROD" --ref main
```

Monitor logs for 1 hour.

---

## Phase 4: Security Lockdown (30 min)

**JIRA:** [TTRC-316](https://ajwolfe37.atlassian.net/browse/TTRC-316)

**Run LAST - after schema is complete**

### Group G: Security (046-049)
```
046_security_lockdown.sql
047_fix_rls_policies.sql
048_add_latest_article_published_at.sql
049_security_revoke_public_execute.sql
```

### GATE: Verify service_role Access

```sql
SELECT has_function_privilege('service_role', 'claim_runnable_job()', 'EXECUTE');
-- Must return TRUE
```

### GATE: Verify anon Read Access

```sql
SELECT has_table_privilege('anon', 'stories', 'SELECT');
SELECT has_table_privilege('anon', 'articles', 'SELECT');
-- Both must return TRUE
```

### Test Frontend

Verify trumpytracker.com still works with locked-down permissions.

---

## Phase 5: Key Rotation (30 min)

**JIRA:** [TTRC-316](https://ajwolfe37.atlassian.net/browse/TTRC-316)

### Key Inventory

| Location | Keys Stored |
|----------|-------------|
| GitHub Secrets | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `OPENAI_API_KEY`, `EDGE_CRON_TOKEN` |
| Supabase Edge Functions | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_API_KEY` |
| Frontend (env-aware config) | Anon key loaded from Supabase meta endpoint (no hardcoded key) |
| Netlify env vars | Verify if any keys stored here |

### Rotation Steps

1. [ ] Rotate anon key in Supabase PROD Dashboard
2. [ ] Verify frontend still works (uses meta endpoint, should auto-update)
3. [ ] Rotate service_role key in Supabase PROD Dashboard
4. [ ] Update GitHub Secrets with new service_role key
5. [ ] Update Supabase Edge Function secrets with new keys
6. [ ] Redeploy all Edge Functions to pick up new secrets
7. [ ] Smoke test everything

---

## Phase 6: Verification + Unfreeze (1 hr)

**JIRA:** [TTRC-362](https://ajwolfe37.atlassian.net/browse/TTRC-362)

### Verification

1. [ ] Test all public pages
2. [ ] Verify RSS pipeline runs clean
3. [ ] Check enrichment works (OpenAI calls)

### Unfreeze Workflows

1. [ ] `rss-tracker-prod.yml`: Uncomment cron schedule OR set `vars.PROD_RUN_ENABLED=true`
2. [ ] `job-scheduler.yml`: Verify branch guards added, THEN merge to main
3. [ ] `story-merge.yml`: Verify branch guards added, THEN merge to main

### Monitor

Monitor for 24 hours.

---

## DEFERRED: Legacy Data Import

**Do after PROD is stable (Day 2-3)**

1. [ ] Fix `title` → `headline` in import SQL (see majestic-zooming-aurora.md)
2. [ ] Run import SQL
3. [ ] Verify 717 entries imported
4. [ ] Backfill embeddings: `node scripts/backfill-embeddings.js --env=prod`

---

## Rollback Procedures

| Level | Method | How |
|-------|--------|-----|
| Netlify | Instant revert | Dashboard > Deploys > Click prior deploy > "Publish deploy" |
| Workflow Kill | Disable schedules | Comment out cron OR set `RSS_TRACKER_RUN_ENABLED: 'false'` |
| Database | Snapshot restore | Supabase Dashboard > Restore backup (created in Phase 0) |

---

## Appendix A: PROD Audit SQL

Run in Supabase PROD Dashboard before Phase 1:

```sql
-- 0) Confirm you are on PROD
SELECT current_database(), current_user;

-- 1) List existing tables
SELECT table_name,
       (SELECT COUNT(*) FROM information_schema.columns c
        WHERE c.table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 2) Check if core RSS tables exist
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'articles', 'stories', 'article_story', 'feed_registry',
  'job_queue', 'budgets', 'feed_compliance_rules',
  'political_entries', 'executive_orders'
);

-- 3) Check installed extensions
SELECT extname, extversion FROM pg_extension;

-- 4) Check existing functions/RPCs
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
ORDER BY routine_name;
```

---

## Appendix B: Files to Modify

| File | Change |
|------|--------|
| `majestic-zooming-aurora.md:152` | `title` → `headline` |
| `.github/workflows/rss-tracker-prod.yml` | Comment out `schedule:` section |
| `.github/workflows/job-scheduler.yml` | Add `if: github.ref == 'refs/heads/main'` |
| `.github/workflows/story-merge.yml` | Add `if: github.ref == 'refs/heads/main'` |

---

*Created from comprehensive QA review session 2026-01-05*
