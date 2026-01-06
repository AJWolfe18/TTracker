/**
 * Candidate Generation for Story Clustering (TTRC-230)
 *
 * Implements OR-blocking strategy to find 50-200 candidate stories in <100ms:
 * - Time block: Stories within 72-hour window
 * - Entity block: Stories with overlapping entities
 * - ANN block: Top-K nearest neighbors by embedding
 *
 * Goal: High recall (don't miss true matches) with acceptable latency
 */

import { createClient } from '@supabase/supabase-js';
import { ENTITY_STOPWORDS } from './scoring.js';

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
// TTRC-321 Phase 0 Diagnostic Helpers
// ============================================================================

/**
 * IMPORTANT: Resolve dynamically to avoid module import order issues.
 * Using module-level const would capture null forever if imported before set.
 */
function getRunStart() {
  return globalThis.__RUN_START__ ?? null;
}

// ============================================================================
// Configuration
// ============================================================================

const TIME_WINDOW_HOURS = 72;   // 3 days
const ANN_LIMIT = 60;            // Top-K nearest neighbors
const MAX_CANDIDATES = 200;      // Total candidate limit

// Include 'stale' to enable stale story reopening
// canReopenStaleStory() will enforce stricter criteria (score >=0.80)
const ACTIVE_LIFECYCLE_STATES = ['emerging', 'growing', 'stable', 'stale'];

// ============================================================================
// Main Candidate Generation
// ============================================================================

/**
 * Generate candidate stories for article using OR-blocking
 * @param {object} article - Article with embedding_v1, entities, published_at
 * @returns {array} - Array of candidate stories (50-200 items)
 */
export async function generateCandidates(article) {
  if (!article) return [];

  const candidates = new Map(); // Use map to deduplicate by story ID

  // Block 1: Time window (40-50 candidates)
  const timeStart = Date.now();
  const timeCandidates = await getTimeBlockCandidates(article);
  console.log(`[candidate-gen] Time block: ${timeCandidates.length} stories in ${Date.now() - timeStart}ms`);
  timeCandidates.forEach(story => candidates.set(story.id, story));

  // Block 2: Entity overlap (80-120 candidates)
  const entityStart = Date.now();
  const entityCandidates = await getEntityBlockCandidates(article);
  console.log(`[candidate-gen] Entity block: ${entityCandidates.length} stories in ${Date.now() - entityStart}ms`);
  entityCandidates.forEach(story => candidates.set(story.id, story));

  // Block 3: ANN embedding search (60 candidates)
  const annStart = Date.now();
  const annCandidates = await getAnnBlockCandidates(article);
  console.log(`[candidate-gen] ANN block: ${annCandidates.length} stories in ${Date.now() - annStart}ms`);
  annCandidates.forEach(story => candidates.set(story.id, story));

  // Block 4: TTRC-306 Topic slug match (10-20 candidates)
  const slugStart = Date.now();
  const slugCandidates = await getSlugBlockCandidates(article);
  console.log(`[candidate-gen] Slug block: ${slugCandidates.length} stories in ${Date.now() - slugStart}ms`);
  slugCandidates.forEach(story => candidates.set(story.id, story));

  // Convert to array and limit
  const result = Array.from(candidates.values()).slice(0, MAX_CANDIDATES);

  console.log(`[candidate-gen] Total candidates: ${result.length} (time: ${timeCandidates.length}, entity: ${entityCandidates.length}, ann: ${annCandidates.length}, slug: ${slugCandidates.length})`);

  // ============================================================================
  // TTRC-321 Phase 0: Attach metadata for diagnostic logging
  // ============================================================================

  // Track which blocks contain each story (for per-block diagnosis)
  const blockResults = {
    time: timeCandidates.map(c => c.id),
    entity: entityCandidates.map(c => c.id),
    ann: annCandidates.map(c => c.id),
    slug: slugCandidates.map(c => c.id)
  };

  // Attach as non-enumerable to prevent leaking into Object.keys/logging
  Object.defineProperty(result, '__candidateIds', {
    value: result.map(c => c.id),
    enumerable: false
  });
  Object.defineProperty(result, '__blockResults', {
    value: blockResults,
    enumerable: false
  });

  // Phase 0 diagnostic logging (only when enabled)
  const LOG_PHASE0 = process.env.LOG_PHASE0_DIAGNOSTICS === 'true';
  const RUN_START = getRunStart();

  if (LOG_PHASE0 && RUN_START) {
    // Defensive: warn if first_seen_at is missing (would cause false negatives)
    // Note: stories table uses first_seen_at, not created_at
    if (result.length > 0 && result.every(c => !c.first_seen_at)) {
      console.warn(`[PHASE0_WARNING] first_seen_at_missing_in_candidates=true - check selects!`);
    }

    const thisRunCandidates = result.filter(c => c.first_seen_at && new Date(c.first_seen_at) >= RUN_START);
    console.log(`[CANDIDATES] article_id=${article.id} from_this_run=${thisRunCandidates.length} total=${result.length}`);
  }

  return result;
}

