#!/usr/bin/env node
// scripts/check-runnable-jobs.js
// Quick check to ensure we have runnable jobs after seeding

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL, 
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const now = new Date().toISOString();

async function checkRunnable() {
  const { count: runnable, error: e1 } = await supabase
    .from('job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('job_type', 'fetch_feed')
    .is('processed_at', null)
    .lte('run_at', now);

  if (e1) {
    console.error('Error checking runnable jobs:', e1);
    process.exit(1);
  }

  const { count: active, error: e2 } = await supabase
    .from('job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'processing');

  if (e2) {
    console.error('Error checking active jobs:', e2);
    process.exit(1);
  }

  console.log(`Runnable fetch_feed jobs: ${runnable ?? 0}`);
  console.log(`Active processing jobs: ${active ?? 0}`);

  if ((runnable ?? 0) === 0 && (active ?? 0) === 0) {
    console.error('\n❌ No runnable fetch_feed jobs. Seed step failed or jobs not active.');
    
    // Debug: show what jobs exist
    const { data: allJobs } = await supabase
      .from('job_queue')
      .select('job_type, status, processed_at, run_at')
      .eq('job_type', 'fetch_feed')
      .limit(5);
    
    if (allJobs && allJobs.length > 0) {
      console.log('\nExisting fetch_feed jobs (first 5):');
      allJobs.forEach(j => {
        console.log(`  - status: ${j.status}, processed_at: ${j.processed_at}, run_at: ${j.run_at}`);
      });
    }
    
    process.exit(1);
  } else {
    console.log('✅ Jobs are ready for processing');
  }
}

checkRunnable().catch(err => {
  console.error('Failed to check runnable jobs:', err);
  process.exit(1);
});
