import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log('=== CLUSTERING DIAGNOSTIC ===\n');

// 1. Check if the function exists and what it returns
console.log('1. Testing attach_or_create_story function...');
const testId = 'diag-' + Date.now();
const testUrl = 'https://test.com/' + testId;
const testHash = crypto.createHash('sha256').update(testUrl).digest('hex');

// First create a test article
const { data: article, error: artErr } = await sb
  .from('articles')
  .upsert({
    id: testId,
    title: 'Diagnostic Test Article',
    url: testUrl,
    url_canonical: testUrl,
    url_hash: testHash,
    published_at: new Date().toISOString(),
    source_name: 'Test',
    source_domain: 'test.com',
    content: 'Test'
  }, { onConflict: 'url_hash,published_date' })
  .select()
  .single();

if (artErr) {
  console.log('❌ Cannot create test article:', artErr);
  process.exit(1);
}

console.log('✅ Test article created:', testId);

// 2. Call the function and see what happens
console.log('\n2. Calling attach_or_create_story...');
const { data: funcResult, error: funcErr } = await sb.rpc('attach_or_create_story', {
  _article_id: testId,
  _title: 'Diagnostic Test Article',
  _url: testUrl,
  _url_canonical: testUrl,
  _url_hash: testHash,
  _published_at: new Date().toISOString(),
  _source_name: 'Test',
  _source_domain: 'test.com',
  _primary_actor: null,
  _categories: null
});

if (funcErr) {
  console.log('❌ Function error:', funcErr);
} else {
  console.log('Function result:', JSON.stringify(funcResult, null, 2));
}

// 3. Check if a link was created
console.log('\n3. Checking article_story table...');
const { data: links, error: linkErr } = await sb
  .from('article_story')
  .select('*')
  .eq('article_id', testId);

if (linkErr) {
  console.log('❌ Cannot query article_story:', linkErr);
} else if (!links || links.length === 0) {
  console.log('❌ No links found in article_story');
} else {
  console.log('✅ Links found:', links);
}

// 4. Check the article_story table structure
console.log('\n4. Checking article_story columns...');
const { data: sample } = await sb
  .from('article_story')
  .select('*')
  .limit(1);

if (sample && sample.length > 0) {
  console.log('Columns:', Object.keys(sample[0]));
} else {
  console.log('No data in article_story table to check structure');
}

// 5. Check if stories table exists and has data
console.log('\n5. Checking stories table...');
const { data: stories, error: storyErr } = await sb
  .from('stories')
  .select('id')
  .limit(1);

if (storyErr) {
  console.log('❌ Cannot query stories:', storyErr);
} else {
  console.log('✅ Stories table accessible');
}

// Clean up
await sb.from('article_story').delete().eq('article_id', testId);
await sb.from('articles').delete().eq('id', testId);

console.log('\n=== DIAGNOSIS COMPLETE ===');
console.log('\nThe issue is likely one of:');
console.log('1. The function returns a result but doesn\'t create a link');
console.log('2. The function has wrong parameter names');
console.log('3. The function errors internally but returns a status');
console.log('4. The article_story table has constraints preventing inserts');
console.log('\nCheck the output above to see which one it is.');
