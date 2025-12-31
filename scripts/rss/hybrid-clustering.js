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

// Environment flag to enable near-miss diagnostic logging (TTRC-324 v2)
// Defaults to true for initial debugging, set to 'false' to disable
const LOG_NEAR_MISS = process.env.LOG_NEAR_MISS !== 'false';

// ============================================================================
// TTRC-331: Tier B Margin Bypass (feature-flagged)
// ============================================================================
// Feature flag - defaults OFF. Enable with ENABLE_TIERB_MARGIN_BYPASS=true
const ENABLE_TIERB_MARGIN_BYPASS = process.env.ENABLE_TIERB_MARGIN_BYPASS === 'true';
// Shadow log rate limit - max 10 per run to avoid log spam
const TIERB_BYPASS_SHADOW_LIMIT = 10;
// Counter for shadow logs - MUST be module-scope (outside per-article loop)
let tierBBypassShadowCount = 0;

// Track titles seen this run for duplicate detection
// Store FIRST occurrence only - never overwrite
const seenTitlesThisRun = new Map(); // normalizedTitle -> { storyId }
let lastCandidateIds = [];  // Track candidates for current article

// ============================================================================
// TTRC-336: In-Memory Batch Story Tracking
// ============================================================================
// Track stories created during THIS batch run for same-run dedup
// Used as FALLBACK when DB candidate generation misses newborn stories
const batchStoriesThisRun = new Map(); // storyId -> BatchStoryEntry

// Feature flags for TTRC-336 batch dedup
const ENABLE_BATCH_DEDUP = process.env.ENABLE_BATCH_DEDUP === 'true';
const BATCH_DEDUP_SHADOW_MODE = process.env.BATCH_DEDUP_SHADOW_MODE !== 'false'; // Default true initially

// Run-level stats for observability (TTRC-323/324/336)
let runStats = {
  created: 0,
  attachedNormal: 0,
  attached321SameRun: 0,
  attached323ExactTitle: 0,
  attached324TierA: 0,
  attached324TierB: 0,
  latestArticlePubRpcFails: 0,  // TTRC-326: Track RPC failures for observability
  // TTRC-336: Batch dedup stats
  batchDedupConsidered: 0,      // How often batch cache was checked
  batchDedupAttached: 0,        // How often batch dedup resulted in merge
  batchDedupRejected: 0,        // How often rejected (and why)
  batchDedupShadow: 0           // Shadow mode decisions logged
};

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
 * TTRC-331: Build blocked_by array from gate booleans
 * Returns list of failed gates in deterministic order
 * Uses RAW margin gate (pre-bypass) to show honest failures
 */
function buildBlockedBy(gates) {
  const blockers = [];
  const order = ['guardrail', 'time', 'embed', 'corroboration', 'margin'];
  for (const k of order) {
    if (!gates[k]) blockers.push(k);
  }
  return blockers;
}

/**
 * TTRC-324 v2: Stopwords for title token overlap
 * Filters common newsroom words that would create false corroboration
 */
const TITLE_STOPWORDS = new Set([
  // Common function words (length >= 5)
  'about', 'after', 'before', 'could', 'would', 'should',
  'their', 'there', 'where', 'which', 'while', 'being',
  'first', 'under', 'again', 'these', 'those', 'other',
  'between', 'through', 'during', 'against', 'further',
  // Generic newsroom tokens
  'release', 'released', 'report', 'reports', 'reported',
  'latest', 'update', 'updates', 'updated', 'breaking',
  'official', 'officials', 'sources', 'according',
  'court', 'ruling', 'judge', 'judges', 'trial',
  'probe', 'probes', 'investigation', 'investigators',
  'policy', 'policies', 'admin', 'administration',
  'statement', 'statements', 'spokesman', 'spokesperson',
  // Opinion/feature pieces
  'exclusive', 'analysis', 'opinion', 'interview', 'explainer'
]);

/**
 * TTRC-324 v2: Critical acronyms that should count as meaningful tokens
 * even though they're shorter than 5 characters
 * NOTE: 'who' excluded - ambiguous with common pronoun
 */
const ACRONYM_ALLOWLIST = new Set([
  'doj', 'ice', 'fbi', 'cia', 'nsa', 'sec', 'ftc', 'epa', 'irs',
  'cdc', 'dhs', 'atf', 'dea', 'nato', 'gop', 'dnc', 'rnc'
]);

/**
 * TTRC-324 v2: Get count of shared meaningful tokens between two titles
 * Filters stopwords, requires length >= 5 OR is a critical acronym
 * @param {string} title1 - First title
 * @param {string} title2 - Second title
 * @returns {number} - Count of unique shared meaningful tokens
 */
function getTitleTokenOverlap(title1, title2) {
  if (!title1 || !title2) return 0;

  const normalize = t => t.toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(tok =>
      (tok.length >= 5 && !TITLE_STOPWORDS.has(tok)) ||
      ACRONYM_ALLOWLIST.has(tok)
    );

  const tokens1 = new Set(normalize(title1));
  const tokens2 = new Set(normalize(title2));

  let count = 0;
  for (const tok of tokens2) {
    if (tokens1.has(tok)) count++;
  }
  return count;
}

// ============================================================================
// TTRC-336: Batch Dedup Helper Functions
// ============================================================================

