-- 079_qa_batches.sql
-- SCOTUS-only batch tracking + items + claim function (SKIP LOCKED)

BEGIN;

CREATE TABLE IF NOT EXISTS public.qa_batches (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  content_type TEXT NOT NULL DEFAULT 'scotus_case',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  filter_criteria JSONB NOT NULL DEFAULT '{}',
  options JSONB NOT NULL DEFAULT '{}',
  total_items INTEGER NOT NULL DEFAULT 0,
  total_cost_usd NUMERIC(10,6) DEFAULT 0,
  initiated_by TEXT NOT NULL DEFAULT 'system',

  CONSTRAINT qa_batches_scotus_only CHECK (content_type = 'scotus_case'),
  CONSTRAINT qa_batches_status CHECK (status IN ('pending','running','completed','failed','cancelled'))
);

CREATE TABLE IF NOT EXISTS public.qa_batch_items (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES public.qa_batches(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'scotus_case',
  content_id BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  options JSONB NOT NULL DEFAULT '{}',

  input_hash TEXT,
  prompt_version TEXT,
  model TEXT,

  qa_verdict TEXT,
  qa_issues JSONB,
  error_message TEXT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  latency_ms INTEGER,
  cost_usd NUMERIC(10,6),

  CONSTRAINT qa_batch_items_scotus_only CHECK (content_type = 'scotus_case'),
  CONSTRAINT qa_batch_items_status CHECK (status IN ('pending','processing','completed','error','skipped')),
  CONSTRAINT qa_batch_items_verdict CHECK (qa_verdict IS NULL OR qa_verdict IN ('APPROVE','FLAG','REJECT'))
);

CREATE INDEX IF NOT EXISTS idx_qa_batches_status
  ON public.qa_batches(status);

CREATE INDEX IF NOT EXISTS idx_qa_batch_items_batch_status
  ON public.qa_batch_items(batch_id, status);

CREATE INDEX IF NOT EXISTS idx_qa_batch_items_content
  ON public.qa_batch_items(content_type, content_id);

CREATE INDEX IF NOT EXISTS idx_qa_batch_items_pending
  ON public.qa_batch_items(status)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_qa_batch_items_completed_hash
  ON public.qa_batch_items(content_id, input_hash)
  WHERE status = 'completed' AND input_hash IS NOT NULL;

-- Concurrency-safe claim function using SKIP LOCKED
-- Only claims from batches that are allowed to run (pending/running, not cancelled/failed)
CREATE OR REPLACE FUNCTION public.qa_claim_pending_batch_items(p_limit INT DEFAULT 10)
RETURNS SETOF public.qa_batch_items
LANGUAGE plpgsql
AS $$
DECLARE
  v_rows INT;
BEGIN
  -- Claim only from batches that are allowed to run
  RETURN QUERY
  WITH cte AS (
    SELECT i.id
    FROM public.qa_batch_items i
    JOIN public.qa_batches b ON b.id = i.batch_id
    WHERE i.status = 'pending'
      AND b.status IN ('pending','running')
    ORDER BY i.id
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.qa_batch_items i
     SET status = 'processing',
         started_at = NOW()
    FROM cte
   WHERE i.id = cte.id
  RETURNING i.*;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  -- Flip any touched batches into running (idempotent)
  IF v_rows > 0 THEN
    UPDATE public.qa_batches b
       SET status = 'running',
           started_at = COALESCE(b.started_at, NOW())
     WHERE b.status = 'pending'
       AND EXISTS (
         SELECT 1
         FROM public.qa_batch_items i
         WHERE i.batch_id = b.id
           AND i.status = 'processing'
       );
  END IF;
END;
$$;

-- Prevent duplicate items in the same batch
CREATE UNIQUE INDEX IF NOT EXISTS uq_qa_batch_items_batch_content
  ON public.qa_batch_items(batch_id, content_id);

COMMIT;
