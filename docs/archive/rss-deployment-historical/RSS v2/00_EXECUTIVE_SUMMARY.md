# RSS Feed Expansion - Executive Summary

**Date:** October 25, 2025  
**Status:** Ready for TEST Execution  
**Epic:** TTRC-180 RSS Feed Infrastructure & Expansion  
**Timeline:** 2-3 hours (migrations) + 2 weeks (monitoring)  
**Budget Impact:** +$1.31/month (well within $50 limit)  
**Environment:** TEST (branch)

---

## WHAT WE'RE DOING

Adding feed-level tracking infrastructure to support scaling from 6 feeds to 15+ feeds while maintaining cost control and reliability monitoring.

### Current State (TEST)
- 6 RSS feeds active (Reuters, AP, NYT, WaPo, Politico, Test)
- 377 articles total
- ~62 articles/day ingestion rate
- Job queue processing operational
- NO feed-level metrics or tracking
- NO per-feed compliance rules
- NO health monitoring

### Target State
- ✅ Feed-level attribution (which feed sourced each article)
- ✅ Per-feed metrics (success rate, error rate, fetch frequency)
- ✅ Compliance rules (per-feed content limits for copyright)
- ✅ Health monitoring dashboards
- ✅ Cost attribution by feed
- ✅ Foundation to safely add 10-15 more feeds

---

## WHY THIS MATTERS

### Business Impact
1. **Cost Control:** See which feeds cost most to process → optimize spending
2. **Reliability:** Real-time health monitoring → catch issues before users notice
3. **Compliance:** Per-feed content limits → respect copyright/ToS
4. **Scalability:** Safe foundation → add feeds without breaking system
5. **Quality:** Track source performance → disable underperforming feeds

### Technical Impact
1. **Attribution:** Every article/job now links to source feed
2. **Metrics:** Daily rollups track fetch success/error rates
3. **Monitoring:** Two admin views for operations dashboard
4. **Adaptive:** Scheduler can adjust polling based on feed activity

---

## WHAT'S CHANGING

### Schema Changes (Migration 027)
```
✅ articles.feed_id        → Track which feed sourced article
✅ job_queue.feed_id       → Track which feed owns job
✅ feed_registry columns   → Add last_response_time_ms, consecutive_successes, failure_count
✅ feed_metrics table      → Daily rollup: fetches, successes, errors, 304s
✅ feed_errors table       → Error log (30-day retention)
✅ feed_compliance_rules   → Per-feed content limits
✅ 7 new indexes           → Performance + legacy tracking
✅ 1 trigger               → Auto-sync payload->column during transition
```

### New RPCs (Migration 028)
```
✅ record_feed_success()        → Increment success metrics
✅ record_feed_not_modified()   → Track 304 responses
✅ record_feed_error()          → Log errors + increment failure_count
✅ enqueue_fetch_job() V2       → Add feed_id + scheduled run_at
✅ enqueue_fetch_job() V1       → Keep old signature (backward compat)
```

### New Views (Migration 029)
```
✅ admin.feed_health_overview   → 24h metrics: articles, errors, fetches
✅ admin.feed_activity_hints    → Scheduler inputs: 304 streak, activity level
```

### Backfill
```
✅ Map 377 existing articles to feeds by domain matching
✅ Expected: ~359 mapped (95%), ~18 unmapped (test/example URLs)
```

---

## WHAT'S NOT CHANGING

- ✅ **No breaking changes** to existing Edge Functions
- ✅ **Backward compatible** job enqueuing (3-arg signature still works)
- ✅ **No downtime** required
- ✅ **Existing articles** remain intact (just add feed_id)
- ✅ **Story clustering** unaffected
- ✅ **Frontend** unaffected (this is backend-only)

---

## RISK ASSESSMENT

### LOW RISK ✅
- All migrations are idempotent (IF NOT EXISTS)
- Foreign keys use ON DELETE SET NULL (safe deletions)
- Backfill has 3-step review process before applying
- Backward-compatible RPC overloading
- Full rollback script provided

### MITIGATIONS
- **Test environment first** → Validate before PROD
- **Phased rollout** → Add 2 feeds, monitor 48h, then add more
- **Circuit breakers** → Auto-disable feeds after 7 days failures
- **Budget alerts** → Stop at 80/90/100% of $50/month cap
- **Monitoring** → Health dashboards + error logs

---

## SUCCESS CRITERIA

### Day 1 (Post-Migration)
- [ ] Migrations applied successfully (no errors)
- [ ] 359/377 articles mapped to feeds (95% coverage)
- [ ] Health views return data
- [ ] No system errors or downtime

### Week 1 (Post-Rollout)
- [ ] 2 new feeds added and stable
- [ ] >80% fetch success rate
- [ ] <3% error rate
- [ ] Cost tracking accurate
- [ ] Zero clustering regressions

### Week 2 (Full Expansion)
- [ ] 5+ additional feeds operational
- [ ] System stable at scale
- [ ] Cost remains <$50/month
- [ ] Quality metrics maintained

---

## COST ANALYSIS

### Current Monthly Cost: ~$35
- OpenAI embeddings: $0.72/mo (120 articles/day × $0.0002)
- Story clustering: $0.54/mo (120 articles/day × $0.00015)
- Story enrichment: $0.05/mo (10 stories/day × $0.000167)
- Supabase: Free tier
- Netlify: Free tier

