/**
 * Enqueue Lifecycle Update Job (TTRC-231)
 *
 * Helper script for GitHub Actions cron to enqueue a story.lifecycle job.
 * This job updates all story lifecycle states based on age.
 *
 * Usage:
 *   node scripts/enqueue-lifecycle-job.js
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
    console.log('[enqueue-lifecycle] Enqueueing lifecycle update job...');

    const { data, error } = await supabase
      .from('job_queue')
      .insert({
        job_type: 'story.lifecycle',
        priority: 5, // Medium priority
        payload: {
          triggered_by: 'github_actions_cron',
          triggered_at: new Date().toISOString(),
        },
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[enqueue-lifecycle] Failed to enqueue job:', error.message);
      process.exit(1);
    }

    console.log(`[enqueue-lifecycle] ✅ Job enqueued successfully (job_id: ${data.id})`);
    process.exit(0);

  } catch (error) {
    console.error('[enqueue-lifecycle] Unexpected error:', error.message);
    process.exit(1);
  }
}

main();
