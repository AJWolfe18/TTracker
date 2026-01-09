#!/usr/bin/env node
// Preflight check - Run this BEFORE any changes to verify the system is working

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Check for required environment variables
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  if (process.env.CI === 'true') {
    console.log('⏭️  Skipping preflight check - environment variables not configured');
    console.log('   This is expected in CI without secrets.');
    process.exit(0);
  } else {
    console.error('❌ Missing required env vars: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const checks = [];
let passed = 0;
let failed = 0;

async function check(name, testFn) {
  try {
    await testFn();
    console.log(`✅ ${name}`);
    passed++;
    return true;
  } catch (err) {
    console.error(`❌ ${name}: ${err.message}`);
    failed++;
    return false;
  }
}

async function runPreflight() {
  console.log('\n🚀 RSS PIPELINE PREFLIGHT CHECK');
  console.log('════════════════════════════════════\n');

  // 1. Check critical RPCs exist
  await check('RPC: claim_and_start_job exists', async () => {
    const { error } = await supabase.rpc('claim_and_start_job', { p_job_type: 'test' });
    if (error && error.message.includes('does not exist')) throw error;
  });

  await check('RPC: finish_job exists', async () => {
    const { error } = await supabase.rpc('finish_job', { 
      p_job_id: -1, 
      p_success: true, 
      p_error_message: null 
    });
    if (error && error.message.includes('does not exist')) throw error;
  });

  await check('RPC: reset_stuck_jobs exists', async () => {
    const { error } = await supabase.rpc('reset_stuck_jobs');
    if (error && error.message.includes('does not exist')) throw error;
  });

  await check('RPC: count_runnable_fetch_jobs exists', async () => {
    const { data, error } = await supabase.rpc('count_runnable_fetch_jobs');
    if (error && error.message.includes('does not exist')) throw error;
    if (typeof data !== 'number') throw new Error('Should return a number');
  });

  await check('RPC: enqueue_fetch_job exists', async () => {
    const { error } = await supabase.rpc('enqueue_fetch_job', {
      p_type: 'test',
      p_payload: {},
      p_hash: 'test'
    });
    if (error && error.message.includes('does not exist')) throw error;
  });

  // 2. Check partial unique index is working
  await check('Partial unique index prevents duplicates', async () => {
    // This should be prevented by the index if a job with this hash is already active
    // We expect this to succeed (return null) because it should skip the duplicate
    const testHash = 'preflight-test-' + Date.now();
    const { data: id1 } = await supabase.rpc('enqueue_fetch_job', {
      p_type: 'test',
      p_payload: { test: true },
      p_hash: testHash
    });
    
    const { data: id2 } = await supabase.rpc('enqueue_fetch_job', {
      p_type: 'test',
      p_payload: { test: true },
      p_hash: testHash
    });
    
    if (id1 && id2) throw new Error('Partial unique index not working - duplicates allowed!');
    
    // Cleanup
    if (id1) {
      await supabase
        .from('job_queue')
        .delete()
        .eq('id', id1);
    }
  });

  // 3. Check job lifecycle
  await check('Job lifecycle: claim returns NULL when empty', async () => {
    const { data } = await supabase.rpc('claim_and_start_job', { 
      p_job_type: 'preflight-test-nonexistent' 
    });
    
    // PostgREST sometimes returns row-of-nulls even when function returns NULL
    // Accept either true null OR an object with null id
    if (data === null || (data && data.id === null)) {
      return; // Success - either pattern is acceptable
    }
    
    throw new Error(`Expected NULL or null id, got ${JSON.stringify(data)}`);
  });

  // 4. Check feed registry
  await check('Feed registry has active feeds', async () => {
    const { count } = await supabase
      .from('feed_registry')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);
    
    if (!count || count === 0) throw new Error('No active feeds in registry');
    console.log(`   Found ${count} active feeds`);
  });

  // 5. Check runnable jobs count
  await check('Checking runnable jobs count', async () => {
    const { data: runnableCount, error: countError } = await supabase.rpc('count_runnable_fetch_jobs');
    if (countError) {
      throw new Error(`count_runnable_fetch_jobs failed: ${countError.message}`);
    }
    console.log(`   Runnable jobs: ${runnableCount || 0}`);
  });

  // 6. Verify claim returns NULL properly
  await check('claim_and_start_job returns NULL for nonexistent job type', async () => {
    const { data: testClaim } = await supabase.rpc('claim_and_start_job', { p_job_type: 'nonexistent' });
    if (testClaim !== null && !(testClaim && testClaim.id === null)) {
      throw new Error('claim_and_start_job not returning NULL for empty queue!');
    }
  });

  // Summary
  console.log('\n════════════════════════════════════');
  console.log(`PREFLIGHT: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    console.error('\n⚠️  PREFLIGHT FAILED - Do not proceed until all checks pass!');
    console.log('\nTo fix:');
    console.log('1. Apply migrations 016 and 017 in Supabase SQL Editor');
    console.log('2. Verify all RPCs are created');
    console.log('3. Check RSS_WORKING_STATE.md for reference');
    process.exit(1);
  } else {
    console.log('\n✅ All systems GO - RSS pipeline ready');
  }
}

runPreflight().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
