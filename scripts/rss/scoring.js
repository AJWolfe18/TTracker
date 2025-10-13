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

const WEIGHTS = {
  embedding: 0.40,      // Semantic similarity (cosine)
  entities: 0.25,       // Entity overlap (Jaccard)
  title: 0.15,          // Title TF-IDF similarity (cosine)
  time: 0.10,           // Time decay factor
  keyphrases: 0.05,     // Keyphrase overlap (Jaccard)
  geography: 0.05,      // Geography match
};

const BONUSES = {
  sharedArtifacts: 0.06,   // Same PDF/FR doc
  quoteMatch: 0.05,        // Shared quotes (pressers)
  sameOutlet: 0.04,        // Same media source
};

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
 * @param {object} article - New article with metadata
 * @param {object} story - Existing story with centroid
 * @returns {number} - Score 0.0-1.0
 */
export function calculateHybridScore(article, story) {
  if (!article || !story) return 0.0;

  let score = 0.0;

  // 1. Embedding similarity (40%)
  const embeddingScore = calculateEmbeddingScore(
    article.embedding_v1,
    story.centroid_embedding_v1
  );
  score += WEIGHTS.embedding * embeddingScore;

  // 2. Entity overlap (25%)
  const entityScore = calculateEntityScore(
    article.entities,
    story.entity_counter
  );
  score += WEIGHTS.entities * entityScore;

  // 3. Title TF-IDF similarity (15%)
  const titleScore = calculateTitleScore(
    article.title,
    story.primary_headline
  );
  score += WEIGHTS.title * titleScore;

  // 4. Time decay factor (10%)
  const timeScore = calculateTimeScore(
    article.published_at,
    story.last_updated_at
  );
  score += WEIGHTS.time * timeScore;

  // 5. Keyphrase overlap (5%)
  const keyphraseScore = calculateKeyphraseScore(
    article.keyphrases,
    story.top_entities  // Use top entities as proxy for keyphrases
  );
  score += WEIGHTS.keyphrases * keyphraseScore;

  // 6. Geography overlap (5%)
  const geoScore = calculateGeoScore(
    article.geo,
    story.geography  // Assume stories have aggregated geography
  );
  score += WEIGHTS.geography * geoScore;

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

  // Cap at 1.0
  return Math.min(score + bonuses, 1.0);
}

// ============================================================================
// Scoring Components
// ============================================================================

/**
 * Cosine similarity between embeddings
 * @param {number[]} embA - Article embedding (1536 dims)
 * @param {number[]} embB - Story centroid embedding (1536 dims)
 * @returns {number} - Cosine similarity 0.0-1.0
 */
function calculateEmbeddingScore(embA, embB) {
  if (!embA || !embB) return 0.0;
  if (embA.length === 0 || embB.length === 0) return 0.0;
  if (embA.length !== embB.length) return 0.0;

  // Cosine similarity = dot product / (||a|| * ||b||)
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;

  for (let i = 0; i < embA.length; i++) {
    dotProduct += embA[i] * embB[i];
    normA += embA[i] * embA[i];
    normB += embB[i] * embB[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0.0;

  const similarity = dotProduct / (normA * normB);

  // Normalize to 0-1 (cosine ranges from -1 to 1)
  return (similarity + 1) / 2;
}

/**
 * Jaccard similarity between article entities and story entity_counter
 * @param {array} articleEntities - [{id, name, type, confidence}, ...]
 * @param {object} storyEntityCounter - {entity_id: count, ...}
 * @returns {number} - Jaccard similarity 0.0-1.0
 */
function calculateEntityScore(articleEntities, storyEntityCounter) {
  if (!articleEntities || !storyEntityCounter) return 0.0;
  if (articleEntities.length === 0) return 0.0;
  if (Object.keys(storyEntityCounter).length === 0) return 0.0;

  const articleEntityIds = new Set(articleEntities.map(e => e.id));
  const storyEntityIds = new Set(Object.keys(storyEntityCounter));

  const intersection = new Set(
    [...articleEntityIds].filter(id => storyEntityIds.has(id))
  );
  const union = new Set([...articleEntityIds, ...storyEntityIds]);

  if (union.size === 0) return 0.0;

  return intersection.size / union.size;
}

/**
 * TF-IDF cosine similarity between titles
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

  // Cosine similarity
  return calculateEmbeddingScore(vectorA, vectorB);
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
  if (!article) return 0.60;

  // Wire services (looser - many rewrites)
  const domain = article.source_domain || '';
  if (WIRE_DOMAINS.some(wd => domain.includes(wd))) {
    return 0.60;  // Start stricter (+0.02 from expert review)
  }

  // Opinion pieces (stricter - unique perspectives)
  if (article.category === 'opinion') {
    return 0.68;
  }

  // Policy documents (medium - shared refs)
  if (article.artifact_urls && article.artifact_urls.length > 0) {
    return 0.64;
  }

  // Default
  return 0.62;
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
