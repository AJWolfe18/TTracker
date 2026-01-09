-- TTRC-260 Cost Monitoring Query
-- Tracks daily OpenAI spend and call counts
-- Compares current period vs. baseline (pre-monitoring)
--
-- Usage (via psql):
--   psql -h wnrjrywpcadwutfykflu.supabase.co -U postgres -d postgres -f scripts/monitoring/check-costs.sql
--
-- Or run via Claude's MCP Supabase integration

-- Daily spend for last 14 days with trend analysis
WITH daily_stats AS (
  SELECT
    day,
    spent_usd,
    openai_calls,
    LAG(spent_usd) OVER (ORDER BY day) as prev_day_spend,
    spent_usd - LAG(spent_usd) OVER (ORDER BY day) as daily_change
  FROM budgets
  WHERE day >= CURRENT_DATE - 14
  ORDER BY day DESC
),
baseline AS (
  -- Baseline: Average of days 7-14 (before monitoring started)
  SELECT
    AVG(spent_usd) as avg_baseline_daily,
    SUM(openai_calls) as total_baseline_calls
  FROM budgets
  WHERE day BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE - 7
),
monitoring_period AS (
  -- Monitoring: Average of last 3 days
  SELECT
    AVG(spent_usd) as avg_monitoring_daily,
    SUM(openai_calls) as total_monitoring_calls
  FROM budgets
  WHERE day >= CURRENT_DATE - 3
)
SELECT
  '📊 TTRC-260 Cost Analysis' as report,
  '' as spacer1,
  '─────────────────────────────────' as divider1,
  'BASELINE (7-14 days ago)' as section1,
  '─────────────────────────────────' as divider2,
  (SELECT ROUND(avg_baseline_daily::numeric, 4) FROM baseline) as baseline_avg_daily_usd,
  (SELECT total_baseline_calls FROM baseline) as baseline_total_calls,
  '' as spacer2,
  '─────────────────────────────────' as divider3,
  'MONITORING PERIOD (Last 3 days)' as section2,
  '─────────────────────────────────' as divider4,
  (SELECT ROUND(avg_monitoring_daily::numeric, 4) FROM monitoring_period) as monitoring_avg_daily_usd,
  (SELECT total_monitoring_calls FROM monitoring_period) as monitoring_total_calls,
  '' as spacer3,
  '─────────────────────────────────' as divider5,
  'IMPACT ANALYSIS' as section3,
  '─────────────────────────────────' as divider6,
  ROUND((
    (SELECT avg_monitoring_daily FROM monitoring_period) -
    (SELECT avg_baseline_daily FROM baseline)
  )::numeric, 4) as daily_increase_usd,
  ROUND((
    ((SELECT avg_monitoring_daily FROM monitoring_period) -
     (SELECT avg_baseline_daily FROM baseline)) * 30
  )::numeric, 2) as monthly_increase_usd_projected,
  CASE
    WHEN (
      ((SELECT avg_monitoring_daily FROM monitoring_period) -
       (SELECT avg_baseline_daily FROM baseline)) * 30
    ) < 5.00 THEN '✅ Under budget (<$5/month increase)'
    WHEN (
      ((SELECT avg_monitoring_daily FROM monitoring_period) -
       (SELECT avg_baseline_daily FROM baseline)) * 30
    ) < 10.00 THEN '⚠️ Moderate increase ($5-10/month)'
    ELSE '🚨 High increase (>$10/month)'
  END as status;

-- Detailed daily breakdown
\echo ''
\echo '📅 DAILY BREAKDOWN (Last 14 Days)'
\echo '───────────────────────────────────────────────────────'

SELECT
  day,
  ROUND(spent_usd::numeric, 4) as spent_usd,
  openai_calls,
  ROUND((spent_usd - LAG(spent_usd) OVER (ORDER BY day))::numeric, 4) as change_from_prev,
  CASE
    WHEN day >= CURRENT_DATE - 3 THEN '📍 MONITORING'
    WHEN day >= CURRENT_DATE - 7 THEN '📊 Recent'
    ELSE '📈 Baseline'
  END as period
FROM budgets
WHERE day >= CURRENT_DATE - 14
ORDER BY day DESC;

-- Summary stats
\echo ''
\echo '💰 BUDGET STATUS'
\echo '───────────────────────────────────────────────────────'

SELECT
  ROUND(SUM(spent_usd)::numeric, 2) as total_spent_last_30_days,
  ROUND(AVG(spent_usd)::numeric, 4) as avg_daily_spend,
  SUM(openai_calls) as total_calls_last_30_days,
  50.00 as monthly_budget_limit,
  ROUND((50.00 - SUM(spent_usd))::numeric, 2) as remaining_budget,
  ROUND(((SUM(spent_usd) / 50.00) * 100)::numeric, 1) as budget_used_percent
FROM budgets
WHERE day >= CURRENT_DATE - 30;
