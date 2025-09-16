// Test script for Job Queue Worker
// Run with: node test-job-queue.js

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://wnrjrywpcadwutfykflu.supabase.co'; // Default to TEST
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY in .env file');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function testJobQueue() {
  console.log('🧪 Testing Job Queue System\n');
  
  // 1. Check job_queue table exists
  console.log('1️⃣ Checking job_queue table...');
  const { data: tableCheck, error: tableError } = await supabase
    .from('job_queue')
    .select('count')
    .limit(1);
  
  if (tableError) {
    console.error('   ❌ job_queue table not found:', tableError.message);
    console.log('   Run migrations/002_job_queue_functions.sql first!');
    return;
  }
  console.log('   ✅ job_queue table exists\n');

  // 2. Test enqueuing jobs
  console.log('2️⃣ Testing job enqueue...');
  
  const testJobs = [
    {
      type: 'story.summarize',
      payload: { story_id: 'test-story-1', mode: 'neutral' }
    },
    {
      type: 'story.summarize',
      payload: { story_id: 'test-story-1', mode: 'spicy' }
    },
    {
      type: 'story.classify',
      payload: { story_id: 'test-story-1' }
    },
    {
      type: 'article.enrich',
      payload: { article_id: 'test-article-1' }
    }
  ];

  for (const job of testJobs) {
    const { data, error } = await supabase.rpc('enqueue_job', {
      p_type: job.type,
      p_payload: job.payload,
      p_priority: 5
    });
    
    if (error) {
      console.error(`   ❌ Failed to enqueue ${job.type}:`, error.message);
    } else {
      console.log(`   ✅ Enqueued ${job.type} (ID: ${data})`);
    }
  }
  console.log();

  // 3. Check queue status
  console.log('3️⃣ Checking queue status...');
  const { data: queueStatus, error: statusError } = await supabase
    .from('job_queue')
    .select('status, type')
    .order('created_at', { ascending: false })
    .limit(10);

  if (statusError) {
    console.error('   ❌ Failed to get queue status:', statusError.message);
  } else {
    console.log('   Recent jobs:');
    queueStatus.forEach(job => {
      const statusEmoji = {
        pending: '⏳',
        processing: '🔄',
        completed: '✅',
        failed: '❌'
      }[job.status] || '❓';
      console.log(`   ${statusEmoji} ${job.type} - ${job.status}`);
    });
  }
  console.log();

  // 4. Test claiming a job
  console.log('4️⃣ Testing job claim function...');
  const { data: claimedJob, error: claimError } = await supabase.rpc('claim_next_job', {
    job_types: ['story.summarize', 'story.classify', 'article.enrich']
  });

  if (claimError) {
    console.error('   ❌ Failed to claim job:', claimError.message);
    console.log('   Make sure claim_next_job function is created in database');
  } else if (claimedJob && claimedJob.length > 0) {
    const job = claimedJob[0];
    console.log(`   ✅ Claimed job ${job.id} (${job.type})`);
    console.log(`      Payload:`, JSON.stringify(job.payload, null, 2));
    
    // Mark it as completed for testing
    await supabase
      .from('job_queue')
      .update({ 
        status: 'completed', 
        completed_at: new Date().toISOString(),
        result: { test: true }
      })
      .eq('id', job.id);
    console.log(`      Marked as completed`);
  } else {
    console.log('   ℹ️ No jobs available to claim');
  }
  console.log();

  // 5. Queue statistics
  console.log('5️⃣ Queue Statistics:');
  const { data: stats, error: statsError } = await supabase
    .from('job_queue')
    .select('status');

  if (!statsError && stats) {
    const counts = stats.reduce((acc, job) => {
      acc[job.status] = (acc[job.status] || 0) + 1;
      return acc;
    }, {});
    
    console.log('   Status breakdown:');
    Object.entries(counts).forEach(([status, count]) => {
      console.log(`   - ${status}: ${count} job(s)`);
    });
    console.log(`   Total: ${stats.length} job(s)`);
  }
  console.log();

  // 6. Test idempotency
  console.log('6️⃣ Testing idempotency...');
  const duplicateJob = {
    type: 'story.summarize',
    payload: { story_id: 'idempotent-test', mode: 'neutral' }
  };

  const { data: job1 } = await supabase.rpc('enqueue_job', {
    p_type: duplicateJob.type,
    p_payload: duplicateJob.payload
  });

  const { data: job2 } = await supabase.rpc('enqueue_job', {
    p_type: duplicateJob.type,
    p_payload: duplicateJob.payload
  });

  if (job1 === job2) {
    console.log(`   ✅ Idempotency working (both returned ID: ${job1})`);
  } else {
    console.log(`   ❌ Idempotency check failed (ID1: ${job1}, ID2: ${job2})`);
  }
  console.log();

  console.log('✨ Job Queue tests complete!\n');
  console.log('Next steps:');
  console.log('1. Set OPENAI_API_KEY in .env file');
  console.log('2. Run: node scripts/job-queue-worker.js');
  console.log('3. The worker will process these test jobs');
}

// Run tests
testJobQueue().catch(console.error);
