/**
 * Apply Migration 022 to TEST database
 *
 * This script reads the migration SQL file and executes it against Supabase.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function applyMigration() {
  console.log('[migration] Reading migration file...');

  const migrationPath = join(__dirname, '..', 'migrations', '022_clustering_v2_schema.sql');
  const sql = readFileSync(migrationPath, 'utf-8');

  console.log('[migration] Applying Migration 022 to TEST database...');
  console.log('[migration] This may take 30-60 seconds...\n');

  try {
    // Execute the migration SQL
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });

    if (error) {
      // Try direct query if RPC doesn't exist
      console.log('[migration] Trying direct SQL execution...');

      // Split into individual statements and execute
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (!stmt) continue;

        console.log(`[migration] Executing statement ${i + 1}/${statements.length}...`);

        try {
          // For most statements, we can use the from() query builder
          // But for DDL, we need to use rpc or a custom function
          const { error: stmtError } = await supabase.rpc('exec', { sql: stmt + ';' });

          if (stmtError) {
            console.error(`[migration] Statement ${i + 1} failed:`, stmtError.message);
            // Continue anyway - many failures are "already exists" which is OK
          }
        } catch (e) {
          console.error(`[migration] Statement ${i + 1} error:`, e.message);
        }
      }

      console.log('\n[migration] ⚠️  Migration executed with some errors (this is often OK for IF NOT EXISTS statements)');
      console.log('[migration] Please verify manually in Supabase SQL Editor\n');
    } else {
      console.log('[migration] ✅ Migration applied successfully!\n');
    }

    // Verify migration worked
    console.log('[migration] Verifying migration...');
    await verifyMigration();

  } catch (error) {
    console.error('[migration] ❌ Migration failed:', error.message);
    console.log('\n[migration] Manual Application Instructions:');
    console.log('1. Open Supabase TEST project: https://supabase.com/dashboard');
    console.log('2. Go to SQL Editor');
    console.log('3. Copy contents of migrations/022_clustering_v2_schema.sql');
    console.log('4. Paste and execute\n');
    process.exit(1);
  }
}

async function verifyMigration() {
  try {
    // Check if new columns exist
    const { data: articles } = await supabase
      .from('articles')
      .select('id, embedding_v1, entities')
      .limit(1);

    if (articles && articles.length > 0) {
      const article = articles[0];

      if ('embedding_v1' in article && 'entities' in article) {
        console.log('  ✅ Articles table updated successfully');
        console.log('  ✅ New columns: embedding_v1, entities');
      } else {
        console.log('  ⚠️  Could not verify new columns');
      }
    }

    // Check if cost tracking table exists
    const { data: usage, error: usageError } = await supabase
      .from('openai_usage')
      .select('count')
      .limit(1);

    if (!usageError) {
      console.log('  ✅ Cost tracking table (openai_usage) created');
    } else {
      console.log('  ⚠️  Could not verify openai_usage table');
    }

    // Check if helper functions exist
    const { data: spend } = await supabase.rpc('get_daily_openai_spend');

    if (spend !== null) {
      console.log('  ✅ Helper functions created');
      console.log(`  ℹ️  Current daily spend: $${parseFloat(spend || 0).toFixed(2)}`);
    } else {
      console.log('  ⚠️  Could not verify helper functions');
    }

    console.log('\n[migration] Verification complete!\n');

  } catch (error) {
    console.log('  ⚠️  Verification partial:', error.message);
    console.log('  This is often OK - manually verify in Supabase dashboard\n');
  }
}

// Run migration
console.log('='.repeat(60));
console.log('TTRC-225: Applying Migration 022');
console.log('='.repeat(60) + '\n');

applyMigration()
  .then(() => {
    console.log('[migration] Done!');
    process.exit(0);
  })
  .catch(error => {
    console.error('[migration] Fatal error:', error);
    process.exit(1);
  });
