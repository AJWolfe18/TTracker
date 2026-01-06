#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function checkClusteringResults() {
  console.log('=== TTRC-315 Clustering Results Analysis ===\n');

  // Query 1: Multi-article story rate
  console.log('1. Multi-article vs Single-article Stories:');
  const { data: stories, error: storiesError } = await supabase
    .from('stories')
    .select('id');

  if (storiesError) {
    console.error('Stories query error:', storiesError);
    return;
  }

  console.log(`  Total stories: ${stories.length}`);

  // Get article counts manually
  const { data: articleStories, error: asError } = await supabase
    .from('article_story')
    .select('story_id, article_id');

  if (asError) {
    console.error('Article story query error:', asError);
    return;
  }

  const storyCounts = {};
  articleStories.forEach(as => {
    storyCounts[as.story_id] = (storyCounts[as.story_id] || 0) + 1;
  });

  let multiArticle = 0;
  let singleArticle = 0;

  stories.forEach(story => {
    const count = storyCounts[story.id] || 0;
    if (count >= 2) {
      multiArticle++;
    } else {
      singleArticle++;
    }
  });

  console.log(`  Multi-article stories: ${multiArticle}`);
  console.log(`  Single-article stories: ${singleArticle}`);
  console.log(`  Multi-article rate: ${((multiArticle / stories.length) * 100).toFixed(1)}%\n`);

  // Query 2: Recent multi-article stories
  console.log('2. Recent Stories with Multiple Articles:');
  const { data: recentStories, error: error2 } = await supabase
    .from('stories')
    .select('id, primary_headline, first_seen_at')
    .order('first_seen_at', { ascending: false })
    .limit(200);

  if (error2) {
    console.error('Error:', error2);
    return;
  }

  const multiStories = recentStories
    .map(s => ({
      ...s,
      article_count: storyCounts[s.id] || 0
    }))
    .filter(s => s.article_count >= 2)
    .slice(0, 10);

  multiStories.forEach(story => {
    console.log(`  Story ${story.id}: ${story.article_count} articles`);
    console.log(`    "${story.primary_headline}"`);
    console.log(`    Created: ${story.first_seen_at}`);
  });
  console.log();

  // Query 3: Venezuela/oil tanker articles
  console.log('3. Venezuela/Oil Tanker Articles:');
  const { data: venezuelaArticles, error: error3 } = await supabase
    .from('articles')
    .select('id, title, created_at')
    .or('title.ilike.%venezuela%,title.ilike.%oil tanker%,title.ilike.%tanker%')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error3) {
    console.error('Error:', error3);
    return;
  }

  console.log(`  Found ${venezuelaArticles.length} articles\n`);

  if (venezuelaArticles.length > 0) {
    // Get their story assignments
    const articleIds = venezuelaArticles.map(a => a.id);
    const { data: storyAssignments, error: error4 } = await supabase
      .from('article_story')
      .select('article_id, story_id')
      .in('article_id', articleIds);

    if (error4) {
      console.error('Error fetching story assignments:', error4);
      return;
    }

    const storyMap = {};
    storyAssignments.forEach(as => {
      storyMap[as.article_id] = as.story_id;
    });

    // Get story details
    const storyIds = [...new Set(Object.values(storyMap))];
    const { data: storyDetails, error: error5 } = await supabase
      .from('stories')
      .select('id, primary_headline')
      .in('id', storyIds);

    if (error5) {
      console.error('Error fetching story details:', error5);
      return;
    }

    const storyHeadlines = {};
    storyDetails.forEach(s => {
      storyHeadlines[s.id] = s.primary_headline;
    });

    venezuelaArticles.forEach(article => {
      const storyId = storyMap[article.id];
      const storyHeadline = storyId ? storyHeadlines[storyId] : null;

      console.log(`  Article ${article.id}:`);
      console.log(`    Title: ${article.title}`);
      console.log(`    Story: ${storyHeadline || 'No story'} (ID: ${storyId || 'N/A'})`);
      console.log(`    Created: ${article.created_at}`);
    });
  }
}

checkClusteringResults().catch(console.error);
