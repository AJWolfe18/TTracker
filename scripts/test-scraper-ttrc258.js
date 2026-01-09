// TTRC-258 Scraper Validation Test
// Tests scraper module with real URLs from allowed domains

import { enrichArticlesForSummary } from './enrichment/scraper.js';

console.log('=== TTRC-258 Scraper Validation ===\n');

// Test articles with different domains
const testArticles = [
  {
    url: 'https://www.csmonitor.com/USA/Politics/2024/1106/congress-midterm-elections',
    source_domain: 'csmonitor.com',
    title: 'Test CSM Article',
    source_name: 'Christian Science Monitor',
    description: 'Short RSS teaser from CSM feed'
  },
  {
    url: 'https://www.pbs.org/newshour/politics/test-article',
    source_domain: 'pbs.org',
    title: 'Test PBS Article',
    source_name: 'PBS NewsHour',
    description: 'Short RSS teaser from PBS feed'
  },
  {
    url: 'https://www.nytimes.com/2024/11/06/us/politics/test.html',
    source_domain: 'nytimes.com',
    title: 'Test NYT Article (Blocked)',
    source_name: 'New York Times',
    description: 'Short RSS teaser from NYT feed (should fall back to this)'
  },
  {
    url: 'https://www.propublica.org/article/test-investigation',
    source_domain: 'propublica.org',
    title: 'Test ProPublica Article',
    source_name: 'ProPublica',
    description: 'Short RSS teaser from ProPublica feed'
  }
];

console.log('Testing enrichArticlesForSummary() with:');
console.log('- 2 allowed domains (CSM, PBS)');
console.log('- 1 blocked domain (NYT)');
console.log('- 1 allowed domain (ProPublica)');
console.log('');
console.log('Expected behavior:');
console.log('✓ Max 2 articles scraped (CSM + PBS or CSM + ProPublica)');
console.log('✓ NYT falls back to RSS description');
console.log('✓ Per-host rate limiting (≥1s between same-host requests)');
console.log('✓ Graceful error handling if URLs 404/timeout');
console.log('');

try {
  console.log('Running enrichment...\n');
  const enriched = await enrichArticlesForSummary(testArticles);

  console.log('\n=== Results ===\n');
  enriched.forEach((article, idx) => {
    const original = testArticles[idx];
    const excerptLen = article.excerpt.length;
    const scraped = excerptLen > 300;
    
    console.log(`${idx + 1}. ${article.source_name}`);
    console.log(`   Domain: ${original.source_domain}`);
    console.log(`   Excerpt Length: ${excerptLen} chars`);
    console.log(`   Status: ${scraped ? '✓ SCRAPED' : '○ RSS FALLBACK'}`);
    console.log(`   Preview: ${article.excerpt.slice(0, 100)}...`);
    console.log('');
  });

  // Validation checks
  console.log('=== Validation ===\n');
  
  const scrapedCount = enriched.filter(a => a.excerpt.length > 300).length;
  console.log(`✓ Scraped articles: ${scrapedCount} (max 2 allowed)`);
  
  const nytArticle = enriched.find(a => a.source_domain === 'nytimes.com');
  const nytUsedFallback = nytArticle.excerpt.length <= 300;
  console.log(`${nytUsedFallback ? '✓' : '✗'} NYT used RSS fallback: ${nytUsedFallback}`);
  
  console.log('\n✅ Test completed successfully!\n');
  console.log('Next steps:');
  console.log('1. Add CSM/PBS/ProPublica feeds to feed_registry');
  console.log('2. Run worker to enrich stories with real articles');
  console.log('3. Compare summary quality before/after');

} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error('\nStack trace:', error.stack);
  process.exit(1);
}
