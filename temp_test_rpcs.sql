-- =============================================================================
-- Test New RPC Functions (Migrations 028/029)
-- =============================================================================

-- Test 1: Record feed success
SELECT public.record_feed_success(3, 450); -- NYT feed, 450ms response

-- Test 2: Record 304 Not Modified
SELECT public.record_feed_not_modified(4, 320); -- WaPo feed, 320ms response

-- Test 3: Record feed error
SELECT public.record_feed_error(5, 'Test error: Connection timeout'); -- Politico feed

-- Test 4: Check feed_metrics table (should have entries for today)
SELECT 
  metric_date,
  feed_id,
  fetch_count,
  success_count,
  error_count,
  not_modified_count
FROM public.feed_metrics
WHERE metric_date = CURRENT_DATE
ORDER BY feed_id;

-- Test 5: Check feed_registry was updated
SELECT 
  id AS feed_id,
  feed_name,
  last_response_time_ms,
  consecutive_successes,
  failure_count,
  last_fetched_at
FROM public.feed_registry
WHERE id IN (3, 4, 5)
ORDER BY id;

-- Test 6: Check feed_errors table
SELECT 
  feed_id,
  error_message,
  created_at
FROM public.feed_errors
WHERE feed_id = 5
ORDER BY created_at DESC
LIMIT 5;

-- Test 7: Re-query health overview (should show updated metrics)
SELECT 
  feed_id,
  feed_name,
  success_fetches_24h,
  errors_24h,
  fetches_24h,
  health_status
FROM admin.feed_health_overview
WHERE feed_id IN (3, 4, 5)
ORDER BY feed_id;
