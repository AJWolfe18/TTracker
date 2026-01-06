/**
 * Test Suite for Hybrid Scoring (TTRC-230)
 * Tests all scoring components and thresholds
 */

import {
  calculateHybridScore,
  getThreshold,
  canReopenStaleStory,
} from './scoring.js';

// ============================================================================
// Test Utilities
// ============================================================================

function assert(condition, message) {
  if (!condition) {
    throw new Error(`❌ FAILED: ${message}`);
  }
}

function assertApprox(actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`❌ FAILED: ${message} - Expected ${expected}, got ${actual} (diff: ${diff})`);
  }
}

function testGroup(name, fn) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`TEST GROUP: ${name}`);
  console.log('='.repeat(80));
  try {
    fn();
    console.log('✅ ALL TESTS PASSED');
    return { name, passed: true, error: null };
  } catch (err) {
    console.error(`\n${err.message}\n`);
    return { name, passed: false, error: err.message };
  }
}

// ============================================================================
// Test 1: Embedding Similarity Calculation
// ============================================================================

function testEmbeddingSimilarity() {
  console.log('\n--- Test 1.1: Identical vectors ---');
  const identicalVector = [0.5, 0.5, 0.5, 0.5];
  const article1 = { embedding_v1: identicalVector };
  const story1 = { centroid_embedding_v1: identicalVector };
  const score1 = calculateHybridScore(article1, story1);

  // Embedding is 40% of total, identical vectors should score ~1.0
  // Time component defaults to 0.5 (10% weight = 0.05)
  // Total: 0.40 (embedding) + 0.05 (time) = 0.45
  assertApprox(score1, 0.45, 0.10, 'Identical vectors should contribute 40% weight + time default');
  console.log(`✓ Identical vectors: ${score1.toFixed(3)}`);

  console.log('\n--- Test 1.2: Orthogonal vectors ---');
  const vecA = [1, 0, 0, 0];
  const vecB = [0, 1, 0, 0];
  const article2 = { embedding_v1: vecA };
  const story2 = { centroid_embedding_v1: vecB };
  const score2 = calculateHybridScore(article2, story2);

  // Orthogonal vectors have cosine = 0, normalized to 0.5
  // Score: 0.40 * 0.5 (embedding) + 0.05 (time) = 0.25
  assertApprox(score2, 0.25, 0.10, 'Orthogonal vectors should score 40% * 0.5 + time');
  console.log(`✓ Orthogonal vectors: ${score2.toFixed(3)}`);

  console.log('\n--- Test 1.3: Opposite vectors ---');
  const vecC = [1, 1, 1, 1];
  const vecD = [-1, -1, -1, -1];
  const article3 = { embedding_v1: vecC };
  const story3 = { centroid_embedding_v1: vecD };
  const score3 = calculateHybridScore(article3, story3);

  // Opposite vectors have cosine = -1, normalized to 0
  // Score: 0.40 * 0 (embedding) + 0.05 (time) = 0.05
  assertApprox(score3, 0.05, 0.10, 'Opposite vectors should only have time component');
  console.log(`✓ Opposite vectors: ${score3.toFixed(3)}`);

  console.log('\n--- Test 1.4: Null/empty vectors ---');
  const article4a = { embedding_v1: null };
  const story4a = { centroid_embedding_v1: [1, 2, 3] };
  const score4a = calculateHybridScore(article4a, story4a);
  assertApprox(score4a, 0.05, 0.10, 'Null embedding should only have time component');
  console.log(`✓ Null embedding: ${score4a.toFixed(3)}`);

  const article4b = { embedding_v1: [] };
  const story4b = { centroid_embedding_v1: [1, 2, 3] };
  const score4b = calculateHybridScore(article4b, story4b);
  assertApprox(score4b, 0.05, 0.10, 'Empty embedding should only have time component');
  console.log(`✓ Empty embedding: ${score4b.toFixed(3)}`);

  const article4c = { embedding_v1: [1, 2] };
  const story4c = { centroid_embedding_v1: [1, 2, 3] };
  const score4c = calculateHybridScore(article4c, story4c);
  assertApprox(score4c, 0.05, 0.10, 'Mismatched length should only have time component');
  console.log(`✓ Mismatched length: ${score4c.toFixed(3)}`);
}

// ============================================================================
// Test 2: Entity Overlap Scoring
// ============================================================================

