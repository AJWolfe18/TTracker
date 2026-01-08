# JIRA Cards: Epic TTRC-180 — RSS Feed Infrastructure & Expansion

**Epic Status:** 📋 Ready for TEST Deployment
**Last Updated:** 2025-10-25
**Handoff:** `/docs/handoffs/2025-10-25-rss-v2-must-fix-consolidation.md`
**Execution Guide:** `docs/rss-deployment/RSS v2/00_START_HERE_EXECUTION_GUIDE.md`

---

## EPIC: TTRC-180 — RSS Feed Infrastructure & Expansion

**Goal:** Scale RSS ingestion from 6 feeds to 15+ feeds with per-feed tracking, health monitoring, and cost attribution.

**Current Status:**
- ✅ All must-fix items complete (schema, views, RPCs, docs)
- ✅ Documentation consolidated (6 duplicates removed)
- ✅ Smoke tests added for RPC signatures
- ✅ Monitoring views enhanced (health_status + suggested_interval)
- ✅ Cost model centralized
- ⏳ Ready for TEST deployment (next session)

**Business Value:**
- Track which feeds provide most valuable content
- Identify and disable underperforming feeds
- Budget protection via per-feed cost attribution
- Foundation to scale to 15+ feeds safely

---

## STORY BREAKDOWN

### TTRC-181 — Apply Schema Foundation (Migration 027) ⏳ READY

**Priority:** P0 (Blocker for all other stories)
**Effort:** 2 story points
**Risk:** ⚠️ MEDIUM (schema changes, but idempotent and reversible)

**Description:**
Add feed_id columns to articles and job_queue tables, create metrics/errors/compliance tables, add tracking columns to feed_registry.

**Tasks:**
1. Run pre-flight checks (01_PRE_FLIGHT_CHECKLIST.md sections 1-15)
2. Execute Migration 027 (02_MIGRATION_027_SCHEMA.sql)
3. Verify schema changes applied correctly
4. Confirm blocking index dropped
5. Verify foreign keys use ON DELETE SET NULL

**Acceptance Criteria:**
- ✅ articles.feed_id column exists (BIGINT, nullable)
- ✅ job_queue.feed_id column exists (BIGINT, nullable)
- ✅ feed_metrics table created (metric_date, feed_id PK)
- ✅ feed_errors table created (id BIGSERIAL PK)
- ✅ feed_compliance_rules table created (feed_id PK)
- ✅ feed_registry has: last_response_time_ms, consecutive_successes, failure_count
- ✅ Full-table unique index job_queue_type_payload_hash_key DROPPED
- ✅ Partial unique index ux_job_queue_payload_hash_active EXISTS
- ✅ All verification queries pass (see migration output)

**Dependencies:** None
**Blocks:** All other stories

**Documentation:**
- Migration file: `02_MIGRATION_027_SCHEMA.sql`
- Runtime notes: Deno architecture warnings (lines 12-18)
- Rollback: `08_rollback_procedures.sql` (if needed)

---

### TTRC-181.1 — Backfill Article→Feed Mappings ⏳ READY

**Priority:** P0 (Part of TTRC-181, but separate step)
**Effort:** 1 story point
**Risk:** ⚠️ MEDIUM (requires manual review before applying)

**Description:**
Map existing 377 articles to their source feeds using base domain matching. Target: 95% coverage.

**Tasks:**
1. Execute backfill STEP 1 (generate mappings in staging table)
2. **CRITICAL:** Review backfill STEP 2 (manual verification - DO NOT SKIP)
3. Verify ~95% coverage, ~18 unmapped (test data)
4. Check multi-mapping query returns ZERO rows
5. Execute backfill STEP 3 (apply UPDATE)

**Acceptance Criteria:**
- ✅ ~359 articles mapped to feeds (95% coverage)
- ✅ ~18 articles unmapped (test/example URLs acceptable)
- ✅ Multi-mapping query returns 0 rows (no URL claimed by multiple feeds)
- ✅ Sample mappings show correct domain matches (nytimes.com → NYT feed)
- ✅ All verification queries in STEP 4 pass

