#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function analyzeRecentClustering() {
  console.log('Fetching articles from recent RSS run (2025-12-19 03:00+)...\n');

  // Get recent articles
  const { data: articles, error } = await supabase
    .from('articles')
    .select('id, title, source_name, topic_slug, created_at')
    .gt('created_at', '2025-12-19 03:00:00')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('Error fetching articles:', error);
    process.exit(1);
  }

  console.log(`Total articles fetched: ${articles.length}\n`);

  // Get story assignments
  const articleIds = articles.map(a => a.id);
  const { data: storyAssignments } = await supabase
    .from('article_story')
    .select('article_id, story_id, is_primary_source, similarity_score')
    .in('article_id', articleIds);

  // Get story details
  const storyIds = [...new Set(storyAssignments.map(sa => sa.story_id))];
  const { data: stories } = await supabase
    .from('stories')
    .select('id, primary_headline, status')
    .in('id', storyIds);

  const storyMap = new Map(stories.map(s => [s.id, s]));
  const assignmentMap = new Map(storyAssignments.map(sa => [sa.article_id, sa]));

  // Enrich articles with story info
  const enrichedArticles = articles.map(a => {
    const assignment = assignmentMap.get(a.id);
    return {
      ...a,
      story_id: assignment?.story_id,
      story_headline: storyMap.get(assignment?.story_id)?.primary_headline,
      story_status: storyMap.get(assignment?.story_id)?.status,
      is_primary: assignment?.is_primary_source,
      similarity: assignment?.similarity_score
    };
  });

  // Group by topic_slug
  const byTopicSlug = new Map();
  enrichedArticles.forEach(a => {
    if (a.topic_slug) {
      if (!byTopicSlug.has(a.topic_slug)) {
        byTopicSlug.set(a.topic_slug, []);
      }
      byTopicSlug.get(a.topic_slug).push(a);
    }
  });

  // Analyze missed clusters
  console.log('=== TOPIC SLUG ANALYSIS ===\n');

  const missedClusters = [];

  for (const [slug, arts] of byTopicSlug.entries()) {
    if (arts.length > 1) {
      // Check if they're in different stories
      const uniqueStories = new Set(arts.map(a => a.story_id));

      if (uniqueStories.size > 1) {
        console.log(`\n🔴 MISSED CLUSTER: "${slug}"`);
        console.log(`   ${arts.length} articles split across ${uniqueStories.size} different stories\n`);

        // Group by story
        const byStory = new Map();
        arts.forEach(a => {
          if (!byStory.has(a.story_id)) {
            byStory.set(a.story_id, []);
          }
          byStory.get(a.story_id).push(a);
        });

        for (const [storyId, storyArts] of byStory.entries()) {
          const story = storyMap.get(storyId);
          console.log(`   Story: "${story?.primary_headline || 'Unknown'}"`);
          storyArts.forEach(a => {
            console.log(`     - [${a.source_name}] ${a.title.substring(0, 80)}...`);
          });
          console.log('');
        }

        missedClusters.push({
          topic_slug: slug,
          article_count: arts.length,
          story_count: uniqueStories.size,
          articles: arts
        });
      }
    }
  }

  // Look for similar titles across different stories
  console.log('\n\n=== TITLE SIMILARITY ANALYSIS ===\n');

  const titleWords = new Map();
  enrichedArticles.forEach(a => {
    const words = a.title.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4); // Only meaningful words

    words.forEach(word => {
      if (!titleWords.has(word)) {
        titleWords.set(word, []);
      }
      titleWords.get(word).push(a);
    });
  });

  // Find words that appear in multiple different stories
  const suspiciousWords = [];
  for (const [word, arts] of titleWords.entries()) {
    if (arts.length >= 3) {
      const uniqueStories = new Set(arts.map(a => a.story_id));
      if (uniqueStories.size > 1) {
        suspiciousWords.push({ word, count: arts.length, stories: uniqueStories.size });
      }
    }
  }

  suspiciousWords.sort((a, b) => b.count - a.count);

  console.log('Words appearing in 3+ articles across different stories:');
  suspiciousWords.slice(0, 10).forEach(({ word, count, stories }) => {
    console.log(`  - "${word}": ${count} articles, ${stories} stories`);
  });

  // Summary
  console.log('\n\n=== SUMMARY ===\n');
  console.log(`Total articles analyzed: ${articles.length}`);
  console.log(`Unique topic_slugs: ${byTopicSlug.size}`);
  console.log(`Unique stories: ${storyIds.length}`);
  console.log(`\nMissed clusters identified: ${missedClusters.length}`);
  console.log(`Total "should have clustered" articles: ${missedClusters.reduce((sum, mc) => sum + mc.article_count, 0)}`);

  if (missedClusters.length > 0) {
    console.log('\nTop missed clusters by article count:');
    missedClusters
      .sort((a, b) => b.article_count - a.article_count)
      .slice(0, 5)
      .forEach(mc => {
        console.log(`  - "${mc.topic_slug}": ${mc.article_count} articles in ${mc.story_count} stories`);
      });
  }

  // Articles without topic_slug
  const noSlug = enrichedArticles.filter(a => !a.topic_slug);
  if (noSlug.length > 0) {
    console.log(`\n⚠️  Articles WITHOUT topic_slug: ${noSlug.length}`);
    console.log('Sample:');
    noSlug.slice(0, 3).forEach(a => {
      console.log(`  - [${a.source_name}] ${a.title.substring(0, 80)}...`);
    });
  }
}

analyzeRecentClustering().catch(console.error);