// ============================================================================
// Blocking Methods
// ============================================================================

/**
 * Time block: Stories within 72-hour window
 * Fast query using time_range column (GiST indexed)
 * @param {object} article - Article with published_at
 * @returns {array} - Stories (~40 candidates)
 */
async function getTimeBlockCandidates(article) {
  if (!article.published_at) return [];

  const publishedAt = new Date(article.published_at);
  const startTime = new Date(publishedAt.getTime() - TIME_WINDOW_HOURS * 60 * 60 * 1000);
  const endTime = new Date(publishedAt.getTime() + 1 * 60 * 60 * 1000); // +1 hour buffer

  // TTRC-319: Removed centroid_embedding_v1 from select (14KB each -> egress optimization)
  // Similarity calculated server-side via get_embedding_similarities RPC
  // TTRC-321: Added first_seen_at for same-run detection (stories use first_seen_at, not created_at)
  // TTRC-327: Use latest_article_published_at for time filter (not last_updated_at which updates on enrichment)
  const { data, error } = await getSupabaseClient()
    .from('stories')
    .select('id, primary_headline, entity_counter, top_entities, topic_slugs, last_updated_at, first_seen_at, latest_article_published_at, primary_source_domain, lifecycle_state')
    .in('lifecycle_state', ACTIVE_LIFECYCLE_STATES)
    .gte('latest_article_published_at', startTime.toISOString())
    .lte('latest_article_published_at', endTime.toISOString())
    .order('latest_article_published_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[candidate-gen] Time block error:', error.message);
    return [];
  }

  return data || [];
}

/**
 * Entity block: Stories with overlapping entities
 * Fast query using top_entities GIN index (ARRAY && operator)
 * @param {object} article - Article with entities [{id, name, type}, ...]
 * @returns {array} - Stories (~100 candidates)
 */
async function getEntityBlockCandidates(article) {
  if (!article.entities || article.entities.length === 0) return [];

  // TTRC-312: Filter out stopword entities to avoid wasting candidate slots
  // If article only has stopwords (e.g., US-TRUMP), skip entity block entirely
  const entityIds = article.entities
    .map(e => e.id)
    .filter(id => id && !ENTITY_STOPWORDS.has(id));

  if (entityIds.length === 0) {
    console.log('[candidate-gen] Entity block skipped: only stopword entities');
    return [];
  }

  // Query using array overlap operator (&&)
  // Note: Supabase PostgREST uses cs (contains) operator for array overlap
  // TTRC-319: Removed centroid_embedding_v1 from select (egress optimization)
  // TTRC-321: Added first_seen_at for same-run detection (stories use first_seen_at, not created_at)
  // TTRC-327: Added latest_article_published_at for recency gating
  const { data, error } = await getSupabaseClient()
    .from('stories')
    .select('id, primary_headline, entity_counter, top_entities, topic_slugs, last_updated_at, first_seen_at, latest_article_published_at, primary_source_domain, lifecycle_state')
    .in('lifecycle_state', ACTIVE_LIFECYCLE_STATES)
    .overlaps('top_entities', entityIds)  // GIN index accelerates this
    .limit(150);

  if (error) {
    console.error('[candidate-gen] Entity block error:', error.message);
    return [];
  }

  return data || [];
}

