#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function checkAssignedArticles() {
  console.log('=== ANALYZING ASSIGNED ARTICLES ===\n');

  // Get recent articles
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, source_name, topic_slug, created_at')
    .gt('created_at', '2025-12-19 03:00:00')
    .order('created_at', { ascending: false })
    .limit(100);

  // Get story assignments
  const articleIds = articles.map(a => a.id);
  const { data: storyAssignments } = await supabase
    .from('article_story')
    .select('article_id, story_id, is_primary_source, similarity_score')
    .in('article_id', articleIds);

  if (!storyAssignments || storyAssignments.length === 0) {
    console.log('⚠️  NO STORY ASSIGNMENTS - All articles are unassigned!\n');
    console.log('This means clustering failed or did not run.\n');
    return;
  }

  const { data: stories } = await supabase
    .from('stories')
    .select('id, primary_headline, status, topic_slug, created_at')
    .in('id', [...new Set(storyAssignments.map(sa => sa.story_id))]);

  const storyMap = new Map((stories || []).map(s => [s.id, s]));
  const assignmentMap = new Map(storyAssignments.map(sa => [sa.article_id, sa]));

  const assigned = articles.filter(a => assignmentMap.has(a.id));
  const unassigned = articles.filter(a => !assignmentMap.has(a.id));

  console.log(`Total articles: ${articles.length}`);
  console.log(`Assigned: ${assigned.length}`);
  console.log(`Unassigned: ${unassigned.length}\n`);

  // Group assigned articles by source
  console.log('=== ASSIGNED ARTICLES BY SOURCE ===\n');

  const assignedBySource = new Map();
  assigned.forEach(a => {
    if (!assignedBySource.has(a.source_name)) {
      assignedBySource.set(a.source_name, []);
    }
    assignedBySource.get(a.source_name).push(a);
  });

  for (const [source, arts] of assignedBySource.entries()) {
    console.log(`${source}: ${arts.length} articles`);
  }

  // Check topic_slug distribution
  console.log('\n\n=== ASSIGNED ARTICLES WITH/WITHOUT TOPIC_SLUG ===\n');

  const assignedWithSlug = assigned.filter(a => a.topic_slug);
  const assignedWithoutSlug = assigned.filter(a => !a.topic_slug);

  console.log(`With topic_slug: ${assignedWithSlug.length}`);
  console.log(`Without topic_slug: ${assignedWithoutSlug.length}\n`);

  if (assignedWithoutSlug.length > 0) {
    console.log('Articles assigned WITHOUT topic_slug:');
    assignedWithoutSlug.slice(0, 5).forEach(a => {
      const assignment = assignmentMap.get(a.id);
      const story = assignment ? storyMap.get(assignment.story_id) : null;
      console.log(`\n  "${a.title}"`);
      console.log(`    Source: ${a.source_name}`);
      if (story) {
        console.log(`    Story: "${story.primary_headline}"`);
        console.log(`    Story slug: "${story.topic_slug || 'NONE'}"`);
      } else {
        console.log(`    Story: NOT FOUND`);
      }
      console.log(`    Similarity: ${assignment?.similarity_score?.toFixed(4) || 'N/A'}`);
    });
  }

  // Sample of unassigned with sources
  console.log('\n\n=== UNASSIGNED ARTICLES BY SOURCE ===\n');

  const unassignedBySource = new Map();
  unassigned.forEach(a => {
    if (!unassignedBySource.has(a.source_name)) {
      unassignedBySource.set(a.source_name, []);
    }
    unassignedBySource.get(a.source_name).push(a);
  });

  for (const [source, arts] of unassignedBySource.entries()) {
    console.log(`\n${source}: ${arts.length} articles`);
    console.log('  Sample titles:');
    arts.slice(0, 3).forEach(a => {
      console.log(`    - "${a.title.substring(0, 70)}..."`);
      console.log(`      Slug: ${a.topic_slug || 'NONE'}`);
    });
  }

  // Check if there are Guardian articles assigned
  console.log('\n\n=== HYPOTHESIS: Are Guardian articles being filtered out? ===\n');

  const guardianArticles = articles.filter(a => a.source_name === 'The Guardian');
  const guardianAssigned = guardianArticles.filter(a => assignmentMap.has(a.id));

  console.log(`Total Guardian articles: ${guardianArticles.length}`);
  console.log(`Guardian assigned: ${guardianAssigned.length}`);
  console.log(`Guardian unassigned: ${guardianArticles.length - guardianAssigned.length}`);

  if (guardianAssigned.length > 0) {
    console.log('\nAssigned Guardian articles:');
    guardianAssigned.forEach(a => {
      const assignment = assignmentMap.get(a.id);
      const story = storyMap.get(assignment.story_id);
      console.log(`  - "${a.title.substring(0, 60)}..."`);
      console.log(`    Story: "${story.primary_headline}"`);
    });
  }
}

checkAssignedArticles().catch(console.error);
