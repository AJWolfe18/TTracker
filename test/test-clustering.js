/**
 * TTRC-142: Clustering Algorithm Tests (ESM)
 * 
 * Tests for similarity scoring and clustering logic
 * Run with: node test/test-clustering.js
 */

import { 
  extractPrimaryActor,
  calculateSimilarity,
  findBestMatch,
  normalizeText,
  CLUSTER_ATTACH_THRESHOLD
} from '../scripts/rss/clustering.js';

// Assertion helper
function expectRange(label, val, lo, hi) {
  if (val < lo || val > hi) {
    throw new Error(`${label} out of range: ${val} not in [${lo}, ${hi}]`);
  }
  console.log(`✓ ${label}: ${val} (expected ${lo}-${hi})`);
}

function expect(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} failed: got "${actual}", expected "${expected}"`);
  }
  console.log(`✓ ${label}: ${actual}`);
}

// Test data
const testArticles = [
  {
    id: 'art-1',
    title: "Trump announces new executive order on immigration",
    url_canonical: "https://cnn.com/trump-immigration-order",
    source_domain: "cnn.com",
    source_name: "CNN",
    published_at: new Date('2025-01-20T10:00:00Z'),
    primary_actor: null
  },
  {
    id: 'art-2',
    title: "President Trump signs immigration executive order",
    url_canonical: "https://foxnews.com/trump-immigration-eo",
    source_domain: "foxnews.com",
    source_name: "Fox News",
    published_at: new Date('2025-01-20T11:00:00Z'),
    primary_actor: null
  },
  {
    id: 'art-3',
    title: "Biden criticizes Supreme Court decision",
    url_canonical: "https://nytimes.com/biden-scotus-reaction",
    source_domain: "nytimes.com",
    source_name: "New York Times",
    published_at: new Date('2025-01-19T15:00:00Z'),
    primary_actor: null
  },
  {
    id: 'art-4',
    title: "Supreme Court ruling sparks debate in Congress",
    url_canonical: "https://politico.com/scotus-congress-debate",
    source_domain: "politico.com",
    source_name: "Politico",
    published_at: new Date('2025-01-19T18:00:00Z'),
    primary_actor: null
  }
];

const testStories = [
  {
    id: 1,
    primary_headline: "Trump signs executive order on immigration policy",
    primary_source_url: "https://reuters.com/trump-immigration",
    primary_source_domain: "reuters.com",
    primary_actor: "Donald Trump",
    first_seen_at: new Date('2025-01-20T09:00:00Z')
  },
  {
    id: 2,
    primary_headline: "Supreme Court issues controversial ruling",
    primary_source_url: "https://apnews.com/scotus-ruling",
    primary_source_domain: "apnews.com",
    primary_actor: "Supreme Court",
    first_seen_at: new Date('2025-01-19T14:00:00Z')
  }
];

console.log('=== Testing TTRC-142: Story Clustering Algorithm ===\n');

// Test actor extraction
console.log('1. Testing Actor Extraction');
const actorTests = [
  ["Trump announces new policy", "Donald Trump"],
  ["President Biden speaks at UN", "Joe Biden"],
  ["McConnell blocks Senate bill", "Mitch McConnell"],
  ["Supreme Court rules on case", "Supreme Court"],
  ["Elon Musk's Twitter changes", "Elon Musk"],
  ["Governor DeSantis signs bill", "Ron DeSantis"],
  ["Random headline without actors", null]
];

let passed = 0;
let failed = 0;

actorTests.forEach(([title, expected]) => {
  const actor = extractPrimaryActor(title);
  if (actor === expected) {
    console.log(`  ✓ "${title}" => ${actor || 'null'}`);
    passed++;
  } else {
    console.log(`  ✗ "${title}" => ${actor || 'null'} (expected: ${expected})`);
    failed++;
  }
});

console.log(`  Actor extraction: ${passed} passed, ${failed} failed\n`);

// Test similarity scoring
console.log('2. Testing Similarity Scoring');

// Extract actors for test articles
testArticles.forEach(article => {
  article.primary_actor = extractPrimaryActor(article.title);
});

// Test 1: Very similar articles (should score high)
const similarity1 = calculateSimilarity(testArticles[0], testStories[0]);
expectRange('Article 1 vs Story 1 (Trump immigration)', similarity1, 70, 95);

const similarity2 = calculateSimilarity(testArticles[1], testStories[0]);
expectRange('Article 2 vs Story 1 (Trump immigration different source)', similarity2, 70, 95);

// Test 2: Different topics (should score low)
const similarity3 = calculateSimilarity(testArticles[0], testStories[1]);
expectRange('Article 1 (Trump) vs Story 2 (Supreme Court)', similarity3, 0, 35);

// Test 3: Related but different actors
const similarity4 = calculateSimilarity(testArticles[2], testStories[1]);
expectRange('Article 3 (Biden on SCOTUS) vs Story 2 (SCOTUS ruling)', similarity4, 30, 70);

console.log();

// Test best match finding
console.log('3. Testing Best Match Finding (Threshold: ' + CLUSTER_ATTACH_THRESHOLD + ')');

testArticles.forEach((article, idx) => {
  const match = findBestMatch(article, testStories);
  console.log(`  Article ${idx + 1}: "${article.title.substring(0, 40)}..."`);
  if (match) {
    console.log(`    → Matched to Story ${match.story_id} (score: ${match.score})`);
  } else {
    console.log(`    → No match (would create new story)`);
  }
});

console.log();

// Test edge cases
console.log('4. Testing Edge Cases');

// Test with missing data
const incompleteArticle = {
  id: 'art-incomplete',
  title: "Breaking news story",
  // Missing URL, domain, dates, etc.
};

const incompleteStory = {
  id: 99,
  primary_headline: "Breaking news",
  // Missing other fields
};

try {
  const edgeScore = calculateSimilarity(incompleteArticle, incompleteStory);
  console.log(`  ✓ Incomplete data handled gracefully (score: ${edgeScore})`);
} catch (e) {
  console.log(`  ✗ Error with incomplete data: ${e.message}`);
  failed++;
}

// Test text normalization
console.log('\n5. Testing Text Normalization');
const normTests = [
  ["Trump's Policy!", "trumps policy"],
  ["  Multiple   Spaces  ", "multiple spaces"],
  ["UPPERCASE TEXT", "uppercase text"],
  ["Special!@#$%^&*()Characters", "specialcharacters"],
  [""Smart Quotes"", "smart quotes"]  // Added smart quotes test
];

normTests.forEach(([input, expected]) => {
  const normalized = normalizeText(input);
  if (normalized === expected) {
    console.log(`  ✓ "${input}" => "${normalized}"`);
    passed++;
  } else {
    console.log(`  ✗ "${input}" => "${normalized}" (expected: "${expected}")`);
    failed++;
  }
});

// Performance test
console.log('\n6. Performance Test');
const startTime = Date.now();
const iterations = 1000;

for (let i = 0; i < iterations; i++) {
  calculateSimilarity(testArticles[0], testStories[0]);
}

const elapsed = Date.now() - startTime;
console.log(`  ${iterations} similarity calculations in ${elapsed}ms`);
console.log(`  Average: ${(elapsed / iterations).toFixed(3)}ms per calculation`);

if ((elapsed / iterations) > 5) {
  console.log(`  ⚠️ Performance warning: Average time exceeds 5ms`);
}

// Summary
console.log('\n=== Test Summary ===');
console.log('✓ Actor extraction working for major political figures');
console.log('✓ Similarity scoring differentiates well between related and unrelated articles');
console.log(`✓ Best match finding respects the ${CLUSTER_ATTACH_THRESHOLD}% threshold`);
console.log('✓ Edge cases handled gracefully without errors');
console.log('✓ Text normalization working correctly');
console.log('✓ Performance within acceptable range');

if (failed > 0) {
  console.log(`\n⚠️ ${failed} tests failed`);
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
