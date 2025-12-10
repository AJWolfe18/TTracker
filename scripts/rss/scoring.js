/**
 * Hybrid Scoring for Story Clustering (TTRC-230)
 *
 * Implements weighted scoring formula combining 6+ signals:
 * - Embedding similarity (40%) - Semantic meaning
 * - Entity overlap (25%) - Who/what overlap
 * - Title TF-IDF (15%) - Headline similarity
 * - Time decay (10%) - Recency bonus
 * - Keyphrase overlap (5%) - Topic overlap
 * - Geography overlap (5%) - Location match
 * + Bonuses (shared artifacts, quotes, same outlet)
 *
 * Returns score 0.0-1.0 indicating story assignment confidence
 */

import natural from 'natural';

const TfIdf = natural.TfIdf;

// ============================================================================
// Configuration
// ============================================================================

// TTRC-310: Rebalanced weights - embeddings + title carry the decision, entities refine
const WEIGHTS = {
  embedding: 0.45,      // +5% - Primary signal (semantic similarity)
  entities: 0.12,       // -13% - Refinement only (after stopword filter)
  title: 0.25,          // +10% - Strong signal for same event
  time: 0.10,           // Keep - Time decay factor
  keyphrases: 0.00,     // Disabled until TTRC-305 (was broken)
  geography: 0.08,      // +3% - Redistribute from entities
};

// TTRC-301: Entity stopwords - generic entities that appear in 80%+ of articles
// These contribute 0 to entity similarity scoring (still stored for display/analytics)
const ENTITY_STOPWORDS = new Set([
  'US-TRUMP',
  'US-BIDEN',
  'LOC-USA',
  'ORG-WHITE-HOUSE',
  'ORG-DEM',
  'ORG-GOP',
  'ORG-CONGRESS',
  'ORG-SENATE',
  'ORG-HOUSE',
  'ORG-SUPREME-COURT',
  'ORG-DOJ',
  'ORG-FBI',
  'LOC-WASHINGTON',
]);

const BONUSES = {
  sharedArtifacts: 0.06,   // Same PDF/FR doc
  quoteMatch: 0.05,        // Shared quotes (pressers)
  sameOutlet: 0.04,        // Same media source
};

// TTRC-310: Thresholds with env-configurable overrides for A/B testing
const THRESHOLDS = {
  wire: parseFloat(process.env.THRESHOLD_WIRE || '0.68'),       // +8% from 0.60
  opinion: parseFloat(process.env.THRESHOLD_OPINION || '0.76'), // +8% from 0.68
  policy: parseFloat(process.env.THRESHOLD_POLICY || '0.72'),   // +8% from 0.64
  default: parseFloat(process.env.THRESHOLD_DEFAULT || '0.70'), // +8% from 0.62
};

// TTRC-311: Guardrail config - requires concrete reason to cluster
const GUARDRAIL = {
  minEmbedding: parseFloat(process.env.GUARDRAIL_MIN_EMBEDDING || '0.60'),
  minTitle: parseFloat(process.env.GUARDRAIL_MIN_TITLE || '0.50'),
};

// Export GUARDRAIL for use in hybrid-clustering.js
export { GUARDRAIL, ENTITY_STOPWORDS };

const WIRE_DOMAINS = [
  'ap.org', 'apnews.com',
  'reuters.com',
  'afp.com',
  'bloomberg.com',
  'upi.com',
  'marketwatch.com',
];

const TIME_DECAY_HOURS = 72;  // Full bonus within 72 hours

// ============================================================================
// Main Scoring Function
// ============================================================================

/**
 * Calculate hybrid score between article and story
 * TTRC-309: Returns detailed object with raw component scores for guardrail
 * @param {object} article - New article with metadata
 * @param {object} story - Existing story with centroid
 * @returns {object} - { total, embeddingScore, titleScore, entityScore, timeScore, geoScore, keyphraseScore, nonStopwordEntityOverlapCount }
 */
