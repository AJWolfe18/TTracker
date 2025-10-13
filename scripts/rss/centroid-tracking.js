/**
 * Centroid Tracking for Story Clustering (TTRC-230)
 *
 * Implements dual update strategy:
 * - Real-time: Running average for fast updates
 * - Nightly: Exact recompute to fix drift
 *
 * Also maintains:
 * - entity_counter: {entity_id: count} frequency map
 * - top_entities: Top-5 entity IDs for GIN filtering
 */

import { createClient } from '@supabase/supabase-js';

// Lazy-initialize Supabase client (don't create at module load time)
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
// Real-Time Centroid Updates
// ============================================================================

/**
 * Update story centroid after adding new article
 * Uses running average formula: new_centroid = (old_centroid * n + new_embedding) / (n + 1)
 * @param {bigint} storyId - Story ID
 * @param {object} article - Article with embedding_v1, entities
 * @param {number} currentArticleCount - Number of articles in story BEFORE adding this one
 * @returns {boolean} - Success
 */
export async function updateCentroid(storyId, article, currentArticleCount) {
  if (!storyId || !article) return false;

  try {
    // 1. Get current story data
    const { data: story, error: fetchError } = await getSupabaseClient()
      .from('stories')
      .select('centroid_embedding_v1, entity_counter, top_entities')
      .eq('id', storyId)
      .single();

    if (fetchError || !story) {
      console.error('[centroid-tracking] Failed to fetch story:', fetchError?.message);
      return false;
    }

    // 2. Calculate new centroid (running average)
    let updatedCentroid = null;
    if (article.embedding_v1 && article.embedding_v1.length > 0) {
      if (story.centroid_embedding_v1 && currentArticleCount > 0) {
        // Running average: (old * n + new) / (n + 1)
        const n = currentArticleCount;
        updatedCentroid = story.centroid_embedding_v1.map((val, i) =>
          (val * n + article.embedding_v1[i]) / (n + 1)
        );
      } else {
        // First article in story
        updatedCentroid = article.embedding_v1;
      }
    }

    // 3. Update entity counter
    const entityCounter = story.entity_counter || {};
    if (article.entities && article.entities.length > 0) {
      for (const entity of article.entities) {
        if (entity.id) {
          entityCounter[entity.id] = (entityCounter[entity.id] || 0) + 1;
        }
      }
    }

    // 4. Sync top_entities from entity_counter (top 5 by count)
    const topEntities = Object.entries(entityCounter)
      .sort((a, b) => b[1] - a[1])  // Sort by count descending
      .slice(0, 5)
      .map(([id]) => id);

    // 5. Update database
    const { error: updateError } = await getSupabaseClient()
      .from('stories')
      .update({
        centroid_embedding_v1: updatedCentroid,
        entity_counter: entityCounter,
        top_entities: topEntities,
      })
      .eq('id', storyId);

    if (updateError) {
      console.error('[centroid-tracking] Failed to update story:', updateError.message);
      return false;
    }

    console.log(`[centroid-tracking] Updated story ${storyId} centroid (${currentArticleCount + 1} articles, ${topEntities.length} top entities)`);
    return true;

  } catch (error) {
    console.error('[centroid-tracking] Unexpected error:', error.message);
    return false;
  }
}

/**
 * Initialize centroid for new story (first article)
 * @param {bigint} storyId - Story ID
 * @param {object} article - Article with embedding_v1, entities
 * @returns {boolean} - Success
 */
export async function initializeCentroid(storyId, article) {
  if (!storyId || !article) return false;

  try {
    // Build entity counter from first article
    const entityCounter = {};
    if (article.entities && article.entities.length > 0) {
      for (const entity of article.entities) {
        if (entity.id) {
          entityCounter[entity.id] = 1;
        }
      }
    }

    // Top entities (up to 5)
    const topEntities = Object.keys(entityCounter).slice(0, 5);

    // Update database
    const { error } = await getSupabaseClient()
      .from('stories')
      .update({
        centroid_embedding_v1: article.embedding_v1 || null,
        entity_counter: entityCounter,
        top_entities: topEntities,
      })
      .eq('id', storyId);

    if (error) {
      console.error('[centroid-tracking] Failed to initialize centroid:', error.message);
      return false;
    }

    console.log(`[centroid-tracking] Initialized story ${storyId} centroid (${topEntities.length} entities)`);
    return true;

  } catch (error) {
    console.error('[centroid-tracking] Unexpected error:', error.message);
    return false;
  }
}

// ============================================================================
// Nightly Exact Recompute
// ============================================================================

/**
 * Trigger nightly recompute job (calls SQL function)
 * Fixes drift from running averages by computing exact centroids
 * @returns {boolean} - Success
 */
export async function triggerNightlyRecompute() {
  try {
    console.log('[centroid-tracking] Starting nightly centroid recompute...');

    const { error } = await getSupabaseClient().rpc('recompute_story_centroids');

    if (error) {
      console.error('[centroid-tracking] Nightly recompute failed:', error.message);
      return false;
    }

    console.log('[centroid-tracking] Nightly recompute completed successfully');
    return true;

  } catch (error) {
    console.error('[centroid-tracking] Unexpected error in recompute:', error.message);
    return false;
  }
}

// ============================================================================
// Utility: Get Article Count for Story
// ============================================================================

/**
 * Get current article count for story
 * @param {bigint} storyId - Story ID
 * @returns {number} - Article count
 */
export async function getArticleCount(storyId) {
  if (!storyId) return 0;

  try {
    const { count, error } = await getSupabaseClient()
      .from('article_story')
      .select('*', { count: 'exact', head: true })
      .eq('story_id', storyId);

    if (error) {
      console.error('[centroid-tracking] Failed to count articles:', error.message);
      return 0;
    }

    return count || 0;

  } catch (error) {
    console.error('[centroid-tracking] Unexpected error counting articles:', error.message);
    return 0;
  }
}

// ============================================================================
// Export
// ============================================================================

export default {
  updateCentroid,
  initializeCentroid,
  triggerNightlyRecompute,
  getArticleCount,
};