/**
 * TTRC-336: Common tokens that don't count toward batch dedup corroboration
 * These are high-frequency political terms that would create false matches
 */
const BATCH_COMMON_TOKENS = new Set([
  'trump', 'biden', 'netanyahu', 'america', 'congress',
  'supreme', 'federal', 'national', 'president', 'administration',
  'judge', 'court', 'says', 'amid', 'after', 'meeting'
]);

/**
 * TTRC-336: Short geo terms that should count as meaningful tokens
 */
const SHORT_GEO_TERMS = new Set(['iran', 'gaza', 'iraq', 'cuba', 'nato', 'un']);

/**
 * TTRC-336: Slugs too broad to count as corroboration
 */
const GENERIC_SLUGS = new Set([
  'us-politics', 'immigration', 'foreign-policy',
  'breaking', 'news', 'analysis', 'politics', 'world'
]);

/**
 * TTRC-336: Roundup headline detection pattern
 */
const ROUNDUP_RE = /at a glance|live updates|live blog|what we know|latest updates|morning briefing|evening briefing|roundup|what happened/i;

/**
 * TTRC-336: Check if a token is meaningful for batch dedup
 * Includes acronyms (3-6 chars ALL CAPS) and short geo terms
 */
function isMeaningfulTokenForBatch(tok) {
  if (!tok) return false;
  const upper = tok.toUpperCase();
  const lower = tok.toLowerCase();

  // 1. Acronyms: 3-6 chars, ALL CAPS (CFPB, DOJ, ICE, DHS, EEOC, NATO)
  if (tok.length >= 3 && tok.length <= 6 && tok === upper) return true;

  // 2. Short geo terms allowlist
  if (SHORT_GEO_TERMS.has(lower)) return true;

  // 3. Normal words: 5+ chars, not in common tokens denylist
  if (tok.length >= 5 && !BATCH_COMMON_TOKENS.has(lower)) return true;

  return false;
}

/**
 * TTRC-336: Extract meaningful tokens from a headline for batch dedup
 */
function getMeaningfulTokens(title) {
  if (!title) return [];
  return title
    .split(/[^a-zA-Z0-9]+/)
    .filter(isMeaningfulTokenForBatch);
}

/**
 * TTRC-336: Count overlapping meaningful tokens between article and story
 */
function getMeaningfulTokenOverlap(articleTokens, storyTokens) {
  if (!articleTokens?.length || !storyTokens?.length) return 0;
  const storySet = new Set(storyTokens.map(t => t.toLowerCase()));
  let count = 0;
  for (const tok of articleTokens) {
    if (storySet.has(tok.toLowerCase())) count++;
  }
  return count;
}

/**
 * TTRC-336: Check if slug overlap is valid (non-empty and non-generic)
 */
function hasValidSlugOverlap(articleSlugs, storySlugs) {
  // Story must have non-empty slugs
  if (!storySlugs || storySlugs.length === 0) return false;
  if (!articleSlugs || articleSlugs.length === 0) return false;

  // Find overlapping slugs not in generic denylist
  const articleSlugSet = new Set(Array.isArray(articleSlugs) ? articleSlugs : [articleSlugs]);
  for (const slug of storySlugs) {
    if (articleSlugSet.has(slug) && !GENERIC_SLUGS.has(slug)) {
      return true;
    }
  }
  return false;
}

/**
 * TTRC-336: Check if headline (or dek) matches roundup patterns
 */
function isRoundup(headline, dek = '') {
  return ROUNDUP_RE.test(headline) || ROUNDUP_RE.test(dek);
}

/**
 * TTRC-336: Compute cosine similarity between two embedding vectors
 * Assumes embeddings are already normalized to unit length
 */
function cosineSimilarity(embA, embB) {
  if (!embA?.length || !embB?.length || embA.length !== embB.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < embA.length; i++) {
    dotProduct += embA[i] * embB[i];
  }
  // Embeddings are normalized, so dot product = cosine similarity
  // Map from [-1, 1] to [0, 1] for consistency with existing scoring
  return (dotProduct + 1) / 2;
}

/**
 * TTRC-336: Find best matching story from batch cache
 * Implements tiered thresholds and semantic corroboration
 * @param {object} article - Article being clustered
 * @param {Map} batchCache - Map of storyId -> BatchStoryEntry
 * @returns {object|null} - {story, sim, decision, rejectReason} or null
 */