export function calculateHybridScore(article, story) {
  const emptyResult = {
    total: 0.0,
    embeddingScore: 0.0,
    titleScore: 0.0,
    entityScore: 0.0,
    timeScore: 0.0,
    geoScore: 0.0,
    keyphraseScore: 0.0,
    nonStopwordEntityOverlapCount: 0,
  };

  if (!article || !story) return emptyResult;

  // 1. Embedding similarity
  const embeddingScore = calculateEmbeddingScore(
    article.embedding_v1,
    story.centroid_embedding_v1
  );

  // 2. Entity overlap - TTRC-301: now filters stopwords
  const { score: entityScore, nonStopwordEntityOverlapCount } = calculateEntityScore(
    article.entities,
    story.entity_counter
  );

  // 3. Title TF-IDF similarity
  const titleScore = calculateTitleScore(
    article.title,
    story.primary_headline
  );

  // 4. Time decay factor
  const timeScore = calculateTimeScore(
    article.published_at,
    story.last_updated_at
  );

  // 5. Keyphrase overlap (short-circuit if weight is 0)
  const keyphraseScore = WEIGHTS.keyphrases > 0
    ? calculateKeyphraseScore(article.keyphrases, story.top_entities)
    : 0.0;

  // 6. Geography overlap
  const geoScore = calculateGeoScore(
    article.geo,
    story.geography
  );

  // Calculate weighted total
  let score =
    WEIGHTS.embedding * embeddingScore +
    WEIGHTS.entities * entityScore +
    WEIGHTS.title * titleScore +
    WEIGHTS.time * timeScore +
    WEIGHTS.keyphrases * keyphraseScore +
    WEIGHTS.geography * geoScore;

  // Debug logging for story #290
  if (story.id === 290) {
    console.log(`[scoring] Story #290 score breakdown:`);
    console.log(`  Embedding: ${embeddingScore.toFixed(3)} × ${WEIGHTS.embedding} = ${(WEIGHTS.embedding * embeddingScore).toFixed(3)}`);
    console.log(`  Entities: ${entityScore.toFixed(3)} × ${WEIGHTS.entities} = ${(WEIGHTS.entities * entityScore).toFixed(3)}`);
    console.log(`  Title: ${titleScore.toFixed(3)} × ${WEIGHTS.title} = ${(WEIGHTS.title * titleScore).toFixed(3)}`);
    console.log(`  Time: ${timeScore.toFixed(3)} × ${WEIGHTS.time} = ${(WEIGHTS.time * timeScore).toFixed(3)}`);
    console.log(`  Keyphrases: ${keyphraseScore.toFixed(3)} × ${WEIGHTS.keyphrases} = ${(WEIGHTS.keyphrases * keyphraseScore).toFixed(3)}`);
    console.log(`  Geography: ${geoScore.toFixed(3)} × ${WEIGHTS.geography} = ${(WEIGHTS.geography * geoScore).toFixed(3)}`);
    console.log(`  Subtotal: ${score.toFixed(3)}`);
    console.log(`  NonStopwordEntityOverlap: ${nonStopwordEntityOverlapCount}`);
  }

  // Bonuses
  let bonuses = 0.0;

  // Shared artifacts (PDFs, FR docs)
  if (hasSharedArtifacts(article.artifact_urls, story)) {
    bonuses += BONUSES.sharedArtifacts;
  }

  // Quote matches (presser detection)
  if (hasQuoteMatch(article.quote_hashes, story)) {
    bonuses += BONUSES.quoteMatch;
  }

  // Same media outlet
  if (article.source_domain === story.primary_source_domain) {
    bonuses += BONUSES.sameOutlet;
  }

  // Return detailed result object
  return {
    total: Math.min(score + bonuses, 1.0),
    embeddingScore,
    titleScore,
    entityScore,
    timeScore,
    geoScore,
    keyphraseScore,
    nonStopwordEntityOverlapCount,
  };
}

// ============================================================================
// Scoring Components
// ============================================================================

/**
 * TTRC-309: Pure cosine similarity helper (no normalization)
 * Returns raw cosine similarity in range [-1, 1] or [0, 1] for TF-IDF
 * @param {number[]} vectorA - First vector
 * @param {number[]} vectorB - Second vector
 * @returns {number} - Raw cosine similarity
 */
function cosineSimilarity(vectorA, vectorB) {
  if (!vectorA?.length || !vectorB?.length) return 0.0;
  if (vectorA.length !== vectorB.length) return 0.0;

  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    normA += vectorA[i] * vectorA[i];
    normB += vectorB[i] * vectorB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0.0;

  return dotProduct / (normA * normB);
}

/**
 * Cosine similarity between embeddings
 * Embeddings use cosine range [-1, 1], so we normalize to [0, 1]
 * @param {number[]} embA - Article embedding (1536 dims)
 * @param {number[]} embB - Story centroid embedding (1536 dims)
 * @returns {number} - Normalized similarity 0.0-1.0
 */
