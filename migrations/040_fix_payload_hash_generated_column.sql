-- Migration 040: Fix payload_hash generated column
-- Fixes: payload_hash was NULL because sha256() requires pgcrypto and isn't immutable
-- Solution: Use md5() which is built-in and immutable

-- Enable pgcrypto (may already exist, safe to run)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Recreate payload_hash column using md5 (immutable)
ALTER TABLE job_queue DROP COLUMN IF EXISTS payload_hash;
ALTER TABLE job_queue ADD COLUMN payload_hash TEXT
  GENERATED ALWAYS AS (md5(payload::text)) STORED;

-- Clean up any existing duplicates before creating index
DELETE FROM job_queue
WHERE id NOT IN (
  SELECT MIN(id)
  FROM job_queue
  WHERE processed_at IS NULL
  GROUP BY job_type, payload_hash
)
AND processed_at IS NULL;

-- Recreate the partial unique index
DROP INDEX IF EXISTS ux_job_queue_payload_hash_active;
CREATE UNIQUE INDEX ux_job_queue_payload_hash_active
  ON job_queue (job_type, payload_hash)
  WHERE processed_at IS NULL;

-- Verification
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM job_queue WHERE payload_hash IS NOT NULL;
  RAISE NOTICE 'Migration 040 complete: % jobs now have payload_hash', v_count;
END $$;
