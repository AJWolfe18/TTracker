#!/usr/bin/env node
// Production-ready RSS feed job seeder using atomic RPC
// Senior dev approved version - race-safe with partial unique index

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Generate consistent hash for payload
const hash = (obj) => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 32);

async function enqueueFeed(feed) {
  const payload = {
    feed_id: feed.id,
    url: feed.feed_url,      // for backward compatibility
    feed_url: feed.feed_url, // keep both for worker compatibility
    source_name: feed.feed_name
  };
  const payloadHash = hash({ job: 'fetch_feed', feed_id: feed.id });

  const { data: jobId, error } = await supabase.rpc('enqueue_fetch_job', {
    p_type: 'fetch_feed',
    p_payload: payload,
    p_hash: payloadHash
  });
  
  if (error) {
    console.error(`❌ Error enqueueing ${feed.feed_name}:`, error.message);
    throw error;
  }
  
  return jobId ? 'created' : 'skipped';
}

async function createFetchJobs() {
  console.log('📋 Creating RSS fetch jobs (atomic mode)...\n');
  
  // Get active feeds
  const { data: feeds, error: feedError } = await supabase
    .from('feed_registry')
    .select('*')
    .eq('is_active', true);
    
  if (feedError) {
    console.error('❌ Failed to fetch feeds:', feedError.message);
    process.exit(1);
  }
  
  if (!feeds || feeds.length === 0) {
    console.error('❌ No active feeds found in feed_registry');
    process.exit(1);
  }
  
  console.log(`Found ${feeds.length} active feeds\n`);
  
  let created = 0;
  let skipped = 0;
  let failed = 0;
  
  // Process each feed
  for (const feed of feeds) {
    try {
      const result = await enqueueFeed(feed);
      
      if (result === 'created') {
        console.log(`✅ Created job for: ${feed.feed_name}`);
        created++;
      } else {
        console.log(`⏭️ Job already active for: ${feed.feed_name}`);
        skipped++;
      }
    } catch (error) {
      failed++;
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped (active): ${skipped}`);
  console.log(`   Failed: ${failed}`);
  
  // Verify we have runnable jobs
  console.log('\n🔍 Checking for runnable jobs...');
  
  const { count: runnableCount } = await supabase
    .from('job_queue')
    .select('*', { count: 'exact', head: true })
    .eq('job_type', 'fetch_feed')
    .is('processed_at', null)
    .lte('run_at', new Date().toISOString());
    
  if (runnableCount > 0) {
    console.log(`✅ ${runnableCount} fetch_feed jobs ready to run`);
  } else if (skipped > 0) {
    // Jobs were skipped because they're already active - this is OK
    console.log(`ℹ️ No new jobs created but ${skipped} are already active`);
  } else {
    console.error('❌ No runnable jobs available!');
    process.exit(1);
  }
  
  console.log('\n✅ Job seeding complete - worker can proceed');
}

createFetchJobs().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
