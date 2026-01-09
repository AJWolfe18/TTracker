#!/bin/bash

##
# TTRC-260 RSS Trigger Helper Script
#
# One-command RSS fetch trigger for monitoring
# Uses TEST environment anon key (correct auth method)
# Logs trigger timestamp for correlation with worker logs
#
# Usage: bash scripts/monitoring/trigger-rss.sh
##

# TEST Supabase credentials
SUPABASE_URL="https://wnrjrywpcadwutfykflu.supabase.co"
# NOTE: Use anon key, not EDGE_CRON_TOKEN (edge functions require valid JWT)
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4"

TRIGGER_LOG="rss-trigger-log.txt"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📡 Triggering RSS Fetch - TTRC-260"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Time: $(date)"
echo "  Environment: TEST"
echo ""

# Trigger RSS enqueue
RESPONSE=$(curl -X POST "$SUPABASE_URL/functions/v1/rss-enqueue" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -H "apikey: $ANON_KEY" \
  -d '{"kind":"fetch_all_feeds"}' \
  --silent \
  --fail-with-body)

CURL_EXIT=$?

if [ $CURL_EXIT -eq 0 ]; then
  echo "✅ RSS fetch triggered successfully"
  echo ""
  echo "📊 Response:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  echo ""

  # Extract feed count
  FEED_COUNT=$(echo "$RESPONSE" | jq -r '.enqueued' 2>/dev/null)
  FAILED_COUNT=$(echo "$RESPONSE" | jq -r '.failed' 2>/dev/null)

  echo "📈 Summary:"
  echo "  Feeds enqueued: $FEED_COUNT"
  echo "  Failed: $FAILED_COUNT"
  echo ""

  # Log to file
  echo "$(date '+%Y-%m-%d %H:%M:%S') - RSS fetch SUCCESS ($FEED_COUNT feeds enqueued)" >> "$TRIGGER_LOG"
else
  echo "❌ RSS fetch failed (curl exit code: $CURL_EXIT)"
  echo ""
  echo "Error response:"
  echo "$RESPONSE"
  echo ""

  # Log failure
  echo "$(date '+%Y-%m-%d %H:%M:%S') - RSS fetch FAILED (curl exit $CURL_EXIT)" >> "$TRIGGER_LOG"
  exit 1
fi

echo "💾 Trigger log: $TRIGGER_LOG"
echo ""