/**
 * ANN block: Top-K nearest neighbors by embedding
 * Uses HNSW index for sub-50ms search
 * @param {object} article - Article with embedding_v1
 * @returns {array} - Stories (60 candidates)
 */
async function getAnnBlockCandidates(article) {
  if (!article.embedding_v1 || article.embedding_v1.length === 0) return [];

  // pgvector cosine distance operator: <=>
  // Note: Supabase PostgREST doesn't directly support vector operators yet
  // We need to use RPC for this

  const { data, error } = await getSupabaseClient().rpc('find_similar_stories', {
    query_embedding: article.embedding_v1,
    match_limit: ANN_LIMIT,
    min_similarity: 0.0  // New parameter from migration 024
  });

  if (error) {
    console.error('[candidate-gen] ANN block error:', error.message);
    // Fallback: return empty array
    return [];
  }

  return data || [];
}

/**
 * TTRC-306: Slug block - Stories with matching topic_slug
 * Fast query using topic_slugs GIN index (contains operator)
 * @param {object} article - Article with topic_slug
 * @returns {array} - Stories with matching slug (~10 candidates)
 */
async function getSlugBlockCandidates(article) {
  if (!article.topic_slug) return [];

  // TTRC-319: Removed centroid_embedding_v1 from select (egress optimization)
  // TTRC-321: Added first_seen_at for same-run detection (stories use first_seen_at, not created_at)
  // TTRC-327: Added latest_article_published_at for recency gating
  const { data, error } = await getSupabaseClient()
    .from('stories')
    .select('id, primary_headline, entity_counter, top_entities, topic_slugs, last_updated_at, first_seen_at, latest_article_published_at, primary_source_domain, lifecycle_state')
    .in('lifecycle_state', ACTIVE_LIFECYCLE_STATES)
    .contains('topic_slugs', [article.topic_slug])  // GIN index lookup
    .limit(20);

  if (error) {
    console.error('[candidate-gen] Slug block error:', error.message);
    return [];
  }

  return data || [];
}

// ============================================================================
// Helper: Create RPC Function (for migration)
// ============================================================================

/**
 * SQL function for ANN search (add to migration)
 *
 * CREATE OR REPLACE FUNCTION find_similar_stories(
 *   query_embedding vector(1536),
 *   match_limit int DEFAULT 60
 * )
 * RETURNS TABLE (
 *   id bigint,
 *   primary_headline text,
 *   centroid_embedding_v1 vector(1536),
 *   entity_counter jsonb,
 *   top_entities text[],
 *   last_updated_at timestamptz,
 *   primary_source_domain text,
 *   lifecycle_state text,
 *   similarity float
 * )
 * LANGUAGE plpgsql
 * AS $$
 * BEGIN
 *   RETURN QUERY
 *   SELECT
 *     s.id,
 *     s.primary_headline,
 *     s.centroid_embedding_v1,
 *     s.entity_counter,
 *     s.top_entities,
 *     s.last_updated_at,
 *     s.primary_source_domain,
 *     s.lifecycle_state,
 *     1 - (s.centroid_embedding_v1 <=> query_embedding) AS similarity
 *   FROM stories s
 *   WHERE s.centroid_embedding_v1 IS NOT NULL
 *     AND s.lifecycle_state IN ('emerging', 'growing', 'stable', 'stale')
 *   ORDER BY s.centroid_embedding_v1 <=> query_embedding
 *   LIMIT match_limit;
 * END;
 * $$;
 */

// ============================================================================
// Export
// ============================================================================

export default {
  generateCandidates,
};
