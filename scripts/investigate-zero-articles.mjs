#!/usr/bin/env node
/**
 * Investigate stories with 0 articles - should not be possible!
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_TEST_URL,
  process.env.SUPABASE_TEST_SERVICE_KEY
);

async function investigate() {
  console.log('=== Investigating Zero-Article Stories ===\n');

  // Find stories with 0 articles
  const { data: allStories } = await supabase
    .from('stories')
    .select('id, primary_headline, first_seen_at')
    .order('first_seen_at', { ascending: false })
    .limit(100);

  const zeroArticleStories = [];

  for (const story of allStories) {
    const { count } = await supabase
      .from('article_story')
      .select('*', { count: 'exact', head: true })
      .eq('story_id', story.id);

    if (count === 0) {
      zeroArticleStories.push(story);
    }
  }

  console.log(`Found ${zeroArticleStories.length} stories with 0 articles:\n`);
  zeroArticleStories.slice(0, 10).forEach(s => {
    console.log(`Story ${s.id}: "${s.primary_headline}"`);
    console.log(`  Created: ${s.first_seen_at}\n`);
  });

  // Check when last articles were actually ingested
  console.log('\n=== Last Article Ingestion ===\n');
  const { data: lastArticles } = await supabase
    .from('articles')
    .select('id, title, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (lastArticles && lastArticles.length > 0) {
    console.log(`Last ${lastArticles.length} articles:`);
    lastArticles.forEach(a => {
      console.log(`- ${a.id}: ${a.title.substring(0, 50)}...`);
      console.log(`  Created: ${a.created_at}\n`);
    });
  } else {
    console.log('No articles found!');
  }

  // Check run_stats for last RSS run
  console.log('\n=== Last RSS Run ===\n');
  const { data: lastRun } = await supabase
    .from('run_stats')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (lastRun) {
    console.log('Last run stats:');
    console.log(`Started: ${lastRun.started_at}`);
    console.log(`Completed: ${lastRun.completed_at}`);
    console.log(`Articles processed: ${lastRun.articles_processed || 0}`);
    console.log(`Stories created: ${lastRun.stories_created || 0}`);
    console.log(`Stories updated: ${lastRun.stories_updated || 0}`);
    console.log(`Status: ${lastRun.status}`);
    if (lastRun.error_log) {
      console.log(`Errors: ${lastRun.error_log}`);
    }
  } else {
    console.log('No run stats found');
  }
}

investigate().catch(console.error);
