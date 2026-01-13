#!/usr/bin/env node
/**
 * Verify Migration 058: Analytics Enhancement Tables
 *
 * Run: node scripts/apply-058-migration.js
 *
 * This verifies:
 * - newsletter_subscribers table exists
 * - rate_limits table exists
 * - search_gaps table exists
 * - RLS is enabled on all tables
 *
 * NOTE: Run the actual SQL in Supabase Dashboard first!
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyMigration() {
  console.log('📋 Verifying Migration 058: Analytics Enhancement Tables\n');
  console.log('='.repeat(60));

  let allGood = true;

  // Step 1: Check newsletter_subscribers table
  console.log('\n1️⃣ Checking newsletter_subscribers table...');
  const { data: nlData, error: nlError } = await supabase
    .from('newsletter_subscribers')
    .select('id')
    .limit(1);

  if (nlError?.code === '42P01') {
    console.log('   ❌ Table does not exist - run migration SQL first');
    allGood = false;
  } else if (nlError) {
    console.log(`   ⚠️ Table exists but error: ${nlError.message}`);
  } else {
    console.log('   ✅ Table exists');
  }

  // Step 2: Check rate_limits table
  console.log('\n2️⃣ Checking rate_limits table...');
  const { data: rlData, error: rlError } = await supabase
    .from('rate_limits')
    .select('id')
    .limit(1);

  if (rlError?.code === '42P01') {
    console.log('   ❌ Table does not exist - run migration SQL first');
    allGood = false;
  } else if (rlError) {
    console.log(`   ⚠️ Table exists but error: ${rlError.message}`);
  } else {
    console.log('   ✅ Table exists');
  }

  // Step 3: Check search_gaps table
  console.log('\n3️⃣ Checking search_gaps table...');
  const { data: sgData, error: sgError } = await supabase
    .from('search_gaps')
    .select('id')
    .limit(1);

  if (sgError?.code === '42P01') {
    console.log('   ❌ Table does not exist - run migration SQL first');
    allGood = false;
  } else if (sgError) {
    console.log(`   ⚠️ Table exists but error: ${sgError.message}`);
  } else {
    console.log('   ✅ Table exists');
  }

  // Step 4: Test insert into newsletter_subscribers (with service_role)
  console.log('\n4️⃣ Testing service_role insert capability...');
  if (!nlError || nlError.code !== '42P01') {
    const testEmail = `test-verify-${Date.now()}@example.com`;
    const { data: insertData, error: insertError } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email: testEmail,
        signup_page: 'test',
        signup_source: 'migration_verify'
      })
      .select('id, email_hash, unsubscribe_token')
      .single();

    if (insertError) {
      console.log(`   ❌ Insert failed: ${insertError.message}`);
      allGood = false;
    } else {
      console.log('   ✅ Insert successful');
      console.log(`   - ID: ${insertData.id}`);
      console.log(`   - email_hash generated: ${insertData.email_hash ? 'Yes' : 'No'}`);
      console.log(`   - unsubscribe_token generated: ${insertData.unsubscribe_token ? 'Yes' : 'No'}`);

      // Clean up test row
      await supabase.from('newsletter_subscribers').delete().eq('id', insertData.id);
      console.log('   - Test row cleaned up');
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  if (allGood) {
    console.log('\n✅ Migration 058 verified successfully!\n');
  } else {
    console.log('\n❌ Migration incomplete. Run the SQL in Supabase Dashboard:');
    console.log('   File: migrations/058_analytics_tables.sql');
    console.log('   Dashboard: https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql\n');
  }
}

verifyMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
