/**
 * TTRC-230: Story Clustering Job Handler (Hybrid Scoring)
 *
 * Handles 'story.cluster' jobs from the queue
 * Uses production-grade hybrid scoring (6+ signals, adaptive thresholds)
 * Replaces legacy pg_trgm clustering
 *
 * Migration: TTRC-142 → TTRC-230 (legacy → hybrid)
 */

import { clusterArticle, clusterBatch } from './rss/hybrid-clustering.js';
import { withDatabaseRetry } from './utils/retry.js';
import { enqueueStoryEnrichment } from './utils/job-helpers.js';

/**
 * Process a story clustering job using hybrid scoring
 * @param {Object} job - Job from the queue
 * @param {Object} supabase - Supabase client instance
 */
export async function processStoryClusterJob(job, supabase) {
  // Defensive: handle if called with just payload or with job object
  const payload = job?.payload || job;
  const { article_id } = payload;

  if (!article_id) {
    console.log('[story.cluster] Skipping job with missing article_id');
    return { status: 'skipped', reason: 'missing_article_id' };
  }

  console.log(`[story.cluster] Processing hybrid clustering for article: ${article_id}`);

  try {
    // Call hybrid clustering algorithm with retry
    const result = await withDatabaseRetry(() =>
      clusterArticle(article_id)
    );

    const { story_id, created_new, reopened, score, status } = result;

    console.log(`[story.cluster] Article ${article_id} ${status}:`, {
      story_id,
      created_new,
      reopened,
      score: score?.toFixed(3),
      status
    });

    // Trigger enrichment for new or reopened stories
    if ((created_new || reopened) && story_id) {
      try {
        const enrichResult = await enqueueStoryEnrichment(supabase, story_id, 5000);

        if (enrichResult.status === 'queued') {
          const action = created_new ? 'new' : 'reopened';
          console.log(`[story.cluster] ✅ Enqueued enrichment for ${action} story ${story_id}`);
        } else if (enrichResult.status === 'duplicate') {
          console.log(`[story.cluster] ℹ️ Enrichment already queued for story ${story_id}`);
        }
      } catch (enrichError) {
        console.error(`[story.cluster] ⚠️ Failed to enqueue enrichment for story ${story_id}:`, enrichError);
        // Don't fail the clustering job if enrichment enqueue fails
      }
    }

    return result;

  } catch (error) {
    console.error(`[story.cluster] Error processing article ${article_id}:`, error);
    throw error;
  }
}

/**
 * Batch clustering handler using hybrid scoring
 * More efficient for initial backfill or bulk operations
 */
export async function processBatchClusterJob(job, supabase) {
  const { limit = 50 } = job.payload;

  console.log(`[story.cluster.batch] Processing hybrid batch clustering for up to ${limit} articles`);

  try {
    // Call hybrid batch clustering
    const results = await clusterBatch(limit);

    console.log('[story.cluster.batch] Batch clustering complete:', results);
    return results;

  } catch (error) {
    console.error('[story.cluster.batch] Batch processing failed:', error);
    throw error;
  }
}

// Export handlers
export const handlers = {
  'story.cluster': processStoryClusterJob,
  'story.cluster.batch': processBatchClusterJob
};
