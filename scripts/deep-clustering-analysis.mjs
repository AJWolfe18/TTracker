#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function deepAnalysis() {
  console.log('=== DEEP CLUSTERING ANALYSIS ===\n');

  // Get recent articles
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, source_name, topic_slug, url, created_at')
    .gt('created_at', '2025-12-19 03:00:00')
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`Total articles: ${articles.length}\n`);

  // Get story assignments
  const articleIds = articles.map(a => a.id);
  const { data: storyAssignments } = await supabase
    .from('article_story')
    .select('article_id, story_id, is_primary_source, similarity_score')
    .in('article_id', articleIds);

  if (!storyAssignments || storyAssignments.length === 0) {
    console.log('⚠️  NO STORY ASSIGNMENTS FOUND - All articles are unassigned!\n');
    return;
  }

  const { data: stories } = await supabase
    .from('stories')
    .select('id, primary_headline, status, topic_slug, created_at')
    .in('id', [...new Set(storyAssignments.map(sa => sa.story_id))]);

  const storyMap = new Map((stories || []).map(s => [s.id, s]));
  const assignmentMap = new Map(storyAssignments.map(sa => [sa.article_id, sa]));

  // Categorize articles
  const withSlug = articles.filter(a => a.topic_slug);
  const withoutSlug = articles.filter(a => !a.topic_slug);
  const assigned = articles.filter(a => assignmentMap.has(a.id));
  const unassigned = articles.filter(a => !assignmentMap.has(a.id));

  console.log('=== ARTICLE CATEGORIZATION ===');
  console.log(`With topic_slug: ${withSlug.length}`);
  console.log(`Without topic_slug: ${withoutSlug.length}`);
  console.log(`Assigned to story: ${assigned.length}`);
  console.log(`Unassigned: ${unassigned.length}\n`);

  // Check if articles without slugs are assigned
  const noSlugButAssigned = withoutSlug.filter(a => assignmentMap.has(a.id));
  const noSlugNotAssigned = withoutSlug.filter(a => !assignmentMap.has(a.id));

  console.log('Articles WITHOUT topic_slug:');
  console.log(`  - Assigned to story: ${noSlugButAssigned.length}`);
  console.log(`  - Not assigned: ${noSlugNotAssigned.length}\n`);

  // Look at story topic_slugs vs article topic_slugs
  console.log('=== STORY vs ARTICLE TOPIC_SLUGS ===\n');

  const storySlugMismatches = [];
  assigned.forEach(a => {
    const assignment = assignmentMap.get(a.id);
    const story = storyMap.get(assignment.story_id);

    if (a.topic_slug && story.topic_slug && a.topic_slug !== story.topic_slug) {
      storySlugMismatches.push({
        article: a,
        story: story,
        articleSlug: a.topic_slug,
        storySlug: story.topic_slug
      });
    }
  });

  if (storySlugMismatches.length > 0) {
    console.log(`Found ${storySlugMismatches.length} articles with topic_slug DIFFERENT from their story's topic_slug:\n`);
    storySlugMismatches.slice(0, 5).forEach(m => {
      console.log(`Article: "${m.article.title.substring(0, 60)}..."`);
      console.log(`  Article slug: "${m.articleSlug}"`);
      console.log(`  Story slug: "${m.storySlug}"`);
      console.log(`  Story: "${m.story.primary_headline}"\n`);
    });
  }

  // Examine articles without slugs
  console.log('\n=== SAMPLE ARTICLES WITHOUT TOPIC_SLUG ===\n');

  withoutSlug.slice(0, 10).forEach(a => {
    const assignment = assignmentMap.get(a.id);
    const story = assignment ? storyMap.get(assignment.story_id) : null;

    console.log(`"${a.title}"`);
    console.log(`  Source: ${a.source_name}`);
    console.log(`  Assigned: ${assignment ? 'YES' : 'NO'}`);
    if (story) {
      console.log(`  Story: "${story.primary_headline}"`);
      console.log(`  Story slug: "${story.topic_slug || 'NONE'}"`);
    }
    console.log('');
  });

  // Check for potential clusters among articles with slugs
  console.log('\n=== POTENTIAL MISSED CLUSTERS (articles with same topic_slug) ===\n');

  const slugGroups = new Map();
  withSlug.forEach(a => {
    if (!slugGroups.has(a.topic_slug)) {
      slugGroups.set(a.topic_slug, []);
    }
    slugGroups.get(a.topic_slug).push(a);
  });

  for (const [slug, arts] of slugGroups.entries()) {
    if (arts.length >= 2) {
      const storyIds = new Set(arts.map(a => assignmentMap.get(a.id)?.story_id).filter(Boolean));

      if (storyIds.size > 1) {
        console.log(`\n🔴 MISSED CLUSTER: "${slug}"`);
        console.log(`   ${arts.length} articles split across ${storyIds.size} stories`);

        arts.forEach(a => {
          const assignment = assignmentMap.get(a.id);
          const story = assignment ? storyMap.get(assignment.story_id) : null;
          console.log(`   - "${a.title.substring(0, 60)}..." [${a.source_name}]`);
          if (story) {
            console.log(`     → Story: "${story.primary_headline}"`);
          }
        });
      } else if (storyIds.size === 1) {
        console.log(`✅ "${slug}": ${arts.length} articles → 1 story (CORRECT)`);
      }
    }
  }

  // Look for temporal patterns
  console.log('\n\n=== TEMPORAL ANALYSIS ===\n');

  const firstArticle = articles[articles.length - 1];
  const lastArticle = articles[0];

  console.log(`Time range: ${firstArticle.created_at} to ${lastArticle.created_at}`);

  if (stories && stories.length > 0) {
    console.log(`Stories created in this period: ${stories.length}`);
    console.log(`Articles per story (avg): ${(articles.length / stories.length).toFixed(1)}`);

    // Check if stories were created vs articles attached to existing
    const newStories = stories.filter(s => new Date(s.created_at) > new Date('2025-12-19 03:00:00'));
    console.log(`\nNew stories created: ${newStories.length}`);
    console.log(`Existing stories reused: ${stories.length - newStories.length}`);
  }

  // Check for articles from same source about similar topics
  console.log('\n\n=== SOURCE ANALYSIS ===\n');

  const bySources = new Map();
  unassigned.forEach(a => {
    if (!bySources.has(a.source_name)) {
      bySources.set(a.source_name, []);
    }
    bySources.get(a.source_name).push(a);
  });

  console.log('Unassigned articles by source:');
  for (const [source, arts] of bySources.entries()) {
    console.log(`  ${source}: ${arts.length} articles`);
  }

  // Look for common words in unassigned titles
  console.log('\n\n=== UNASSIGNED ARTICLE TITLE PATTERNS ===\n');

  const titleWords = new Map();
  unassigned.forEach(a => {
    const words = a.title.toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 4 && !['trump', 'about', 'would', 'house', 'white'].includes(w));

    words.forEach(word => {
      if (!titleWords.has(word)) {
        titleWords.set(word, []);
      }
      titleWords.get(word).push(a);
    });
  });

  const frequentWords = [...titleWords.entries()]
    .filter(([_, arts]) => arts.length >= 3)
    .sort((a, b) => b[1].length - a[1].length);

  console.log('Frequent words in unassigned articles (3+ occurrences):');
  frequentWords.slice(0, 10).forEach(([word, arts]) => {
    console.log(`  "${word}": ${arts.length} articles`);
  });
}

deepAnalysis().catch(console.error);
