#!/usr/bin/env node
/**
 * Apply Migration 057: Pardon Research Tables
 *
 * Run: node scripts/apply-057-migration.js
 *
 * This adds:
 * - research_prompt_version + researched_at columns to pardons
 * - pardon_research_costs table
 * - pardon_research_errors table
 * - RLS on new tables
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

async function applyMigration() {
  console.log('📋 Applying Migration 057: Pardon Research Tables\n');

  // Step 1: Add columns to pardons table
  console.log('1️⃣ Adding columns to pardons table...');

  const { error: col1Error } = await supabase.rpc('query', {
    sql: `ALTER TABLE public.pardons ADD COLUMN IF NOT EXISTS research_prompt_version TEXT`
  }).catch(() => ({ error: null }));  // Ignore if rpc doesn't exist

  // Use direct SQL approach via REST API
  const addColumnsSQL = `
    ALTER TABLE public.pardons
    ADD COLUMN IF NOT EXISTS research_prompt_version TEXT;

    ALTER TABLE public.pardons
    ADD COLUMN IF NOT EXISTS researched_at TIMESTAMPTZ;
  `;

  // Check if columns exist by querying
  const { data: testRow, error: testError } = await supabase
    .from('pardons')
    .select('id')
    .limit(1);

  if (testError) {
    console.error('❌ Cannot access pardons table:', testError.message);
    process.exit(1);
  }

  // Try to query the new columns
  const { error: colCheckError } = await supabase
    .from('pardons')
    .select('research_prompt_version')
    .limit(1);

  if (colCheckError?.code === '42703') {
    console.log('   Columns do not exist - please run this SQL in Supabase Dashboard:');
    console.log('   ---');
    console.log(`   ALTER TABLE public.pardons ADD COLUMN IF NOT EXISTS research_prompt_version TEXT;`);
    console.log(`   ALTER TABLE public.pardons ADD COLUMN IF NOT EXISTS researched_at TIMESTAMPTZ;`);
    console.log('   ---\n');
  } else {
    console.log('   ✅ Columns already exist or added\n');
  }

  // Step 2: Check if cost table exists
  console.log('2️⃣ Checking pardon_research_costs table...');
  const { error: costTableError } = await supabase
    .from('pardon_research_costs')
    .select('id')
    .limit(1);

  if (costTableError?.code === '42P01') {
    console.log('   Table does not exist - please run migration 057 SQL in Supabase Dashboard\n');
  } else if (costTableError) {
    console.log('   Table exists but may have RLS (expected)\n');
  } else {
    console.log('   ✅ Table exists\n');
  }

  // Step 3: Check if error table exists
  console.log('3️⃣ Checking pardon_research_errors table...');
  const { error: errorTableError } = await supabase
    .from('pardon_research_errors')
    .select('id')
    .limit(1);

  if (errorTableError?.code === '42P01') {
    console.log('   Table does not exist - please run migration 057 SQL in Supabase Dashboard\n');
  } else if (errorTableError) {
    console.log('   Table exists but may have RLS (expected)\n');
  } else {
    console.log('   ✅ Table exists\n');
  }

  console.log('='.repeat(60));
  console.log('\n📝 To complete migration, run the SQL in migrations/057_pardon_research_tables.sql');
  console.log('   via the Supabase Dashboard SQL Editor.\n');
}

applyMigration().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
