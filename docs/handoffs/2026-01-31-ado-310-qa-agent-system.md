# 2026-01-31: ADO-310 SCOTUS QA Agent Batch Processing System

## Summary

ADO-310 Phase 0-2 complete: Implemented batch processing infrastructure for SCOTUS QA. This includes database tables for revision history, overrides, batches, and items; Edge Functions for orchestration; and a Node worker for actual QA execution. Committed `f2ab08d`, pushed to test. **Migrations and Edge Functions require manual deployment.**

## What Was Done

**Phase 0 - Database Migrations (076-079):**
- `076_content_revisions.sql`: Revision history with `add_content_revision_scotus` RPC
- `077_qa_gold_examples.sql`: Gold set table for future RAG training
- `078_qa_overrides.sql`: Admin override log
- `079_qa_batches.sql`: Batch + items with `qa_claim_pending_batch_items` RPC (SKIP LOCKED)

**Phase 1-2 - Edge Functions (orchestration only, no OpenAI):**
- `qa-run`: POST creates single job, GET polls for result
- `qa-history`: GET revision history for a case
- `qa-override`: POST admin verdict override
- `qa-batch`: POST creates batch from filter, GET returns status with computed cost

**Phase 2 - Node Worker:**
- `scripts/qa/process-batch.js`: Claims items, runs Layer A+B QA, updates items
- `.github/workflows/qa-worker.yml`: Runs every 10 min on test branch

**Code Review Fixes Applied:**
- Fixed COUNT query pattern in `checkBatchCompletion` (was using `data.length` instead of `count`)
- Added batch status validation to prevent overwriting cancelled batches
- Standardized `x-admin-id` default to 'system' across functions
- Added `x-admin-id` to CORS allowed headers
- Added header documentation to all Edge Functions

## Manual Setup Required

1. **Apply migrations 076-079** via Supabase SQL Editor (TEST first)
2. **Set `ADMIN_API_KEY`** secret in Supabase Edge Function environment
3. **Deploy Edge Functions:**
   ```bash
   supabase functions deploy qa-run --project-ref wnrjrywpcadwutfykflu
   supabase functions deploy qa-history --project-ref wnrjrywpcadwutfykflu
   supabase functions deploy qa-override --project-ref wnrjrywpcadwutfykflu
   supabase functions deploy qa-batch --project-ref wnrjrywpcadwutfykflu
   ```

## Testing Edge Functions

```bash
# Create single QA job
curl -X POST "$SUPABASE_TEST_URL/functions/v1/qa-run" \
  -H "x-api-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content_type":"scotus_case","content_id":230}'

# Poll for result
curl "$SUPABASE_TEST_URL/functions/v1/qa-run?job_id=<job_id>" \
  -H "x-api-key: $ADMIN_API_KEY"

# Trigger worker manually
gh workflow run "QA Worker" --ref test
```

## Next Steps

1. Apply migrations to TEST database
2. Set ADMIN_API_KEY in Supabase Edge Function env
3. Deploy Edge Functions
4. Test single-case flow: POST /qa-run → worker processes → GET /qa-run
5. **Phase 3 (ADO-310-7, ADO-310-8):** Dashboard UI for QA tab
6. **Phase 4 (ADO-310-9):** Gold set + RAG for few-shot learning

## Commits

- `f2ab08d` feat(ado-310): add SCOTUS QA Agent batch processing system
