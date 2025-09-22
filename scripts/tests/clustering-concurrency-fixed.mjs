import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Proper SHA-256 hashing
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// Unique base with timestamp and random to avoid conflicts
const baseTime = Date.now() + '-' + Math.random().toString(36).substring(7);

// Create test articles using upsert
const articles = [];
for (let i = 0; i < 10; i++) {
  const articleId = `art-conc-${baseTime}-${i}`;
  const url = `https://example.com/article-${baseTime}-${i}`;
  const urlHash = sha256(url);
  
  // Use upsert with proper conflict handling
  const { data, error: artErr } = await sb.from('articles').upsert({
    id: articleId,
    title: `Concurrent article ${i}`,
    url: url,
    url_canonical: url,
    url_hash: urlHash,
    source_name: 'Test',
    source_domain: 'example.com',
    published_at: new Date().toISOString(),
    content: `Test content ${i}`
  }, {
    onConflict: 'url_hash,published_date'
  }).select().single();
  
  assert.ifError(artErr);
  assert.ok(data, `Article ${i} should be created`);
  articles.push(data.id);
}

// Cluster each article by calling the function directly
const clusterPromises = articles.map(async (articleId, i) => {
  const url = `https://example.com/article-${baseTime}-${i}`;
  const urlHash = sha256(url);
  
  const { data, error } = await sb.rpc('attach_or_create_story', {
    _article_id: articleId,
    _title: `Concurrent article ${i}`,
    _url: url,
    _url_canonical: url,
    _url_hash: urlHash,
    _published_at: new Date().toISOString(),
    _source_name: 'Test',
    _source_domain: 'example.com',
    _primary_actor: 'TestActor',
    _categories: ['test']
  });
  
  assert.ifError(error);
  return data;
});

// Execute all clustering operations concurrently
await Promise.all(clusterPromises);

// Wait a moment for database to settle
await new Promise(resolve => setTimeout(resolve, 200));

// Verify each article has exactly one link
for (const articleId of articles) {
  const { data: links, error: linkErr } = await sb
    .from('article_story')
    .select('story_id')
    .eq('article_id', articleId);
  
  assert.ifError(linkErr);
  assert.strictEqual(links?.length, 1, `Article ${articleId} should have exactly 1 story link, got ${links?.length}`);
}

// Check that all articles are linked to stories (no race conditions)
const { data: allLinks, error: allLinksErr } = await sb
  .from('article_story')
  .select('article_id')
  .in('article_id', articles);

assert.ifError(allLinksErr);
assert.strictEqual(allLinks?.length, articles.length, `All ${articles.length} articles should be linked`);

// Clean up
await sb.from('article_story').delete().in('article_id', articles);
await sb.from('articles').delete().in('id', articles);

console.log('[OK] clustering-concurrency');
