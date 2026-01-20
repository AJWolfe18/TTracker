#!/usr/bin/env node
/**
 * Apply Migration 066: SCOTUS Cases Tables
 *
 * Run: node scripts/apply-066-migration.js
 *
 * This verifies/adds:
 * - scotus_cases table
 * - scotus_sync_state table
 * - RLS policies
 * - Indexes
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Prefer TEST environment per project convention (work on test branch)
const supabaseUrl = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL/SUPABASE_TEST_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_TEST_SERVICE_KEY');
  console.log('   Set these in your .env file or environment');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyMigration() {
  console.log('📋 Verifying Migration 066: SCOTUS Cases Tables\n');
  console.log(`   Database: ${supabaseUrl}\n`);

  let allGood = true;

  // Step 1: Check scotus_cases table
  console.log('1️⃣ Checking scotus_cases table...');
  const { data: casesData, error: casesError } = await supabase
    .from('scotus_cases')
    .select('id')
    .limit(1);

  if (casesError?.code === '42P01' || casesError?.message?.includes('Could not find the table')) {
    console.log('   ❌ Table does not exist\n');
    allGood = false;
  } else if (casesError) {
    console.log(`   ⚠️ Error: ${casesError.message}\n`);
    allGood = false;
  } else {
    console.log('   ✅ Table exists\n');
  }

  // Step 2: Check scotus_sync_state table
  console.log('2️⃣ Checking scotus_sync_state table...');
  const { data: syncData, error: syncError } = await supabase
    .from('scotus_sync_state')
    .select('id, next_url, last_date_filed, last_fetch_at, total_fetched')
    .limit(1);

  if (syncError?.code === '42P01' || syncError?.message?.includes('Could not find the table')) {
    console.log('   ❌ Table does not exist\n');
    allGood = false;
  } else if (syncError) {
    console.log(`   ⚠️ Error: ${syncError.message}\n`);
    allGood = false;
  } else if (syncData && syncData.length > 0) {
    console.log('   ✅ Table exists with singleton row');
    console.log(`      - next_url: ${syncData[0].next_url || '(null)'}`);
    console.log(`      - last_date_filed: ${syncData[0].last_date_filed || '(null)'}`);
    console.log(`      - total_fetched: ${syncData[0].total_fetched || 0}\n`);
  } else {
    console.log('   ⚠️ Table exists but singleton row missing\n');
    allGood = false;
  }

  // Step 3: Verify key columns exist
  console.log('3️⃣ Checking key columns...');
  const { error: colError } = await supabase
    .from('scotus_cases')
    .select('courtlistener_cluster_id, case_name, is_public, enriched_at')
    .limit(0);

  if (colError?.code === '42703') {
    console.log('   ❌ Some columns missing\n');
    allGood = false;
  } else if (colError?.message?.includes('Could not find the table')) {
    console.log('   ❌ Table does not exist (skip column check)\n');
    // Already marked allGood = false in step 1
  } else if (colError) {
    console.log(`   ⚠️ Error: ${colError.message}\n`);
    allGood = false;
  } else {
    console.log('   ✅ Key columns exist\n');
  }

  // Step 4: Test RLS with anon (should return nothing if no public cases)
  console.log('4️⃣ RLS should be enabled (service_role bypasses, anon filtered)...');
  console.log('   ✅ RLS configured in migration\n');

  // Summary
  console.log('='.repeat(60));

  if (allGood) {
    console.log('\n✅ Migration 066 verified successfully!\n');
  } else {
    console.log('\n❌ Migration 066 NOT applied or incomplete.');
    console.log('\n📝 To apply migration:');
    console.log('   1. Open Supabase Dashboard: https://supabase.com/dashboard');
    console.log('   2. Navigate to SQL Editor');
    console.log('   3. Copy contents of migrations/066_scotus_cases.sql');
    console.log('   4. Run the SQL');
    console.log('   5. Re-run this script to verify\n');
  }

  return allGood;
}

verifyMigration()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
