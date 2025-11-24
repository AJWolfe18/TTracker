-- ============================================================================
-- Error Tracking Observability Queries
-- Added: 2025-11-23 (TTRC-278/279)
-- Purpose: Monitor story enrichment errors and retry patterns
-- ============================================================================

-- Top failing stories (needs manual review)
-- Shows stories that have hit permanent_failure status
SELECT
  s.id,
  s.primary_headline,
  s.enrichment_failure_count,
  s.last_error_category,
  s.last_error_message,
  s.enrichment_status,
  s.last_enriched_at
FROM public.stories s
WHERE s.enrichment_status = 'permanent_failure'
ORDER BY s.enrichment_failure_count DESC
LIMIT 20;

-- Error distribution (last 7 days)
-- Shows which error categories are most common
SELECT
  error_category,
  COUNT(*) as error_count,
  ROUND(AVG(retry_count), 1) as avg_retry_count,
  MIN(occurred_at) as first_seen,
  MAX(occurred_at) as last_seen
FROM admin.enrichment_error_log
WHERE occurred_at > NOW() - INTERVAL '7 days'
GROUP BY error_category
ORDER BY error_count DESC;

-- Retry recovery rate (how often retries succeed)
-- Shows effectiveness of retry logic for each error category
SELECT
  initial.error_category,
  COUNT(*) as total_failures,
  SUM(CASE WHEN s.enrichment_status = 'success' THEN 1 ELSE 0 END) as recovered,
  ROUND(100.0 * SUM(CASE WHEN s.enrichment_status = 'success' THEN 1 ELSE 0 END) / COUNT(*), 1) as recovery_pct
FROM admin.enrichment_error_log initial
JOIN public.stories s ON s.id = initial.story_id
WHERE initial.retry_count = 1
  AND initial.occurred_at > NOW() - INTERVAL '30 days'
GROUP BY initial.error_category
ORDER BY total_failures DESC;

-- Stories with repeated failures (potential bugs)
-- Identifies stories that fail repeatedly - may need manual intervention
SELECT
  s.id,
  s.primary_headline,
  s.last_error_category,
  COUNT(e.id) as total_errors,
  MAX(e.occurred_at) as last_error_at
FROM public.stories s
JOIN admin.enrichment_error_log e ON e.story_id = s.id
WHERE e.occurred_at > NOW() - INTERVAL '7 days'
GROUP BY s.id
HAVING COUNT(e.id) > 3
ORDER BY total_errors DESC;

-- Budget exhaustion timeline
-- Shows when daily budget cap was hit
SELECT
  DATE(occurred_at) as day,
  COUNT(*) as budget_errors,
  COUNT(DISTINCT story_id) as unique_stories_blocked
FROM admin.enrichment_error_log
WHERE error_category = 'budget_exceeded'
  AND occurred_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(occurred_at)
ORDER BY day DESC;

-- Permanent error breakdown
-- Shows specific reasons stories failed permanently
SELECT
  last_error_category,
  COUNT(*) as failure_count,
  STRING_AGG(DISTINCT SUBSTRING(last_error_message, 1, 100), ' | ' ORDER BY SUBSTRING(last_error_message, 1, 100)) as example_messages
FROM public.stories
WHERE enrichment_status = 'permanent_failure'
GROUP BY last_error_category
ORDER BY failure_count DESC;

-- Recent error timeline (last 24 hours)
-- Shows error volume over time for anomaly detection
SELECT
  DATE_TRUNC('hour', occurred_at) as hour,
  error_category,
  COUNT(*) as error_count
FROM admin.enrichment_error_log
WHERE occurred_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', occurred_at), error_category
ORDER BY hour DESC, error_count DESC;

-- Stories pending retry
-- Shows stories that failed but are still retryable
SELECT
  s.id,
  s.primary_headline,
  s.enrichment_failure_count,
  s.last_error_category,
  s.last_enriched_at,
  EXTRACT(EPOCH FROM (NOW() - s.last_enriched_at))/3600 as hours_since_last_attempt
FROM public.stories s
WHERE s.enrichment_status = 'pending'
  AND s.enrichment_failure_count > 0
ORDER BY s.last_enriched_at DESC
LIMIT 20;

-- Infrastructure error alerts
-- Shows auth/permission errors that need immediate attention
SELECT
  DATE_TRUNC('hour', occurred_at) as hour,
  COUNT(*) as infra_errors,
  STRING_AGG(DISTINCT SUBSTRING(error_message, 1, 100), ' | ') as example_messages
FROM admin.enrichment_error_log
WHERE error_category = 'infra_auth'
  AND occurred_at > NOW() - INTERVAL '24 hours'
GROUP BY DATE_TRUNC('hour', occurred_at)
ORDER BY hour DESC;

-- Success rate after errors
-- Shows overall enrichment success rate including retries
SELECT
  COUNT(*) FILTER (WHERE enrichment_status = 'success') as successful,
  COUNT(*) FILTER (WHERE enrichment_status = 'permanent_failure') as permanent_failures,
  COUNT(*) FILTER (WHERE enrichment_status = 'pending') as pending_retry,
  COUNT(*) FILTER (WHERE enrichment_status IS NULL) as never_attempted,
  ROUND(100.0 * COUNT(*) FILTER (WHERE enrichment_status = 'success') /
    NULLIF(COUNT(*) FILTER (WHERE enrichment_status IS NOT NULL), 0), 1) as success_rate_pct
FROM public.stories;

-- ============================================================================
-- Usage:
--   Copy and paste these queries into Supabase SQL Editor or psql
--   Adjust time intervals (7 days, 30 days, 24 hours) as needed
-- ============================================================================
