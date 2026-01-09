/**
 * Enqueue Story Merge Job (TTRC-231)
 *
 * Helper script for GitHub Actions cron to enqueue a story.merge job.
 * This job detects and merges duplicate stories.
 *
 * Usage:
 *   node scripts/enqueue-merge-job.js
 *
 * Environment:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key for admin access
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  try {
    console.log('[enqueue-merge] Enqueueing story merge job...');

    const { data, error } = await supabase
      .from('job_queue')
      .insert({
        job_type: 'story.merge',
        priority: 5, // Medium priority
        payload: {
          triggered_by: 'github_actions_cron',
          triggered_at: new Date().toISOString(),
          limit: 10, // Max merges per run
          threshold: 0.70, // Similarity threshold
        },
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[enqueue-merge] Failed to enqueue job:', error.message);
      process.exit(1);
    }

    console.log(`[enqueue-merge] ✅ Job enqueued successfully (job_id: ${data.id})`);
    process.exit(0);

  } catch (error) {
    console.error('[enqueue-merge] Unexpected error:', error.message);
    process.exit(1);
  }
}

main();
