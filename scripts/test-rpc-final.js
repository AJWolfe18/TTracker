#!/usr/bin/env node
/**
 * Final test to confirm RPC function works correctly
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testRPC() {
  console.log('🧪 Testing RPC function with exact parameters...\n');
  
  const testUrl = `https://test.com/final-test-${Date.now()}`;
  const urlHash = crypto.createHash('sha256').update(testUrl).digest('hex');
  const title = 'Test Article - DELETE ME';
  const content = 'This is test content';
  const publishedAt = new Date().toISOString();
  
  // Call with EXACT parameter order from database
  const { data: result, error } = await supabase.rpc('upsert_article_and_enqueue_jobs', {
    p_url: testUrl,
    p_title: title,
    p_content: content,
    p_published_at: publishedAt,
    p_feed_id: 'test-feed-123',
    p_source_name: 'Test Source',
    p_source_domain: 'test.com',
    p_content_type: 'news_report',
    p_is_opinion: false,
    p_metadata: { test: true }
  });
  
  if (error) {
    console.log('❌ RPC Failed:', error.message);
    console.log('Full error:', error);
    process.exit(1);
  }
  
  console.log('✅ RPC succeeded!');
  console.log('Result:', result);
  
  // Verify it went to articles table
  const { data: article, error: fetchError } = await supabase
    .from('articles')
    .select('*')
    .eq('url', testUrl)
    .single();
  
  if (article) {
    console.log('\n✅ Article found in ARTICLES table:');
    console.log('  ID:', article.id);
    console.log('  Title:', article.title);
    console.log('  URL:', article.url);
    console.log('  Source:', article.source_name);
    console.log('  Published at:', article.published_at);
    
    // Check if job was created
    const { data: jobs } = await supabase
      .from('job_queue')
      .select('*')
      .eq('type', 'process_article')
      .order('created_at', { ascending: false })
      .limit(1);
    
    if (jobs && jobs[0]) {
      console.log('\n✅ Job created in job_queue:');
      console.log('  Job ID:', jobs[0].id);
      console.log('  Type:', jobs[0].type || jobs[0].job_type);
      console.log('  Status:', jobs[0].status);
    }
    
    // Cleanup
    await supabase.from('articles').delete().eq('id', article.id);
    console.log('\n🧹 Cleaned up test article');
    
    console.log('\n✨ ALL TESTS PASSED - RPC FUNCTION WORKS!');
  } else {
    console.log('❌ Article NOT found in articles table');
    console.log('Fetch error:', fetchError);
    
    // Check if it went to political_entries by mistake
    const { data: pe } = await supabase
      .from('political_entries')
      .select('*')
      .eq('url', testUrl)
      .single();
    
    if (pe) {
      console.log('❌ WRONG: Article found in POLITICAL_ENTRIES table!');
      console.log('   The RPC function is using the wrong table!');
    }
  }
}

testRPC().catch(console.error);
