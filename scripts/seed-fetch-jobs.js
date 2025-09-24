#!/usr/bin/env node
// Create RSS fetch jobs for CI/CD workflow
// This replaces the inline node -e scripts in the GitHub workflow

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function createFetchJobs() {
  console.log('📋 Creating RSS fetch jobs...\n');
  
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
  
  // Create job for each feed
  for (const feed of feeds) {
    const { error } = await supabase
      .from('job_queue')
      .insert({
        job_type: 'fetch_feed',
        payload: {
          feed_id: feed.id,
          url: feed.feed_url,
          source_name: feed.feed_name
        },
        run_at: new Date().toISOString(),
        status: 'pending',
        attempts: 0
      })
      .select();
    
    if (!error) {
      console.log(`✅ Created job for: ${feed.feed_name}`);
      created++;
    } else if (error.message?.includes('duplicate') || error.message?.includes('unique')) {
      console.log(`⏭️ Job already exists for: ${feed.feed_name}`);
      skipped++;
    } else {
      console.error(`❌ Failed to create job for ${feed.feed_name}:`, error.message);
      failed++;
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   Created: ${created}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Failed: ${failed}`);
  
  if (created === 0 && skipped === 0) {
    console.error('\n❌ No jobs were created or found!');
    process.exit(1);
  }
  
  console.log('\n✅ Jobs ready for processing');
}

createFetchJobs().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
