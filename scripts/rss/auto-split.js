/**
 * Auto-Split Detection for Story Clustering (TTRC-231)
 *
 * Detects when a story contains unrelated articles (low internal coherence)
 * and splits them into separate stories.
 *
 * Coherence threshold: <0.50 triggers split
 * Uses pairwise cosine similarity of article embeddings
 */

import { createClient } from '@supabase/supabase-js';
import { clusterArticle } from './hybrid-clustering.js';

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
// Coherence Calculation
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} - Similarity score (0.0-1.0)
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

/**
 * Calculate internal coherence of a story
 * Returns median pairwise cosine similarity of article embeddings
 *
 * @param {bigint} storyId - Story ID
 * @param {number} sampleSize - Max articles to sample for performance (default: 20)
 * @returns {Promise<{success: boolean, coherence?: number, articleCount?: number, error?: string}>}
 */
export async function calculateInternalCoherence(storyId, sampleSize = 20) {
  try {
    // Fetch articles with embeddings
    const { data: articles, error } = await getSupabaseClient()
      .from('article_story')
      .select('article_id, articles!inner(id, embedding_v1)')
      .eq('story_id', storyId);

    if (error) {
      console.error('[auto-split] Failed to fetch articles:', error.message);
      return {
        success: false,
        error: error.message,
      };
    }

    if (!articles || articles.length < 2) {
      // Need at least 2 articles to calculate coherence
      return {
        success: true,
        coherence: 1.0, // Single article is perfectly coherent
        articleCount: articles?.length || 0,
      };
    }

    // Extract embeddings (filter out nulls)
    const embeddings = articles
      .map(a => a.articles?.embedding_v1)
      .filter(e => e && e.length > 0);

    if (embeddings.length < 2) {
      console.warn('[auto-split] Not enough embeddings for coherence calculation');
      return {
        success: true,
        coherence: null, // Cannot calculate
        articleCount: articles.length,
      };
    }

    // Sample if too many articles (performance optimization)
    let sampled = embeddings;
    if (embeddings.length > sampleSize) {
      sampled = [];
      const step = Math.floor(embeddings.length / sampleSize);
      for (let i = 0; i < embeddings.length; i += step) {
        sampled.push(embeddings[i]);
        if (sampled.length >= sampleSize) break;
      }
    }

    // Calculate pairwise similarities
    const similarities = [];
    for (let i = 0; i < sampled.length; i++) {
      for (let j = i + 1; j < sampled.length; j++) {
        const sim = cosineSimilarity(sampled[i], sampled[j]);
        similarities.push(sim);
      }
    }

    if (similarities.length === 0) {
      return {
        success: true,
        coherence: 1.0,
        articleCount: articles.length,
      };
    }

    // Calculate median similarity
    similarities.sort((a, b) => a - b);
    const mid = Math.floor(similarities.length / 2);
    const median = similarities.length % 2 === 0
      ? (similarities[mid - 1] + similarities[mid]) / 2
      : similarities[mid];

    console.log(`[auto-split] Story ${storyId}: coherence=${median.toFixed(3)}, articles=${articles.length}`);

    return {
      success: true,
      coherence: median,
      articleCount: articles.length,
    };

  } catch (error) {
    console.error('[auto-split] Unexpected error:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============================================================================
// Split Detection & Execution
// ============================================================================

/**
 * Check if a story should be split due to low coherence
 * @param {bigint} storyId - Story ID
 * @param {number} threshold - Coherence threshold (default: 0.50)
 * @returns {Promise<{shouldSplit: boolean, coherence?: number, reason?: string}>}
 */
export async function shouldSplitStory(storyId, threshold = 0.50) {
  const result = await calculateInternalCoherence(storyId);

  if (!result.success || result.coherence === null) {
    return {
      shouldSplit: false,
      reason: 'Cannot calculate coherence',
    };
  }

  if (result.articleCount < 2) {
    return {
      shouldSplit: false,
      coherence: result.coherence,
      reason: 'Story has < 2 articles',
    };
  }

  return {
    shouldSplit: result.coherence < threshold,
    coherence: result.coherence,
    reason: result.coherence < threshold
      ? `Coherence ${result.coherence.toFixed(3)} below threshold ${threshold}`
      : `Coherence ${result.coherence.toFixed(3)} above threshold`,
  };
}

/**
 * Split a story by re-clustering its articles
 * Returns new stories created
 *
 * @param {bigint} storyId - Story ID to split
 * @returns {Promise<{success: boolean, newStories?: number[], originalStory: bigint, error?: string}>}
 */
export async function splitStory(storyId) {
  try {
    console.log(`[auto-split] Splitting story ${storyId}...`);

    // 1. Fetch all articles in the story
    const { data: links, error: fetchError } = await getSupabaseClient()
      .from('article_story')
      .select('article_id, articles!inner(id, title, embedding_v1, entities, url)')
      .eq('story_id', storyId);

    if (fetchError || !links || links.length < 2) {
      return {
        success: false,
        error: 'Failed to fetch articles or insufficient articles',
        originalStory: storyId,
      };
    }

    const articles = links.map(l => l.articles);
    console.log(`[auto-split] Found ${articles.length} articles to re-cluster`);

    // 2. Remove articles from original story
    const { error: deleteError } = await getSupabaseClient()
      .from('article_story')
      .delete()
      .eq('story_id', storyId);

    if (deleteError) {
      console.error('[auto-split] Failed to remove articles from story:', deleteError.message);
      return {
        success: false,
        error: deleteError.message,
        originalStory: storyId,
      };
    }

    // 3. Re-cluster each article using hybrid clustering
    const newStoryIds = new Set();
    for (const article of articles) {
      try {
        const result = await clusterArticle(article.id);
        if (result.success && result.story_id) {
          newStoryIds.add(result.story_id);
        }
      } catch (err) {
        console.error(`[auto-split] Failed to cluster article ${article.id}:`, err.message);
      }
    }

    // 4. Mark original story as split (update status)
    const { error: updateError } = await getSupabaseClient()
      .from('stories')
      .update({
        status: 'archived', // Mark as archived
        // Could add a 'split_at' timestamp column in future
      })
      .eq('id', storyId);

    if (updateError) {
      console.warn('[auto-split] Failed to mark original story as split:', updateError.message);
    }

    const newStories = Array.from(newStoryIds);
    console.log(`[auto-split] Split complete: ${articles.length} articles → ${newStories.length} stories`);

    return {
      success: true,
      originalStory: storyId,
      newStories,
      articlesProcessed: articles.length,
    };

  } catch (error) {
    console.error('[auto-split] Unexpected error:', error.message);
    return {
      success: false,
      error: error.message,
      originalStory: storyId,
    };
  }
}

/**
 * Check and split a story if needed
 * Main entry point for story.split job handler
 *
 * @param {bigint} storyId - Story ID
 * @param {number} threshold - Coherence threshold (default: 0.50)
 * @returns {Promise<{success: boolean, split: boolean, coherence?: number, newStories?: number[], error?: string}>}
 */
export async function checkAndSplitStory(storyId, threshold = 0.50) {
  // 1. Check if split is needed
  const check = await shouldSplitStory(storyId, threshold);

  if (!check.shouldSplit) {
    return {
      success: true,
      split: false,
      coherence: check.coherence,
      reason: check.reason,
    };
  }

  // 2. Execute split
  const result = await splitStory(storyId);

  return {
    success: result.success,
    split: result.success,
    coherence: check.coherence,
    originalStory: result.originalStory,
    newStories: result.newStories,
    articlesProcessed: result.articlesProcessed,
    error: result.error,
  };
}

// ============================================================================
// Export
// ============================================================================

export default {
  calculateInternalCoherence,
  shouldSplitStory,
  splitStory,
  checkAndSplitStory,
};
