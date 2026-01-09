#!/usr/bin/env node
/**
 * Check clustering quality - are related articles being grouped together?
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function analyze() {
  // Get all stories
  const { data: stories, error: e1 } = await supabase
    .from('stories')
    .select('id, primary_headline, source_count, top_entities, status')
    .order('source_count', { ascending: false });

  if (e1 || !stories) {
    console.error('Failed to fetch stories:', e1);
    return;
  }

  // Get article-story relationships
  const { data: articleStory, error: e2 } = await supabase
    .from('article_story')
    .select('article_id, story_id');

  if (e2 || !articleStory) {
    console.error('Failed to fetch article_story:', e2);
    return;
  }

  // Get articles
  const { data: articles, error: e3 } = await supabase
    .from('articles')
    .select('id, title, source_name, entities');

  if (e3 || !articles) {
    console.error('Failed to fetch articles:', e3);
    return;
  }

  // Build lookups
  const articleMap = new Map();
  for (const a of articles || []) {
    articleMap.set(a.id, a);
  }

  const storyArticles = new Map();
  for (const as of articleStory || []) {
    if (!storyArticles.has(as.story_id)) storyArticles.set(as.story_id, []);
    storyArticles.get(as.story_id).push(as.article_id);
  }

  console.log('=== CLUSTERING QUALITY ASSESSMENT ===');
  console.log('');

  // Count articles per story from article_story table
  const storyArticleCounts = new Map();
  for (const as of articleStory) {
    storyArticleCounts.set(as.story_id, (storyArticleCounts.get(as.story_id) || 0) + 1);
  }

  // Enrich stories with article count
  for (const s of stories) {
    s.article_count = storyArticleCounts.get(s.id) || 0;
  }

  // Sort by article count
  stories.sort((a, b) => b.article_count - a.article_count);

  // Basic stats
  const totalStories = stories.length;
  const singleArticle = stories.filter(s => s.article_count <= 1).length;
  const twoToFive = stories.filter(s => s.article_count >= 2 && s.article_count <= 5).length;
  const sixPlus = stories.filter(s => s.article_count >= 6).length;

  console.log('1. STORY SIZE DISTRIBUTION');
  console.log('   ─────────────────────────────────────');
  console.log(`   Total stories: ${totalStories}`);
  console.log(`   Single-article (no clustering): ${singleArticle} (${Math.round(singleArticle/totalStories*100)}%)`);
  console.log(`   2-5 articles (some clustering): ${twoToFive} (${Math.round(twoToFive/totalStories*100)}%)`);
  console.log(`   6+ articles (strong clustering): ${sixPlus} (${Math.round(sixPlus/totalStories*100)}%)`);
  console.log('');

  // Is this good or bad?
  console.log('   INTERPRETATION:');
  if (singleArticle / totalStories > 0.7) {
    console.log('   ⚠️  70%+ single-article stories = clustering may be too strict');
  } else if (singleArticle / totalStories > 0.5) {
    console.log('   📊 50-70% single-article = normal for diverse news sources');
  } else {
    console.log('   ✅ <50% single-article = clustering is working well');
  }
  console.log('');

  // Show well-clustered stories
  console.log('2. TOP CLUSTERED STORIES (best examples)');
  console.log('   ─────────────────────────────────────');

  for (const s of stories.filter(s => s.article_count >= 3).slice(0, 8)) {
    const artIds = storyArticles.get(s.id) || [];
    const arts = artIds.map(id => articleMap.get(id)).filter(Boolean);
    const sources = [...new Set(arts.map(a => a.source_name))];

    console.log('');
    console.log(`   Story #${s.id}: "${s.primary_headline.slice(0, 70)}..."`);
    console.log(`   📰 ${s.article_count} articles from ${sources.length} sources: ${sources.slice(0, 4).join(', ')}`);
    console.log(`   🏷️  Entities: ${(s.top_entities || []).slice(0, 4).join(', ')}`);

    // Show article titles to verify they belong together
    console.log('   Articles:');
    for (const a of arts.slice(0, 3)) {
      console.log(`      - "${a.title.slice(0, 60)}..." (${a.source_name})`);
    }
    if (arts.length > 3) {
      console.log(`      ... and ${arts.length - 3} more`);
    }
  }

  console.log('');
  console.log('3. CLUSTERING QUALITY SIGNALS');
  console.log('   ─────────────────────────────────────');

  // Check if multi-source clustering is happening
  let multiSourceStories = 0;
  for (const s of stories.filter(s => s.article_count >= 2)) {
    const artIds = storyArticles.get(s.id) || [];
    const arts = artIds.map(id => articleMap.get(id)).filter(Boolean);
    const sources = [...new Set(arts.map(a => a.source_name))];
    if (sources.length >= 2) multiSourceStories++;
  }

  const multiArtStories = stories.filter(s => s.article_count >= 2).length;
  console.log(`   Multi-source stories: ${multiSourceStories}/${multiArtStories} multi-article stories have 2+ sources`);

  if (multiSourceStories / multiArtStories > 0.5) {
    console.log('   ✅ Good: Clustering is finding same story across different outlets');
  } else {
    console.log('   ⚠️  Warning: Most clusters are same-source (might be duplicate detection, not clustering)');
  }

  // Entity overlap check
  console.log('');
  console.log('4. ENTITY OVERLAP IN CLUSTERS');
  console.log('   ─────────────────────────────────────');

  let goodOverlap = 0;
  let poorOverlap = 0;

  for (const s of stories.filter(s => s.article_count >= 2).slice(0, 20)) {
    const artIds = storyArticles.get(s.id) || [];
    const arts = artIds.map(id => articleMap.get(id)).filter(Boolean);

    // Get all entity IDs from articles in this story
    const allEntitySets = arts.map(a => new Set((a.entities || []).map(e => e.id)));

    if (allEntitySets.length >= 2) {
      // Find common entities across all articles
      const intersection = allEntitySets.reduce((a, b) => new Set([...a].filter(x => b.has(x))));

      if (intersection.size >= 1) {
        goodOverlap++;
      } else {
        poorOverlap++;
      }
    }
  }

  console.log(`   Stories with entity overlap: ${goodOverlap}/${goodOverlap + poorOverlap}`);
  if (goodOverlap / (goodOverlap + poorOverlap) > 0.7) {
    console.log('   ✅ Good: Articles in same story share entities');
  } else {
    console.log('   ⚠️  Warning: Many clusters lack entity overlap (title similarity only?)');
  }

  console.log('');
  console.log('=== BOTTOM LINE ===');
  console.log('');

  const clusteringRate = 1 - (singleArticle / totalStories);
  const multiSourceRate = multiSourceStories / Math.max(multiArtStories, 1);
  const overlapRate = goodOverlap / Math.max(goodOverlap + poorOverlap, 1);

  const score = (clusteringRate * 0.4 + multiSourceRate * 0.3 + overlapRate * 0.3) * 100;

  console.log(`Clustering Quality Score: ${Math.round(score)}/100`);
  console.log('');
  if (score >= 60) {
    console.log('✅ Clustering is working reasonably well.');
    console.log('   Related articles from different sources are being grouped together.');
  } else if (score >= 40) {
    console.log('📊 Clustering is partially working.');
    console.log('   Some grouping is happening but could be improved.');
  } else {
    console.log('⚠️  Clustering needs attention.');
    console.log('   Articles may not be grouping as expected.');
  }
}

analyze().catch(console.error);
