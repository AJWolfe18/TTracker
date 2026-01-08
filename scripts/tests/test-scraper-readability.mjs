#!/usr/bin/env node
/**
 * Quick test for Mozilla Readability scraper upgrade (TTRC-260)
 * Tests three-tier fallback: Readability → Regex → RSS
 */

import { enrichArticlesForSummary } from '../enrichment/scraper.js';

const testArticles = [
  {
    url: 'https://www.csmonitor.com/USA/Politics/2024/1107/democrats-redistricting-virginia',
    source_domain: 'csmonitor.com',
    title: 'Democrats flip Virginia legislature',
    description: 'Short RSS description...',
    excerpt: 'Short RSS description...'
  },
  {
    url: 'https://www.propublica.org/article/trump-documents-case-dismissal',
    source_domain: 'propublica.org',
    title: 'Trump Documents Case Analysis',
    description: 'Short RSS description...',
    excerpt: 'Short RSS description...'
  }
];

console.log('\n🧪 Testing Mozilla Readability Scraper (TTRC-260)\n');
console.log('Expected logs:');
console.log('  - scraped_ok method=readability (if Readability works)');
console.log('  - scraped_ok method=regex_fallback (if Readability fails)');
console.log('  - scrape_fallback_to_rss (if both fail)\n');
console.log('---\n');

try {
  const enriched = await enrichArticlesForSummary(testArticles);
  
  console.log('\n---\n');
  console.log('✅ Test Complete\n');
  
  enriched.forEach((article, idx) => {
    console.log(`Article ${idx + 1}: ${article.source_domain}`);
    console.log(`  Excerpt length: ${article.excerpt.length} chars`);
    console.log(`  Preview: ${article.excerpt.slice(0, 150)}...`);
    console.log('');
  });

  console.log('✅ All imports working');
  console.log('✅ Three-tier fallback executed');
  console.log('✅ No runtime errors\n');
  
} catch (error) {
  console.error('\n❌ Test Failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
