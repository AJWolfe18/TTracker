// Diagnose why jobs aren't runnable
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function diagnose() {
  console.log('\n🔍 JOB QUEUE DIAGNOSTICS');
  console.log('════════════════════════════════════');
  
  // Try the new RPC if available
  const { data: runnable, error: rpcErr } = await supabase.rpc('count_runnable_fetch_jobs');
  if (!rpcErr) {
    console.log(`\n✅ Runnable jobs (via RPC): ${runnable}`);
  } else {
    console.log('\n⚠️  count_runnable_fetch_jobs not available - run migration 017');
  }
  
  // Get diagnostic info
  const { data: diagnosis, error: diagErr } = await supabase.rpc('diagnose_job_queue');
  if (!diagErr && diagnosis) {
    console.log('\n📊 Job Queue Status:');
    console.log('─────────────────────');
    diagnosis.forEach(job => {
      const status = job.is_runnable ? '✅' : '❌';
      console.log(`${status} Job #${job.id}: ${job.status} - ${job.blocker}`);
      console.log(`   Attempts: ${job.attempts}/${job.max_attempts || '∞'}`);
      console.log(`   Run at: ${job.run_at || 'NOW'}`);
      if (job.status === 'processing') {
        console.log(`   Started: ${job.started_at}`);
      }
      console.log('');
    });
  } else {
    // Fallback to basic query
    console.log('\n📊 Fetching job queue status...');
    
    const { data: jobs, error } = await supabase
      .from('job_queue')
      .select('*')
      .eq('job_type', 'fetch_feed')
      .order('processed_at', { ascending: false, nullsFirst: true })
      .order('status')
      .limit(10);
    
    if (error) {
      console.error('Error fetching jobs:', error);
      return;
    }
    
    if (!jobs || jobs.length === 0) {
      console.log('No fetch_feed jobs found');
      return;
    }
    
    console.log(`Found ${jobs.length} fetch_feed jobs:\n`);
    
    const now = new Date();
    jobs.forEach(job => {
      const isActive = !job.processed_at;
      const status = isActive ? '🟡' : '✅';
      console.log(`${status} Job #${job.id}: ${job.status}`);
      console.log(`   Active: ${isActive}`);
      console.log(`   Attempts: ${job.attempts}/${job.max_attempts || '∞'}`);
      console.log(`   Run at: ${job.run_at || 'NOW'}`);
      
      // Check why it might be blocked
      if (isActive) {
        const blockers = [];
        
        if (job.status === 'processing' && job.started_at) {
          const minutesProcessing = (now - new Date(job.started_at)) / 60000;
          if (minutesProcessing < 5) {
            blockers.push(`Processing for ${minutesProcessing.toFixed(1)} min (not stale yet)`);
          }
        }
        
        if (job.run_at && new Date(job.run_at) > now) {
          blockers.push(`Future run_at: ${job.run_at}`);
        }
        
        if (job.max_attempts && job.attempts >= job.max_attempts) {
          blockers.push(`Max attempts reached: ${job.attempts}/${job.max_attempts}`);
        }
        
        if (blockers.length > 0) {
          console.log(`   ⚠️  Blocked by: ${blockers.join(', ')}`);
        } else if (job.status === 'pending') {
          console.log(`   ✅ Should be runnable!`);
        }
      }
      
      if (job.last_error) {
        console.log(`   Error: ${job.last_error.slice(0, 50)}...`);
      }
      console.log('');
    });
  }
}

diagnose().catch(console.error);