function calculateEmbeddingScore(embA, embB) {
  const cosine = cosineSimilarity(embA, embB);
  // Normalize from [-1, 1] to [0, 1]
  return (cosine + 1) / 2;
}

/**
 * Jaccard similarity between article entities and story entity_counter
 * TTRC-301: Filters out stopword entities (US-TRUMP, etc.) from scoring
 * @param {array} articleEntities - [{id, name, type, confidence}, ...]
 * @param {object} storyEntityCounter - {entity_id: count, ...}
 * @returns {object} - { score: 0.0-1.0, nonStopwordEntityOverlapCount: number }
 */
function calculateEntityScore(articleEntities, storyEntityCounter) {
  if (!articleEntities || !storyEntityCounter) {
    return { score: 0.0, nonStopwordEntityOverlapCount: 0 };
  }
  if (articleEntities.length === 0) {
    return { score: 0.0, nonStopwordEntityOverlapCount: 0 };
  }
  if (Object.keys(storyEntityCounter).length === 0) {
    return { score: 0.0, nonStopwordEntityOverlapCount: 0 };
  }

  // Use entity_counter keys (has all entities, not just top 8)
  const storyEntityIds = Object.keys(storyEntityCounter);

  // Filter out stopwords from both sets
  const articleNonStop = new Set(
    articleEntities
      .map(e => e?.id)
      .filter(id => id && !ENTITY_STOPWORDS.has(id))
  );
  const storyNonStop = new Set(
    storyEntityIds.filter(id => !ENTITY_STOPWORDS.has(id))
  );

  // Jaccard on non-stopword entities only
  const overlap = [...articleNonStop].filter(id => storyNonStop.has(id));
  const nonStopwordEntityOverlapCount = overlap.length;

  const union = new Set([...articleNonStop, ...storyNonStop]);
  const score = union.size > 0 ? overlap.length / union.size : 0.0;

  return { score, nonStopwordEntityOverlapCount };
}

/**
 * TF-IDF cosine similarity between titles
 * TTRC-309 BUG FIX: TF-IDF cosine is already [0, 1], don't apply embedding normalization
 * @param {string} titleA - Article title
 * @param {string} titleB - Story headline
 * @returns {number} - Cosine similarity 0.0-1.0
 */
function calculateTitleScore(titleA, titleB) {
  if (!titleA || !titleB) return 0.0;

  const tfidf = new TfIdf();
  tfidf.addDocument(titleA.toLowerCase());
  tfidf.addDocument(titleB.toLowerCase());

  // Get TF-IDF vectors for both titles
  const vectorA = [];
  const vectorB = [];
  const terms = new Set();

  // Collect all terms
  tfidf.listTerms(0).forEach(item => terms.add(item.term));
  tfidf.listTerms(1).forEach(item => terms.add(item.term));

  // Build vectors
  terms.forEach(term => {
    vectorA.push(tfidf.tfidf(term, 0));
    vectorB.push(tfidf.tfidf(term, 1));
  });

  // TTRC-309: Use raw cosine similarity (TF-IDF is already [0, 1])
  // Clamp to ensure valid range
  const rawCosine = cosineSimilarity(vectorA, vectorB);
  return Math.max(0, Math.min(1, rawCosine));
}

/**
 * Time decay factor (newer articles get higher score)
 * @param {string} articleTime - ISO timestamp
 * @param {string} storyTime - ISO timestamp of last update
 * @returns {number} - Decay factor 0.0-1.0
 */
function calculateTimeScore(articleTime, storyTime) {
  if (!articleTime || !storyTime) return 0.5;

  const articleDate = new Date(articleTime);
  const storyDate = new Date(storyTime);

  const diffMs = Math.abs(articleDate - storyDate);
  const diffHours = diffMs / (1000 * 60 * 60);

  // Linear decay from 1.0 to 0.0 over TIME_DECAY_HOURS
  if (diffHours <= TIME_DECAY_HOURS) {
    return 1.0 - (diffHours / TIME_DECAY_HOURS);
  }

  return 0.0;
}

/**
 * Jaccard similarity between keyphrases
 * @param {string[]} articlePhrases - Article keyphrases
 * @param {string[]} storyPhrases - Story top entities (proxy)
 * @returns {number} - Jaccard similarity 0.0-1.0
 */
