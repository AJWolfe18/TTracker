import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixStuckJobs() {
  console.log('🔧 Fixing stuck RSS jobs...\n');
  
  // 1. Fix jobs with completed_at but wrong status
  console.log('Step 1: Fixing jobs with completed_at but status=pending...');
  
  const { data: wrongStatus, error: error1 } = await supabase
    .from('job_queue')
    .update({ status: 'done' })
    .eq('status', 'pending')
    .not('completed_at', 'is', null)
    .select();
    
  if (error1) {
    console.error('Error fixing wrong status:', error1);
  } else {
    console.log(`✅ Fixed ${wrongStatus?.length || 0} jobs with wrong status\n`);
  }
  
  // 2. Mark old stuck jobs as failed
  console.log('Step 2: Timing out jobs started >30 minutes ago...');
  
  const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  
  const { data: timedOut, error: error2 } = await supabase
    .from('job_queue')
    .update({ 
      status: 'failed',
      completed_at: new Date().toISOString(),
      last_error: 'Job timed out after 30 minutes'
    })
    .lt('started_at', thirtyMinutesAgo)
    .is('completed_at', null)
    .select();
    
  if (error2) {
    console.error('Error timing out jobs:', error2);
  } else {
    console.log(`✅ Timed out ${timedOut?.length || 0} stuck jobs\n`);
  }
  
  // 3. Call reset_stuck_jobs RPC if it exists
  console.log('Step 3: Calling reset_stuck_jobs RPC...');
  
  const { data: resetCount, error: error3 } = await supabase
    .rpc('reset_stuck_jobs', {});
    
  if (error3) {
    console.error('Error calling reset_stuck_jobs:', error3);
  } else {
    console.log(`✅ RPC reset ${resetCount || 0} additional jobs\n`);
  }
  
  // 4. Show current state
  console.log('📊 Current job queue state:');
  
  const { data: summary } = await supabase
    .from('job_queue')
    .select('status, job_type')
    .order('created_at', { ascending: false })
    .limit(100);
    
  if (summary) {
    // Group by status
    const statusCounts = {};
    summary.forEach(job => {
      const key = `${job.status} - ${job.job_type}`;
      statusCounts[key] = (statusCounts[key] || 0) + 1;
    });
    
    Object.entries(statusCounts).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}`);
    });
  }
  
  console.log('\n✅ Cleanup complete!');
}

fixStuckJobs().catch(console.error);
