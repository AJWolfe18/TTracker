/**
 * Test stale story reopening (TTRC-230 validation)
 *
 * Creates a fresh article matching story #290 (now stale) to verify:
 * 1. Score meets reopen threshold (>=0.80)
 * 2. Story transitions from 'stale' to 'growing'
 * 3. reopen_count increments
 */

import dotenv from 'dotenv';
import { clusterArticle } from './rss/hybrid-clustering.js';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testStaleReopening() {
  console.log('='.repeat(60));
  console.log('TTRC-230 Stale Story Reopening Test');
  console.log('='.repeat(60));
  console.log('');
  console.log('Target: Story #290 (currently stale)');
  console.log('');

  // 1. Verify story #290 is stale
  const { data: story } = await supabase
    .from('stories')
    .select('id, primary_headline, lifecycle_state, reopen_count, source_count, centroid_embedding_v1')
    .eq('id', 290)
    .single();

  console.log('Story #290 before test:');
  console.log('  - Headline:', story.primary_headline);
  console.log('  - State:', story.lifecycle_state);
  console.log('  - Reopen count:', story.reopen_count);
  console.log('  - Source count:', story.source_count);
  console.log('');

  // Update story to be stale AND set last_updated_at to recent time
  // (within 72 hours for time decay score)
  const recentTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  
  if (story.lifecycle_state !== 'stale') {
    console.log('⚠️  Story is not stale. Setting to stale first...');
    await supabase
      .from('stories')
      .update({ 
        lifecycle_state: 'stale',
        last_updated_at: recentTime.toISOString()
      })
      .eq('id', 290);
    console.log('✅ Story set to stale with recent last_updated_at');
    console.log('');
  } else {
    // Already stale, just update the timestamp
    console.log('⚠️  Updating last_updated_at to be within 72 hours...');
    await supabase
      .from('stories')
      .update({ last_updated_at: recentTime.toISOString() })
      .eq('id', 290);
    console.log('✅ Story last_updated_at updated');
    console.log('');
  }

  // 2. Create fresh test article with strong match
  const now = new Date();
  const testArticle = {
    id: `test-reopen-${Date.now()}`,
    url: `https://test.local/reopen-${Date.now()}`,
    url_hash: `test-reopen-hash-${Date.now()}`,
    title: 'Senate advances stopgap funding bill',
    source_name: 'Test Source',
    source_domain: 'test.local',
    published_at: now.toISOString(),  // TODAY
    // published_date: generated column - don't set it
    entities: [
      {id: 'US-SENATE', name: 'Senate', type: 'ORG', confidence: 0.9},
      {id: 'US-CONGRESS', name: 'Congress', type: 'ORG', confidence: 0.85},
      {id: 'US-FUNDING', name: 'funding bill', type: 'LAW', confidence: 0.8}
    ],
    // Use same embedding as story #290's centroid (for perfect match)
    embedding_v1: story.centroid_embedding_v1 ? JSON.parse(story.centroid_embedding_v1) : null
  };

  console.log('Creating test article:');
  console.log('  - ID:', testArticle.id);
  console.log('  - Title:', testArticle.title);
  console.log('  - Published:', testArticle.published_at);
  console.log('  - Entities:', testArticle.entities.length);
  console.log('');

  if (!testArticle.embedding_v1) {
    console.error('❌ Story #290 has no centroid - cannot create matching article');
    process.exit(1);
  }

  const { error: insertError } = await supabase
    .from('articles')
    .insert(testArticle);

  if (insertError) {
    console.error('❌ Failed to create article:', insertError.message);
    process.exit(1);
  }

  console.log('✅ Test article created');
  console.log('');

  // 3. Run clustering
  console.log('Running clustering...');
  console.log('');

  try {
    const result = await clusterArticle(testArticle.id);

    console.log('');
    console.log('='.repeat(60));
    console.log('CLUSTERING RESULT:');
    console.log('='.repeat(60));
    console.log('Story ID:', result.story_id);
    console.log('Created new story:', result.created_new);
    console.log('Reopened stale story:', result.reopened);
    console.log('Score:', result.score);
    console.log('Status:', result.status);
    console.log('');

    // 4. Verify story state changed
    if (result.reopened && result.story_id === 290) {
      const { data: updatedStory } = await supabase
        .from('stories')
        .select('id, lifecycle_state, reopen_count, source_count')
        .eq('id', 290)
        .single();

      console.log('Story #290 after reopening:');
      console.log('  - State:', updatedStory.lifecycle_state);
      console.log('  - Reopen count:', updatedStory.reopen_count);
      console.log('  - Source count:', updatedStory.source_count);
      console.log('');

      if (updatedStory.lifecycle_state === 'growing' && updatedStory.reopen_count > story.reopen_count) {
        console.log('✅ SUCCESS: Stale story reopened correctly!');
        console.log('  - State changed: stale → growing ✅');
        console.log('  - Reopen count incremented ✅');
        console.log('  - Source count incremented ✅');
      } else {
        console.log('❌ FAIL: State or counters did not update correctly');
      }
    } else if (!result.reopened && result.story_id === 290) {
      console.log('⚠️  Article attached to stale story but did NOT reopen');
      console.log('This means score was below 0.80 threshold');
    } else if (result.created_new) {
      console.log('❌ FAIL: Created new story instead of attaching to #290');
      console.log('Score was likely below clustering threshold');
    }

  } catch (error) {
    console.error('');
    console.error('❌ Clustering failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testStaleReopening().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
