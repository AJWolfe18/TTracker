#!/usr/bin/env node
/**
 * Check if recently ingested articles are being clustered properly
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function checkRecentClustering() {
  console.log('=== Recent Clustering Analysis ===\n');

  // Get last 50 articles
  const { data: recentArticles } = await supabase
    .from('articles')
    .select('id, title, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  console.log(`Analyzing last ${recentArticles.length} articles...\n`);

  // Check their story assignments
  let clustered = 0;
  let unclustered = 0;
  const storyMap = new Map();

  for (const article of recentArticles) {
    const { data: assignment } = await supabase
      .from('article_story')
      .select('story_id, similarity_score')
      .eq('article_id', article.id)
      .single();

    if (assignment) {
      clustered++;
      const count = storyMap.get(assignment.story_id) || 0;
      storyMap.set(assignment.story_id, count + 1);
    } else {
      unclustered++;
      console.log(`UNCLUSTERED: ${article.id} - "${article.title.substring(0, 60)}..."`);
    }
  }

  console.log(`\nClustering Results:`);
  console.log(`  Clustered: ${clustered} (${((clustered / recentArticles.length) * 100).toFixed(1)}%)`);
  console.log(`  Unclustered: ${unclustered} (${((unclustered / recentArticles.length) * 100).toFixed(1)}%)`);

  // Check multi-article stories
  const multiArticleStories = Array.from(storyMap.entries())
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);

  console.log(`\nMulti-Article Stories in Recent Batch:`);
  console.log(`  Total stories: ${storyMap.size}`);
  console.log(`  Multi-article stories: ${multiArticleStories.length}`);

  if (multiArticleStories.length > 0) {
    console.log(`\n  Top clustered stories:`);
    for (const [storyId, count] of multiArticleStories.slice(0, 5)) {
      const { data: story } = await supabase
        .from('stories')
        .select('primary_headline')
        .eq('id', storyId)
        .single();

      console.log(`  - Story ${storyId}: ${count} articles - "${story?.primary_headline.substring(0, 60)}..."`);
    }
    console.log(`\n  ✅ CLUSTERING IS WORKING - ${multiArticleStories.length} multi-article stories found`);
  } else {
    console.log(`\n  ❌ NO CLUSTERING - All recent articles went to separate stories`);
  }

  // Calculate clustering rate for recent articles
  const multiArticleRate = storyMap.size > 0
    ? ((multiArticleStories.length / storyMap.size) * 100).toFixed(1)
    : 0;
  console.log(`\nRecent clustering rate: ${multiArticleRate}% of stories are multi-article`);
}

checkRecentClustering().catch(console.error);
