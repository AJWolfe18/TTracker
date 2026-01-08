/**
 * TTRC-315 Dry-Run Validation
 * Tests slug token similarity with Venezuela oil tanker examples
 */

import { slugTokenSimilarity } from './rss/scoring.js';

console.log('=== TTRC-315 Slug Token Similarity Dry-Run ===\n');

// Venezuela oil tanker test cases
const testCases = [
  {
    name: 'Venezuela Oil Tanker - Same event, different phrasing',
    articleSlug: 'TRUMP-SEIZURE-OIL-TANKER',
    storySlugs: ['WHITE-HOUSE-SEIZES-OIL-TANKERS'],
    expectedPasses: true,
  },
  {
    name: 'Venezuela Oil Tanker - Alternative phrasing',
    articleSlug: 'OIL-TANKER-SEIZED-VENEZUELA',
    storySlugs: ['TRUMP-SEIZURE-OIL-TANKER'],
    expectedPasses: true,
  },
  {
    name: 'Venezuela - All three slugs should match',
    articleSlug: 'WHITE-HOUSE-SEIZES-OIL-TANKERS',
    storySlugs: ['OIL-TANKER-SEIZED-VENEZUELA', 'TRUMP-SEIZURE-OIL-TANKER'],
    expectedPasses: true,
  },
  {
    name: 'Generic ORDER - Should NOT pass (low-signal event)',
    articleSlug: 'TRUMP-ORDERS-TARIFF-INCREASE',
    storySlugs: ['TRUMP-ORDERS-BORDER-WALL'],
    expectedPasses: false, // ORDER is not high-signal, different anchors
  },
  {
    name: 'Generic SIGN - Should NOT pass (low-signal event)',
    articleSlug: 'TRUMP-SIGNS-EXECUTIVE-ORDER',
    storySlugs: ['TRUMP-SIGNS-TRADE-DEAL'],
    expectedPasses: false, // SIGN is not high-signal, different anchors
  },
  {
    name: 'Hegseth confirmation - Should pass',
    articleSlug: 'HEGSETH-CONFIRMATION-HEARING',
    storySlugs: ['SENATE-CONFIRMS-HEGSETH'],
    expectedPasses: true, // CONFIRM is high-signal, HEGSETH is anchor
  },
  {
    name: 'Indict - Should pass',
    articleSlug: 'JAMES-INDICTED-FRAUD',
    storySlugs: ['JAMES-INDICTMENT-CHARGES'],
    expectedPasses: true, // INDICT is high-signal, JAMES is anchor
  },
  {
    name: 'Only event overlap, no anchor - Should NOT pass',
    articleSlug: 'ARREST-ANNOUNCE',
    storySlugs: ['ARREST-CONFIRM'],
    expectedPasses: false, // Only event tokens, no anchor
  },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = slugTokenSimilarity(tc.articleSlug, tc.storySlugs);
  const success = result.passes === tc.expectedPasses;

  if (success) {
    passed++;
    console.log(`✅ ${tc.name}`);
  } else {
    failed++;
    console.log(`❌ ${tc.name}`);
    console.log(`   Expected: passes=${tc.expectedPasses}`);
    console.log(`   Got: passes=${result.passes}`);
  }
  console.log(`   Article: ${tc.articleSlug}`);
  console.log(`   Story: ${tc.storySlugs.join(', ')}`);
  console.log(`   Result: coeff=${result.overlapCoeff.toFixed(2)}, count=${result.overlapCount}, event=${result.hasEventOverlap}, anchor=${result.hasAnchorOverlap}`);
  console.log('');
}

console.log('=== Summary ===');
console.log(`Passed: ${passed}/${testCases.length}`);
console.log(`Failed: ${failed}/${testCases.length}`);

if (failed > 0) {
  process.exit(1);
}
