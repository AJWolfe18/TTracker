#!/bin/bash
# Apply migrations 026 and 026.1 to TEST database
# Usage: ./scripts/apply-026-migrations.sh

set -e  # Exit on error

echo "🔄 Applying TTRC-231 migrations to TEST database..."
echo ""

# Check for required environment variables
if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "❌ Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
  echo ""
  echo "Set them in your .env file or export them:"
  echo "  export SUPABASE_URL=https://your-project.supabase.co"
  echo "  export SUPABASE_SERVICE_ROLE_KEY=your-service-role-key"
  exit 1
fi

# Extract project ID from URL
PROJECT_ID=$(echo $SUPABASE_URL | sed -E 's|https://([^.]+)\.supabase\.co|\1|')
echo "📍 Target: $PROJECT_ID (TEST environment)"
echo ""

# Apply migration 026
echo "📝 Applying migration 026 (story_split_actions table)..."
cat migrations/026_story_split_audit.sql

read -p "▶️  Press Enter to apply migration 026..."

psql "$DATABASE_URL" < migrations/026_story_split_audit.sql

if [ $? -eq 0 ]; then
  echo "✅ Migration 026 applied successfully"
else
  echo "❌ Migration 026 failed"
  exit 1
fi

echo ""

# Apply migration 026.1
echo "📝 Applying migration 026.1 (hardening + indexes)..."
cat migrations/026.1_story_split_audit_hardening.sql

read -p "▶️  Press Enter to apply migration 026.1..."

psql "$DATABASE_URL" < migrations/026.1_story_split_audit_hardening.sql

if [ $? -eq 0 ]; then
  echo "✅ Migration 026.1 applied successfully"
else
  echo "❌ Migration 026.1 failed"
  exit 1
fi

echo ""
echo "🎉 All migrations applied successfully!"
echo ""
echo "Next steps:"
echo "  1. Run tests: node scripts/test-ttrc231-manual.js all"
echo "  2. Verify audit tables: node scripts/test-ttrc231-manual.js verify"