**Dependencies:** TTRC-181 (schema foundation must complete first)
**Blocks:** TTRC-182 (RPCs need articles mapped for testing)

**Documentation:**
- Backfill script: `03_backfill_articles_feed_id.sql`
- Subdomain stripping: www., rss., feeds., m., amp.

**⚠️ CRITICAL NOTE:** Must review staging table before applying UPDATE. See execution guide section 2.2.

---

### TTRC-182 — Metrics RPCs & Enqueue Overload (Migration 028) ⏳ READY

**Priority:** P0 (Required for Edge Function integration)
**Effort:** 1 story point
**Risk:** ✅ LOW (backward compatible, has smoke tests)

**Description:**
Create metrics tracking RPCs (record_feed_success, record_feed_not_modified, record_feed_error) and add new 5-arg enqueue_fetch_job signature while maintaining 3-arg backward compatibility.

**Tasks:**
1. Execute Migration 028 (04_migration_028_rpcs.sql)
2. Verify smoke tests pass (check output for ✅ marks)
3. Run post-migration RPC signature verification (01 section 16)
4. Manually test both signatures
5. Confirm legacy callers still work (3-arg signature)

**Acceptance Criteria:**
- ✅ 5 metrics RPCs created: _ensure_today_metrics, record_feed_success, record_feed_not_modified, record_feed_error
- ✅ New 5-arg enqueue_fetch_job exists: (p_feed_id, p_job_type, p_payload, p_run_at, p_payload_hash)
- ✅ Legacy 3-arg enqueue_fetch_job exists: (p_type, p_payload, p_hash)
- ✅ Legacy wrapper delegates to new 5-arg version correctly
- ✅ Smoke tests pass with detailed output
- ✅ Manual test of both signatures succeeds

**Dependencies:** TTRC-181, TTRC-181.1 (schema + backfill)
**Blocks:** TTRC-185 (Edge Function needs new RPC signatures)

**Documentation:**
- Migration file: `04_migration_028_rpcs.sql`
- Smoke tests: Lines 102-166
- RPC reference: `12_rpc_api_reference.md`

---

### TTRC-183 — Monitoring Views with Health Status (Migration 029) ⏳ READY

**Priority:** P0 (Required for operations monitoring)
**Effort:** 2 story points
**Risk:** ✅ LOW (read-only views, no data changes)

**Description:**
Create 3 admin views: feed_health_overview (with health_status), feed_activity_hints (with suggested_interval), feed_cost_attribution. Grant SELECT to authenticated role.

**Tasks:**
1. Execute Migration 029 (05_migration_029_views.sql)
2. Verify all 3 views created
3. Run view grants verification (01 section 17)
4. Run view field verification (01 section 18)
5. Query each view to confirm data returns without errors

**Acceptance Criteria:**
- ✅ admin.feed_health_overview created with columns:
  - feed_id, feed_name, is_active
  - articles_24h, success_fetches_24h, errors_24h, fetches_24h
  - error_rate_24h (numeric)
  - **health_status (text: HEALTHY/DEGRADED/CRITICAL/INACTIVE)**
- ✅ admin.feed_activity_hints created with columns:
  - feed_id, feed_name, is_active
  - consecutive_successes, failure_count, articles_24h
  - not_modified_24h, fetches_24h, last_run_at
  - **suggested_interval_seconds (integer: 1800-21600)**
  - **suggested_interval_human (text: "30 minutes" to "6 hours")**
- ✅ admin.feed_cost_attribution created with columns:
  - feed_id, feed_name, articles_24h, fetches_24h
  - total_cost_24h_usd, projected_cost_month_usd
- ✅ GRANT SELECT to authenticated role for all 3 views
- ✅ All view queries return data without errors

