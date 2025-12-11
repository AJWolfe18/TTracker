/**
 * Apply Migration 045 (topic_slug) to TEST database
 *
 * This script applies the topic_slug schema changes to Supabase.
 * Uses direct SQL execution via the 'exec' RPC if available,
 * otherwise provides manual instructions.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function applyMigration() {
  console.log('[migration-045] TTRC-306: Topic Slug Schema Migration\n');

  // First, check if columns already exist
  console.log('[migration-045] Checking current schema...');

  const { data: articles, error: artError } = await supabase
    .from('articles')
    .select('id')
    .limit(1);

  // Try to select topic_slug to see if it exists
  const { error: colCheck } = await supabase
    .from('articles')
    .select('topic_slug')
    .limit(1);

  if (!colCheck) {
    console.log('[migration-045] ✅ topic_slug column already exists on articles table');

    // Check stories too
    const { error: storiesCheck } = await supabase
      .from('stories')
      .select('topic_slugs')
      .limit(1);

    if (!storiesCheck) {
      console.log('[migration-045] ✅ topic_slugs column already exists on stories table');
      console.log('[migration-045] Migration already applied - no action needed.');
      return;
    }
  }

  console.log('[migration-045] Columns do not exist yet. Applying migration...\n');

  // Read migration file
  const migrationPath = join(__dirname, '..', 'migrations', '045_add_topic_slug.sql');
  let sql;
  try {
    sql = readFileSync(migrationPath, 'utf-8');
  } catch (e) {
    console.error('[migration-045] ❌ Could not read migration file:', e.message);
    return;
  }

  // Try exec_sql RPC (if it exists)
  try {
    const { error: rpcError } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (!rpcError) {
      console.log('[migration-045] ✅ Migration applied successfully via exec_sql RPC!');
      await verifyMigration();
      return;
    }

    console.log('[migration-045] exec_sql RPC not available, trying alternative...');
  } catch (e) {
    console.log('[migration-045] exec_sql not available:', e.message);
  }

  // If we get here, manual application is needed
  console.log('\n' + '='.repeat(60));
  console.log('[migration-045] MANUAL APPLICATION REQUIRED');
  console.log('='.repeat(60));
  console.log('\nThe migration must be applied manually via Supabase SQL Editor:');
  console.log('\n1. Open: https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql');
  console.log('2. Paste the following SQL and click "Run":\n');
  console.log('-'.repeat(60));
  console.log(sql);
  console.log('-'.repeat(60));
  console.log('\n3. After running, re-run this script to verify.');
}

async function verifyMigration() {
  console.log('\n[migration-045] Verifying migration...');

  const { error: artCheck } = await supabase
    .from('articles')
    .select('topic_slug')
    .limit(1);

  const { error: storyCheck } = await supabase
    .from('stories')
    .select('topic_slugs')
    .limit(1);

  if (!artCheck && !storyCheck) {
    console.log('[migration-045] ✅ Both columns exist - migration verified!');
  } else {
    console.log('[migration-045] ⚠️  Verification failed:');
    if (artCheck) console.log('  - articles.topic_slug: MISSING');
    if (storyCheck) console.log('  - stories.topic_slugs: MISSING');
  }
}

applyMigration().catch(err => {
  console.error('[migration-045] ❌ Error:', err.message);
  process.exit(1);
});