function findBatchStoryMatch(article, batchCache) {
  if (!ENABLE_BATCH_DEDUP || batchCache.size === 0) return null;
  if (!article.embedding_v1) return null;

  const articleEmbedding = typeof article.embedding_v1 === 'string'
    ? JSON.parse(article.embedding_v1)
    : article.embedding_v1;

  const articleTokens = getMeaningfulTokens(article.title);
  const articleSlugs = article.topic_slug ? [article.topic_slug] : [];
  const isRoundupArticle = isRoundup(article.title);

  // 1. Score all candidates
  const scored = [];
  for (const [storyId, batchStory] of batchCache) {
    if (!batchStory.embedding) continue;
    const sim = cosineSimilarity(articleEmbedding, batchStory.embedding);
    scored.push({ story: batchStory, sim });
  }

  if (scored.length === 0) return null;

  // 2. Filter to ELIGIBLE candidates only
  const eligible = scored.filter(({ story, sim }) => {
    // Roundup articles need ≥0.93
    if (isRoundupArticle && sim < 0.93) return false;

    // Base threshold
    if (sim < 0.88) return false;

    // TTRC-336 fix: Removed standalone mode (embed >= 0.93 without corroboration)
    // Shadow run showed 2/3 false positives at 0.93 with title_token 0-1
    // All batch dedup matches now require corroboration
    const tokenOverlap = getMeaningfulTokenOverlap(articleTokens, story.title_tokens || []);
    const slugOk = hasValidSlugOverlap(articleSlugs, story.topic_slugs || []);

    return tokenOverlap >= 2 || slugOk;
  });

  runStats.batchDedupConsidered++;

  if (eligible.length === 0) {
    runStats.batchDedupRejected++;
    return { story: null, sim: scored[0]?.sim || 0, decision: 'reject', rejectReason: 'no_eligible_candidates' };
  }

  // 3. Sort eligible by similarity
  eligible.sort((a, b) => b.sim - a.sim);

  const top1 = eligible[0];
  const top2 = eligible[1] ?? null;

  // 4. Ambiguity rejection (only among eligible candidates)
  if (top2 && (top1.sim - top2.sim) < 0.02) {
    runStats.batchDedupRejected++;
    return { story: null, sim: top1.sim, decision: 'reject', rejectReason: 'ambiguity' };
  }

  // 5. Tie-break: prefer earliest story among near-ties
  let selectedStory = top1.story;
  if (top2 && Math.abs(top1.sim - top2.sim) < 0.005) {
    // Prefer story with lower ID (created earlier)
    selectedStory = top1.story.id < top2.story.id ? top1.story : top2.story;
  }

  return { story: selectedStory, sim: top1.sim, decision: 'attach', rejectReason: null };
}

/**
 * Reset run state - call at start of each RSS run
 * Exported for use by rss-tracker-supabase.js
 */
