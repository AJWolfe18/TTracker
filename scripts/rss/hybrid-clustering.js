/**
 * Hybrid Story Clustering (TTRC-230)
 *
 * Replaces legacy pg_trgm clustering with production-grade hybrid scoring:
 * - Candidate generation (OR-blocking): Time, Entity, ANN
 * - Hybrid scoring: 6+ signals with adaptive thresholds
 * - Centroid tracking: Real-time running average updates
 *
 * This module provides the main clustering logic for story.cluster jobs
 */

import { createClient } from '@supabase/supabase-js';
import { calculateHybridScore, getThreshold, canReopenStaleStory } from './scoring.js';
import { generateCandidates } from './candidate-generation.js';
import { updateCentroid, initializeCentroid, getArticleCount } from './centroid-tracking.js';
import { extractPrimaryActor } from './clustering.js';  // Keep legacy actor extraction

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
// Main Clustering Function
// ============================================================================

/**
 * Cluster article into story using hybrid scoring
 * @param {string} articleId - Article ID to cluster
 * @returns {object} - {story_id, created_new, reopened, score, status}
 */
export async function clusterArticle(articleId) {
  if (!articleId) {
    throw new Error('articleId required');
  }

  console.log(`[hybrid-clustering] Clustering article: ${articleId}`);

  // 1. Fetch article with all metadata
  const { data: article, error: fetchError } = await getSupabaseClient()
    .from('articles')
    .select('*')
    .eq('id', articleId)
    .single();

  if (fetchError || !article) {
    throw new Error(`Failed to fetch article: ${fetchError?.message || 'Not found'}`);
  }

  // 2. Check if already clustered
  const { data: existing, error: existingError } = await getSupabaseClient()
    .from('article_story')
    .select('story_id')
    .eq('article_id', articleId)
    .single();

  if (existing && !existingError) {
    console.log(`[hybrid-clustering] Article ${articleId} already clustered to story ${existing.story_id}`);
    return {
      story_id: existing.story_id,
      created_new: false,
      reopened: false,
      score: null,
      status: 'already_clustered'
    };
  }

  // 3. Extract primary actor if missing
  if (!article.primary_actor && article.title) {
    article.primary_actor = extractPrimaryActor(article.title);

    if (article.primary_actor) {
      await getSupabaseClient()
        .from('articles')
        .update({ primary_actor: article.primary_actor })
        .eq('id', articleId);
    }
  }

  // 4. Generate candidate stories
  const startTime = Date.now();
  const candidates = await generateCandidates(article);
  const candidateTime = Date.now() - startTime;

  console.log(`[hybrid-clustering] Found ${candidates.length} candidates in ${candidateTime}ms`);

  if (candidateTime > 100) {
    console.warn(`[hybrid-clustering] ⚠️ Candidate generation slow: ${candidateTime}ms (target: <100ms)`);
  }

  // 5. Score each candidate
  const scoredCandidates = candidates
    .map(story => ({
      story,
      score: calculateHybridScore(article, story)
    }))
    .sort((a, b) => b.score - a.score);  // Sort by score descending

  // 6. Get adaptive threshold for this article
  const threshold = getThreshold(article);

  // 7. Find best match above threshold
  const bestMatch = scoredCandidates[0];

  if (bestMatch && bestMatch.score >= threshold) {
    // Check if story is stale and needs special permission
    const story = bestMatch.story;
    const isStale = story.lifecycle_state === 'stale';

    if (isStale && !canReopenStaleStory(bestMatch.score, article, story)) {
      console.log(`[hybrid-clustering] Story ${story.id} is stale and score ${bestMatch.score} doesn't meet reopen criteria`);
      // Fall through to create new story
    } else {
      // Attach to existing story
      const result = await attachToStory(article, story, bestMatch.score);

      console.log(`[hybrid-clustering] ✅ Attached article ${articleId} to story ${story.id} (score: ${bestMatch.score.toFixed(3)}, threshold: ${threshold})`);

      return result;
    }
  }

  // 8. No match found - create new story
  const result = await createNewStory(article);

  console.log(`[hybrid-clustering] 🆕 Created new story ${result.story_id} for article ${articleId} (best score: ${bestMatch?.score?.toFixed(3) || 'N/A'}, threshold: ${threshold})`);

  return result;
}

// ============================================================================
// Story Assignment Functions
// ============================================================================

/**
 * Attach article to existing story
 * @param {object} article - Article to attach
 * @param {object} story - Story to attach to
 * @param {number} score - Similarity score
 * @returns {object} - Result object
 */