**Dependencies:** TTRC-181, TTRC-182 (schema + metrics RPCs)
**Blocks:** TTRC-186 (verification needs views)

**Documentation:**
- Migration file: `05_migration_029_views.sql`
- Health status logic: Lines 41-52
- Adaptive polling logic: Lines 93-124
- Cost model constants: `00_EXECUTIVE_SUMMARY.md` lines 160-182

---

### TTRC-184 — Seed Compliance Rules ⏳ READY

**Priority:** P1 (Required for legal compliance)
**Effort:** 0.5 story points
**Risk:** ✅ LOW (simple INSERT with conflict handling)

**Description:**
Populate feed_compliance_rules table with excerpt limits (1200 chars default) for all 6 existing feeds.

**Tasks:**
1. Execute compliance seed (06_seed_compliance_rules.sql)
2. Verify all 6 feeds have compliance rules
3. Check default settings (allow_full_text=FALSE, max_chars=1200)
4. Confirm Test Feed (ID 6) allows full text for development

**Acceptance Criteria:**
- ✅ 6 rows inserted into feed_compliance_rules (one per active feed)
- ✅ Feeds 1-5: allow_full_text=FALSE, max_chars=1200
- ✅ Feed 6 (Test): allow_full_text=TRUE, max_chars=0
- ✅ ON CONFLICT DO UPDATE handles re-runs correctly

**Dependencies:** TTRC-181 (feed_compliance_rules table must exist)
**Blocks:** None (can run in parallel with others)

**Documentation:**
- Seed script: `06_seed_compliance_rules.sql`
- Copyright notes: Lines 21-27

---

### TTRC-186 — Post-Deployment Verification ⏳ READY

**Priority:** P0 (Must confirm deployment success)
**Effort:** 1 story point
**Risk:** ✅ LOW (read-only verification queries)

**Description:**
Run comprehensive verification script (50+ checks) to confirm all migrations applied correctly, views work, grants exist, and system is healthy.

**Tasks:**
1. Execute verification script (07_post_deployment_verification.sql)
2. Review all 7 sections of output
3. Confirm all ✓ success indicators
4. Investigate any ⚠️ warnings
5. STOP if any 🛑 critical issues

**Acceptance Criteria:**
- ✅ All schema checks show ✓
- ✅ All table/column/index counts match expected
- ✅ Backfill coverage ~95% (359/377 articles mapped)
- ✅ All active feeds have compliance rules
- ✅ Health dashboard queries return data
- ✅ Integration tests pass (metrics recording + job enqueuing)
- ✅ No critical issues (blocking index, missing grants, over budget)

**Dependencies:** TTRC-181, 181.1, 182, 183, 184 (all migrations)
**Blocks:** TTRC-185, 188 (must verify before next phases)

**Documentation:**
- Verification script: `07_post_deployment_verification.sql`
- Troubleshooting: `15_troubleshooting_faq.md`

---

### TTRC-185 — Edge Function Update (Deno Worker) ⏸️ DEFERRED

**Priority:** P1 (Required for full functionality)
**Effort:** 5 story points
**Risk:** ⚠️ MEDIUM (requires Deno runtime testing)

**Status:** ⏸️ Deferred until after TTRC-186 verification complete

**Description:**
Update Supabase Edge Function (Deno runtime) to use new 5-arg enqueue_fetch_job signature, call metrics RPCs, and schedule using p_run_at parameter from feed_activity_hints view.

**Tasks:**
1. Review current Edge Function code (11_edge_function_handler_deno.ts)
2. Update to use new enqueue_fetch_job(feed_id, job_type, payload, run_at, hash)
3. Add metrics RPC calls:
   - record_feed_success(feed_id, duration_ms) on 200 OK
   - record_feed_not_modified(feed_id, duration_ms) on 304
   - record_feed_error(feed_id, error_message) on errors
