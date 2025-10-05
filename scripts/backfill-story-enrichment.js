#!/usr/bin/env node

/**
 * Backfill Script: Story Enrichment (TTRC-191)
 * 
 * Enqueues enrichment jobs for all active stories missing summaries.
 * 
 * Features:
 * - Dry-run mode (--dry-run flag)
 * - Batch processing (10 stories at a time, 5s pause between batches)
 * - Rate limiting (2s delay between individual jobs)
 * - Cost estimation (~$0.0004 per story)
 * - Idempotency (via payload_hash)
 * - Resume support (skips duplicate jobs)
 * 
 * Usage:
 *   # Dry run (safe, no changes)
 *   node scripts/backfill-story-enrichment.js --dry-run
 * 
 *   # Real run (enqueues jobs)
 *   node scripts/backfill-story-enrichment.js
 * 
 * Environment Variables Required (from .env):
 *   SUPABASE_URL - TEST Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - TEST service role key
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================

const COST_PER_STORY = 0.0004; // Estimated OpenAI enrichment cost
const BATCH_SIZE = 10;         // Stories per batch
const BATCH_PAUSE_MS = 5000;   // 5 second pause between batches
const JOB_DELAY_MS = 2000;     // 2 second delay between individual jobs

// ============================================================================
// ENVIRONMENT VALIDATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ Missing required environment variables:');
  console.error('   SUPABASE_URL');
  console.error('   SUPABASE_SERVICE_ROLE_KEY');
  console.error('   (Check your .env file)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate MD5 hash for idempotency
 */
function calculatePayloadHash(type, payload) {
  const payloadStr = JSON.stringify(payload);
  const hashInput = `${type}:${payloadStr}`;
  return crypto.createHash('md5').update(hashInput).digest('hex');
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Enqueue a single enrichment job
 */
async function enqueueJob(storyId, dryRun = false) {
  const jobType = 'story.enrich';
  const payload = { story_id: storyId };
  const payloadHash = calculatePayloadHash(jobType, payload);

  if (dryRun) {
    return { status: 'dry-run', storyId };
  }

  // Insert job with idempotency check
  const { data, error } = await supabase
    .from('job_queue')
    .insert({
      type: jobType,
      payload: payload,
      payload_hash: payloadHash,
      status: 'pending',
      run_at: new Date().toISOString()
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // Check if duplicate (unique constraint violation)
    if (error.code === '23505') {
      return { status: 'duplicate', storyId };
    }
    return { status: 'error', storyId, error: error.message };
  }

  return { status: 'queued', storyId, jobId: data?.id };
}

// ============================================================================
// MAIN SCRIPT
// ============================================================================

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('\n🚀 Story Enrichment Backfill');
  console.log('━'.repeat(50));
  
  if (isDryRun) {
    console.log('🔬 MODE: DRY RUN (no changes will be made)\n');
  } else {
    console.log('⚠️  MODE: REAL RUN (jobs will be enqueued)\n');
  }

  // =========================================================================
  // STEP 1: Find unenriched stories
  // =========================================================================
  
  console.log('🔍 Finding stories needing enrichment...');
  
  const { data: stories, error: queryError } = await supabase
    .from('stories')
    .select('id, primary_headline, status')
    .eq('status', 'active')
    .is('summary_spicy', null)
    .order('last_updated_at', { ascending: false });

  if (queryError) {
    console.error('❌ Failed to query stories:', queryError.message);
    process.exit(1);
  }

  if (!stories || stories.length === 0) {
    console.log('✅ No stories need enrichment. All done!');
    process.exit(0);
  }

  console.log(`📊 Found ${stories.length} stories needing enrichment`);
  
  const estimatedCost = stories.length * COST_PER_STORY;
  console.log(`💰 Estimated cost: $${estimatedCost.toFixed(4)}\n`);

  // =========================================================================
  // STEP 2: Show sample (dry-run mode)
  // =========================================================================
  
  if (isDryRun) {
    console.log('📋 Sample stories (first 5):');
    stories.slice(0, 5).forEach(story => {
      const headline = story.primary_headline || '(no headline)';
      const preview = headline.length > 60 
        ? headline.substring(0, 57) + '...' 
        : headline;
      console.log(`   - ${story.id}: ${preview}`);
    });
    
    console.log(`\n✅ Dry run complete. Run without --dry-run to enqueue jobs.\n`);
    process.exit(0);
  }

  // =========================================================================
  // STEP 3: Enqueue jobs (real run)
  // =========================================================================
  
  console.log('⚙️  Enqueueing jobs...\n');

  let queued = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const progress = `[${i + 1}/${stories.length}]`;

    // Enqueue job
    const result = await enqueueJob(story.id);

    // Report result
    if (result.status === 'queued') {
      console.log(`✅ ${progress} Queued (job ${result.jobId})`);
      queued++;
    } else if (result.status === 'duplicate') {
      console.log(`⏭️  ${progress} Skipped (duplicate)`);
      skipped++;
    } else if (result.status === 'error') {
      console.log(`❌ ${progress} Error: ${result.error}`);
      errors++;
    }

    // Rate limiting: 2s between jobs
    if (i < stories.length - 1) {
      await sleep(JOB_DELAY_MS);
    }

    // Batch pause: 5s after every 10 stories
    if ((i + 1) % BATCH_SIZE === 0 && i < stories.length - 1) {
      console.log(`⏸️  Batch complete. Pausing 5s...\n`);
      await sleep(BATCH_PAUSE_MS);
    }
  }

  // =========================================================================
  // STEP 4: Summary
  // =========================================================================
  
  console.log('\n━'.repeat(50));
  console.log('📈 Backfill Summary:');
  console.log(`   ✅ Queued:  ${queued}`);
  console.log(`   ⏭️  Skipped: ${skipped} (duplicates)`);
  if (errors > 0) {
    console.log(`   ❌ Errors:  ${errors}`);
  }
  console.log(`   💰 Estimated cost: $${(queued * COST_PER_STORY).toFixed(4)}`);
  console.log('━'.repeat(50));

  if (queued > 0) {
    console.log('\n🎯 Next steps:');
    console.log('   1. Monitor job_queue status:');
    console.log('      SELECT status, COUNT(*) FROM job_queue');
    console.log('      WHERE type=\'story.enrich\' GROUP BY status;');
    console.log('\n   2. Check enrichment progress:');
    console.log('      SELECT COUNT(*) FROM stories');
    console.log('      WHERE summary_spicy IS NOT NULL;');
  }

  console.log('');
}

// ============================================================================
// RUN
// ============================================================================

main().catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
