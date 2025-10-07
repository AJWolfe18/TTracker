/**
 * Job Queue Helper Functions
 * Utilities for enqueueing jobs with idempotency
 */

/**
 * Insert-or-ignore job using partial unique (job_type,payload_hash WHERE processed_at IS NULL).
 * Returns { status: 'queued'|'duplicate', job? }
 *
 * @param {Object} supabase - Supabase client
 * @param {Object} options - Job options
 * @param {string} options.type - Job type (e.g., 'story.enrich', 'story.cluster')
 * @param {Object} options.payload - Job payload
 * @param {number} [options.delayMs=0] - Delay before job should run (milliseconds)
 * @returns {Promise<Object>} Result with status ('queued' | 'duplicate') and job data
 */
export async function enqueueJob(supabase, { type, payload, delayMs = 0 }) {
  if (!type) {
    throw new Error('Job type is required');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Job payload must be an object');
  }

  const runAt = new Date(Date.now() + delayMs).toISOString();

  // DO NOTHING on conflict (no UPDATEs). Supabase JS: use insert + ignoreDuplicates:true
  const { data, error } = await supabase
    .from('job_queue')
    .insert(
      [{ job_type: type, payload, status: 'pending', run_at: runAt }],
      { ignoreDuplicates: true }                   // <-- prevents updates
    )
    .select();

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    // Conflict path → duplicate active job
    return {
      status: 'duplicate',
      message: `Job already queued: ${type}`,
      payload
    };
  }

  return {
    status: 'queued',
    job: data[0]
  };
}

/**
 * Enqueue enrichment job for a story
 * Convenience wrapper for story enrichment jobs
 *
 * @param {Object} supabase - Supabase client
 * @param {number} storyId - Story ID to enrich
 * @param {number} [delayMs=5000] - Delay before enrichment (default 5 seconds)
 * @returns {Promise<Object>} Enqueue result
 */
export async function enqueueStoryEnrichment(supabase, storyId, delayMs = 5000) {
  return enqueueJob(supabase, {
    type: 'story.enrich',
    payload: { story_id: storyId },
    delayMs
  });
}

/**
 * Enqueue clustering job for an article
 * Convenience wrapper for article clustering jobs
 *
 * @param {Object} supabase - Supabase client
 * @param {string} articleId - Article ID to cluster
 * @param {number} [delayMs=0] - Delay before clustering
 * @returns {Promise<Object>} Enqueue result
 */
export async function enqueueArticleClustering(supabase, articleId, delayMs = 0) {
  return enqueueJob(supabase, {
    type: 'story.cluster',
    payload: { article_id: articleId },
    delayMs
  });
}