export function resetRunState() {
  seenTitlesThisRun.clear();
  batchStoriesThisRun.clear();  // TTRC-336: Clear batch cache
  lastCandidateIds = [];
  runStats = {
    created: 0,
    attachedNormal: 0,
    attached321SameRun: 0,
    attached323ExactTitle: 0,
    attached324TierA: 0,
    attached324TierB: 0,
    latestArticlePubRpcFails: 0,
    // TTRC-336: Batch dedup stats
    batchDedupConsidered: 0,
    batchDedupAttached: 0,
    batchDedupRejected: 0,
    batchDedupShadow: 0
  };
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

  // ============================================================================
  // TTRC-323: Same-Run Exact Title Match Dedup
  // Check EARLY - before candidate generation to save compute
  // ============================================================================
  const normTitle = normalizeTitle(article.title);

  // Guard: skip generic short titles (less reliable for dedup)
  if (normTitle.length >= 20 && seenTitlesThisRun.has(normTitle)) {
    const cachedStory = seenTitlesThisRun.get(normTitle);

    // SLUG SANITY CHECK: if article has slug and story has slugs, require match
    // Prevents merging different events with same headline (e.g., "Breaking: Fire reported")
    const articleSlug = article.topic_slug;
    const storyHasSlugs = cachedStory.topic_slugs?.length > 0;
    const slugsMatch = !articleSlug || !storyHasSlugs ||
                       cachedStory.topic_slugs.includes(articleSlug);

    if (slugsMatch) {
      console.log(JSON.stringify({
        type: 'EXACT_TITLE_DEDUP_ATTACH',
        article_id: article.id,
        target_story_id: cachedStory.id,
        normalized_title: normTitle
      }));

      const totalStart2 = Date.now();
      const result = await attachToStory(article, cachedStory, 1.0);
      const totalTime = Date.now() - totalStart2;

      console.log(`[hybrid-clustering] ✅ TITLE_DEDUP: Attached article ${articleId} to story ${cachedStory.id} (exact title match)`);
      console.log(`[PERF] Total clustering time: ${totalTime}ms (title dedup path)`);

      runStats.attached323ExactTitle++;
      return result;
    }
    // else: Different events with same headline - proceed to normal clustering
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

        runStats.attachedNormal++;
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

      runStats.attached321SameRun++;
      return overrideResult;
    }
  }

  // ============================================================================
  // TTRC-324 v2: Two-Tier Cross-Run Override
  // Tier A: Very high embedding (0.90+, 48h) - no corroboration needed
  // Tier B: High embedding (0.88+, 72h) - needs slug/entity/title corroboration
  // ============================================================================

  // Sort all candidates by embedding for override logic
  const allByEmbed = [...scoredCandidates].sort(
    (a, b) => (b.scoreResult?.embeddingScore ?? 0) - (a.scoreResult?.embeddingScore ?? 0)
  );

  const overrideBest = allByEmbed[0];
  if (overrideBest) {
    const embedBest = overrideBest.scoreResult?.embeddingScore ?? 0;
    const candidateCount = allByEmbed.length;
    // Null when single candidate OR second candidate lacks embeddingScore (AI code review blocker)
    const rawSecond = candidateCount >= 2 ? (allByEmbed[1].scoreResult?.embeddingScore ?? null) : null;
    const embedSecond = Number.isFinite(rawSecond) ? rawSecond : null;
    const margin = embedSecond !== null ? embedBest - embedSecond : null;
    const marginVacuous = candidateCount < 2 || embedSecond === null;
    // TTRC-331: Capture second candidate for logging (null if doesn't exist)
    const secondCandidate = candidateCount >= 2 ? allByEmbed[1]?.story : null;
    const targetStory = overrideBest.story;
    const scoreResult = overrideBest.scoreResult;

    // Time diff calculation with fallback chain
    // Article: prefer published_at, fallback to created_at (for sources missing pub dates)
    const articlePubTime = article.published_at ? new Date(article.published_at).getTime() : NaN;
    const articleCreatedTime = article.created_at ? new Date(article.created_at).getTime() : NaN;
    const articleTime = Number.isFinite(articlePubTime) ? articlePubTime : articleCreatedTime;

    // TTRC-326: Prefer latest_article_published_at (most accurate for event recency)
    // Fallback chain: latest_article_published_at → first_seen_at → last_updated_at
    const storyLatestArticle = targetStory.latest_article_published_at
      ? new Date(targetStory.latest_article_published_at).getTime() : NaN;
    const storyFirstSeen = targetStory.first_seen_at
      ? new Date(targetStory.first_seen_at).getTime() : NaN;
    const storyLastUpdated = targetStory.last_updated_at
      ? new Date(targetStory.last_updated_at).getTime() : NaN;

    let storyTime = NaN;
    let timeAnchor = 'unknown';

    if (Number.isFinite(storyLatestArticle)) {
      storyTime = storyLatestArticle;
      timeAnchor = 'latest_article_published_at';
    } else if (Number.isFinite(storyFirstSeen)) {
      storyTime = storyFirstSeen;
      timeAnchor = 'first_seen_at';
    } else if (Number.isFinite(storyLastUpdated)) {
      // Tertiary fallback for legacy rows without latest_article_published_at/first_seen_at
      storyTime = storyLastUpdated;
      timeAnchor = 'last_updated_at_fallback';
    }

    const timeDiffMs = Number.isFinite(articleTime) && Number.isFinite(storyTime)
      ? Math.abs(articleTime - storyTime) : Infinity;
    const timeDiffHours = timeDiffMs / (60 * 60 * 1000);

    // Guardrail check
    const passesGuardrail = passesClusteringGuardrail(article, targetStory, scoreResult);

    // Calculate corroboration signals upfront (used by both Tier A margin bypass and Tier B)
    // Defensive slug handling - ensure array type
    const storySlugs = Array.isArray(targetStory.topic_slugs)
      ? targetStory.topic_slugs
      : (targetStory.topic_slugs ? [String(targetStory.topic_slugs)] : []);
    const slugTok = slugTokenSimilarity(article.topic_slug || '', storySlugs);
    const entityOverlap = scoreResult.nonStopwordEntityOverlapCount ?? 0;
    const storyTitle = targetStory.primary_headline || targetStory.title || '';
    const titleTokenOverlap = getTitleTokenOverlap(article.title, storyTitle);

    // Tier A: embed >= 0.90 (0.92 if single candidate for extra safety), time <= 48h, margin, guardrail
    const tierAEmbedThreshold = candidateCount < 2 ? 0.92 : 0.90;
    let marginOkTierA = marginVacuous ? true : margin >= 0.04;
    let tierAMarginBypass = null;

    // Tier A margin bypass: corroboration can override low margin when other gates pass
    // This catches cases where multiple candidates are about the SAME event (Epstein-class fragmentation)
    if (!marginOkTierA && embedBest >= tierAEmbedThreshold && timeDiffHours <= 48 && passesGuardrail) {
      // Bypass rules (ordered by signal strength):
      // - entityOverlap >= 1: strong structural signal
      // - slug_token.passes: strong topic signal
      // - titleTokenOverlap >= 1 AND embedBest >= 0.905: title needs extra embedding safety
      if (entityOverlap >= 1) {
        marginOkTierA = true;
        tierAMarginBypass = 'entity';
      } else if (slugTok.passes) {
        marginOkTierA = true;
        tierAMarginBypass = 'slug_token';
      } else if (titleTokenOverlap >= 1 && embedBest >= 0.905) {
        marginOkTierA = true;
        tierAMarginBypass = 'title_token';
      }
    }

    const isTierA = embedBest >= tierAEmbedThreshold && timeDiffHours <= 48 && marginOkTierA && passesGuardrail;

    // =========================================================================
    // Tier B: embed >= 0.88, time <= 72h, margin gate, guardrail + corroboration
    // TTRC-331: Fix marginVacuous bug + add margin bypass
    // =========================================================================
    let isTierB = false;
    let corroboration = null;

    // TTRC-331: Margin gate passes if meaningful margin OR vacuous (single candidate)
    // Single-candidate cases have no ambiguity to resolve
    const hasMeaningfulMargin = !marginVacuous && margin >= 0.04;
    // IMPORTANT: Save pre-bypass state for logging/shadow mode
    const tierBMarginOk_preBypass = hasMeaningfulMargin || marginVacuous;
    let tierBMarginOk = tierBMarginOk_preBypass;  // Will be mutated by bypass
    let tierBMarginBypass = null;

    // TTRC-331: Compute wouldBypass BEFORE bypass mutation
    // This is used for shadow logging and near-miss diagnostics
    const wouldBypassVia = slugTok.passes ? 'slug'
      : (entityOverlap >= 2 ? 'entity'
      : (titleTokenOverlap >= 1 ? 'title_token' : null));
    const wouldBypass = !tierBMarginOk_preBypass && wouldBypassVia && embedBest >= 0.88 && timeDiffHours <= 48 && passesGuardrail;

    // TTRC-331/333: Tier B margin bypass (feature-flagged, defaults OFF)
    // Similar to Tier A but stricter: entity >= 2 (not 1), title_token uses base 0.88
    if (
      !tierBMarginOk_preBypass &&                          // Use PRE-bypass state
      embedBest >= 0.88 &&
      timeDiffHours <= 48 &&                               // Stricter time (48h not 72h)
      passesGuardrail &&
      ENABLE_TIERB_MARGIN_BYPASS                           // Feature flag
    ) {
      if (slugTok.passes) {
        tierBMarginOk = true;
        tierBMarginBypass = 'slug';
      } else if (entityOverlap >= 2) {                     // Entity >= 2 (not 1)
        tierBMarginOk = true;
        tierBMarginBypass = 'entity';
      } else if (titleTokenOverlap >= 1) {                // TTRC-333: Title token bypass
        tierBMarginOk = true;
        tierBMarginBypass = 'title_token';
      }
    }

    // TTRC-331: Shadow logging - log when bypass WOULD have fired (but didn't because flag is OFF)
    // Rate-limited to avoid log spam. Counter is module-scope (outside article loop)
    const marginIsBlocker = !tierBMarginOk_preBypass && !marginVacuous;
    if (!ENABLE_TIERB_MARGIN_BYPASS && marginIsBlocker && wouldBypass &&
        tierBBypassShadowCount < TIERB_BYPASS_SHADOW_LIMIT) {
      tierBBypassShadowCount++;
      console.log(JSON.stringify({
        type: 'TIERB_BYPASS_SHADOW',
        article_id: article.id,
        story_id: targetStory.id,
        embed_best: embedBest,
        margin,
        would_bypass_via: wouldBypassVia,
        shadow_count: tierBBypassShadowCount
      }));
    }

    // CRITICAL: passesCorroboration still required - bypass only relaxes margin gate
    if (!isTierA && embedBest >= 0.88 && timeDiffHours <= 72 && tierBMarginOk && passesGuardrail) {
      if (slugTok.passes) {
        isTierB = true;
        corroboration = 'slug_token';
      } else if (entityOverlap >= 1) {
        isTierB = true;
        corroboration = 'entity';
      } else if (titleTokenOverlap >= 1) {
        isTierB = true;
        corroboration = 'title_token';
      }
    }

    if (isTierA || isTierB) {
      const tier = isTierA ? 'A' : 'B';

      // Guard against undefined scoreResult.total
      const attachScore = Number.isFinite(scoreResult.total) ? scoreResult.total : embedBest;

      // JSON log with raw numbers (no toFixed for machine parsing)
      console.log(JSON.stringify({
        type: 'CROSS_RUN_OVERRIDE',
        tier,
        tierA_embed_threshold: tierAEmbedThreshold,
        tierA_margin_bypass: tierAMarginBypass,  // null if margin was OK, else the corroboration that allowed bypass
        tierb_margin_bypass: tierBMarginBypass,  // null if margin was OK, else 'slug'|'entity'|'title_token'
        article_id: article.id,
        story_id: targetStory.id,
        embed_best: embedBest,
        embed_second: embedSecond,
        margin,
        margin_vacuous: marginVacuous,
        time_diff_hours: timeDiffHours,
        time_anchor: timeAnchor,
        candidate_count: candidateCount,
        guardrail: passesGuardrail,
        corroboration: isTierA ? tierAMarginBypass : corroboration,  // Show what allowed the attach
        total: attachScore
      }));

      const overrideResult = await attachToStory(article, targetStory, attachScore);

      const totalTime = Date.now() - totalStart;
      const marginStr = margin !== null ? margin.toFixed(3) : 'n/a';
      const embedSecondStr = embedSecond !== null ? embedSecond.toFixed(3) : 'n/a';
      console.log(`[hybrid-clustering] ✅ CROSS_RUN_OVERRIDE (Tier ${tier}): Attached ${article.id} to ${targetStory.id} (embed: ${embedBest.toFixed(3)}, second: ${embedSecondStr}, margin: ${marginStr})`);
      console.log(`[PERF] Total clustering time: ${totalTime}ms`);

      if (tier === 'A') {
        runStats.attached324TierA++;
      } else {
        runStats.attached324TierB++;
      }
      return overrideResult;
    }

    // =========================================================================
    // Near-miss diagnostic: log when top-by-embedding was close but didn't fire
    // Helps debug cases like "why didn't this attach to the obvious story?"
    // Controlled by LOG_NEAR_MISS env flag (defaults true, set 'false' to disable)
    // =========================================================================
    const nearMissEligible =
      LOG_NEAR_MISS && (embedBest >= 0.88 || (embedBest >= 0.85 && timeDiffHours <= 72));

    if (nearMissEligible) {
      // Recompute slug/entity/title corroboration for logging (may not have been computed if Tier B wasn't reached)
      const storySlugsNM = Array.isArray(targetStory.topic_slugs)
        ? targetStory.topic_slugs
        : (targetStory.topic_slugs ? [String(targetStory.topic_slugs)] : []);
      const slugTokNM = slugTokenSimilarity(article.topic_slug || '', storySlugsNM);
      const entityOverlapNM = scoreResult?.nonStopwordEntityOverlapCount ?? 0;
      const storyTitleNM = targetStory.primary_headline || targetStory.title || '';
      const titleTokenOverlapNM = getTitleTokenOverlap(article.title, storyTitleNM);

      const tierA_gates = {
        embed: embedBest >= tierAEmbedThreshold,
        time: timeDiffHours <= 48,
        margin: marginVacuous ? true : (margin !== null && margin >= 0.04),
        guardrail: passesGuardrail
      };

      const hasMeaningfulMarginNM = !marginVacuous && margin !== null && margin >= 0.04;
      const tierB_base = {
        embed: embedBest >= 0.88,
        time: timeDiffHours <= 72,
        margin: hasMeaningfulMarginNM,
        guardrail: passesGuardrail
      };

      const corroboration_detail = {
        slug_token: slugTokNM?.passes ?? false,
        entity: entityOverlapNM >= 1,
        title_token: titleTokenOverlapNM >= 1
      };

      const tierB_corroboration_pass =
        corroboration_detail.slug_token ||
        corroboration_detail.entity ||
        corroboration_detail.title_token;

      // Determine primary blocker in stable order
      function firstFail(gates, order) {
        for (const k of order) {
          if (!gates[k]) return k;
        }
        return null;
      }

      const tierA_primary_blocker = firstFail(tierA_gates, ['embed', 'time', 'margin', 'guardrail']);
      let tierB_primary_blocker = firstFail(tierB_base, ['embed', 'time', 'margin', 'guardrail']);
      if (tierB_primary_blocker === null && !tierB_corroboration_pass) {
        tierB_primary_blocker = 'corroboration';
      }

      console.log(JSON.stringify({
        type: 'CROSS_RUN_NEAR_MISS',
        article_id: article.id,
        story_id: targetStory.id,
        top_by: 'embedding',
        embed_best: embedBest,
        embed_second: candidateCount >= 2 ? embedSecond : null,  // TTRC-331: null if single candidate
        margin,
        margin_vacuous: marginVacuous,
        candidate_count: candidateCount,
        time_diff_hours: timeDiffHours,
        time_anchor: timeAnchor,
        tierA_embed_threshold: tierAEmbedThreshold,
        tierA_gates,
        tierA_primary_blocker,
        tierB_base,
        tierB_corroboration_pass,
        corroboration_detail,
        tierB_primary_blocker,
        // TTRC-331: Margin diagnosis - separate raw vs final
        margin_pass_raw: hasMeaningfulMargin,                    // raw margin gate only (>= 0.04)
        tierb_margin_ok_pre_bypass: tierBMarginOk_preBypass,     // raw + vacuous (before bypass)
        tierb_margin_ok: tierBMarginOk,                          // final (includes bypass)
        tierb_margin_bypass: tierBMarginBypass,                  // 'slug'|'entity'|null
        bypass_applied: tierBMarginBypass != null,               // boolean for easy filtering
        // TTRC-331: blocked_by uses effective margin gate (shows true failures even if bypassed)
        blocked_by: buildBlockedBy({
          guardrail: passesGuardrail,
          time: timeDiffHours <= 72,
          embed: embedBest >= 0.88,
          corroboration: tierB_corroboration_pass,
          margin: tierBMarginOk_preBypass                        // effective gate, not post-bypass
        }),
        // TTRC-331: Second candidate (null if doesn't exist)
        second_candidate_id: secondCandidate?.id ?? null,
        // TTRC-331: Shadow mode - what would have happened if bypass was enabled
        tierb_margin_bypass_would_fire: wouldBypass,
        tierb_margin_bypass_would_fire_via: wouldBypassVia
      }));
    }

    // ==========================================================================
    // TTRC-329: Shadow Policy Diff Logging (no behavior change)
    // Test multiple Tier B thresholds to inform threshold selection
    // Only logs when shadow would ATTACH but live would CREATE
    // ==========================================================================
    if (targetStory && embedBest >= 0.86 && timeDiffHours <= 48 && passesGuardrail) {
      // Compute corroboration signals
      const shadowSlugs = Array.isArray(targetStory.topic_slugs)
        ? targetStory.topic_slugs
        : (targetStory.topic_slugs ? [String(targetStory.topic_slugs)] : []);
      const shadowSlugTok = slugTokenSimilarity(article.topic_slug || '', shadowSlugs);
      const shadowEntityOverlap = scoreResult?.nonStopwordEntityOverlapCount ?? 0;
      const shadowStoryTitle = targetStory.primary_headline || targetStory.title || '';
      const shadowTitleOverlap = getTitleTokenOverlap(article.title || '', shadowStoryTitle);

      // Corroboration strength
      const hasStrongCorroboration = shadowSlugTok.passes || shadowEntityOverlap >= 1;
      const hasTitleOnlyCorroboration = shadowTitleOverlap >= 1 && !hasStrongCorroboration;
      const hasAnyCorroboration = hasStrongCorroboration || hasTitleOnlyCorroboration;

      // Test shadow thresholds
      const shadowThresholds = [0.86, 0.87, 0.88, 0.89];
      const shadowResults = {};

      for (const thresh of shadowThresholds) {
        // TTRC-333: title-only corroboration now uses 0.88 (matches live bypass)
        const effectiveThresh = hasTitleOnlyCorroboration ? Math.max(thresh, 0.88) : thresh;
        const wouldAttach = embedBest >= effectiveThresh && hasAnyCorroboration;
        shadowResults[`tierB_${String(thresh).replace('.', '_')}`] = wouldAttach;
      }

      // Only log if at least one shadow would attach
      if (Object.values(shadowResults).some(v => v)) {
        console.log(JSON.stringify({
          type: 'SHADOW_POLICY_DIFF',
          commit_sha: process.env.GITHUB_SHA || 'local',
          article_id: article.id,
          article_title: (article.title || '').substring(0, 80),
          best_candidate_id: targetStory.id,
          best_candidate_headline: (targetStory.primary_headline || '').substring(0, 80),
          embed_best: embedBest,
          embed_second: embedSecond,
          margin: margin,
          candidate_count: candidateCount,
          time_diff_hours: timeDiffHours,
          guardrail: passesGuardrail,
          corroboration_type: hasStrongCorroboration ? (shadowSlugTok.passes ? 'slug' : 'entity') : (hasTitleOnlyCorroboration ? 'title_only' : 'none'),
          corroboration_detail: {
            entity: shadowEntityOverlap,
            slug: shadowSlugTok.passes,
            title: shadowTitleOverlap
          },
          // Entity snapshots at clustering time (key diagnostic)
          article_entities_count: article.entities?.length || 0,
          story_entities_count: targetStory.top_entities?.length || 0,
          article_entity_sample: (article.entities || []).slice(0, 5).map(e => e.id || e.name || e),
          story_entity_sample: (targetStory.top_entities || []).slice(0, 5),
          shadow_results: shadowResults
        }));
      }
    }
  }

  // Fall through to createNewStory()

  // ============================================================================
  // TTRC-336: Batch Dedup Fallback
  // Check batch cache for same-run stories that DB candidate gen missed
  // This runs AFTER DB scoring fails, as a FALLBACK only
  // ============================================================================
  if (ENABLE_BATCH_DEDUP && batchStoriesThisRun.size > 0) {
    const batchMatch = findBatchStoryMatch(article, batchStoriesThisRun);

    if (batchMatch) {
      const { story: batchStory, sim, decision, rejectReason } = batchMatch;

      // Compute corroboration details for logging
      const articleTokens = getMeaningfulTokens(article.title);
      const tokenOverlap = batchStory ? getMeaningfulTokenOverlap(articleTokens, batchStory.title_tokens || []) : 0;
      const slugMatch = batchStory ? hasValidSlugOverlap(
        article.topic_slug ? [article.topic_slug] : [],
        batchStory.topic_slugs || []
      ) : false;

      // Log decision (shadow or live)
      const mode = BATCH_DEDUP_SHADOW_MODE ? 'shadow' : 'live';
      console.log(JSON.stringify({
        type: 'BATCH_DEDUP_DECISION',
        mode,
        article_id: article.id,
        decision,
        target_story_id: batchStory?.id ?? null,
        embed_similarity: sim,
        corroborators_found: [
          tokenOverlap >= 2 ? 'title_token' : null,
          slugMatch ? 'slug' : null
        ].filter(Boolean),
        title_token_overlap: tokenOverlap,
        slug_match: slugMatch,
        batch_cache_size: batchStoriesThisRun.size,
        reject_reason: rejectReason,
        best_db_candidate_score: bestMatch?.scoreResult?.embeddingScore ?? null
      }));

      // If live mode and we have a match, attach to batch story
      if (!BATCH_DEDUP_SHADOW_MODE && decision === 'attach' && batchStory) {
        // Fetch full story from DB for attachToStory compatibility
        const { data: fullStory } = await getSupabaseClient()
          .from('stories')
          .select('id, primary_headline, topic_slugs, first_seen_at, last_updated_at, entity_counter, top_entities, lifecycle_state, primary_source_domain')
          .eq('id', batchStory.id)
          .single();

        if (fullStory) {
          const batchResult = await attachToStory(article, fullStory, sim);

          // Update batch cache with new article info
          batchStory.article_count = (batchStory.article_count || 1) + 1;
          if (article.topic_slug && !batchStory.topic_slugs?.includes(article.topic_slug)) {
            batchStory.topic_slugs = [...(batchStory.topic_slugs || []), article.topic_slug];
          }

          const totalTime = Date.now() - totalStart;
          console.log(`[hybrid-clustering] ✅ BATCH_DEDUP: Attached ${article.id} to batch story ${batchStory.id} (sim: ${sim.toFixed(3)})`);
          console.log(`[PERF] Total clustering time: ${totalTime}ms`);

          runStats.batchDedupAttached++;
          return batchResult;
        }
      } else if (BATCH_DEDUP_SHADOW_MODE && decision === 'attach') {
        runStats.batchDedupShadow++;
      }
    }
  }

  // ============================================================================
  // TTRC-321 Phase 0: Pre-creation diagnostic logging
  // ============================================================================
  if (LOG_PHASE0) {
    // Log decision context before creating new story
    // Include BOTH top-by-total and top-by-embedding to avoid confusion
    const topByTotal = bestMatch?.story;
    const topByEmbed = allByEmbed?.[0]?.story;
    console.log(`[DECISION] action=create_new_story article_id=${articleId} top_total_story=${topByTotal?.id || 'none'} top_total_score=${bestMatch?.scoreResult?.total?.toFixed(3) || 'n/a'} top_embed_story=${topByEmbed?.id || 'none'} top_embed_score=${allByEmbed?.[0]?.scoreResult?.embeddingScore?.toFixed(3) || 'n/a'} threshold=${threshold.toFixed(3)}`);

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
  // TTRC-323: Store title→story mapping for same-run dedup
  // Only store if NOT already present (first story wins, prevents ping-pong)
  // Store full story object (not just id) for attachToStory() compatibility
  // ============================================================================
  if (normTitle.length >= 20 && !seenTitlesThisRun.has(normTitle)) {
    // Fetch the created story to get full object with topic_slugs
    const { data: createdStory } = await getSupabaseClient()
      .from('stories')
      .select('id, primary_headline, topic_slugs, first_seen_at, last_updated_at')
      .eq('id', result.story_id)
      .single();

    if (createdStory) {
      seenTitlesThisRun.set(normTitle, createdStory);
    }
  }

  // ============================================================================
  // TTRC-336: Populate batch cache for same-batch dedup
  // ============================================================================
  if (ENABLE_BATCH_DEDUP && article.embedding_v1) {
    batchStoriesThisRun.set(result.story_id, {
      id: result.story_id,
      headline: article.title,
      embedding: typeof article.embedding_v1 === 'string'
        ? JSON.parse(article.embedding_v1) : article.embedding_v1,
      topic_slugs: article.topic_slug ? [article.topic_slug] : [],
      title_tokens: getMeaningfulTokens(article.title),
      first_seen_at: new Date().toISOString(),
      article_count: 1
    });
    console.log(`[BATCH_CACHE] Added story ${result.story_id} to batch cache (size: ${batchStoriesThisRun.size})`)
  }

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

  runStats.created++;
  return result;
}

