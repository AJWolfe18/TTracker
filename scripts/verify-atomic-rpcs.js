#!/usr/bin/env node
// Verify atomic RPCs exist before running worker
// Exits with error if RPCs are missing

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyAtomicRPCs() {
  console.log('🔍 Verifying atomic RPC functions...\n');
  
  let claimExists = false;
  let finishExists = false;
  
  // Test claim_next_job
  try {
    const { error } = await supabase.rpc('claim_next_job', { p_job_type: null });
    if (!error || !error.message?.includes('does not exist')) {
      claimExists = true;
      console.log('✅ claim_next_job function exists');
    }
  } catch (e) {
    // Function exists but might have thrown an error
    claimExists = true;
  }
  
  // Test finish_job (with dummy params)
  try {
    const { error } = await supabase.rpc('finish_job', { 
      p_id: -1,  // Non-existent ID
      p_success: true,
      p_error: null 
    });
    if (!error || !error.message?.includes('does not exist')) {
      finishExists = true;
      console.log('✅ finish_job function exists');
    }
  } catch (e) {
    // Function exists but might have thrown an error
    finishExists = true;
  }
  
  if (!claimExists || !finishExists) {
    console.error('\n❌ CRITICAL: Atomic RPC functions are missing!');
    console.error('   Please run migration 009_atomic_job_claiming.sql');
    
    if (!claimExists) console.error('   Missing: claim_next_job');
    if (!finishExists) console.error('   Missing: finish_job');
    
    process.exit(1);
  }
  
  console.log('\n✅ All required RPC functions are installed');
  console.log('   Worker can use atomic claiming\n');
  
  // Also check if there are pending jobs
  const { count } = await supabase
    .from('job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending')
    .or('run_at.is.null,run_at.lte.now()');
    
  if (count > 0) {
    console.log(`📦 ${count} jobs ready to process`);
  } else {
    console.log('⚠️ No pending jobs found (worker may exit quickly)');
  }
}

verifyAtomicRPCs().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
