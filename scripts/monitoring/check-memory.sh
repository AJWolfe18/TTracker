#!/bin/bash

##
# TTRC-260 Worker Memory Monitoring Script
#
# Tracks job queue worker memory usage over time
# Appends to CSV for trend analysis
# Alerts if memory exceeds threshold
#
# Usage: bash scripts/monitoring/check-memory.sh
##

CSV_FILE="memory-ttrc260.csv"
ALERT_THRESHOLD_MB=300

# Initialize CSV if doesn't exist
if [ ! -f "$CSV_FILE" ]; then
  echo "timestamp,pid,memory_mb" > "$CSV_FILE"
  echo "📊 Created new memory tracking file: $CSV_FILE"
fi

# Find worker process
# On Windows (Git Bash), process names might differ
WORKER_PID=$(ps aux | grep "node scripts/job-queue-worker.js" | grep -v grep | awk '{print $2}' | head -1)

if [ -z "$WORKER_PID" ]; then
  echo "❌ Worker not found! Is job-queue-worker running?"
  echo "   Start with: node scripts/job-queue-worker.js > worker-ttrc260.log 2>&1 &"
  exit 1
fi

# Get memory usage (RSS in KB, convert to MB)
# Column positions may vary by system
MEMORY_KB=$(ps aux | grep "^[^ ]* *$WORKER_PID" | awk '{print $6}' | head -1)

if [ -z "$MEMORY_KB" ]; then
  echo "❌ Could not read memory for PID $WORKER_PID"
  exit 1
fi

MEMORY_MB=$(echo "scale=2; $MEMORY_KB / 1024" | bc)
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Append to CSV
echo "$TIMESTAMP,$WORKER_PID,$MEMORY_MB" >> "$CSV_FILE"

# Display
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🧠 Worker Memory Status - TTRC-260"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Worker PID: $WORKER_PID"
echo "  Memory: ${MEMORY_MB} MB"
echo "  Threshold: $ALERT_THRESHOLD_MB MB"
echo "  Timestamp: $TIMESTAMP"

# Check threshold
if (( $(echo "$MEMORY_MB > $ALERT_THRESHOLD_MB" | bc -l) )); then
  echo ""
  echo "🚨 ALERT: Memory exceeds threshold!"
  echo "   Current: ${MEMORY_MB} MB"
  echo "   Limit: $ALERT_THRESHOLD_MB MB"
  echo "   Consider investigating memory leaks"
else
  echo "  Status: ✅ Normal"
fi

echo ""

# Show trend (last 5 measurements)
echo "📈 Recent Trend (Last 5 measurements):"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
tail -5 "$CSV_FILE" | column -t -s,

echo ""
echo "💾 Full log: $CSV_FILE"
echo ""