4. Query feed_activity_hints for suggested_interval_seconds
5. Schedule next run using p_run_at parameter
6. Test locally with Deno CLI
7. Deploy to TEST Edge Function
8. Verify new jobs show feed_id and scheduled run_at

**Acceptance Criteria:**
- ✅ Handler uses 5-arg enqueue_fetch_job signature
- ✅ Metrics RPCs called for all fetch outcomes (success/304/error)
- ✅ New jobs in job_queue show feed_id populated
- ✅ New jobs scheduled at run_at (not immediate)
- ✅ Scheduler queries feed_activity_hints for intervals
- ✅ No Node.js dependencies used (Deno-only)
- ✅ Handler deployed to TEST Edge Function successfully

**Dependencies:** TTRC-182, TTRC-183 (needs RPCs + views)
**Blocks:** TTRC-188 (need working scheduler for feed expansion)

**Documentation:**
- Handler template: `11_edge_function_handler_deno.ts`
- Runtime warnings: `02_MIGRATION_027_SCHEMA.sql` lines 12-18
- RPC reference: `12_rpc_api_reference.md`

**⚠️ NOTE:** Exponential backoff logic exists in views but scheduler must implement it.

---

### TTRC-187 — Alert Configuration (IFTTT Email) ⏸️ DEFERRED

**Priority:** P2 (Nice-to-have for initial launch)
**Effort:** 2 story points
**Risk:** ✅ LOW (existing IFTTT setup, just needs integration)

**Status:** ⏸️ Deferred to Phase 4 (post-stabilization)

**Description:**
Configure email alerts via IFTTT webhook when feeds reach CRITICAL health status or error rates exceed thresholds.

**Tasks:**
1. Set IFTTT_WEBHOOK_KEY environment variable
2. Add deliverAlertIFTTT() function to Edge Function
3. Check health_status in feed_health_overview
4. Send alert if health_status = 'CRITICAL'
5. Test alert delivery with manual trigger
6. Document alert format and thresholds

**Acceptance Criteria:**
- ✅ IFTTT webhook configured in Supabase environment
- ✅ Alerts sent when health_status = 'CRITICAL'
- ✅ Alerts sent when error_rate_24h > 50%
- ✅ Alert email received with feed details
- ✅ Alert throttling (max 1/hour per feed)

**Dependencies:** TTRC-183 (needs feed_health_overview)
**Blocks:** None (optional enhancement)

**Documentation:**
- Alert config: `14_alerts_email_ifttt.md`
- Future enhancement: Slack webhooks (`16_FUTURE_ENHANCEMENTS.md` section 3)

**⚠️ NOTE:** Slack webhooks recommended over IFTTT for Phase 4.

---

### TTRC-188 — Add First 2 New Feeds (Phase 3) ⏸️ DEFERRED

**Priority:** P1 (First expansion test)
**Effort:** 3 story points
**Risk:** ⚠️ MEDIUM (validates system scales correctly)

**Status:** ⏸️ Deferred until 48h after TTRC-186 verification

**Description:**
Add 2 high-quality news feeds (Christian Science Monitor, Time), configure compliance rules, monitor for 48 hours to validate system stability before larger expansion.

**Tasks:**
1. Research feed URLs and validate RSS format
2. INSERT into feed_registry (tier 2)
3. INSERT compliance rules (excerpt only, 1200 chars)
4. Manually trigger initial fetch
5. Monitor feed_health_overview for 48 hours
6. Check error_rate_24h < 3%
7. Verify clustering quality maintained
8. Confirm cost projection stays under budget

**Acceptance Criteria:**
- ✅ 2 new feeds added to feed_registry (is_active=TRUE)
- ✅ Compliance rules configured for both
- ✅ Articles successfully ingested (>5 per feed in 24h)
- ✅ health_status = 'HEALTHY' after 48h
- ✅ error_rate_24h < 3% for both feeds
- ✅ Story clustering still works correctly
- ✅ Cost projection remains <$40/month