function testEntityOverlap() {
  const baseEmbedding = [0.5, 0.5, 0.5, 0.5]; // Neutral embedding

  console.log('\n--- Test 2.1: Perfect overlap ---');
  const article1 = {
    embedding_v1: baseEmbedding,
    entities: [
      { id: 'trump', name: 'Donald Trump', type: 'PERSON' },
      { id: 'biden', name: 'Joe Biden', type: 'PERSON' },
    ]
  };
  const story1 = {
    centroid_embedding_v1: baseEmbedding,
    entity_counter: { trump: 5, biden: 3 }
  };
  const score1 = calculateHybridScore(article1, story1);

  // Perfect overlap = Jaccard 1.0, weighted 25% = 0.25
  // Plus embedding ~0.40 = total ~0.65
  assert(score1 > 0.60, 'Perfect entity overlap should contribute significantly');
  console.log(`✓ Perfect overlap: ${score1.toFixed(3)}`);

  console.log('\n--- Test 2.2: Partial overlap ---');
  const article2 = {
    embedding_v1: baseEmbedding,
    entities: [
      { id: 'trump', name: 'Donald Trump', type: 'PERSON' },
      { id: 'musk', name: 'Elon Musk', type: 'PERSON' },
    ]
  };
  const story2 = {
    centroid_embedding_v1: baseEmbedding,
    entity_counter: { trump: 5, biden: 3 }
  };
  const score2 = calculateHybridScore(article2, story2);

  // Partial overlap: {trump} ∩ {trump, biden} = 1, union = 3, Jaccard = 1/3 = 0.33
  // Weighted: 0.25 * 0.33 = 0.083, plus embedding ~0.40 = total ~0.48
  assert(score2 < score1, 'Partial overlap should score less than perfect overlap');
  assert(score2 > 0.40, 'Partial overlap should still contribute');
  console.log(`✓ Partial overlap: ${score2.toFixed(3)}`);

  console.log('\n--- Test 2.3: No overlap ---');
  const article3 = {
    embedding_v1: baseEmbedding,
    entities: [
      { id: 'musk', name: 'Elon Musk', type: 'PERSON' },
    ]
  };
  const story3 = {
    centroid_embedding_v1: baseEmbedding,
    entity_counter: { trump: 5, biden: 3 }
  };
  const score3 = calculateHybridScore(article3, story3);

  // No overlap = Jaccard 0.0, should only have embedding contribution (~0.40)
  assertApprox(score3, 0.40, 0.10, 'No entity overlap should only have embedding score');
  console.log(`✓ No overlap: ${score3.toFixed(3)}`);

  console.log('\n--- Test 2.4: Null/empty entity arrays ---');
  const article4 = {
    embedding_v1: baseEmbedding,
    entities: null
  };
  const story4 = {
    centroid_embedding_v1: baseEmbedding,
    entity_counter: { trump: 5 }
  };
  const score4 = calculateHybridScore(article4, story4);
  assertApprox(score4, 0.40, 0.10, 'Null entities should only have embedding score');
  console.log(`✓ Null entities: ${score4.toFixed(3)}`);

  const article5 = {
    embedding_v1: baseEmbedding,
    entities: []
  };
  const story5 = {
    centroid_embedding_v1: baseEmbedding,
    entity_counter: {}
  };
  const score5 = calculateHybridScore(article5, story5);
  assertApprox(score5, 0.40, 0.10, 'Empty entities should only have embedding score');
  console.log(`✓ Empty entities: ${score5.toFixed(3)}`);
}

// ============================================================================
// Test 3: Adaptive Thresholds
// ============================================================================

function testAdaptiveThresholds() {
  console.log('\n--- Test 3.1: Wire services ---');
  const wireArticle1 = { source_domain: 'ap.org' };
  const threshold1 = getThreshold(wireArticle1);
  assert(threshold1 === 0.60, 'AP should use 0.60 threshold');
  console.log(`✓ ap.org: ${threshold1}`);

  const wireArticle2 = { source_domain: 'reuters.com' };
  const threshold2 = getThreshold(wireArticle2);
  assert(threshold2 === 0.60, 'Reuters should use 0.60 threshold');
  console.log(`✓ reuters.com: ${threshold2}`);

  const wireArticle3 = { source_domain: 'apnews.com' };
  const threshold3 = getThreshold(wireArticle3);
  assert(threshold3 === 0.60, 'APNews should use 0.60 threshold');
  console.log(`✓ apnews.com: ${threshold3}`);

  console.log('\n--- Test 3.2: Opinion articles ---');
  const opinionArticle = {
    source_domain: 'nytimes.com',
    category: 'opinion'
  };
  const threshold4 = getThreshold(opinionArticle);
  assert(threshold4 === 0.68, 'Opinion articles should use 0.68 threshold');
  console.log(`✓ opinion: ${threshold4}`);

  console.log('\n--- Test 3.3: Policy documents with artifacts ---');
  const policyArticle = {
    source_domain: 'whitehouse.gov',
    artifact_urls: ['https://example.com/doc.pdf']
  };
  const threshold5 = getThreshold(policyArticle);
  assert(threshold5 === 0.64, 'Articles with artifacts should use 0.64 threshold');
  console.log(`✓ with artifacts: ${threshold5}`);

  console.log('\n--- Test 3.4: Default threshold ---');
  const defaultArticle = { source_domain: 'nytimes.com' };
  const threshold6 = getThreshold(defaultArticle);
  assert(threshold6 === 0.62, 'Default articles should use 0.62 threshold');
  console.log(`✓ default: ${threshold6}`);

  const nullArticle = null;
  const threshold7 = getThreshold(nullArticle);
  assert(threshold7 === 0.60, 'Null article should use 0.60 threshold');
  console.log(`✓ null article: ${threshold7}`);
}

