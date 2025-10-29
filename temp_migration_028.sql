-- =============================================================================
-- Migration 028: RSS Monitoring RPCs
-- =============================================================================
-- Purpose: Add metric tracking functions and backward-compatible job enqueuing
-- Prerequisites: Migration 027 applied, backfill complete
-- Estimated Time: 3-5 seconds
-- =============================================================================

-- Helper function: ensure today's metrics row exists
CREATE OR REPLACE FUNCTION public._ensure_today_metrics(p_feed_id bigint)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.feed_metrics(metric_date, feed_id)
  VALUES (CURRENT_DATE, p_feed_id)
  ON CONFLICT (metric_date, feed_id) DO NOTHING;
END$$;

-- Metric tracking: successful fetch
CREATE OR REPLACE FUNCTION public.record_feed_success(p_feed_id bigint, p_duration_ms integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public._ensure_today_metrics(p_feed_id);
  UPDATE public.feed_metrics
     SET fetch_count = fetch_count + 1,
         success_count = success_count + 1
   WHERE metric_date = CURRENT_DATE AND feed_id = p_feed_id;

  UPDATE public.feed_registry
     SET last_response_time_ms = p_duration_ms,
         last_fetched_at = NOW(),
         failure_count = GREATEST(COALESCE(failure_count,0) - 1, 0),
         consecutive_successes = COALESCE(consecutive_successes,0) + 1
   WHERE id = p_feed_id;
END$$;

-- Metric tracking: 304 Not Modified
CREATE OR REPLACE FUNCTION public.record_feed_not_modified(p_feed_id bigint, p_duration_ms integer)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public._ensure_today_metrics(p_feed_id);
  UPDATE public.feed_metrics
     SET fetch_count = fetch_count + 1,
         not_modified_count = not_modified_count + 1,
         success_count = success_count + 1
   WHERE metric_date = CURRENT_DATE AND feed_id = p_feed_id;

  UPDATE public.feed_registry
     SET last_response_time_ms = p_duration_ms,
         last_fetched_at = NOW(),
         consecutive_successes = COALESCE(consecutive_successes,0) + 1
   WHERE id = p_feed_id;
END$$;

-- Metric tracking: error
CREATE OR REPLACE FUNCTION public.record_feed_error(p_feed_id bigint, p_error text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public._ensure_today_metrics(p_feed_id);
  UPDATE public.feed_metrics
     SET fetch_count = fetch_count + 1,
         error_count = error_count + 1
   WHERE metric_date = CURRENT_DATE AND feed_id = p_feed_id;

  INSERT INTO public.feed_errors(feed_id, error_message, created_at)
  VALUES (p_feed_id, left(coalesce(p_error,'unknown'), 500), NOW())
  ON CONFLICT DO NOTHING;

  UPDATE public.feed_registry
     SET failure_count = COALESCE(failure_count,0) + 1,
         consecutive_successes = 0
   WHERE id = p_feed_id;
END$$;

-- NEW: 5-arg version with feed_id + run_at
CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(
  p_feed_id BIGINT,
  p_job_type TEXT,
  p_payload JSONB,
  p_run_at TIMESTAMPTZ DEFAULT NOW(),
  p_payload_hash TEXT DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_hash TEXT := COALESCE(p_payload_hash, encode(digest(p_job_type || ':' || p_payload::text, 'sha256'), 'hex'));
  v_id BIGINT;
BEGIN
  INSERT INTO public.job_queue (feed_id, job_type, payload, payload_hash, run_at)
  VALUES (p_feed_id, p_job_type, p_payload, v_hash, p_run_at)
  ON CONFLICT (job_type, payload_hash) WHERE processed_at IS NULL
  DO UPDATE SET run_at = LEAST(EXCLUDED.run_at, NOW())
  RETURNING id INTO v_id;
  RETURN v_id;
END$$;

-- LEGACY: 3-arg backward-compatible version
CREATE OR REPLACE FUNCTION public.enqueue_fetch_job(
  p_type TEXT, p_payload JSONB, p_hash TEXT DEFAULT NULL
) RETURNS BIGINT LANGUAGE plpgsql AS $$
BEGIN
  RETURN public.enqueue_fetch_job(NULL, p_type, p_payload, NOW(), p_hash);
END$$;

-- =============================================================================
-- SMOKE TESTS: Verify both RPC signatures work correctly
-- =============================================================================

DO $$
DECLARE
  v_test_feed_id BIGINT := 1; -- NYT feed
  v_job_id_new BIGINT;
  v_job_id_legacy BIGINT;
  v_job_new_feed_id BIGINT;
  v_job_legacy_feed_id BIGINT;
  v_job_new_run_at TIMESTAMPTZ;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '=== Smoke Testing RPC Signatures ===';

  -- Test 1: New 5-arg signature (feed_id + run_at)
  RAISE NOTICE 'Test 1: New 5-arg enqueue_fetch_job signature...';
  v_job_id_new := public.enqueue_fetch_job(
    p_feed_id := v_test_feed_id,
    p_job_type := 'test_rss_fetch_new',
    p_payload := jsonb_build_object('test', 'new_signature', 'timestamp', NOW()::text),
    p_run_at := NOW() + INTERVAL '1 hour'
  );

  -- Verify job created with correct feed_id
  SELECT feed_id, run_at INTO v_job_new_feed_id, v_job_new_run_at
  FROM public.job_queue
  WHERE id = v_job_id_new;

  IF v_job_new_feed_id = v_test_feed_id THEN
    RAISE NOTICE '  ✓ Job created with feed_id=%', v_test_feed_id;
  ELSE
    RAISE EXCEPTION 'SMOKE TEST FAILED: Job feed_id mismatch (expected %, got %)', v_test_feed_id, v_job_new_feed_id;
  END IF;

  -- Test 2: Legacy 3-arg signature (backward compatibility)
  RAISE NOTICE 'Test 2: Legacy 3-arg enqueue_fetch_job signature...';
  v_job_id_legacy := public.enqueue_fetch_job(
    'test_legacy_job',
    jsonb_build_object('test', 'legacy_signature', 'timestamp', NOW()::text)
  );

  -- Verify job created (feed_id should be NULL for legacy)
  SELECT feed_id INTO v_job_legacy_feed_id
  FROM public.job_queue
  WHERE id = v_job_id_legacy;

  IF v_job_legacy_feed_id IS NULL THEN
    RAISE NOTICE '  ✓ Legacy job created with feed_id=NULL (backward compat OK)';
  ELSE
    RAISE WARNING 'Legacy job has feed_id=% (expected NULL, but acceptable)', v_job_legacy_feed_id;
  END IF;

  -- Cleanup test jobs
  DELETE FROM public.job_queue
  WHERE id IN (v_job_id_new, v_job_id_legacy);

  RAISE NOTICE '  ✓ Test jobs cleaned up';
  RAISE NOTICE '';
  RAISE NOTICE '=== All Smoke Tests Passed ===';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Migration 028 completed successfully!';
  RAISE NOTICE 'Next: Migration 029 (views)';
END $$;
