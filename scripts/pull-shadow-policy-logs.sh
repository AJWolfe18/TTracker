#!/bin/bash
set -euo pipefail

# TTRC-329: Pull SHADOW_POLICY_DIFF logs from GitHub Actions
# Usage: bash scripts/pull-shadow-policy-logs.sh

# Dependency checks
command -v gh >/dev/null || { echo "❌ gh CLI required"; exit 1; }
command -v jq >/dev/null || { echo "❌ jq required"; exit 1; }

WORKFLOW="rss-tracker-test.yml"
OUTPUT_DIR="logs/shadow-policy"
mkdir -p "$OUTPUT_DIR"

echo "Fetching recent workflow runs..."
gh run list --workflow="$WORKFLOW" --limit 20 --json databaseId,headSha,createdAt \
  > "$OUTPUT_DIR/runs.json"

RUN_IDS=$(jq -r '.[].databaseId' "$OUTPUT_DIR/runs.json")

for RUN_ID in $RUN_IDS; do
  OUTFILE="$OUTPUT_DIR/run-$RUN_ID.log"

  if [ -f "$OUTFILE" ]; then
    echo "Run $RUN_ID: already downloaded"
    continue
  fi

  echo "Run $RUN_ID: downloading..."
  # Dump raw lines containing our marker - Node does precise filtering
  # Tolerant grep: just the stable token, handles spaces/formatting
  gh run view "$RUN_ID" --log 2>/dev/null | \
    grep 'SHADOW_POLICY_DIFF' > "$OUTFILE" || true

  COUNT=$(wc -l < "$OUTFILE" 2>/dev/null || echo 0)
  echo "  Found $COUNT shadow diffs"
done

echo ""
echo "Done. Run 'node scripts/analyze-shadow-policy.mjs' next."