### Additional Cost (10-15 feeds): ~$1.31/mo
- RSS fetching: $0/mo (included in Supabase free tier)
- Additional embeddings: +$0.72/mo (2x articles)
- Additional clustering: +$0.54/mo (2x articles)
- Additional enrichment: +$0.05/mo (2x stories)

### **New Total: ~$36.31/month** (72% below $50 cap)

**Verdict:** Massive headroom. RSS expansion is NOT a cost risk.

### Cost Model Constants

**Centralized for reference across SQL views and documentation:**

```
Per-article costs (inputs to admin.feed_cost_attribution view):
- OpenAI embeddings:    $0.0002  per article
- Story clustering:     $0.00015 per article
- Story enrichment:     $0.000167 per story (allocated proportionally)
---
TOTAL PER ARTICLE:      $0.00035

Per-feed costs:
- RSS fetching:         $0       (Supabase Edge Functions free tier)
- Supabase DB:          $0       (free tier, <500MB storage)
- Netlify hosting:      $0       (free tier, <100GB bandwidth)
```

**Referenced in:**
- `05_migration_029_views.sql` → admin.feed_cost_attribution view
- Job queue worker cost tracking (future)
- Budget alert thresholds (future)

---

## DEPENDENCIES

### Prerequisites (Already Complete)
- ✅ Existing RSS pipeline operational
- ✅ Job queue system working
- ✅ Story clustering active
- ✅ Partial unique index exists (ux_job_queue_payload_hash_active)

### Required for This Work
- [ ] Supabase SQL Editor access (TEST)
- [ ] GitHub Desktop (for Edge Function updates later)
- [ ] 2-3 hours for migration execution

### Phase 2 (Deferred)
- ⏸️ Slack webhook setup (alerts)
- ⏸️ Edge Function updates (use new feed_id architecture)
- ⏸️ Feed expansion (add 10-15 new sources)

---

## ROLLOUT PLAN

### Phase 1: Foundation (This Package)
**Timeline:** Today (2-3 hours)
1. Apply Migration 027 (schema)
2. Run backfill (review before applying)
3. Apply Migration 028 (RPCs)
4. Apply Migration 029 (views)
5. Seed compliance rules
6. Verify all systems green

### Phase 2: Validation
**Timeline:** Days 1-3
1. Monitor existing 6 feeds for 48-72 hours
2. Verify metrics tracking correctly
3. Confirm cost attribution accurate
4. Check health dashboards

### Phase 3: First Expansion
**Timeline:** Week 1
1. Add 2 high-quality feeds (CSM, Time)
2. Monitor for 48 hours
3. Validate clustering quality maintained
4. Check cost stays within budget

### Phase 4: Full Expansion
**Timeline:** Weeks 2-4
1. Add 3-5 feeds per week
2. Monitor stability after each batch
3. Disable any underperforming sources
4. Final validation at 15 feeds

---

## TEAM RESPONSIBILITIES

### Josh (PM/Owner)
- [ ] Review and approve this plan
- [ ] Execute migrations in TEST
- [ ] Monitor dashboards post-deployment
- [ ] Decide which feeds to add in Phase 3/4

### Claude (Implementation Partner)
- [x] Create complete handoff documentation
- [x] Provide all SQL migrations
- [x] Write verification scripts
- [x] Document rollback procedures
- [ ] Support during execution (next chat)

### Future Claude Chat (Executor)
- [ ] Read all documentation in this folder
- [ ] Execute migrations step-by-step
- [ ] Verify each step before proceeding
- [ ] Report any errors immediately
- [ ] Update JIRA tickets as work completes

---

## CRITICAL NOTES

⚠️ **DO NOT SKIP BACKFILL REVIEW** - Review article mappings before applying UPDATE

⚠️ **CHECK COST DAILY** - First week after expansion, check openai_usage table daily

⚠️ **MONITOR CLUSTERING** - If quality drops below 85%, pause expansion

⚠️ **TEST ENVIRONMENT ONLY** - Do NOT apply to PROD until validated in TEST

✅ **BACKWARD COMPATIBLE** - Old Edge Functions will continue to work

---

## NEXT STEPS

1. **Read this entire folder** (10 documents)
2. **Review JIRA cards** (updated epic structure)
3. **Execute pre-flight checks** (verify TEST readiness)
4. **Apply migrations** (follow step-by-step guide)
5. **Monitor for 48 hours** (use health dashboards)
6. **Plan Phase 3** (select first 2 feeds to add)

---

## DOCUMENT INDEX

```
00_EXECUTIVE_SUMMARY.md           ← You are here
01_PRE_FLIGHT_CHECKLIST.md        ← Run before starting
02_MIGRATION_027_SCHEMA.sql       ← Schema foundation
03_BACKFILL_SCRIPT.sql            ← Map articles to feeds
04_MIGRATION_028_RPCS.sql         ← Metric tracking functions
05_MIGRATION_029_VIEWS.sql        ← Monitoring dashboards
06_COMPLIANCE_SEED.sql            ← Configure per-feed limits
07_VERIFICATION_SCRIPTS.sql       ← Confirm success
08_ROLLBACK_PROCEDURES.sql        ← Emergency undo
09_OPERATIONS_RUNBOOK.md          ← Daily operations guide
10_UPDATED_JIRA_CARDS.md          ← New epic structure
```

**Total Reading Time:** 45 minutes  
**Execution Time:** 2-3 hours  
**Monitoring Period:** 2 weeks

---

**Questions?** Review the other documents in this folder or start a new Claude chat with context from this package.
