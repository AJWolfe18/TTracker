// Test script for Edge Functions
// Run with: node test-edge-functions.js

const SUPABASE_URL = 'https://wnrjrywpcadwutfykflu.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUyMjA3MzcsImV4cCI6MjA3MDc5NjczN30.n-4DboHQSivt5GWx7X5wuaUsdmjsuJe0VgB18V-GxU4';
const ADMIN_KEY = process.env.ADMIN_API_KEY || 'my-secure-admin-key-2025'; // Use env var in production

// For local testing, use: http://localhost:54321/functions/v1
const BASE_URL = `${SUPABASE_URL}/functions/v1`;

async function testEndpoint(name, url, options = {}) {
  console.log(`\nTesting ${name}...`);
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${ANON_KEY}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log(`✅ ${name}: Success`);
      console.log(`   Response:`, JSON.stringify(data, null, 2).substring(0, 200) + '...');
    } else {
      console.log(`❌ ${name}: Failed (${response.status})`);
      console.log(`   Error:`, data);
    }
    
    return data;
  } catch (error) {
    console.log(`❌ ${name}: Error`);
    console.log(`   Error:`, error.message);
  }
}

async function runTests() {
  console.log('========================================');
  console.log('EDGE FUNCTIONS TEST SUITE');
  console.log('========================================');
  
  // Test 1: Get active stories
  await testEndpoint(
    'GET /stories-active',
    `${BASE_URL}/stories-active?limit=5`
  );
  
  // Test 2: Search stories
  await testEndpoint(
    'GET /stories-search',
    `${BASE_URL}/stories-search?q=Trump&status=active&limit=5`
  );
  
  // Test 3: Get story detail (using a test story ID)
  // First, get an active story to get its ID
  const activeStories = await testEndpoint(
    'GET stories to find ID',
    `${BASE_URL}/stories-active?limit=1`
  );
  
  if (activeStories?.items?.[0]?.id) {
    await testEndpoint(
      'GET /stories-detail',
      `${BASE_URL}/stories-detail/${activeStories.items[0].id}`
    );
  }
  
  // Test 4: Manual article submission (requires admin auth)
  await testEndpoint(
    'POST /articles-manual',
    `${BASE_URL}/articles-manual`,
    {
      method: 'POST',
      headers: {
        'x-api-key': ADMIN_KEY,
      },
      body: JSON.stringify({
        title: 'Test Article from Edge Function',
        url: 'https://example.com/test-article-' + Date.now(),
        source_name: 'Test Source',
        category: 'Test Category',
        severity_level: 2,
      }),
    }
  );
  
  console.log('\n========================================');
  console.log('TEST SUITE COMPLETE');
  console.log('========================================');
}

// Run tests
runTests().catch(console.error);