# Project Handoff - October 3, 2025 10:45 AM CST - TTRC-148 Implementation Plan

## SESSION SUMMARY
Created comprehensive implementation plan for Story Enrichment System (TTRC-148) with corrected pricing analysis. Backfilling 82 stories will cost **3 cents** (not $12), making enrichment essentially free (~$0.73/year). Plan includes all 5 phases, security hardening, and testing strategy. Ready for immediate implementation.

---

## WHAT GOT DONE

### Planning & Analysis
**Focus:** TTRC-148 (Story Enrichment) + TTRC-137 (Queue Infrastructure) review  
**Deliverable:** Complete 4-5 hour implementation plan

**Documents Created:**
- Implementation plan added to JIRA TTRC-148 as comprehensive comment
- All 5 phases detailed with code snippets
- Cost analysis corrected (1000× pricing error fixed)
- Testing checklist and deployment steps defined

### Critical Bug Fix
**TTRC-184:** Closed ✅
- Fixed political tab schema mismatch (`added_at` → `created_at`)
- Verified all 3 query locations updated
- Ready for testing in TEST environment

### Testing Status
- ✅ **Verified:** TTRC-184 code committed to test branch
- ⏳ **Pending:** TTRC-148 implementation (no code written yet - planning only)
- ✅ **Confirmed:** TTRC-137 queue infrastructure ready for use

---

## UPDATES COMPLETED (Via Tools)

### JIRA
- **Closed:** TTRC-184 from In Progress → Done (political tab fix complete)
- **Updated:** TTRC-148 with full implementation plan (~5000 words)
  - Added corrected pricing analysis
  - Added 5 phases with code examples
  - Added category mapping (UI ↔ DB)
  - Added security hardening steps
  - Added testing & deployment checklists

### Confluence
- ⚠️ **Not Updated:** Confluence tools not available in this session
- **Action Required:** Manually update RSS implementation plan with TTRC-148 status

### Documentation
- None - plan lives in JIRA only

---

## TECHNICAL CONTEXT

### Key Decisions Made

**Decision:** Use GPT-4o-mini for enrichment (not GPT-3.5-turbo)  
**Rationale:** 
- Identical cost structure ($0.00015/$0.0006 per 1K tokens)
- Better quality outputs
- Supports JSON mode natively
**Cost Impact:** ~$0.73/year (essentially free)

**Decision:** Category mapping in code (not DB migration)  
**Rationale:** 
- Existing DB enum has underscored values
- UI shows user-friendly labels (no underscores)
- Mapping layer prevents breaking changes
**Cost Impact:** No cost impact

**Decision:** Optimistic locking for job queue (not FOR UPDATE SKIP LOCKED)  
**Rationale:** 
- PostgREST doesn't support FOR UPDATE SKIP LOCKED
- Optimistic locking pattern is sufficient
- Check `WHERE id = X AND status = 'pending'` on update
**Cost Impact:** No cost impact

### Watch Out For

- **Gotcha:** OpenAI `completion.usage` can be undefined - always use `?.` optional chaining
- **Gotcha:** Category values must be mapped UI→DB (underscores in DB, spaces in UI)
- **Dependency:** TTRC-137 queue infrastructure must be deployed before enrichment
- **Risk:** Budget soft stop ($45) might queue all jobs for tomorrow if hit early - monitor first week

### Critical Pricing Correction

**Original estimate:** $12.30 backfill, $22.50/month  
**Corrected estimate:** $0.033 backfill, $0.06/month, $0.73/year

**Reason:** Confused per-token vs per-1K-token pricing
- GPT-4o-mini: $0.15 per **1 million** tokens input
- NOT $0.15 per 1 thousand tokens
- 1000× pricing error discovered and corrected

---

## NEXT SESSION PRIORITIES

### Immediate Actions

1. **TTRC-148 Phase 1:** Implement `enrichStory()` handler (2-3 hours)
   - Most critical: get enrichment working end-to-end
   - Includes all safety checks (cooldown, budget, idempotency)
   - Test on 1 story before proceeding

2. **TTRC-148 Phase 2:** Create DB migration 008 (30 min)
   - Add indexes for performance
   - Create `increment_budget` RPC function
   - Security hardening (REVOKE/GRANT)

3. **TTRC-148 Phase 3:** Test backfill script dry-run (15 min)
   - Verify cost estimate accurate
   - Confirm job enqueuing works
   - Run real backfill on 5 stories

### Blocked/Waiting

- **TTRC-137:** Ready for Prod (GitHub Actions needs manual setup)
  - Requires GitHub Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, EDGE_CRON_TOKEN
  - Not blocking TTRC-148 (can enqueue jobs manually)

### Questions for Josh

- **Decision Required:** Should we implement automatic enrichment trigger (Phase 4) immediately, or wait to see backfill results?
- **Clarification Needed:** Priority of TTRC-137 prod deployment vs TTRC-148 implementation?

---

## ENVIRONMENT STATUS

**TEST Environment:**
- Status: Deployed
- URL: https://test--taupe-capybara-0ff2ed.netlify.app/
- Notes: TTRC-184 fix committed and deployed, political tab should work now

**PROD Environment:**
- Status: Stable (old article system still running)
- URL: https://trumpytracker.com/
- Notes: No changes in this session

**Cost:** $35/month → unchanged (enrichment adds <$1/year)

**Database:**
- TEST: Ready for migration 008 (enrichment helpers)
- PROD: No changes
- Schema: `stories` table has all required columns for enrichment

---

## COMMIT READY

**No commits needed** - this was a planning session only.

Files modified in previous session (TTRC-184):
```bash
# Already committed by Josh
git log --oneline -1
# Should show: fix: align political tab queries with schema (TTRC-184)
```

---

## IMPLEMENTATION PLAN SUMMARY

### Phase Breakdown (4-5 hours total)

1. **Phase 1:** Core enrichment handler (2-3 hours)
   - Implement `enrichStory()` in job-queue-worker.js
   - Budget checks, cooldown, article fetch
   - OpenAI call with JSON mode
   - Category mapping, cost tracking

2. **Phase 2:** Database helpers (30 min)
   - Migration 008: indexes + RPC + security
   - Helper functions: `generatePayloadHash`, `enqueueJob`

3. **Phase 3:** Backfill script (1 hour)
   - Query stories missing summaries
   - Enqueue with 2s delays
   - Batch processing (10 at a time)

4. **Phase 4:** Auto-trigger (30 min)
   - Enqueue on story creation
   - Enqueue on status change (closed→active)
   - Optional: trigger on article count increase

5. **Phase 5:** Frontend polish (30 min)
   - Modal deduplication check
   - AI badge display
   - Summary fallback chain
   - Error vs no-sources states

### Cost Reality

| Metric | Value |
|--------|-------|
| Per story | $0.000405 |
| Backfill (82) | $0.033 |
| Monthly (150) | $0.06 |
| **Yearly** | **$0.73** |

---

_Created: 2025-10-03T15:45:00Z_  
_Environment: TEST_  
_Session Duration: ~2 hours_  
_Token Usage: 158K/190K (83%)_