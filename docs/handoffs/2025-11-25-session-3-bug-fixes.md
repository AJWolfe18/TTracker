# Session Handoff - Bug Fixes

**Date:** 2025-11-25 (Session 3)
**Commit:** ca16257

---

## Completed This Session

### 1. EO Tracker - Missing November EOs
- **Status:** ✅ RESOLVED
- **Root Cause:** PROD uses 3-day lookback; TEST uses 90-day
- **Action:** Manually triggered tracker on test branch with 90-day lookback
- **Result:** 4 missing EOs now in database:
  - EO 14360: Tariffs (Agricultural) - Nov 14
  - EO 14359: Fostering Future for Children - Nov 13
  - EO 14357: China Opioid Tariffs - Nov 4
  - EO 14358: China Trade Tariffs - Nov 4

### 2. Feed `last_fetched_at` Not Updating
- **Status:** ✅ FIXED
- **Root Cause:** Column name typo - code wrote `last_fetched`, schema has `last_fetched_at`
- **Files Changed:**
  - `scripts/rss/fetch_feed.js` line 294
  - `migrations/025_feed_filter_monitoring_view.sql` line 38

### 3. QA Idempotency Test Failing
- **Status:** ✅ FIXED (pending migration application)
- **Root Cause:** Two issues:
  1. RPC used wrong ON CONFLICT syntax (constraint name vs index)
  2. RPC tried to INSERT into GENERATED ALWAYS column
- **Files Changed:**
  - `migrations/039_fix_enqueue_rpc_partial_index.sql` (NEW)
  - `scripts/tests/enqueue-idempotency.mjs`

---

## Pending Action Required

### Apply Migration 039 via Supabase Dashboard

The QA idempotency fix requires applying migration 039. Run this SQL in the Supabase SQL Editor:

```sql
-- Migration 039: Fix enqueue_fetch_job RPC
BEGIN;

CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(
  p_type    text,
  p_payload jsonb
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE v_id BIGINT;
BEGIN
  INSERT INTO public.job_queue (job_type, payload, run_at, status, attempts, max_attempts)
  VALUES (p_type, p_payload, NOW(), 'pending', 0, 5)
  ON CONFLICT (job_type, payload_hash) WHERE processed_at IS NULL DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.enqueue_fetch_job(text, jsonb) TO service_role;

DROP FUNCTION IF EXISTS public.enqueue_fetch_job(text, jsonb, text);

COMMIT;
```

After applying, run: `npm run qa:idempotency`

---

## Additional DB Fixes Applied (during session)

1. **Enable pgcrypto extension** (required for sha256)
2. **Recreate payload_hash column** using md5() (sha256 wasn't immutable)
3. **Clean up duplicate jobs** before creating unique index
4. **Fix EO enriched_at** - 3 EOs had summaries but null enriched_at

```sql
-- All applied successfully:
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE job_queue DROP COLUMN IF EXISTS payload_hash;
ALTER TABLE job_queue ADD COLUMN payload_hash TEXT
  GENERATED ALWAYS AS (md5(payload::text)) STORED;

DELETE FROM job_queue WHERE id NOT IN (
  SELECT MIN(id) FROM job_queue WHERE processed_at IS NULL
  GROUP BY job_type, payload_hash
) AND processed_at IS NULL;

CREATE UNIQUE INDEX ux_job_queue_payload_hash_active
  ON job_queue (job_type, payload_hash) WHERE processed_at IS NULL;

UPDATE executive_orders SET enriched_at = NOW()
WHERE summary IS NOT NULL AND enriched_at IS NULL;
```

---

## Verification Commands

```bash
# Check feed timestamps are updating after next RSS run
SELECT feed_url, last_fetched_at FROM feed_registry LIMIT 5;

# Check November EOs
SELECT order_number, title, date FROM executive_orders WHERE date >= '2025-11-01' ORDER BY date DESC;

# Run idempotency test (after migration)
npm run qa:idempotency
```

---

## AI Code Review
- **Run:** 19693841453
- **Status:** ✅ Passed (no blockers)

## Files Changed
| File | Change |
|------|--------|
| `scripts/rss/fetch_feed.js` | Fix `last_fetched` → `last_fetched_at` |
| `migrations/025_feed_filter_monitoring_view.sql` | Fix column name in view |
| `migrations/039_fix_enqueue_rpc_partial_index.sql` | New - fix RPC syntax |
| `scripts/tests/enqueue-idempotency.mjs` | Use RPC instead of .upsert() |
