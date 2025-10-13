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
// Utility Functions
// ============================================================================

/**
 * Simple string hash function (djb2 algorithm)
 * Used for generating story_hash from headline
 * @param {string} str - String to hash
 * @returns {string} - Hash as hex string
 */
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16);
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

  const totalStart = Date.now();
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

  // 4. Parse embeddings if they're JSON strings (Supabase returns vectors as strings)
  if (article.embedding_v1 && typeof article.embedding_v1 === 'string') {
    article.embedding_v1 = JSON.parse(article.embedding_v1);
  }

  // 5. Generate candidate stories
  const startTime = Date.now();
  const candidates = await generateCandidates(article);
  const candidateTime = Date.now() - startTime;

  // Parse candidate story centroids
  candidates.forEach(story => {
    if (story.centroid_embedding_v1 && typeof story.centroid_embedding_v1 === 'string') {
      story.centroid_embedding_v1 = JSON.parse(story.centroid_embedding_v1);
    }
  });

  console.log(`[hybrid-clustering] Found ${candidates.length} candidates in ${candidateTime}ms`);

  if (candidateTime > 100) {
    console.warn(`[hybrid-clustering] ⚠️ Candidate generation slow: ${candidateTime}ms (target: <100ms)`);
  }

  // 5. Score each candidate
  const scoringStart = Date.now();
  const scoredCandidates = candidates
    .map(story => ({
      story,
      score: calculateHybridScore(article, story)
    }))
    .sort((a, b) => b.score - a.score);  // Sort by score descending
  const scoringTime = Date.now() - scoringStart;

  console.log(`[hybrid-clustering] Scored ${candidates.length} candidates in ${scoringTime}ms (${(scoringTime / candidates.length).toFixed(1)}ms avg per candidate)`);

  if (scoringTime > 50 * candidates.length) {
    console.warn(`[hybrid-clustering] ⚠️ Scoring slow: ${scoringTime}ms for ${candidates.length} candidates (target: <50ms per candidate)`);
  }

  // 6. Get adaptive threshold for this article
  const threshold = getThreshold(article);

  // 7. Find best match above threshold
  const bestMatch = scoredCandidates[0];

  // Debug logging for threshold comparison
  console.log(`[hybrid-clustering] Best match: score=${bestMatch?.score?.toFixed(3) || 'N/A'}, threshold=${threshold.toFixed(3)}`);
  if (bestMatch) {
    console.log(`[hybrid-clustering] Best story: ID=${bestMatch.story.id}, headline="${bestMatch.story.primary_headline}"`);
  }

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

      const totalTime = Date.now() - totalStart;
      console.log(`[hybrid-clustering] ✅ Attached article ${articleId} to story ${story.id} (score: ${bestMatch.score.toFixed(3)}, threshold: ${threshold})`);
      console.log(`[PERF] Total clustering time: ${totalTime}ms (candidate: ${candidateTime}ms, scoring: ${scoringTime}ms)`);

      if (totalTime > 500) {
        console.warn(`[PERF] ⚠️ End-to-end clustering slow: ${totalTime}ms (target: <500ms p95)`);
      }

      return result;
    }
  }

  // 8. No match found - create new story
  const result = await createNewStory(article);

  const totalTime = Date.now() - totalStart;
  console.log(`[hybrid-clustering] 🆕 Created new story ${result.story_id} for article ${articleId} (best score: ${bestMatch?.score?.toFixed(3) || 'N/A'}, threshold: ${threshold})`);
  console.log(`[PERF] Total clustering time: ${totalTime}ms (candidate: ${candidateTime}ms, scoring: ${scoringTime}ms)`);

  if (totalTime > 500) {
    console.warn(`[PERF] ⚠️ End-to-end clustering slow: ${totalTime}ms (target: <500ms p95)`);
  }

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
    
    // Get current reopen_count to increment it
    const { data: currentStory } = await getSupabaseClient()
      .from('stories')
      .select('reopen_count')
      .eq('id', storyId)
      .single();
    
    updates.reopen_count = (currentStory?.reopen_count || 0) + 1;
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
  // Generate story_hash from headline (simple hash for uniqueness)
  const storyHash = hashString(article.title || 'untitled');

  // 1. Create story
  const { data: story, error: createError } = await getSupabaseClient()
    .from('stories')
    .insert({
      primary_headline: article.title,
      story_hash: storyHash,
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

  // Get articles with embeddings (we'll skip already clustered ones in the loop)
  const { data: articles, error: fetchError } = await getSupabaseClient()
    .from('articles')
    .select('id')
    .not('embedding_v1', 'is', null)  // Articles with embeddings
    .order('published_at', { ascending: false })  // Newest first
    .limit(limit * 2);  // Get extra to account for already clustered

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

  const timings = [];
  const batchStart = Date.now();

  // Process each article
  for (const { id } of articles) {
    try {
      const articleStart = Date.now();
      const result = await clusterArticle(id);
      const articleTime = Date.now() - articleStart;

      timings.push(articleTime);

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

  const batchTime = Date.now() - batchStart;

  // Calculate percentiles
  timings.sort((a, b) => a - b);
  const p50 = timings[Math.floor(timings.length * 0.50)] || 0;
  const p95 = timings[Math.floor(timings.length * 0.95)] || 0;
  const p99 = timings[Math.floor(timings.length * 0.99)] || 0;
  const avg = timings.length > 0 ? timings.reduce((a, b) => a + b, 0) / timings.length : 0;

  console.log('[hybrid-clustering] Batch clustering complete:', results);
  console.log(`[PERF] Batch performance: ${batchTime}ms total, ${avg.toFixed(0)}ms avg`);
  console.log(`[PERF] Latency percentiles: p50=${p50}ms, p95=${p95}ms, p99=${p99}ms`);

  if (p95 > 500) {
    console.warn(`[PERF] ⚠️ p95 latency ${p95}ms exceeds target (500ms)`);
  }

  return results;
}

// ============================================================================
// Export
// ============================================================================

export default {
  clusterArticle,
  clusterBatch,
};