// ============================================================================
// Test 4: Stale Story Reopening
// ============================================================================

function testStaleStoryReopening() {
  console.log('\n--- Test 4.1: High score + 2+ shared entities ---');
  const article1 = {
    entities: [
      { id: 'trump', name: 'Donald Trump', type: 'PERSON' },
      { id: 'biden', name: 'Joe Biden', type: 'PERSON' },
    ]
  };
  const story1 = {
    entity_counter: { trump: 5, biden: 3 }
  };
  const canReopen1 = canReopenStaleStory(0.85, article1, story1);
  assert(canReopen1 === true, 'Score 0.85 + 2 shared entities should allow reopening');
  console.log(`✓ Score 0.85 + 2 entities: ${canReopen1}`);

  console.log('\n--- Test 4.2: High score + shared artifact ---');
  const article2 = {
    entities: [{ id: 'trump', name: 'Donald Trump', type: 'PERSON' }],
    artifact_urls: ['https://example.com/doc.pdf']
  };
  const story2 = {
    entity_counter: { trump: 5, biden: 3 },
    artifact_urls: ['https://example.com/doc.pdf']
  };
  const canReopen2 = canReopenStaleStory(0.85, article2, story2);
  assert(canReopen2 === true, 'Score 0.85 + shared artifact should allow reopening');
  console.log(`✓ Score 0.85 + shared artifact: ${canReopen2}`);

  console.log('\n--- Test 4.3: Score below 0.80 ---');
  const article3 = {
    entities: [
      { id: 'trump', name: 'Donald Trump', type: 'PERSON' },
      { id: 'biden', name: 'Joe Biden', type: 'PERSON' },
    ]
  };
  const story3 = {
    entity_counter: { trump: 5, biden: 3 }
  };
  const canReopen3 = canReopenStaleStory(0.75, article3, story3);
  assert(canReopen3 === false, 'Score below 0.80 should not allow reopening');
  console.log(`✓ Score 0.75: ${canReopen3}`);

  console.log('\n--- Test 4.4: High score but only 1 shared entity ---');
  const article4 = {
    entities: [
      { id: 'trump', name: 'Donald Trump', type: 'PERSON' },
    ]
  };
  const story4 = {
    entity_counter: { trump: 5, biden: 3 }
  };
  const canReopen4 = canReopenStaleStory(0.85, article4, story4);
  assert(canReopen4 === false, 'Only 1 shared entity should not allow reopening');
  console.log(`✓ Score 0.85 + 1 entity: ${canReopen4}`);

  console.log('\n--- Test 4.5: High score but no overlap ---');
  const article5 = {
    entities: [{ id: 'musk', name: 'Elon Musk', type: 'PERSON' }],
    artifact_urls: ['https://different.com/doc.pdf']
  };
  const story5 = {
    entity_counter: { trump: 5, biden: 3 },
    artifact_urls: ['https://example.com/doc.pdf']
  };
  const canReopen5 = canReopenStaleStory(0.85, article5, story5);
  assert(canReopen5 === false, 'No entity/artifact overlap should not allow reopening');
  console.log(`✓ Score 0.85 + no overlap: ${canReopen5}`);
}

// ============================================================================
// Test 5: Weighted Formula
// ============================================================================