/**
 * Get current run stats (for end-of-run summary)
 * @returns {object} - Current run stats
 */
export function getRunStats() {
  return { ...runStats };
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

  // TTRC-326: Atomically update latest_article_published_at via DB-side GREATEST
  // Avoids JS-side race conditions when multiple attachments happen concurrently
  // NOTE: Two round-trips for now; could merge into single attach RPC later
  if (article.published_at) {
    try {
      const { data: updatedTs, error: rpcErr } = await getSupabaseClient().rpc('update_story_latest_article_published_at', {
        p_story_id: storyId,
        p_article_published_at: article.published_at
      });
      if (rpcErr) throw rpcErr;
      // Debug: uncomment to log updated timestamp
      // console.log(`[hybrid-clustering] latest_article_published_at updated to ${updatedTs}`);
    } catch (latestPubErr) {
      // Log but don't fail - recency gating falls back to first_seen_at
      console.warn(`[hybrid-clustering] latest_article_published_at update failed: ${latestPubErr.message}`);
      runStats.latestArticlePubRpcFails++;
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

  // TTRC-325: Seed entity_counter with primary_actor (improves same-run matching)
  // TTRC-298: Also include article.entities
  const entityCounter = {};
  const topEntities = [];

  // Seed with primary_actor first (TTRC-325)
  const actor = article.primary_actor?.trim();
  if (actor) {
    entityCounter[actor] = 1;
    topEntities.push(actor);
  }

  // Also add article.entities (TTRC-298)
  const articleEntities = article.entities || [];
  for (const e of articleEntities) {
    if (e?.id && !entityCounter[e.id]) {
      entityCounter[e.id] = 1;
      if (topEntities.length < 8) {
        topEntities.push(e.id);
      }
    }
  }

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
      latest_article_published_at: article.published_at ?? null,  // TTRC-326: null if missing, don't fake
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

  // Log run-level override stats for observability (TTRC-323/324/336)
  const stats = getRunStats();
  // Guard against undefined tier fields (AI code review blocker)
  const tierA = Number(stats.attached324TierA ?? 0);
  const tierB = Number(stats.attached324TierB ?? 0);
  console.log(JSON.stringify({
    type: 'RUN_SUMMARY',
    created: stats.created,
    attached_normal: stats.attachedNormal,
    attached_321_same_run: stats.attached321SameRun,
    attached_323_exact_title: stats.attached323ExactTitle,
    // Backwards compat - keep old key for one release
    attached_324_slug_embed: tierA + tierB,
    // New tier-specific keys (v2)
    attached_324_tier_a: tierA,
    attached_324_tier_b: tierB,
    // TTRC-336: Batch dedup stats
    batch_dedup_considered: stats.batchDedupConsidered ?? 0,
    batch_dedup_attached: stats.batchDedupAttached ?? 0,
    batch_dedup_rejected: stats.batchDedupRejected ?? 0,
    batch_dedup_shadow: stats.batchDedupShadow ?? 0
  }));

  return results;
}

// ============================================================================
// Export
// ============================================================================

export default {
  clusterArticle,
  clusterBatch,
  resetRunState,
  getRunStats,
};