async function attachToStory(article, story, score) {
  const storyId = story.id;
  const reopened = story.lifecycle_state === 'stale';

  // 1. Get current article count BEFORE adding this one
  const currentCount = await getArticleCount(storyId);

  // 2. Insert into article_story junction table
  const { error: insertError } = await getSupabaseClient()
    .from('article_story')
    .insert({
      article_id: article.id,
      story_id: storyId,
      similarity_score: score,
      matched_at: new Date().toISOString(),
      is_primary_source: currentCount === 0  // First article is primary
    });

  if (insertError) {
    // Check for duplicate constraint
    if (insertError.code === '23505') {
      return {
        story_id: storyId,
        created_new: false,
        reopened: false,
        score: score,
        status: 'already_attached'
      };
    }
    throw new Error(`Failed to attach article: ${insertError.message}`);
  }

  // 3. Update story centroid
  await updateCentroid(storyId, article, currentCount);

  // 4. Update story metadata
  const updates = {
    last_updated_at: new Date().toISOString(),
    source_count: currentCount + 1
  };

  // Reopen stale story if needed
  if (reopened) {
    updates.lifecycle_state = 'growing';
  }

  await getSupabaseClient()
    .from('stories')
    .update(updates)
    .eq('id', storyId);

  return {
    story_id: storyId,
    created_new: false,
    reopened: reopened,
    score: score,
    status: 'attached'
  };
}

/**
 * Create new story for article
 * @param {object} article - Article to create story for
 * @returns {object} - Result object
 */
async function createNewStory(article) {
  // 1. Create story
  const { data: story, error: createError } = await getSupabaseClient()
    .from('stories')
    .insert({
      primary_headline: article.title,
      primary_source: article.source_name,
      primary_source_url: article.url,
      primary_source_domain: article.source_domain,
      primary_actor: article.primary_actor,
      first_seen_at: article.published_at || new Date().toISOString(),
      last_updated_at: article.published_at || new Date().toISOString(),
      source_count: 1,
      lifecycle_state: 'emerging',
      status: 'active'
    })
    .select()
    .single();

  if (createError || !story) {
    throw new Error(`Failed to create story: ${createError?.message || 'Unknown error'}`);
  }

  const storyId = story.id;

  // 2. Insert article-story link
  const { error: insertError } = await getSupabaseClient()
    .from('article_story')
    .insert({
      article_id: article.id,
      story_id: storyId,
      similarity_score: 1.0,  // Perfect match with self
      matched_at: new Date().toISOString(),
      is_primary_source: true
    });

  if (insertError) {
    // Rollback story creation if link fails
    await getSupabaseClient().from('stories').delete().eq('id', storyId);
    throw new Error(`Failed to link article to story: ${insertError.message}`);
  }

  // 3. Initialize centroid
  await initializeCentroid(storyId, article);

  return {
    story_id: storyId,
    created_new: true,
    reopened: false,
    score: 1.0,
    status: 'created'
  };
}

// ============================================================================
// Batch Clustering
// ============================================================================

/**
 * Cluster multiple articles in batch
 * More efficient for backfills
 * @param {number} limit - Max articles to process
 * @returns {object} - Results summary
 */
export async function clusterBatch(limit = 50) {
  console.log(`[hybrid-clustering] Starting batch clustering (limit: ${limit})`);

  // Get unclustered articles
  const { data: articles, error: fetchError } = await getSupabaseClient()
    .from('articles')
    .select('id')
    .is('embedding_v1', null)  // Articles without embeddings can't be clustered
    .not('id', 'in',
      getSupabaseClient().from('article_story').select('article_id')
    )
    .order('published_at', { ascending: true })  // Oldest first
    .limit(limit);

  if (fetchError) {
    throw new Error(`Failed to fetch articles: ${fetchError.message}`);
  }

  if (!articles || articles.length === 0) {
    console.log('[hybrid-clustering] No unclustered articles found');
    return {
      processed: 0,
      attached: 0,
      created: 0,
      errors: 0
    };
  }

  console.log(`[hybrid-clustering] Found ${articles.length} unclustered articles`);

  const results = {
    processed: 0,
    attached: 0,
    created: 0,
    reopened: 0,
    errors: 0
  };

  // Process each article
  for (const { id } of articles) {
    try {
      const result = await clusterArticle(id);

      results.processed++;
      if (result.created_new) {
        results.created++;
      } else if (result.status === 'attached') {
        results.attached++;
      }
      if (result.reopened) {
        results.reopened++;
      }

      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`[hybrid-clustering] Error clustering article ${id}:`, error.message);
      results.errors++;
    }
  }

  console.log('[hybrid-clustering] Batch clustering complete:', results);
  return results;
}

// ============================================================================
// Export
// ============================================================================

export default {
  clusterArticle,
  clusterBatch,
};
