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
import { calculateHybridScore, getThreshold, canReopenStaleStory, GUARDRAIL, BONUSES, TIERED_GUARDRAIL, slugTokenSimilarity } from './scoring.js';
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
// TTRC-321 Phase 0: Diagnostic State and Helpers
// ============================================================================

// Environment flag to enable Phase 0 diagnostic logging
const LOG_PHASE0 = process.env.LOG_PHASE0_DIAGNOSTICS === 'true';

// Track titles seen this run for duplicate detection
// Store FIRST occurrence only - never overwrite
const seenTitlesThisRun = new Map(); // normalizedTitle -> { storyId }
let lastCandidateIds = [];  // Track candidates for current article

/**
 * IMPORTANT: Resolve dynamically to avoid module import order issues.
 * Using module-level const would capture null forever if imported before set.
 */
function getRunStart() {
  return globalThis.__RUN_START__ ?? null;
}

/**
 * Normalize title for duplicate detection
 * Removes all non-alphanumeric characters, lowercases, and collapses whitespace
 */
function normalizeTitle(title) {
  return (title || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Reset run state - call at start of each RSS run
 * Exported for use by rss-tracker-supabase.js
 */
export function resetRunState() {
  seenTitlesThisRun.clear();
  lastCandidateIds = [];
  console.log('[hybrid-clustering] Run state reset');
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

/**
 * TTRC-321: Single guardrail check used by both normal attach path and override path
 * Prevents logic drift when thresholds change (TTRC-315, etc.)
 * @param {object} article - Article being clustered
 * @param {object} story - Candidate story
 * @param {object} scoreResult - Result from calculateHybridScore
 * @returns {boolean} - Whether the article-story pair passes clustering guardrails
 */
function passesClusteringGuardrail(article, story, scoreResult) {
  const hasDecentEmbedding = scoreResult.embeddingScore >= GUARDRAIL.minEmbedding;
  const hasNonStopwordEntityOverlap = scoreResult.nonStopwordEntityOverlapCount > 0;
  const hasTitleMatch = scoreResult.titleScore >= GUARDRAIL.minTitle;
  const slugsMatch = article.topic_slug && story?.topic_slugs?.includes(article.topic_slug);

  const slugToken = slugTokenSimilarity(article.topic_slug, story?.topic_slugs || []);
  const hasSlugTokenOverlap = scoreResult.embeddingScore >= TIERED_GUARDRAIL.tokenOverlapEmbedMin && slugToken.passes;

  if (TIERED_GUARDRAIL.enabled) {
    return hasDecentEmbedding && (
      scoreResult.embeddingScore >= TIERED_GUARDRAIL.veryHighEmbedding ||
      slugsMatch || hasSlugTokenOverlap || hasNonStopwordEntityOverlap || hasTitleMatch
    );
  }
  return hasDecentEmbedding && (slugsMatch || hasNonStopwordEntityOverlap || hasTitleMatch);
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

  // 1. Fetch article with clustering-required fields only (TTRC-302 egress optimization)
  // Excludes: content, excerpt, scraped_html (not used in clustering, saves ~5KB/article)
  const { data: article, error: fetchError } = await getSupabaseClient()
    .from('articles')
    .select('id, title, embedding_v1, entities, published_at, source_name, source_domain, url, primary_actor, topic_slug, artifact_urls, quote_hashes, geo, opinion_flag')
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

  // TTRC-321 Phase 0: Store candidate IDs for diagnostic logging
  lastCandidateIds = candidates.__candidateIds || [];

  console.log(`[hybrid-clustering] Found ${candidates.length} candidates in ${candidateTime}ms`);

  // TTRC-319: Server-side similarity calculation (egress optimization)
  // Replaces centroid parsing - centroids no longer fetched, similarity computed in PostgreSQL

  // SAFEGUARD 1: Deduplicate story IDs (ANN/time/entity/slug blocks overlap heavily)
  const storyIds = [...new Set(candidates.map(c => c.id))];

  // SAFEGUARD 2: Handle null embeddings gracefully (don't force new story!)
  // Embedding is 45% of score, but title/entities/time/geo (55%) can still find matches
  let simMap = new Map();

  if (!article.embedding_v1 || article.embedding_v1.length === 0) {
    console.warn(`[hybrid-clustering] Article ${articleId} has no embedding - using 0 for similarity`);
    // Don't skip - let other signals (title, entity, time) do the work
    // simMap stays empty, all candidates get precomputedSimilarity = 0
  } else if (storyIds.length > 0) {
    // Call RPC for all candidates at once (single query)
    // Uses float8[] param - pass embedding array directly (not vector type)
    const { data: similarities, error: simError } = await getSupabaseClient()
      .rpc('get_embedding_similarities', {
        p_query_embedding: article.embedding_v1,
        p_story_ids: storyIds
      });

    // SAFEGUARD 3: Don't throw on RPC failure (especially in TEST)
    // Fallback to similarity=0, let other signals work
    if (simError) {
      console.error(`[hybrid-clustering] Similarity RPC failed (fallback to 0): ${simError.message}`);
      // simMap stays empty - all candidates get 0
    } else if (similarities) {
      simMap = new Map(similarities.map(s => [s.story_id, s.similarity]));
    }
  }

  // SAFEGUARD 4: Attach precomputed similarity to each candidate
  // ANN candidates already have similarity from find_similar_stories - use that
  // Non-ANN candidates need lookup from simMap (default 0 if centroid was null)
  candidates.forEach(c => {
    if (c.similarity !== undefined) {
      c.precomputedSimilarity = c.similarity;  // ANN already has it
    } else {
      c.precomputedSimilarity = simMap.get(c.id) ?? 0;  // Default 0 if not found
    }
  });

  if (candidateTime > 100) {
    console.warn(`[hybrid-clustering] ⚠️ Candidate generation slow: ${candidateTime}ms (target: <100ms)`);
  }

  // 5. Score each candidate - TTRC-309: now returns detailed object
  // TTRC-319: Pass precomputed similarity (server-side egress optimization)
  const scoringStart = Date.now();
  const scoredCandidates = candidates
    .map(story => ({
      story,
      scoreResult: calculateHybridScore(article, story, story.precomputedSimilarity)
    }))
    .sort((a, b) => b.scoreResult.total - a.scoreResult.total);  // Sort by total score descending
  const scoringTime = Date.now() - scoringStart;

  console.log(`[hybrid-clustering] Scored ${candidates.length} candidates in ${scoringTime}ms (${(scoringTime / candidates.length).toFixed(1)}ms avg per candidate)`);

  if (scoringTime > 50 * candidates.length) {
    console.warn(`[hybrid-clustering] ⚠️ Scoring slow: ${scoringTime}ms for ${candidates.length} candidates (target: <50ms per candidate)`);
  }

  // TTRC-321: Track top 2 candidates by EMBEDDING (not total) for margin gate
  // Use scoreResult.embeddingScore (source of truth), not story.precomputedSimilarity
  // which may be undefined/stale for non-ANN candidates
  const byEmbed = [...scoredCandidates].sort(
    (a, b) => (b.scoreResult?.embeddingScore ?? 0) - (a.scoreResult?.embeddingScore ?? 0)
  );
  const bestEmbedding = byEmbed[0]?.scoreResult?.embeddingScore ?? 0;
  const secondBestEmbedding = byEmbed[1]?.scoreResult?.embeddingScore ?? 0;
  const bestStoryIdByEmbed = byEmbed[0]?.story?.id ?? null;
  const secondStoryIdByEmbed = byEmbed[1]?.story?.id ?? null;

  // 6. Get adaptive threshold for this article
  const threshold = getThreshold(article);

  // 7. Find best match above threshold
  const bestMatch = scoredCandidates[0];

  // Debug logging for threshold comparison
  console.log(`[hybrid-clustering] Best match: score=${bestMatch?.scoreResult?.total?.toFixed(3) || 'N/A'}, threshold=${threshold.toFixed(3)}`);
  if (bestMatch) {
    console.log(`[hybrid-clustering] Best story: ID=${bestMatch.story.id}, headline="${bestMatch.story.primary_headline}"`);
  }

  if (bestMatch && bestMatch.scoreResult.total >= threshold) {
    const story = bestMatch.story;
    const scoreResult = bestMatch.scoreResult;

    // TTRC-321: Use helper function to check guardrail (prevents logic duplication)
    const passesGuardrail = passesClusteringGuardrail(article, story, scoreResult);

    // TTRC-306: Topic slug match (still needed for logging and bonus calculation)
    const slugsMatch = article.topic_slug && story.topic_slugs?.includes(article.topic_slug);

    // TTRC-315: Calculate slug token similarity for logging
    const slugToken = slugTokenSimilarity(article.topic_slug, story.topic_slugs);
    const hasSlugTokenOverlap = scoreResult.embeddingScore >= TIERED_GUARDRAIL.tokenOverlapEmbedMin && slugToken.passes;

    // Variables for logging only (guardrail check done in helper)
    const hasNonStopwordEntityOverlap = scoreResult.nonStopwordEntityOverlapCount > 0;
    const hasTitleMatch = scoreResult.titleScore >= GUARDRAIL.minTitle;

    // TTRC-315: Log merge reasons for analysis (ONLY if LOG_CLUSTER_GUARDRAIL=true)
    if (TIERED_GUARDRAIL.logEnabled) {
      const mergeReasons = [];
      if (scoreResult.embeddingScore >= TIERED_GUARDRAIL.veryHighEmbedding) mergeReasons.push('very_high_embedding');
      if (slugsMatch) mergeReasons.push('exact_slug_match');
      if (hasSlugTokenOverlap) mergeReasons.push(`slug_token(coeff=${slugToken.overlapCoeff.toFixed(2)},cnt=${slugToken.overlapCount},evt=${slugToken.hasEventOverlap},anc=${slugToken.hasAnchorOverlap})`);
      if (hasNonStopwordEntityOverlap) mergeReasons.push('entity_overlap');
      if (hasTitleMatch) mergeReasons.push('title_match');

      console.log(`[cluster-guardrail] ${articleId} → ${story.id}: ${passesGuardrail ? 'PASS' : 'BLOCK'} [${mergeReasons.join(', ') || 'none'}]`);
    }

    if (!passesGuardrail) {
      // Log blocked cluster for debugging/tuning (existing log, kept for backwards compat)
      console.log(`[cluster-guardrail-block] Article ${articleId} blocked from story ${story.id}:`, {
        totalScore: scoreResult.total.toFixed(3),
        threshold: threshold.toFixed(3),
        embeddingScore: scoreResult.embeddingScore.toFixed(3),
        titleScore: scoreResult.titleScore.toFixed(3),
        nonStopwordEntityOverlapCount: scoreResult.nonStopwordEntityOverlapCount,
        slugsMatch,
        hasSlugTokenOverlap,
        slugTokenDetails: slugToken,
        articleSlug: article.topic_slug,
        storySlugs: story.topic_slugs,
        minEmbedding: GUARDRAIL.minEmbedding,
        minTitle: GUARDRAIL.minTitle,
        tieredEnabled: TIERED_GUARDRAIL.enabled,
      });
      // Fall through to create new story
    } else {
      // TTRC-306: Calculate final score with slug bonus if matched
      let finalScore = scoreResult.total;
      if (slugsMatch) {
        finalScore = Math.min(finalScore + BONUSES.topicSlugMatch, 1.0);
        console.log(`[cluster-slug-match] Article ${articleId} matched story ${story.id} via slug "${article.topic_slug}"`);
      }

      // Check if story is stale and needs special permission
      const isStale = story.lifecycle_state === 'stale';

      if (isStale && !canReopenStaleStory(finalScore, article, story)) {
        console.log(`[hybrid-clustering] Story ${story.id} is stale and score ${finalScore} doesn't meet reopen criteria`);
        // Fall through to create new story
      } else {
        // Attach to existing story
        const result = await attachToStory(article, story, finalScore);

        const totalTime = Date.now() - totalStart;
        console.log(`[hybrid-clustering] ✅ Attached article ${articleId} to story ${story.id} (score: ${scoreResult.total.toFixed(3)}, threshold: ${threshold})`);
        console.log(`[PERF] Total clustering time: ${totalTime}ms (candidate: ${candidateTime}ms, scoring: ${scoringTime}ms)`);

        if (totalTime > 500) {
          console.warn(`[PERF] ⚠️ End-to-end clustering slow: ${totalTime}ms (target: <500ms p95)`);
        }

        return result;
      }
    }
  }

  // 8. No match found - create new story

  // ============================================================================
  // TTRC-321: Same-Run High-Embedding Override
  // Attach to same-run story when embedding is very high but total is below threshold
  // (happens because newborn stories have empty entity_counter)
  // HARDENING: Use top-by-embedding (byEmbed[0]) as override target, not best-by-total
  // ============================================================================

  // IMPORTANT: Override targets top-by-embedding, not best-by-total
  // They usually match, but if they differ we log it for debugging
  const overrideCandidate = byEmbed[0];
  const overrideStory = overrideCandidate?.story;
  // Use scoreResult.embeddingScore (source of truth) instead of story.precomputedSimilarity
  const topEmbedding = overrideCandidate?.scoreResult?.embeddingScore ?? 0;

  // Log if top-by-embedding differs from best-by-total (diagnostic)
  const topByTotalId = bestMatch?.story?.id ?? null;
  const topByEmbedId = overrideStory?.id ?? null;
  if (topByTotalId !== topByEmbedId && topByTotalId && topByEmbedId) {
    console.log(`[TTRC-321-DEBUG] top-by-total=${topByTotalId} differs from top-by-embedding=${topByEmbedId}`);
  }

  const isHighEmbed = topEmbedding >= 0.90;
  const runStart = getRunStart();
  // Stories use first_seen_at as creation timestamp (not created_at)
  const isSameRun = runStart && overrideStory?.first_seen_at &&
                    new Date(overrideStory.first_seen_at) >= runStart;
  // Use overrideCandidate's score (top-by-embedding), not bestMatch (top-by-total)
  const overrideScore = overrideCandidate?.scoreResult;
  const belowThreshold = typeof overrideScore?.total === 'number' && overrideScore.total < threshold;

  // Use helper - NO INLINE DUPLICATION of guardrail logic
  const overridePassesGuardrail = overrideScore
    ? passesClusteringGuardrail(article, overrideStory, overrideScore)
    : false;

  if (isHighEmbed && isSameRun && belowThreshold && overridePassesGuardrail) {
    // Safety gates (at least one must pass)
    const margin = topEmbedding - secondBestEmbedding;
    const hasMargin = margin >= 0.04;

    const overrideSlugTok = slugTokenSimilarity(article.topic_slug, overrideStory.topic_slugs);
    const hasSlugOverlap = overrideSlugTok.passes;

    // DEFENSIVE: Handle null/invalid timestamps gracefully
    // Stories use first_seen_at as creation timestamp (not created_at)
    const articlePubTime = article.published_at ? new Date(article.published_at).getTime() : NaN;
    const storyCreateTime = overrideStory.first_seen_at ? new Date(overrideStory.first_seen_at).getTime() : NaN;
    const timeDiffMs = Math.abs(articlePubTime - storyCreateTime);
    const hasTightWindow = Number.isFinite(timeDiffMs) && timeDiffMs < 2 * 60 * 60 * 1000;

    if (hasMargin || hasSlugOverlap || hasTightWindow) {
      // Log all gates that passed
      const reasons = [];
      if (hasMargin) reasons.push('margin');
      if (hasSlugOverlap) reasons.push('slug');
      if (hasTightWindow) reasons.push('time');

      // MUST LOG: Story IDs for margin gate debugging/tuning
      console.log(JSON.stringify({
        type: 'SAME_RUN_OVERRIDE',
        article_id: article.id,
        story_id: overrideStory.id,
        embeddingSim: topEmbedding.toFixed(3),
        secondBestEmbedding: secondBestEmbedding.toFixed(3),
        bestStoryIdByEmbed: bestStoryIdByEmbed,
        secondStoryIdByEmbed: secondStoryIdByEmbed,
        topByTotalDiffers: topByTotalId !== topByEmbedId,
        total: overrideScore.total.toFixed(3),
        threshold: threshold.toFixed(3),
        reasonsPassed: reasons,
        margin: margin.toFixed(3),
        slugPasses: hasSlugOverlap,
        timeWindowMinutes: Number.isFinite(timeDiffMs) ? Math.round(timeDiffMs / 60000) : null
      }));

      // Attach instead of creating new story (using overrideScore, not bestMatch)
      const overrideResult = await attachToStory(article, overrideStory, overrideScore.total);

      const totalTime = Date.now() - totalStart;
      console.log(`[hybrid-clustering] ✅ OVERRIDE: Attached article ${articleId} to same-run story ${overrideStory.id} (score: ${overrideScore.total.toFixed(3)}, threshold: ${threshold}, reasons: [${reasons.join(', ')}])`);
      console.log(`[PERF] Total clustering time: ${totalTime}ms (candidate: ${candidateTime}ms, scoring: ${scoringTime}ms)`);

      if (totalTime > 500) {
        console.warn(`[PERF] ⚠️ End-to-end clustering slow: ${totalTime}ms (target: <500ms p95)`);
      }

      return overrideResult;
    }
  }

  // ============================================================================
  // TTRC-321 Phase 0: Pre-creation diagnostic logging
  // ============================================================================
  if (LOG_PHASE0) {
    // Log decision context before creating new story
    console.log(`[DECISION] action=create_new_story article_id=${articleId} best_story_id=${bestMatch?.story?.id || 'none'} best_total=${bestMatch?.scoreResult?.total?.toFixed(3) || 'n/a'} embedding=${bestMatch?.scoreResult?.embeddingScore?.toFixed(3) || 'n/a'} threshold=${threshold.toFixed(3)}`);

    // Check if we're about to create a duplicate
    const norm = normalizeTitle(article.title);
    if (seenTitlesThisRun.has(norm)) {
      const prev = seenTitlesThisRun.get(norm);
      const expectedInCandidates = lastCandidateIds.includes(prev.storyId);
      const blocks = candidates.__blockResults || {};
      console.warn(`[ABOUT_TO_DUP] article_id=${articleId} normalized_title="${norm}" first_seen_story=${prev.storyId} first_story_in_candidates=${expectedInCandidates} best_story_id=${bestMatch?.story?.id || 'none'} best_total=${bestMatch?.scoreResult?.total?.toFixed(3) || 'n/a'}`);
      console.log(`[ABOUT_TO_DUP_DETAIL] time_has_expected=${blocks.time?.includes(prev.storyId)} entity_has_expected=${blocks.entity?.includes(prev.storyId)} ann_has_expected=${blocks.ann?.includes(prev.storyId)} slug_has_expected=${blocks.slug?.includes(prev.storyId)}`);
    }
  }

  const result = await createNewStory(article);

  // ============================================================================
  // TTRC-321 Phase 0: Post-creation diagnostic logging
  // ============================================================================
  if (LOG_PHASE0) {
    // Log story creation
    console.log(`[STORY_CREATED] story_id=${result.story_id} primary_headline="${article.title}" created_at=${new Date().toISOString()}`);

    const norm = normalizeTitle(article.title);
    if (seenTitlesThisRun.has(norm)) {
      // Confirmed duplicate - log with block-level detail
      const prev = seenTitlesThisRun.get(norm);
      const expectedInCandidates = lastCandidateIds.includes(prev.storyId);
      const blocks = candidates.__blockResults || {};
      console.warn(`[DUP_IN_RUN] article_id=${articleId} normalized_title="${norm}" created_story=${result.story_id} first_seen_story=${prev.storyId} expected_in_candidates=${expectedInCandidates} candidate_count=${lastCandidateIds.length}`);
      console.log(`[DUP_IN_RUN_DETAIL] time_has_expected=${blocks.time?.includes(prev.storyId)} entity_has_expected=${blocks.entity?.includes(prev.storyId)} ann_has_expected=${blocks.ann?.includes(prev.storyId)} slug_has_expected=${blocks.slug?.includes(prev.storyId)}`);

      // Log new story fields to check if filters explain non-visibility
      // Note: We don't have newStory object here, but result has story_id
      console.log(`[NEW_STORY_FIELDS] article_slug=${article.topic_slug || 'none'} article_entities_count=${article.entities?.length || 0}`);
    } else {
      // First time seeing this title - store it (never overwrite)
      seenTitlesThisRun.set(norm, { storyId: result.story_id });
    }
  }

  const totalTime = Date.now() - totalStart;
  console.log(`[hybrid-clustering] 🆕 Created new story ${result.story_id} for article ${articleId} (best score: ${bestMatch?.scoreResult?.total?.toFixed(3) || 'N/A'}, threshold: ${threshold})`);
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

  // TTRC-298: Aggregate article entities into story via atomic RPC
  const entityIds = (article.entities || [])
    .map(e => e?.id)
    .filter(Boolean);

  if (entityIds.length > 0) {
    try {
      await getSupabaseClient().rpc('increment_story_entities', {
        p_story_id: storyId,
        p_entity_ids: entityIds
      });
    } catch (rpcErr) {
      // Log but don't fail - entity aggregation is enhancement, not critical
      console.warn(`[hybrid-clustering] Entity aggregation failed for story ${storyId}: ${rpcErr.message}`);
    }
  }

  // TTRC-306: Aggregate article topic slug into story.topic_slugs
  if (article.topic_slug) {
    try {
      const { data: currentStoryData } = await getSupabaseClient()
        .from('stories')
        .select('topic_slugs')
        .eq('id', storyId)
        .single();

      const existingSlugs = currentStoryData?.topic_slugs || [];
      if (!existingSlugs.includes(article.topic_slug)) {
        await getSupabaseClient()
          .from('stories')
          .update({ topic_slugs: [...existingSlugs, article.topic_slug] })
          .eq('id', storyId);
      }
    } catch (slugErr) {
      // Log but don't fail - slug aggregation is enhancement, not critical
      console.warn(`[hybrid-clustering] Slug aggregation failed for story ${storyId}: ${slugErr.message}`);
    }
  }

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

  // TTRC-298: Build initial entity_counter from article.entities
  const entityCounter = {};
  const articleEntities = article.entities || [];
  for (const e of articleEntities) {
    if (e?.id) entityCounter[e.id] = 1;
  }
  const topEntities = Object.keys(entityCounter).slice(0, 8);

  // TTRC-306: Initialize topic_slugs with article's topic_slug
  const initialSlugs = article.topic_slug ? [article.topic_slug] : [];

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
      status: 'active',
      entity_counter: entityCounter,   // TTRC-298
      top_entities: topEntities,        // TTRC-298
      topic_slugs: initialSlugs         // TTRC-306
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
  resetRunState,
};
