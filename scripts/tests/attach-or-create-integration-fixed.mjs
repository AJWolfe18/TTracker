import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Proper SHA-256 hashing
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// Use unique timestamp and random string to avoid conflicts
const uniqueId = Date.now() + '-' + Math.random().toString(36).substring(7);
const articleId = 'test-integration-' + uniqueId;
const url = `https://test.local/article-${uniqueId}`;
const urlHash = sha256(url);
const now = new Date().toISOString();
const uniqueTitle = `Senate advances stopgap funding bill ${uniqueId}`;

// Clean up any existing article with this hash first
await sb.from('article_story').delete().eq('article_id', articleId);
await sb.from('articles').delete().eq('url_hash', urlHash);

// Use insert (not upsert) - onConflict doesn't work with GENERATED columns via PostgREST
// We already cleaned up any existing data above, so insert is safe
const { data: article, error: insertError } = await sb
  .from('articles')
  .insert({
    id: articleId,
    title: uniqueTitle,
    url: url,
    url_canonical: url,
    url_hash: urlHash,
    published_at: now,
    source_name: 'Test Source',
    source_domain: 'test.local',
    content: 'Test content for clustering'
  })
  .select()
  .single();

assert.ifError(insertError);
assert.ok(article, 'Article should be created');

// Now call the clustering function directly
const { data: result1, error: error1 } = await sb.rpc('attach_or_create_story', {
  _article_id: articleId,
  _title: uniqueTitle,
  _url: url,
  _url_canonical: url,
  _url_hash: urlHash,
  _published_at: now,
  _source_name: 'Test Source',
  _source_domain: 'test.local',
  _primary_actor: 'Senate',
  _categories: ['politics', 'legislation']
});

assert.ifError(error1);
assert.ok(result1, 'Should return a result');
assert.ok(result1?.story_id || result1?.created || result1?.status !== 'error', 'Should create or attach to story');

// Wait a moment for database to settle
await new Promise(resolve => setTimeout(resolve, 100));

// Check that article_story link was created
const { data: links, error: linkError } = await sb
  .from('article_story')
  .select('*')
  .eq('article_id', articleId);

assert.ifError(linkError);
assert.ok(links && links.length > 0, 'Article should be linked to a story');

// Test idempotency - calling again should return already_clustered
const { data: result2, error: error2 } = await sb.rpc('attach_or_create_story', {
  _article_id: articleId,
  _title: uniqueTitle,
  _url: url,
  _url_canonical: url,
  _url_hash: urlHash,
  _published_at: now,
  _source_name: 'Test Source',
  _source_domain: 'test.local',
  _primary_actor: 'Senate',
  _categories: ['politics', 'legislation']
});

assert.ifError(error2);
assert.ok(result2?.status === 'already_clustered' || !result2?.created, 'Should indicate already clustered');

// Clean up
await sb.from('article_story').delete().eq('article_id', articleId);
await sb.from('articles').delete().eq('id', articleId);

console.log('[OK] attach-or-create-integration');
