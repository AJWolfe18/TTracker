// Test script: Validate article scraping against real RSS feeds
// Tests which feeds can be successfully scraped for full content
// Read-only - no database writes, no OpenAI calls

import { createClient } from '@supabase/supabase-js';
import Parser from 'rss-parser';
import dotenv from 'dotenv';
import { enrichArticlesForSummary } from './enrichment/scraper.js';

dotenv.config();

// Configuration
const FEEDS_TO_TEST = 15;
const ARTICLES_PER_FEED = 2;

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const parser = new Parser({
  timeout: 15000,  // Matches scraper timeout
  headers: {
    'User-Agent': 'TrumpyTracker/1.0 (+https://trumpytracker.com)'
  }
});

// Capture scraper logs to analyze methods used
const scrapeLogs = [];
const originalLog = console.log;
console.log = (...args) => {
  const msg = args.join(' ');
  if (msg.includes('scraped_ok') || msg.includes('scraped_fail') || msg.includes('scrape_fallback') || msg.includes('readability_fail')) {
    scrapeLogs.push(msg);
  }
  originalLog(...args);
};

async function fetchFeedArticles(feedUrl, feedName, limit = 2) {
  try {
    const feed = await parser.parseURL(feedUrl);
    const items = feed.items.slice(0, limit);

    return items.map(item => ({
      url: item.link,
      source_domain: new URL(item.link).hostname, // Use article domain, not feed domain
      title: item.title || 'Untitled',
      source_name: feedName,
      description: item.contentEncoded || item.content || item.description || item.summary || ''
    }));
  } catch (err) {
    console.error(`❌ RSS fetch failed for ${feedName}: ${err.message}`);
    return [];
  }
}

function parseScrapeLogs(logs, articleUrls) {
  const results = {
    scraped: 0,
    methods: { readability: 0, regex: 0, rss: 0 },
    failed: 0,
    lengths: []
  };

  for (const log of logs) {
    if (log.includes('scraped_ok method=readability')) {
      results.scraped++;
      results.methods.readability++;
      const match = log.match(/len=(\d+)/);
      if (match) results.lengths.push(parseInt(match[1]));
    } else if (log.includes('scraped_ok method=regex_fallback')) {
      results.scraped++;
      results.methods.regex++;
      const match = log.match(/len=(\d+)/);
      if (match) results.lengths.push(parseInt(match[1]));
    } else if (log.includes('scrape_fallback_to_rss')) {
      results.methods.rss++;
    } else if (log.includes('scraped_fail')) {
      results.failed++;
    }
  }

  return results;
}

async function main() {
  console.log('=== RSS SCRAPER VALIDATION TEST ===\n');

  // Step 1: Query feed_registry for active feeds
  const { data: feeds, error } = await supabase
    .from('feed_registry')
    .select('id, feed_url, feed_name, source_name, tier')
    .eq('is_active', true)
    .neq('id', 177) // Skip ProPublica (ID 177) - hangs even with 60s timeout
    .order('tier', { ascending: true })
    .order('feed_name', { ascending: true });

  if (error) {
    console.error('❌ Failed to fetch feeds:', error.message);
    process.exit(1);
  }

  console.log(`Testing ${feeds.length} feeds with up to ${ARTICLES_PER_FEED} articles each...\n`);

  const testResults = [];

  // Step 2: Test each feed
  for (const feed of feeds) {
    console.log(`\n📰 Testing: ${feed.source_name} (${feed.feed_url})`);

    // Clear logs for this feed
    scrapeLogs.length = 0;

    // Fetch articles
    const articles = await fetchFeedArticles(feed.feed_url, feed.source_name, ARTICLES_PER_FEED);

    if (articles.length === 0) {
      testResults.push({
        source_name: feed.source_name,
        domain: new URL(feed.feed_url).hostname,
        tested: 0,
        scraped: 0,
        method: 'rss_fetch_failed',
        avg_length: 0,
        errors: 1
      });
      continue;
    }

    // Run scraper
    const enriched = await enrichArticlesForSummary(articles);

    // Show sample scraped content (first 200 chars)
    if (enriched.length > 0 && enriched[0].excerpt && enriched[0].excerpt.length > 300) {
      console.log(`   ✅ Sample content: "${enriched[0].excerpt.slice(0, 200)}..."`);
    }

    // Parse results
    const logResults = parseScrapeLogs(scrapeLogs, articles.map(a => a.url));
    const avgLength = logResults.lengths.length > 0
      ? Math.round(logResults.lengths.reduce((a, b) => a + b, 0) / logResults.lengths.length)
      : 0;

    // Determine primary method used
    let method = 'rss_fallback';
    if (logResults.methods.readability > 0) method = 'readability';
    else if (logResults.methods.regex > 0) method = 'regex';

    testResults.push({
      source_name: feed.source_name,
      domain: new URL(feed.feed_url).hostname,
      tested: articles.length,
      scraped: logResults.scraped,
      method: method,
      avg_length: avgLength,
      errors: logResults.failed
    });

    // Brief pause between feeds
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Step 3: Display results table
  console.log('\n\n=== RESULTS ===\n');
  console.table(testResults.map(r => ({
    'Source': r.source_name.slice(0, 25),
    'Domain': r.domain.slice(0, 20),
    'Tested': r.tested,
    'Scraped': r.scraped,
    'Method': r.method,
    'Avg Length': r.avg_length,
    'Errors': r.errors
  })));

  // Step 4: Summary statistics
  const totalTested = testResults.reduce((sum, r) => sum + r.tested, 0);
  const totalScraped = testResults.reduce((sum, r) => sum + r.scraped, 0);
  const totalRss = testResults.filter(r => r.method === 'rss_fallback').length;
  const totalReadability = testResults.filter(r => r.method === 'readability').length;
  const totalRegex = testResults.filter(r => r.method === 'regex').length;
  const scrapedLengths = testResults.filter(r => r.avg_length > 0).map(r => r.avg_length);
  const avgScrapedLength = scrapedLengths.length > 0
    ? Math.round(scrapedLengths.reduce((a, b) => a + b, 0) / scrapedLengths.length)
    : 0;

  console.log('\n=== SUMMARY ===');
  console.log(`Feeds tested: ${feeds.length}`);
  console.log(`Articles tested: ${totalTested}`);
  console.log(`Successfully scraped: ${totalScraped} (${Math.round(totalScraped/totalTested*100)}%)`);
  console.log(`RSS fallbacks: ${totalRss} feeds`);
  console.log(`Scraping methods:`);
  console.log(`  - Readability: ${totalReadability} feeds`);
  console.log(`  - Regex: ${totalRegex} feeds`);
  console.log(`  - RSS fallback: ${totalRss} feeds`);
  console.log(`Avg scraped content length: ${avgScrapedLength} chars`);

  console.log('\n✅ Test complete\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
