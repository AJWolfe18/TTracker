// Test RSS Fetcher - One Feed Sanity Check
// Tests RSS parsing and conditional GET behavior
// Run with: node scripts/test/test-rss-fetch.js [url]

const Parser = require('rss-parser');

const DEFAULT_URL = 'https://www.reuters.com/rss/world';

async function testRSSFetch() {
  const url = process.argv[2] || DEFAULT_URL;
  
  console.log('🧪 RSS Fetcher Test');
  console.log(`📡 Testing URL: ${url}\n`);

  try {
    // Test 1: Basic fetch
    console.log('1️⃣ Testing basic fetch...');
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TrumpyTracker/1.0 RSS Test',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    console.log(`✅ Fetch successful: ${response.status}`);
    console.log(`   Content-Type: ${response.headers.get('content-type')}`);
    console.log(`   ETag: ${response.headers.get('etag') || 'None'}`);
    console.log(`   Last-Modified: ${response.headers.get('last-modified') || 'None'}`);

    // Test 2: Parse RSS content
    console.log('\n2️⃣ Testing RSS parsing...');
    const xmlContent = await response.text();
    
    const parser = new Parser({
      timeout: 15000,
      customFields: {
        item: [
          ['content:encoded', 'contentEncoded'],
          ['description', 'description'],
          ['summary', 'summary']
        ]
      }
    });

    const feed = await parser.parseString(xmlContent);
    
    console.log(`✅ Parsing successful`);
    console.log(`   Feed title: ${feed.title}`);
    console.log(`   Feed description: ${feed.description?.substring(0, 100)}...`);
    console.log(`   Total items: ${feed.items?.length || 0}`);

    // Test 3: Show sample items
    if (feed.items && feed.items.length > 0) {
      console.log('\n3️⃣ Sample articles:');
      
      feed.items.slice(0, 3).forEach((item, index) => {
        const published = item.isoDate || item.pubDate || 'Unknown';
        const age = item.isoDate ? 
          Math.round((Date.now() - new Date(item.isoDate)) / (1000 * 60 * 60)) : 
          '?';
        
        console.log(`   ${index + 1}. ${item.title}`);
        console.log(`      Published: ${published} (${age}h ago)`);
        console.log(`      URL: ${item.link}`);
        console.log(`      Content length: ${(item.contentEncoded || item.description || '').length} chars\n`);
      });
    }

    // Test 4: Test conditional GET (if we have ETag/Last-Modified)
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    
    if (etag || lastModified) {
      console.log('4️⃣ Testing conditional GET...');
      
      const conditionalHeaders = {
        'User-Agent': 'TrumpyTracker/1.0 RSS Test',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml'
      };
      
      if (etag) conditionalHeaders['If-None-Match'] = etag;
      if (lastModified) conditionalHeaders['If-Modified-Since'] = lastModified;
      
      const conditionalResponse = await fetch(url, {
        headers: conditionalHeaders,
        redirect: 'follow'
      });
      
      console.log(`   Conditional response: ${conditionalResponse.status}`);
      
      if (conditionalResponse.status === 304) {
        console.log('✅ 304 Not Modified - conditional GET working!');
      } else if (conditionalResponse.status === 200) {
        console.log('⚠️  200 OK - server doesn\'t support conditional GET or content changed');
      } else {
        console.log(`❌ Unexpected status: ${conditionalResponse.status}`);
      }
    } else {
      console.log('4️⃣ No ETag/Last-Modified headers - skipping conditional GET test');
    }

    // Test 5: Opinion detection test
    console.log('\n5️⃣ Testing opinion detection...');
    const opinionPatterns = [
      /\/opinion\//i,
      /\/editorial\//i,
      /\/commentary\//i,
      /\/analysis\//i,
      /\/op-ed\//i,
      /\/blogs?\//i
    ];
    
    if (feed.items && feed.items.length > 0) {
      const opinionCount = feed.items.filter(item => {
        const url = item.link || '';
        const title = item.title || '';
        return opinionPatterns.some(pattern => pattern.test(url)) ||
               /^(opinion|editorial|commentary|analysis):/i.test(title);
      }).length;
      
      console.log(`   Opinion articles detected: ${opinionCount}/${feed.items.length}`);
    }

    console.log('\n🎉 All tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
RSS Fetcher Test Script

Usage: node scripts/test/test-rss-fetch.js [url]

Examples:
  node scripts/test/test-rss-fetch.js
  node scripts/test/test-rss-fetch.js https://thehill.com/feed
  node scripts/test/test-rss-fetch.js https://www.politico.com/rss/politics-news.xml

Tests:
  1. Basic HTTP fetch with proper headers
  2. RSS/Atom parsing
  3. Sample article display
  4. Conditional GET (304 responses)
  5. Opinion content detection
`);
  process.exit(0);
}

// Run the test
testRSSFetch().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
