import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkFragmentation() {
  console.log('=== RECENT STORIES CHECK ===\n');

  // Get recent stories
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, primary_headline, first_seen_at, top_entities, topic_slugs')
    .order('first_seen_at', { ascending: false })
    .limit(40);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Found ' + stories.length + ' recent stories\n');

  // Group by potential topic
  const groups = {
    'turning_point': [],
    'vance': [],
    'epstein': [],
    'tanker': [],
    'coast_guard': []
  };

  for (const story of stories) {
    const h = (story.primary_headline || '').toLowerCase();
    if (h.includes('turning point')) groups.turning_point.push(story);
    if (h.includes('vance')) groups.vance.push(story);
    if (h.includes('epstein')) groups.epstein.push(story);
    if (h.includes('tanker') || h.includes('oil')) groups.tanker.push(story);
    if (h.includes('coast guard')) groups.coast_guard.push(story);
  }

  for (const [topic, topicStories] of Object.entries(groups)) {
    if (topicStories.length > 1) {
      console.log('--- POTENTIAL FRAGMENTATION: ' + topic + ' (' + topicStories.length + ' stories) ---\n');
      for (const s of topicStories) {
        console.log('Story ' + s.id + ':');
        console.log('  "' + s.primary_headline + '"');
        console.log('  Entities: ' + JSON.stringify(s.top_entities));
        console.log('');
      }
    }
  }

  // Now compute cross-story embedding similarities for fragmented groups
  console.log('\n=== EMBEDDING SIMILARITIES BETWEEN FRAGMENTED STORIES ===\n');

  const allFragmented = [...new Set([...groups.vance, ...groups.epstein, ...groups.tanker, ...groups.coast_guard])];

  for (const story of allFragmented.slice(0, 8)) {
    // Get embedding for this story
    const { data: storyData } = await supabase
      .from('stories')
      .select('centroid_embedding_v1')
      .eq('id', story.id)
      .single();

    if (!storyData || !storyData.centroid_embedding_v1) continue;

    const { data: similar } = await supabase.rpc('find_similar_stories', {
      query_embedding: storyData.centroid_embedding_v1,
      match_limit: 10,
      min_similarity: 0.85
    });

    if (similar && similar.length > 1) {
      console.log('Story ' + story.id + ' ("' + story.primary_headline.substring(0, 40) + '..."):');
      for (const s of similar) {
        if (s.id !== story.id) {
          console.log('  sim=' + s.similarity.toFixed(3) + ' -> Story ' + s.id + ' "' + (s.primary_headline || 'N/A').substring(0, 40) + '..."');
        }
      }
      console.log('');
    }
  }
}

checkFragmentation();
