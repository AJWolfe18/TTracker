#!/usr/bin/env node
/**
 * TTRC-315 Clustering Results Checker
 * Queries Supabase TEST database to analyze clustering performance after RSS run
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function checkClusteringResults() {
  console.log('=== TTRC-315 Clustering Results Check ===\n');

  // 1. Overall multi-article story rate
  console.log('1. Overall Multi-Article Story Rate:');
  const { data: overallStats, error: statsError } = await supabase.rpc('get_story_stats');

  if (statsError) {
    // Manual query if RPC doesn't exist
    const { data: stories } = await supabase
      .from('stories')
      .select('id');

    const { data: articleCounts } = await supabase
      .from('article_story')
      .select('story_id');

    // Count articles per story
    const storyMap = new Map();
    articleCounts?.forEach(({ story_id }) => {
      storyMap.set(story_id, (storyMap.get(story_id) || 0) + 1);
    });

    let multiArticle = 0;
    let singleArticle = 0;

    stories?.forEach(({ id }) => {
      const count = storyMap.get(id) || 0;
      if (count >= 2) {
        multiArticle++;
      } else {
        singleArticle++;
      }
    });

    const total = multiArticle + singleArticle;
    const multiRate = total > 0 ? ((multiArticle / total) * 100).toFixed(1) : 0;

    console.log(`   Multi-article stories: ${multiArticle}`);
    console.log(`   Single-article stories: ${singleArticle}`);
    console.log(`   Total stories: ${total}`);
    console.log(`   Multi-article rate: ${multiRate}%\n`);
  } else {
    console.log(overallStats);
  }

  // 2. Articles ingested in last 24 hours
  console.log('2. Recent Ingestion (Last 24 Hours):');
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { data: recentArticles24h, error: articles24Error } = await supabase
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', oneDayAgo);

  const { data: recentArticles1h, error: articles1Error } = await supabase
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', oneHourAgo);

  if (articles24Error || articles1Error) {
    console.error('   Error:', articles24Error?.message || articles1Error?.message);
  } else {
    console.log(`   Last 24 hours: ${recentArticles24h?.length || 0} articles`);
    console.log(`   Last 1 hour: ${recentArticles1h?.length || 0} articles\n`);
  }

  // 3. Stories created in last 24 hours
  console.log('3. Stories Created in Last 24 Hours:');
  const { data: recentStories, error: storiesError } = await supabase
    .from('stories')
    .select('id, primary_headline, first_seen_at')
    .gte('first_seen_at', oneDayAgo)
    .order('first_seen_at', { ascending: false })
    .limit(50);

  if (storiesError) {
    console.error('   Error:', storiesError.message);
  } else {
    console.log(`   New stories: ${recentStories?.length || 0}`);

    if (recentStories && recentStories.length > 0) {
      // Get article counts for each story
      for (const story of recentStories) {
        const { count } = await supabase
          .from('article_story')
          .select('*', { count: 'exact', head: true })
          .eq('story_id', story.id);

        console.log(`   - Story ${story.id}: ${count} articles - "${story.primary_headline.substring(0, 60)}..."`);
      }
    }
    console.log('');
  }

  // 4. Multi-article stories from last 24 hours
  console.log('4. Multi-Article Stories (Clustered) from Last 24 Hours:');
  if (recentStories && recentStories.length > 0) {
    const multiStories = [];

    for (const story of recentStories) {
      const { count } = await supabase
        .from('article_story')
        .select('*', { count: 'exact', head: true })
        .eq('story_id', story.id);

      if (count >= 2) {
        multiStories.push({ ...story, article_count: count });
      }
    }

    console.log(`   Multi-article stories in last 24h: ${multiStories.length}`);

    if (multiStories.length > 0) {
      console.log(`   Top clustered stories:`);
      multiStories.slice(0, 10).forEach(s => {
        console.log(`   - Story ${s.id}: ${s.article_count} articles - "${s.primary_headline.substring(0, 60)}..."`);
      });
      console.log(`   ✅ Clustering SUCCESS - ${multiStories.length} stories merged in last 24h`);
    } else {
      console.log('   ❌ No clustering occurred in last 24h - all stories are single-article');
    }

    // Check multi-article rate in last 24h
    const multiRate24h = ((multiStories.length / recentStories.length) * 100).toFixed(1);
    console.log(`   24h multi-article rate: ${multiRate24h}%`);
  } else {
    console.log('   No recent stories to analyze');
  }

  console.log('\n=== End Report ===');
}

checkClusteringResults().catch(console.error);
