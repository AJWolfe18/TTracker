import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyJobQueueSchema() {
  console.log('Checking TEST job_queue schema...\n');
  
  // Get a sample row to see columns
  try {
    const { data: jobs, error: jobError } = await supabase
      .from('job_queue')
      .select('*')
      .limit(1);
    
    if (jobError) {
      console.log('Error fetching job_queue:', jobError.message);
      return;
    }
    
    if (jobs && jobs.length > 0) {
      console.log('✅ Columns found in job_queue:');
      Object.keys(jobs[0]).forEach(col => {
        const value = jobs[0][col];
        const type = value === null ? 'null' : typeof value;
        console.log(`  - ${col}: ${type}`);
      });
      
      console.log('\n📊 Sample job data:');
      console.log(JSON.stringify(jobs[0], null, 2));
    } else {
      console.log('⚠️ No jobs found in job_queue table');
    }
    
    // Check for stuck jobs - Pattern 1: Has completed_at but wrong status
    console.log('\n🔍 Checking for stuck jobs...\n');
    
    // First, let's see what statuses we have
    const { data: statuses } = await supabase
      .from('job_queue')
      .select('status')
      .limit(100);
    
    if (statuses) {
      const uniqueStatuses = [...new Set(statuses.map(s => s.status))];
      console.log('Unique status values found:', uniqueStatuses);
    }
    
    // Check if we have the columns we're looking for
    if (jobs && jobs.length > 0) {
      const sampleJob = jobs[0];
      
      if ('status' in sampleJob && 'completed_at' in sampleJob) {
        const { data: wrongStatus, count: wrongCount } = await supabase
          .from('job_queue')
          .select('id, status, completed_at, started_at', { count: 'exact' })
          .eq('status', 'pending')
          .not('completed_at', 'is', null);
        
        if (wrongCount && wrongCount > 0) {
          console.log(`\n⚠️ Found ${wrongCount} jobs with status='pending' BUT completed_at is set:`);
          if (wrongStatus) {
            wrongStatus.slice(0, 5).forEach(job => {
              console.log(`  Job ${job.id}: completed at ${job.completed_at}`);
            });
          }
        } else {
          console.log('✅ No jobs with mismatched status/completed_at');
        }
      }
      
      if ('started_at' in sampleJob) {
        // Check for jobs started long ago
        const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        
        const { data: oldJobs, count: oldCount } = await supabase
          .from('job_queue')
          .select('id, job_type, started_at, status, completed_at', { count: 'exact' })
          .lt('started_at', thirtyMinutesAgo)
          .is('completed_at', null);
        
        if (oldCount && oldCount > 0) {
          console.log(`\n⚠️ Found ${oldCount} jobs started >30 minutes ago but not completed:`);
          if (oldJobs) {
            oldJobs.slice(0, 5).forEach(job => {
              console.log(`  Job ${job.id} (${job.job_type}): started ${job.started_at}, status: ${job.status}`);
            });
          }
        } else {
          console.log('✅ No jobs stuck for >30 minutes');
        }
      }
    }
    
    // Check what functions exist
    console.log('\n📚 Checking for RPC functions...');
    
    // Try to call finish_job to see if it exists
    try {
      const { error: finishError } = await supabase.rpc('finish_job', {
        p_job_id: -1,  // Non-existent ID
        p_status: 'done',
        p_result: null,
        p_error: null
      });
      
      if (finishError && finishError.message.includes('does not exist')) {
        console.log('❌ finish_job function does not exist');
      } else {
        console.log('✅ finish_job function exists');
      }
    } catch (e) {
      console.log('❌ finish_job function not found or has different signature');
    }
    
    try {
      const { error: resetError } = await supabase.rpc('reset_stuck_jobs', {});
      
      if (resetError && resetError.message.includes('does not exist')) {
        console.log('❌ reset_stuck_jobs function does not exist');
      } else {
        console.log('✅ reset_stuck_jobs function exists');
      }
    } catch (e) {
      console.log('❌ reset_stuck_jobs function not found');
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

verifyJobQueueSchema().catch(console.error);