**Dependencies:** TTRC-185, TTRC-186 (need working scheduler + verification)
**Blocks:** TTRC-189 (larger expansion)

**Documentation:**
- Feed addition guide: `09_operations_runbook.md` section 4
- Monitoring queries: `09_operations_runbook.md` section 2

---

### TTRC-189 — Full Feed Expansion to 15 Feeds ⏸️ DEFERRED

**Priority:** P1 (Final expansion target)
**Effort:** 5 story points
**Risk:** ⚠️ MEDIUM (validates system at scale)

**Status:** ⏸️ Deferred until after TTRC-188 validates stability

**Description:**
Add 8-10 additional feeds (reaching 15 total) in batches of 3-5 per week, monitoring stability after each batch.

**Tasks:**
1. Select 8-10 high-quality news sources (tier 2-3)
2. Add 3-5 feeds per week (batched expansion)
3. Monitor stability after each batch (24-48h)
4. Validate clustering quality maintained
5. Confirm cost stays within $50/month budget
6. Disable any underperforming feeds (error_rate > 10%)
7. Final validation at 15 feeds

**Acceptance Criteria:**
- ✅ 15 total feeds operational (up from 6)
- ✅ All feeds have compliance rules configured
- ✅ Average health_status = 'HEALTHY' or 'INACTIVE'
- ✅ System error_rate < 5% across all feeds
- ✅ Cost projection <$50/month (with headroom)
- ✅ Story clustering quality >85%
- ✅ No performance degradation

**Dependencies:** TTRC-188 (Phase 3 must validate stability)
**Blocks:** None (final expansion phase)

**Documentation:**
- Operations runbook: `09_operations_runbook.md`
- Cost monitoring: Query admin.feed_cost_attribution daily

---

## PHASE 4: Future Enhancements ⏸️ DEFERRED

See `16_FUTURE_ENHANCEMENTS.md` for detailed documentation.

**Potential Stories (not prioritized):**
- Implement exponential backoff in scheduler (partially in views)
- Add per-feed daily fetch caps (budget protection)
- Replace IFTTT with Slack webhook alerts
- Create cost model configuration table
- Build feed health dashboards (UI)
- Implement intelligent feed discovery

**Total estimated effort:** 66 hours (~2 weeks)
**Priority:** LOW (defer until >20 feeds operational)

---

## COMMON TASKS (All Stories)

- Update operations runbook with any deltas
- File follow-up tickets for anomalies
- Create handoff document at end of each phase
- Update JIRA cards with actual completion dates
- Monitor cost daily during first week

---

## EXECUTION ORDER

**Phase 1: Foundation (Next Session - 30 minutes)**
1. TTRC-181 (Schema)
2. TTRC-181.1 (Backfill)
3. TTRC-182 (RPCs)
4. TTRC-183 (Views)
5. TTRC-184 (Compliance)
6. TTRC-186 (Verification)

**Phase 2: Integration (Week 1 - 8 hours)**
7. TTRC-185 (Edge Function)
8. TTRC-187 (Alerts - optional)

**Phase 3: Expansion (Week 2 - 4 hours)**
9. TTRC-188 (Add 2 feeds)
10. TTRC-189 (Expand to 15 feeds)

**Phase 4: Enhancements (Future - 66 hours)**
- See `16_FUTURE_ENHANCEMENTS.md`

---

## SUCCESS METRICS

**Deployment Success (Phase 1):**
- All verification checks pass (07 script)
- Zero critical issues
- Cost projection <$50/month

**Integration Success (Phase 2):**
- New jobs show feed_id populated
- Metrics RPCs recording data
- Scheduler using suggested_interval

**Expansion Success (Phase 3):**
- 15 feeds operational
- <5% error rate system-wide
- Cost <$50/month
- Clustering quality >85%

---

**Last Updated:** 2025-10-25
**Owner:** Josh (PM)
**Epic Link:** https://ajwolfe37.atlassian.net/browse/TTRC-180
