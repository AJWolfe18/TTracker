#!/usr/bin/env node
/**
 * CRITICAL: Run this BEFORE making ANY code changes
 * This verifies what actually exists in the database
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function verifyDatabaseState() {
  console.log('🔍 VERIFYING ACTUAL DATABASE STATE...\n');
  
  // 1. Get a sample job to see columns
  console.log('📋 Checking job_queue structure:');
  const { data: sampleJob, error: jobError } = await supabase
    .from('job_queue')
    .select('*')
    .limit(1)
    .single();
    
  if (sampleJob) {
    console.log('job_queue columns:', Object.keys(sampleJob));
    console.log('Sample job_type value:', sampleJob.job_type || sampleJob.type || 'COLUMN NOT FOUND');
    console.log('Has run_at?', 'run_at' in sampleJob);
    console.log('Has run_after?', 'run_after' in sampleJob);
  } else {
    console.log('No jobs in queue, trying to insert a test job...');
    const { data: testJob, error: insertError } = await supabase
      .from('job_queue')
      .insert({
        job_type: 'test',
        payload: { test: true },
        status: 'pending'
      })
      .select()
      .single();
    
    if (testJob) {
      console.log('job_queue columns:', Object.keys(testJob));
      // Clean up
      await supabase.from('job_queue').delete().eq('id', testJob.id);
    } else {
      console.log('Could not determine job_queue structure:', insertError?.message);
    }
  }
  
  // 2. Check articles table
  console.log('\n📋 Checking articles structure:');
  const { data: sampleArticle } = await supabase
    .from('articles')
    .select('*')
    .limit(1)
    .single();
    
  if (sampleArticle) {
    console.log('articles columns:', Object.keys(sampleArticle));
    console.log('Has title?', 'title' in sampleArticle);
    console.log('Has headline?', 'headline' in sampleArticle);
    console.log('Has url_hash?', 'url_hash' in sampleArticle);
  } else {
    console.log('No articles found');
  }
  
  // 3. Check feed_registry
  console.log('\n📋 Checking feed_registry structure:');
  const { data: sampleFeed } = await supabase
    .from('feed_registry')
    .select('*')
    .limit(1)
    .single();
    
  if (sampleFeed) {
    console.log('feed_registry columns:', Object.keys(sampleFeed));
    console.log('Has feed_url?', 'feed_url' in sampleFeed);
    console.log('Has url?', 'url' in sampleFeed);
    console.log('Sample feed_url:', sampleFeed.feed_url || sampleFeed.url || 'NOT FOUND');
  } else {
    console.log('No feeds found');
  }
  
  // 4. Test the actual RPC function with minimal params
  console.log('\n🧪 Testing RPC function (minimal call)...');
  const testUrl = `https://test.com/verify-${Date.now()}`;
  
  // Try with minimal parameters first
  const { data: rpcResult, error: rpcError } = await supabase.rpc('upsert_article_and_enqueue_jobs', {
    p_url: testUrl,
    p_title: 'Test',
    p_published_at: new Date().toISOString()
  });
  
  if (rpcError) {
    console.log('❌ Minimal RPC failed:', rpcError.message);
    
    // Try with more parameters
    console.log('\n🧪 Trying with more parameters...');
    const { error: rpcError2 } = await supabase.rpc('upsert_article_and_enqueue_jobs', {
      p_url: testUrl,
      p_title: 'Test Article',
      p_content: 'Test content',
      p_published_at: new Date().toISOString(),
      p_source_name: 'Test Source',
      p_source_domain: 'test.com'
    });
    
    if (rpcError2) {
      console.log('❌ Still failed:', rpcError2.message);
      console.log('   The error message tells us what is wrong!');
    } else {
      console.log('✅ RPC worked with these parameters');
    }
  } else {
    console.log('✅ RPC worked! Result:', rpcResult);
    
    // Check where it was inserted
    const { data: articleCheck } = await supabase
      .from('articles')
      .select('id, title')
      .eq('url', testUrl)
      .single();
      
    if (articleCheck) {
      console.log('✅ Confirmed: Using ARTICLES table');
      console.log('   Article ID:', articleCheck.id);
      // Cleanup
      await supabase.from('articles').delete().eq('id', articleCheck.id);
    } else {
      // Check political_entries
      const { data: peCheck } = await supabase
        .from('political_entries')
        .select('id')
        .eq('url', testUrl)
        .single();
      
      if (peCheck) {
        console.log('❌ WRONG: Using POLITICAL_ENTRIES table!');
        await supabase.from('political_entries').delete().eq('id', peCheck.id);
      } else {
        console.log('⚠️  Article not found in either table');
      }
    }
  }
  
  // 5. Check what claim_next_job returns
  console.log('\n🧪 Testing claim_next_job...');
  const { data: claimedJob, error: claimError } = await supabase
    .rpc('claim_next_job', { p_job_type: 'nonexistent_type' });
  
  if (claimError) {
    console.log('claim_next_job error:', claimError.message);
  } else if (claimedJob) {
    console.log('claim_next_job returned:', Object.keys(claimedJob));
  } else {
    console.log('claim_next_job returned null (no jobs)');
  }
  
  console.log('\n=====================================');
  console.log('SAVE THIS OUTPUT TO DATABASE-STATE.md');
  console.log('=====================================\n');
}

verifyDatabaseState().catch(console.error);
