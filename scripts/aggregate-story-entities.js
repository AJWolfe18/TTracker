#!/usr/bin/env node
/**
 * TTRC-298: Story Entity Aggregation
 *
 * Aggregates article entities into story entity_counter/top_entities.
 * Run AFTER article entity backfill is complete.
 *
 * This is a FREE operation (no OpenAI calls) - just SQL aggregation.
 *
 * Different from backfill-story-entities.js which enqueues story.enrich jobs.
 * This script directly aggregates existing article.entities into stories.
 *
 * Usage:
 *   node scripts/aggregate-story-entities.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('='.repeat(60));
  console.log('TTRC-298: Story Entity Aggregation');
  console.log('='.repeat(60));
  console.log('');

  // Get total story count for context
  const { count: totalStories } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });

  console.log(`Total stories in database: ${totalStories}`);

  // Get all stories that need entity aggregation
  const { data: stories, error } = await supabase
    .from('stories')
    .select('id, primary_headline')
    .or('entity_counter.is.null,entity_counter.eq.{}')
    .order('id', { ascending: true });

  if (error) {
    console.error('Failed to fetch stories:', error.message);
    process.exit(1);
  }

  console.log(`Found ${stories.length} stories needing entity aggregation`);
  console.log('');

  let updated = 0;
  let skipped = 0;

  for (const story of stories) {
    // Get all articles for this story with their entities
    const { data: articleStories } = await supabase
      .from('article_story')
      .select('article_id, articles(entities)')
      .eq('story_id', story.id);

    if (!articleStories || articleStories.length === 0) {
      skipped++;
      continue;
    }

    // Aggregate entities across all articles
    const entityCounter = {};
    for (const as of articleStories) {
      const entities = as.articles?.entities || [];
      for (const e of entities) {
        if (e?.id) {
          entityCounter[e.id] = (entityCounter[e.id] || 0) + 1;
        }
      }
    }

    // Skip if no entities found
    if (Object.keys(entityCounter).length === 0) {
      skipped++;
      continue;
    }

    // Derive top_entities (top 8 by count)
    const topEntities = Object.entries(entityCounter)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);

    // Update story
    const { error: updateError } = await supabase
      .from('stories')
      .update({
        entity_counter: entityCounter,
        top_entities: topEntities
      })
      .eq('id', story.id);

    if (updateError) {
      console.error(`Failed to update story ${story.id}:`, updateError.message);
    } else {
      updated++;
      process.stdout.write('.');
      if (updated % 50 === 0) {
        console.log(` [${updated}]`);
      }
    }
  }

  console.log('');
  console.log('');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Stories updated: ${updated}`);
  console.log(`Stories skipped (no entities): ${skipped}`);
  console.log('');
  console.log('Cost: $0.00 (SQL only, no OpenAI)');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
