#!/usr/bin/env node
// Quick verification script - run after applying migrations
// Shows if the critical fixes worked

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log('\n🔍 RSS Job Queue Fix Verification\n');
console.log('═'.repeat(40));

// Check columns exist
const { error: colCheck } = await supabase
  .from('job_queue')
  .select('started_at, completed_at, attempts, last_error, updated_at')
  .limit(1);

if (colCheck?.message?.includes('column')) {
  console.log('❌ CRITICAL: Migration 008 not applied!');
  console.log('   Run: migrations/008_job_queue_critical_columns.sql');
  process.exit(1);
}

console.log('✅ All required columns exist');

// Check job counts
const { data: stats } = await supabase
  .from('job_queue')
  .select('status');

const counts = {};
stats?.forEach(row => {
  counts[row.status] = (counts[row.status] || 0) + 1;
});

console.log('\n📊 Current job queue status:');
Object.entries(counts).forEach(([status, count]) => {
  const icon = status === 'pending' ? '⏳' : 
               status === 'processing' ? '⚙️' : 
               status === 'done' ? '✅' :          // Changed from 'completed'
               status === 'failed' ? '❌' : '🔄';
  console.log(`   ${icon} ${status}: ${count}`);
});

// Check if atomic functions exist
try {
  await supabase.rpc('claim_next_job', { p_job_type: null });
  console.log('\n✅ Atomic claiming functions installed');
} catch (e) {
  if (e.message?.includes('does not exist')) {
    console.log('\n⚠️ Atomic functions not found');
    console.log('   Run: migrations/009_atomic_job_claiming.sql');
  }
}

// Check for ready jobs
const { count: readyCount } = await supabase
  .from('job_queue')
  .select('*', { count: 'exact', head: true })
  .eq('status', 'pending')
  .or('run_at.is.null,run_at.lte.now()');

if (readyCount > 0) {
  console.log(`\n🎯 ${readyCount} jobs ready to process!`);
  console.log('   Run: node scripts/job-queue-worker-atomic.js');
} else {
  console.log('\n⚠️ No jobs ready to run');
}

console.log('\n' + '═'.repeat(40));
console.log('✨ Verification complete\n');