function testWeightedFormula() {
  console.log('\n--- Test 5.1: All signals contribute ---');
  const article1 = {
    embedding_v1: [0.5, 0.5, 0.5, 0.5],
    entities: [
      { id: 'trump', name: 'Donald Trump', type: 'PERSON' },
    ],
    title: 'Trump announces new policy',
    published_at: '2025-10-12T10:00:00Z',
    keyphrases: ['trump', 'policy'],
    geo: { country: 'US', state: 'DC' },
    source_domain: 'nytimes.com',
  };
  const story1 = {
    centroid_embedding_v1: [0.5, 0.5, 0.5, 0.5],
    entity_counter: { trump: 5 },
    primary_headline: 'Trump policy announcement',
    last_updated_at: '2025-10-12T09:00:00Z',
    top_entities: ['trump', 'policy'],
    geography: { country: 'US', state: 'DC' },
    primary_source_domain: 'nytimes.com',
  };
  const score1 = calculateHybridScore(article1, story1);

  // Should have contributions from all components
  assert(score1 > 0.60, 'All signals should contribute to high score');
  console.log(`✓ All signals: ${score1.toFixed(3)}`);

  console.log('\n--- Test 5.2: Bonuses apply ---');
  const article2 = {
    embedding_v1: [0.5, 0.5, 0.5, 0.5],
    entities: [{ id: 'trump', name: 'Donald Trump', type: 'PERSON' }],
    title: 'Trump policy',
    published_at: '2025-10-12T10:00:00Z',
    artifact_urls: ['https://example.com/doc.pdf'],
    quote_hashes: [BigInt(12345)],
    source_domain: 'reuters.com',
  };
  const story2 = {
    centroid_embedding_v1: [0.5, 0.5, 0.5, 0.5],
    entity_counter: { trump: 5 },
    primary_headline: 'Trump policy',
    last_updated_at: '2025-10-12T09:00:00Z',
    artifact_urls: ['https://example.com/doc.pdf'],
    quote_hashes: [BigInt(12345)],
    primary_source_domain: 'reuters.com',
  };
  const score2 = calculateHybridScore(article2, story2);

  // Should have all three bonuses:
  // - Shared artifacts: +0.06
  // - Quote match: +0.05
  // - Same outlet: +0.04
  // Total bonus: +0.15
  assert(score2 > score1, 'Bonuses should increase score');
  console.log(`✓ With bonuses: ${score2.toFixed(3)}`);

  console.log('\n--- Test 5.3: Score capped at 1.0 ---');
  // Create perfect match with all bonuses
  const article3 = {
    embedding_v1: [1, 1, 1, 1],
    entities: [
      { id: 'trump', name: 'Donald Trump', type: 'PERSON' },
      { id: 'biden', name: 'Joe Biden', type: 'PERSON' },
    ],
    title: 'Exact same title',
    published_at: '2025-10-12T10:00:00Z',
    keyphrases: ['trump', 'policy'],
    geo: { country: 'US', state: 'DC', city: 'Washington' },
    artifact_urls: ['https://example.com/doc.pdf'],
    quote_hashes: [BigInt(12345)],
    source_domain: 'nytimes.com',
  };
  const story3 = {
    centroid_embedding_v1: [1, 1, 1, 1],
    entity_counter: { trump: 10, biden: 5 },
    primary_headline: 'Exact same title',
    last_updated_at: '2025-10-12T10:00:00Z',
    top_entities: ['trump', 'policy'],
    geography: { country: 'US', state: 'DC', city: 'Washington' },
    artifact_urls: ['https://example.com/doc.pdf'],
    quote_hashes: [BigInt(12345)],
    primary_source_domain: 'nytimes.com',
  };
  const score3 = calculateHybridScore(article3, story3);

  assert(score3 <= 1.0, 'Score should be capped at 1.0');
  console.log(`✓ Perfect match capped: ${score3.toFixed(3)}`);

  console.log('\n--- Test 5.4: Null article/story returns 0.0 ---');
  const score4 = calculateHybridScore(null, story1);
  assert(score4 === 0.0, 'Null article should return 0.0');
  console.log(`✓ Null article: ${score4.toFixed(3)}`);

  const score5 = calculateHybridScore(article1, null);
  assert(score5 === 0.0, 'Null story should return 0.0');
  console.log(`✓ Null story: ${score5.toFixed(3)}`);
}

// ============================================================================
// Run All Tests
// ============================================================================

console.log('\n');
console.log('╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║                    HYBRID SCORING TEST SUITE (TTRC-230)                   ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝');

const results = [
  testGroup('Test 1: Embedding Similarity Calculation', testEmbeddingSimilarity),
  testGroup('Test 2: Entity Overlap Scoring', testEntityOverlap),
  testGroup('Test 3: Adaptive Thresholds', testAdaptiveThresholds),
  testGroup('Test 4: Stale Story Reopening', testStaleStoryReopening),
  testGroup('Test 5: Weighted Formula', testWeightedFormula),
];

// ============================================================================
// Summary
// ============================================================================

console.log('\n');
console.log('╔════════════════════════════════════════════════════════════════════════════╗');
console.log('║                              TEST SUMMARY                                  ║');
console.log('╚════════════════════════════════════════════════════════════════════════════╝');

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

results.forEach(result => {
  const status = result.passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${status}: ${result.name}`);
  if (!result.passed) {
    console.log(`   Error: ${result.error}`);
  }
});

console.log('\n' + '='.repeat(80));
console.log(`TOTAL: ${passed}/${results.length} test groups passed`);
console.log('='.repeat(80) + '\n');

if (failed > 0) {
  process.exit(1);
}