function calculateKeyphraseScore(articlePhrases, storyPhrases) {
  if (!articlePhrases || !storyPhrases) return 0.0;
  if (articlePhrases.length === 0 || storyPhrases.length === 0) return 0.0;

  const setA = new Set(articlePhrases.map(p => p.toLowerCase()));
  const setB = new Set(storyPhrases.map(p => p.toLowerCase()));

  const intersection = new Set([...setA].filter(p => setB.has(p)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 0.0;

  return intersection.size / union.size;
}

/**
 * Geography overlap score
 * @param {object} articleGeo - {country, state, city}
 * @param {object} storyGeo - {country, state, city}
 * @returns {number} - Match score 0.0-1.0
 */
function calculateGeoScore(articleGeo, storyGeo) {
  if (!articleGeo || !storyGeo) return 0.0;

  let matches = 0;
  let total = 0;

  // Check country
  if (articleGeo.country && storyGeo.country) {
    total++;
    if (articleGeo.country === storyGeo.country) matches++;
  }

  // Check state
  if (articleGeo.state && storyGeo.state) {
    total++;
    if (articleGeo.state === storyGeo.state) matches++;
  }

  // Check city
  if (articleGeo.city && storyGeo.city) {
    total++;
    if (articleGeo.city === storyGeo.city) matches++;
  }

  if (total === 0) return 0.0;

  return matches / total;
}

// ============================================================================
// Bonus Detection
// ============================================================================

/**
 * Check if article and story share artifacts
 * @param {string[]} articleArtifacts - Article artifact URLs
 * @param {object} story - Story object
 * @returns {boolean}
 */
function hasSharedArtifacts(articleArtifacts, story) {
  if (!articleArtifacts || articleArtifacts.length === 0) return false;
  if (!story.artifact_urls || story.artifact_urls.length === 0) return false;

  const articleSet = new Set(articleArtifacts);
  const storySet = new Set(story.artifact_urls);

  const intersection = new Set([...articleSet].filter(url => storySet.has(url)));
  return intersection.size > 0;
}

/**
 * Check if article quotes match story quotes
 * @param {bigint[]} articleHashes - Article quote_hashes
 * @param {object} story - Story object
 * @returns {boolean}
 */
function hasQuoteMatch(articleHashes, story) {
  if (!articleHashes || articleHashes.length === 0) return false;
  if (!story.quote_hashes || story.quote_hashes.length === 0) return false;

  const articleSet = new Set(articleHashes);
  const storySet = new Set(story.quote_hashes);

  const intersection = new Set([...articleSet].filter(h => storySet.has(h)));
  return intersection.size > 0;
}

// ============================================================================
// Adaptive Thresholds
// ============================================================================

/**
 * Get clustering threshold based on content type
 * @param {object} article - Article with source_domain, category, artifact_urls
 * @returns {number} - Threshold 0.58-0.68
 */
export function getThreshold(article) {
  if (!article) return THRESHOLDS.default;

  // Wire services (stricter - many rewrites of same story)
  const domain = article.source_domain || '';
  if (WIRE_DOMAINS.some(wd => domain.includes(wd))) {
    return THRESHOLDS.wire;
  }

  // Opinion pieces (strictest - unique perspectives)
  if (article.opinion_flag) {
    return THRESHOLDS.opinion;
  }

  // Policy documents (medium - shared refs)
  if (article.artifact_urls && article.artifact_urls.length > 0) {
    return THRESHOLDS.policy;
  }

  // Default
  return THRESHOLDS.default;
}

/**
 * Check if article can reopen stale story
 * Requires score ≥0.80 AND (≥2 entities OR shared artifact)
 * @param {number} score - Hybrid score
 * @param {object} article - Article
 * @param {object} story - Story
 * @returns {boolean}
 */
export function canReopenStaleStory(score, article, story) {
  if (score < 0.80) return false;

  // Check entity overlap
  const articleEntityIds = new Set((article.entities || []).map(e => e.id));
  const storyEntityIds = new Set(Object.keys(story.entity_counter || {}));
  const sharedEntities = new Set([...articleEntityIds].filter(id => storyEntityIds.has(id)));

  if (sharedEntities.size >= 2) return true;

  // Check shared artifacts
  if (hasSharedArtifacts(article.artifact_urls, story)) return true;

  return false;
}

// ============================================================================
// Export
// ============================================================================

export default {
  calculateHybridScore,
  getThreshold,
  canReopenStaleStory,
};
