#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function debug() {
  // Get articles with entities
  const { data: arts } = await supabase
    .from('articles')
    .select('id, title, entities')
    .not('entities', 'is', null)
    .limit(10);

  // Get article-story links
  const { data: links } = await supabase
    .from('article_story')
    .select('article_id, story_id');

  const linkMap = new Map();
  for (const l of links) linkMap.set(l.article_id, l.story_id);

  console.log('=== ENTITY OVERLAP DEBUG ===\n');

  for (const a of arts) {
    const storyId = linkMap.get(a.id);
    if (!storyId) continue;

    const { data: story } = await supabase
      .from('stories')
      .select('id, primary_headline, entity_counter')
      .eq('id', storyId)
      .single();

    if (!story) continue;

    const articleEntityIds = (a.entities || []).map(e => e.id);
    const storyEntityCounter = story.entity_counter || {};
    const storyEntityIds = Object.keys(storyEntityCounter);

    console.log('Article: "' + a.title.slice(0, 60) + '..."');
    console.log('  Article entities (' + articleEntityIds.length + '): ' + articleEntityIds.slice(0, 5).join(', '));
    console.log('  Story #' + storyId + ' entity_counter keys (' + storyEntityIds.length + '): ' + storyEntityIds.slice(0, 5).join(', '));

    // Calculate Jaccard overlap
    const articleSet = new Set(articleEntityIds);
    const storySet = new Set(storyEntityIds);
    const intersection = [...articleSet].filter(id => storySet.has(id));
    const union = new Set([...articleSet, ...storySet]);
    const jaccard = union.size > 0 ? intersection.length / union.size : 0;

    console.log('  Intersection: ' + intersection.length + ' → ' + intersection.join(', '));
    console.log('  Jaccard score: ' + jaccard.toFixed(3));
    console.log('');
  }
}

debug().catch(console.error);
