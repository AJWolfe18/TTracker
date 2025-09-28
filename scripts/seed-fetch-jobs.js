#!/usr/bin/env node
// scripts/seed-fetch-jobs.js
// Production-ready RSS feed job seeder using atomic RPC + partial unique index

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Validate environment variables immediately
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Stable 32-char hash per feed
const hash = (obj) =>
  crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 32);

async function enqueueFeed(feed) {
  const payload = {
    feed_id: feed.id,
    url: feed.feed_url,       // backward-compat
    feed_url: feed.feed_url,  // worker compatibility
    source_name: feed.feed_name
  };
  const payloadHash = hash({ job: 'fetch_feed', feed_id: feed.id });

  // ATOMIC: Let the database handle duplicate detection
  const { data: jobId, error } = await supabase.rpc('enqueue_fetch_job', {
    p_type: 'fetch_feed',
    p_payload: payload,
    p_hash: payloadHash
  });
  
  if (error) {
    console.error(`❌ Error enqueueing ${feed.feed_name}:`, error.message);
    throw error;
  }
  
  // jobId is NULL if duplicate exists (partial unique index prevented insert)
  return jobId ? 'created' : 'skipped';
}

async function createFetchJobs() {
  console.log('📋 Creating RSS fetch jobs (atomic mode)...\n');

  // Check current runnable jobs count using RPC
  const { data: runnableBefore } = await supabase.rpc('count_runnable_fetch_jobs');
  console.log(`Runnable jobs before seeding: ${runnableBefore || 0}\n`);

  // Active feeds
  const { data: feeds, error: feedError } = await supabase
    .from('feed_registry')
    .select('id, feed_name, feed_url')
    .eq('is_active', true);

  if (feedError) {
    console.error('❌ Failed to fetch feeds:', feedError.message);
    process.exit(1);
  }
  if (!feeds?.length) {
    console.error('❌ No active feeds found in feed_registry');
    process.exit(1);
  }

  console.log(`Found ${feeds.length} active feeds\n`);

  let created = 0, skipped = 0, failed = 0;

  for (const feed of feeds) {
    try {
      const res = await enqueueFeed(feed);
      if (res === 'created') {
        console.log(`✅ Created job for: ${feed.feed_name}`);
        created++;
      } else {
        console.log(`⏭️ Job already active for: ${feed.feed_name}`);
        skipped++;
      }
    } catch {
      failed++;
    }
  }

  console.log('\n📊 Summary:');
  console.log(`   Created: ${created}`);
  console.log(`   Skipped (active): ${skipped}`);
  console.log(`   Failed: ${failed}`);

  // Verify runnable jobs using server-side function
  console.log('\n🔍 Checking for runnable jobs...');
  const { data: runnableCount, error: runErr } = await supabase.rpc('count_runnable_fetch_jobs');
  
  if (runErr) {
    console.error('❌ Failed to check runnable jobs:', runErr.message);
    process.exit(1);
  }

  if (runnableCount > 0) {
    console.log(`✅ ${runnableCount} fetch_feed jobs ready to run`);
  } else if (skipped > 0) {
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
