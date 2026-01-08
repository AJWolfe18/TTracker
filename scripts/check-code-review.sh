#!/bin/bash
# check-code-review.sh
# Automated AI code review checker
# Part of git workflow - run after every push

set -e

echo "🔍 Checking AI Code Review Status..."
echo ""

# Get the latest commit SHA
LATEST_SHA=$(git rev-parse HEAD)
echo "Latest commit: ${LATEST_SHA:0:7}"

# Wait a few seconds for workflow to start
echo "⏳ Waiting 10s for workflow to start..."
sleep 10

# Check for the workflow run
RUN_DATA=$(gh run list --workflow="ai-code-review.yml" --limit 1 --json conclusion,createdAt,databaseId,headSha,displayTitle)

# Parse JSON
CONCLUSION=$(echo "$RUN_DATA" | jq -r '.[0].conclusion')
RUN_ID=$(echo "$RUN_DATA" | jq -r '.[0].databaseId')
RUN_SHA=$(echo "$RUN_DATA" | jq -r '.[0].headSha')
TITLE=$(echo "$RUN_DATA" | jq -r '.[0].displayTitle')

# Check if this run is for our commit
if [ "${RUN_SHA:0:7}" != "${LATEST_SHA:0:7}" ]; then
  echo "⚠️  WARNING: No workflow run found for this commit yet"
  echo "   Latest workflow is for: ${RUN_SHA:0:7}"
  echo "   Your commit is:         ${LATEST_SHA:0:7}"
  echo ""
  echo "   View runs: gh run list --workflow='ai-code-review.yml'"
  exit 1
fi

# Check conclusion
echo ""
echo "📊 Review Status: ${CONCLUSION}"
echo "📝 Commit: ${TITLE}"
echo "🔗 Run ID: ${RUN_ID}"
echo ""

if [ "$CONCLUSION" = "success" ]; then
  echo "✅ AI Code Review PASSED"
  echo "   View: gh run view ${RUN_ID}"
  exit 0
elif [ "$CONCLUSION" = "failure" ]; then
  echo "❌ AI Code Review FAILED"
  echo "   View: gh run view ${RUN_ID}"
  echo "   Fix issues before proceeding"
  exit 1
elif [ "$CONCLUSION" = "null" ]; then
  echo "⏳ AI Code Review IN PROGRESS"
  echo "   Monitor: gh run watch ${RUN_ID}"
  echo "   Or view: gh run view ${RUN_ID}"
  exit 2
else
  echo "⚠️  Unknown status: ${CONCLUSION}"
  echo "   View: gh run view ${RUN_ID}"
  exit 1
fi
