// verify-test-schema.js
// Run this script to check if TEST database has correct schema
// Usage: node scripts/verify-test-schema.js

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing environment variables!');
  console.error('Need: SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function verifySchema() {
  console.log('🔍 Verifying TEST Database Schema...');
  console.log('URL:', SUPABASE_URL);
  console.log('');

  const results = {
    passed: [],
    failed: [],
    warnings: []
  };

  // 1. Check that articles table exists
  console.log('Checking articles table...');
  const { data: articles, error: articlesError } = await supabase
    .from('articles')
    .select('*')
    .limit(1);
  
  if (!articlesError) {
    results.passed.push('✅ articles table exists');
    
    // Show columns
    if (articles && articles[0]) {
      const columns = Object.keys(articles[0]);
      console.log('  Columns:', columns.join(', '));
    }
    
    // Get count
    const { count } = await supabase
      .from('articles')
      .select('*', { count: 'exact', head: true });
    console.log('  Total articles:', count || 0);
  } else {
    results.failed.push('❌ articles table NOT FOUND: ' + articlesError.message);
  }

  // 2. Check that political_entries does NOT exist (or warn if it does)
  console.log('\nChecking for legacy political_entries table...');
  const { error: peError } = await supabase
    .from('political_entries')
    .select('id')
    .limit(1);
  
  if (peError) {
    results.passed.push('✅ political_entries table not found (good - using new schema)');
  } else {
    results.warnings.push('⚠️ political_entries table EXISTS - this is legacy, should not be used in TEST');
  }

  // 3. Check RSS system tables
  console.log('\nChecking RSS system tables...');
  const rssTables = ['stories', 'article_story', 'feed_registry', 'job_queue'];
  
  for (const table of rssTables) {
    const { error } = await supabase
      .from(table)
      .select('id')
      .limit(1);
    
    if (!error) {
      results.passed.push(`✅ ${table} table exists`);
    } else {
      results.failed.push(`❌ ${table} table NOT FOUND`);
    }
  }

  // 4. Check for atomic upsert function
  console.log('\nChecking for atomic upsert function...');
  try {
    const { error } = await supabase.rpc('upsert_article_and_enqueue_jobs', {
      p_article: {
        title: 'Schema Test',
        url: 'https://test.local/schema-check-' + Date.now(),
        source_name: 'System Check',
        published_at: new Date().toISOString()
      }
    });
    
    if (!error) {
      results.passed.push('✅ upsert_article_and_enqueue_jobs function exists');
      // Clean up test article
      await supabase
        .from('articles')
        .delete()
        .eq('url', 'https://test.local/schema-check-' + Date.now());
    } else if (error.message.includes('does not exist')) {
      results.failed.push('❌ Atomic function NOT FOUND - need to apply migration 003');
    } else {
      // Function exists but returned an error (maybe validation)
      results.passed.push('✅ Atomic function exists (error was: ' + error.message + ')');
    }
  } catch (e) {
    results.failed.push('❌ Could not check atomic function: ' + e.message);
  }

  // 5. Check for active RSS feeds
  console.log('\nChecking RSS feeds...');
  const { data: feeds, count: feedCount } = await supabase
    .from('feed_registry')
    .select('*', { count: 'exact' })
    .eq('is_active', true);
  
  if (feeds && feeds.length > 0) {
    results.passed.push(`✅ ${feedCount} active RSS feeds configured`);
    feeds.forEach(f => console.log(`  - ${f.feed_name}: ${f.feed_url}`));
  } else {
    results.warnings.push('⚠️ No active RSS feeds configured - run seed script');
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('SCHEMA VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  
  if (results.failed.length === 0) {
    console.log('\n🎉 ALL CHECKS PASSED! Database is ready for RSS system.\n');
  } else {
    console.log('\n❌ SCHEMA ISSUES FOUND:\n');
    results.failed.forEach(msg => console.log(msg));
    console.log('\nTo fix: Run migrations 003 and 004 on TEST database');
  }
  
  if (results.warnings.length > 0) {
    console.log('\n⚠️ WARNINGS:\n');
    results.warnings.forEach(msg => console.log(msg));
  }
  
  console.log('\n✅ PASSED CHECKS:\n');
  results.passed.forEach(msg => console.log(msg));
  
  // Exit with error code if there were failures
  process.exit(results.failed.length > 0 ? 1 : 0);
}

verifySchema().catch(console.error);
