/**
 * Periodic Merge Detection for Story Clustering (TTRC-231)
 *
 * Daily job to identify and merge duplicate stories
 * Merge criteria:
 * - Centroid similarity >0.70
 * - Share 3+ entities
 * - Within 5-day time window
 * - Same primary_actor
 */

import { createClient } from '@supabase/supabase-js';

// Lazy-initialize Supabase client
let supabase = null;

function getSupabaseClient() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabase;
}

// ============================================================================
// Merge Candidate Detection
// ============================================================================

/**
 * Find candidate story pairs for merging
 * Uses strict criteria to avoid false positives
 *
 * @param {number} limit - Max candidates to return (default: 10)
 * @param {number} threshold - Coherence threshold (default: 0.70)
 * @returns {Promise<{success: boolean, candidates?: array, error?: string}>}
 */
export async function findMergeCandidates(limit = 10, threshold = 0.70) {
  try {
    console.log('[periodic-merge] Finding merge candidates...');

    // Fetch active stories with centroid embeddings
    const { data: stories, error: fetchError } = await getSupabaseClient()
      .from('stories')
      .select('id, primary_headline, primary_actor, centroid_embedding_v1, top_entities, first_seen_at, last_updated_at')
      .in('status', ['active', 'closed'])
      .neq('centroid_embedding_v1', null)
      .order('last_updated_at', { ascending: false })
      .limit(100); // Consider recent stories only

    if (fetchError) {
      console.error('[periodic-merge] Failed to fetch stories:', fetchError.message);
      return {
        success: false,
        error: fetchError.message,
      };
    }

    if (!stories || stories.length < 2) {
      return {
        success: true,
        candidates: [],
      };
    }

    console.log(`[periodic-merge] Evaluating ${stories.length} stories for merge candidates...`);

    // Find pairs with high similarity
    const candidates = [];
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    for (let i = 0; i < stories.length; i++) {
      for (let j = i + 1; j < stories.length; j++) {
        const story1 = stories[i];
        const story2 = stories[j];

        // 1. Check time window (within 5 days)
        const time1 = new Date(story1.first_seen_at || story1.last_updated_at);
        const time2 = new Date(story2.first_seen_at || story2.last_updated_at);
        const daysDiff = Math.abs(time1 - time2) / (1000 * 60 * 60 * 24);
        if (daysDiff > 5) continue;

        // 2. Check primary actor match
        if (story1.primary_actor && story2.primary_actor && story1.primary_actor !== story2.primary_actor) {
          continue;
        }

        // 3. Check entity overlap (need 3+ shared entities)
        const entities1 = story1.top_entities || [];
        const entities2 = story2.top_entities || [];
        const sharedEntities = entities1.filter(e => entities2.includes(e));
        if (sharedEntities.length < 3) continue;

        // 4. Calculate centroid similarity (cosine)
        const similarity = cosineSimilarity(
          story1.centroid_embedding_v1,
          story2.centroid_embedding_v1
        );

        if (similarity >= threshold) {
          candidates.push({
            story1_id: story1.id,
            story2_id: story2.id,
            similarity,
            shared_entities: sharedEntities,
            story1_headline: story1.primary_headline,
            story2_headline: story2.primary_headline,
            primary_actor: story1.primary_actor || story2.primary_actor,
            days_apart: daysDiff.toFixed(1),
          });
        }
      }
    }

    // Sort by similarity (highest first) and limit
    candidates.sort((a, b) => b.similarity - a.similarity);
    const topCandidates = candidates.slice(0, limit);

    console.log(`[periodic-merge] Found ${topCandidates.length} merge candidates`);

    return {
      success: true,
      candidates: topCandidates,
    };

  } catch (error) {
    console.error('[periodic-merge] Unexpected error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ============================================================================
// Merge Execution
// ============================================================================

/**
 * Merge two stories (source → target)
 * Moves all articles from source to target, updates metadata, creates audit record
 *
 * @param {bigint} sourceId - Story to merge from
 * @param {bigint} targetId - Story to merge into
 * @param {object} metadata - Merge metadata (similarity, entities, reason)
 * @returns {Promise<{success: boolean, articlesMoved?: number, error?: string}>}
 */
export async function mergeStories(sourceId, targetId, metadata = {}) {
  try {
    console.log(`[periodic-merge] Merging story ${sourceId} → ${targetId}...`);

    // 1. Get article counts
    const { count: sourceArticleCount, error: countError } = await getSupabaseClient()
      .from('article_story')
      .select('*', { count: 'exact', head: true })
      .eq('story_id', sourceId);

    if (countError) {
      console.error('[periodic-merge] Failed to count source articles:', countError.message);
      return {
        success: false,
        error: countError.message,
      };
    }

    // 2. Move articles from source to target
    const { error: moveError } = await getSupabaseClient()
      .from('article_story')
      .update({ story_id: targetId })
      .eq('story_id', sourceId);

    if (moveError) {
      console.error('[periodic-merge] Failed to move articles:', moveError.message);
      return {
        success: false,
        error: moveError.message,
      };
    }

    // 3. Update source story status
    const { error: updateError } = await getSupabaseClient()
      .from('stories')
      .update({
        status: 'merged_into',
        merged_into_story_id: targetId,
      })
      .eq('id', sourceId);

    if (updateError) {
      console.warn('[periodic-merge] Failed to update source story:', updateError.message);
    }

    // 4. Update target story last_updated_at
    const { error: touchError } = await getSupabaseClient()
      .from('stories')
      .update({
        last_updated_at: new Date().toISOString(),
      })
      .eq('id', targetId);

    if (touchError) {
      console.warn('[periodic-merge] Failed to update target timestamp:', touchError.message);
    }

    // 5. Create audit record
    const { error: auditError } = await getSupabaseClient()
      .from('story_merge_actions')
      .insert({
        source_story_id: sourceId,
        target_story_id: targetId,
        coherence_score: metadata.similarity || null,
        shared_entities: metadata.shared_entities || [],
        articles_moved: sourceArticleCount || 0,
        performed_by: 'system',
        reason: metadata.reason || `Auto-merge: similarity=${(metadata.similarity || 0).toFixed(3)}`,
      });

    if (auditError) {
      console.warn('[periodic-merge] Failed to create audit record:', auditError.message);
    }

    console.log(`[periodic-merge] Merge complete: ${sourceArticleCount} articles moved`);

    return {
      success: true,
      articlesMoved: sourceArticleCount || 0,
    };

  } catch (error) {
    console.error('[periodic-merge] Unexpected error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// Main Job Entry Point
// ============================================================================

/**
 * Run periodic merge detection and execution
 * Main entry point for story.merge job handler
 *
 * @param {number} limit - Max merges to perform (default: 10)
 * @param {number} threshold - Similarity threshold (default: 0.70)
 * @returns {Promise<{success: boolean, candidates?: number, merged?: number, results?: array, error?: string}>}
 */
export async function runMergeDetection(limit = 10, threshold = 0.70) {
  try {
    console.log('[periodic-merge] Starting merge detection job...');

    // 1. Find candidates
    const candidatesResult = await findMergeCandidates(limit, threshold);

    if (!candidatesResult.success) {
      return {
        success: false,
        error: candidatesResult.error,
      };
    }

    const candidates = candidatesResult.candidates || [];

    if (candidates.length === 0) {
      console.log('[periodic-merge] No merge candidates found');
      return {
        success: true,
        candidates: 0,
        merged: 0,
        results: [],
      };
    }

    console.log(`[periodic-merge] Processing ${candidates.length} merge candidates...`);

    // 2. Execute merges
    const results = [];
    for (const candidate of candidates) {
      const mergeResult = await mergeStories(
        candidate.story1_id,
        candidate.story2_id,
        {
          similarity: candidate.similarity,
          shared_entities: candidate.shared_entities,
          reason: `Auto-merge: ${candidate.similarity.toFixed(3)} similarity, ${candidate.shared_entities.length} shared entities`,
        }
      );

      results.push({
        source: candidate.story1_id,
        target: candidate.story2_id,
        success: mergeResult.success,
        articlesMoved: mergeResult.articlesMoved,
        error: mergeResult.error,
      });

      // Small delay between merges to avoid overwhelming DB
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const successful = results.filter(r => r.success).length;

    console.log(`[periodic-merge] Merge job complete: ${successful}/${candidates.length} successful`);

    return {
      success: true,
      candidates: candidates.length,
      merged: successful,
      results,
    };

  } catch (error) {
    console.error('[periodic-merge] Unexpected error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// Export
// ============================================================================

export default {
  findMergeCandidates,
  mergeStories,
  runMergeDetection,
};
