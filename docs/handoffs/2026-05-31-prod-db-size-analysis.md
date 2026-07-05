# Handoff: PROD DB Size Analysis
**Date:** 2026-05-31  
**Session type:** Research/analysis — no code changes

## What Was Done

Analyzed PROD Supabase database at 570MB over the 500MB free-tier cap. Ran diagnostic queries directly in PROD SQL Editor to get real numbers.

## Key Findings

### Dead tuple bloat (low)
- stories: 10.1% dead (10,373 live) — 190 MB total
- articles: 5.4% dead (14,840 live) — 257 MB total
- VACUUM FULL on both tables saves ~15-20 MB

### pipeline_skips (minimal cleanup potential)
- 24,536 rows, but **all from May 2026** (oldest: May 1)
- Only 377 rows older than 30 days — ~0.2 MB savings
- Table grows fast from pipeline runs; truncating old rows won't help much

### Unused dead-code indexes (~11 MB)
34 indexes with `idx_scan = 0` confirmed as dead code (not low-traffic — active indexes have 100K+ scans). Safe to drop:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_pipeline_skips_pipeline_reason;
DROP INDEX CONCURRENTLY IF EXISTS idx_articles_url_hash;
DROP INDEX CONCURRENTLY IF EXISTS ix_articles_entities_gin;
DROP INDEX CONCURRENTLY IF EXISTS idx_articles_topic_slug;
DROP INDEX CONCURRENTLY IF EXISTS idx_articles_published_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_political_entries_search;
DROP INDEX CONCURRENTLY IF EXISTS idx_executive_orders_search;
DROP INDEX CONCURRENTLY IF EXISTS idx_pardons_search;
DROP INDEX CONCURRENTLY IF EXISTS ix_stories_primary_actor;
DROP INDEX CONCURRENTLY IF EXISTS ix_stories_lifecycle_state;
DROP INDEX CONCURRENTLY IF EXISTS idx_stories_search_vector;
DROP INDEX CONCURRENTLY IF EXISTS ix_articles_quote_hashes_gin;
DROP INDEX CONCURRENTLY IF EXISTS ix_articles_keyphrases_gin;
DROP INDEX CONCURRENTLY IF EXISTS ix_articles_url_canonical;
DROP INDEX CONCURRENTLY IF EXISTS idx_articles_guid;
DROP INDEX CONCURRENTLY IF EXISTS idx_job_queue_type_hash;
DROP INDEX CONCURRENTLY IF EXISTS idx_political_entries_actor;
DROP INDEX CONCURRENTLY IF EXISTS idx_eo_policy_areas_gin;
DROP INDEX CONCURRENTLY IF EXISTS idx_eo_agencies_gin;
DROP INDEX CONCURRENTLY IF EXISTS idx_eo_regions_gin;
DROP INDEX CONCURRENTLY IF EXISTS idx_eo_category;
DROP INDEX CONCURRENTLY IF EXISTS idx_pardons_research_status_prompt;
DROP INDEX CONCURRENTLY IF EXISTS idx_pardons_recipient_type;
DROP INDEX CONCURRENTLY IF EXISTS idx_pardons_crime_category;
DROP INDEX CONCURRENTLY IF EXISTS idx_pardons_connection_type;
DROP INDEX CONCURRENTLY IF EXISTS idx_stories_enrichment_status;
DROP INDEX CONCURRENTLY IF EXISTS idx_scotus_cases_merits_null;
DROP INDEX CONCURRENTLY IF EXISTS idx_scotus_drift;
DROP INDEX CONCURRENTLY IF EXISTS idx_scotus_cases_qa_flagged;
DROP INDEX CONCURRENTLY IF EXISTS idx_feeds_tier;
DROP INDEX CONCURRENTLY IF EXISTS idx_feeds_active;
DROP INDEX CONCURRENTLY IF EXISTS idx_pardon_research_costs_pardon_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_pardon_research_costs_run_id;
DROP INDEX CONCURRENTLY IF EXISTS idx_pardon_enrichment_costs_pardon_id;
```

`CONCURRENTLY` = no table locks, safe on live PROD.

### The math
| Action | Savings |
|--------|---------|
| Drop unused indexes | ~11 MB |
| VACUUM FULL stories + articles | ~15-20 MB |
| pipeline_skips cleanup | ~0.2 MB |
| **Total** | **~26 MB** |

**Still leaves ~544 MB — over the 500 MB cap.** Cleanup alone doesn't solve it.

## Real Solutions

### Option 1: Mercury bank (recommended — free, fastest)
Open a free Mercury business bank account → claim $300 in Supabase credits via perks page.  
**= 12 months of Pro at $0.** No rebate, no special status, no gimmicks.  
URL: mercury.com/perks/supabase

### Option 2: Annual billing
$20.83/month (17% off). No eligibility requirements. Contact Supabase support to enable.

### Option 3: Nonprofit discount (40-80% off)
Requires 501(c)(3) status. ~$5-15/month if eligible.

## Do NOT Touch
- `ix_articles_emb_v1_hnsw` (113 MB) and `ix_stories_centroid_emb_v1_hnsw` (82 MB) — these power vector search
- `stories_story_hash_key` — unique constraint enforcing story dedup
- Any `uq_*`, `ux_*`, or `_pkey` indexes — constraint enforcement

## Next Steps
- Josh decides: Mercury credits (fastest) vs annual billing vs just upgrade to Pro
- If index drops: paste the SQL above into PROD SQL Editor, run as-is
