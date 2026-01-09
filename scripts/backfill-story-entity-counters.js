#!/usr/bin/env node
/**
 * TTRC-236: Backfill Story Entity Counters
 *
 * Recomputes entity_counter and top_entities for all stories
 * based on their articles' entities.
 *
 * Usage:
 *   node scripts/backfill-story-entity-counters.js
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('='.repeat(70));
  console.log('TTRC-236: Backfill Story Entity Counters');
  console.log('='.repeat(70));
  console.log('');

  // Get all stories
  const { data: stories, error: storyError } = await supabase
    .from('stories')
    .select('id')
    .order('id');

  if (storyError) {
    console.error('Failed to fetch stories:', storyError.message);
    process.exit(1);
  }

  console.log(`Found ${stories.length} stories to process`);
  console.log('');

  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < stories.length; i++) {
    const storyId = stories[i].id;

    // Get all articles for this story with their entities
    const { data: articles, error: artError } = await supabase
      .from('article_story')
      .select('article_id, articles(entities)')
      .eq('story_id', storyId);

    if (artError) {
      console.error(`Error fetching articles for story ${storyId}:`, artError.message);
      continue;
    }

    // Build entity counter from all articles
    const entityCounter = {};
    for (const as of articles) {
      const entities = as.articles?.entities;
      if (entities && Array.isArray(entities)) {
        for (const entity of entities) {
          if (entity.id) {
            entityCounter[entity.id] = (entityCounter[entity.id] || 0) + 1;
          }
        }
      }
    }

    // Get top 5 entities
    const topEntities = Object.entries(entityCounter)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);

    // Skip if no entities
    if (Object.keys(entityCounter).length === 0) {
      skipped++;
      continue;
    }

    // Update story
    const { error: updateError } = await supabase
      .from('stories')
      .update({
        entity_counter: entityCounter,
        top_entities: topEntities
      })
      .eq('id', storyId);

    if (updateError) {
      console.error(`Failed to update story ${storyId}:`, updateError.message);
    } else {
      updated++;
    }

    // Progress
    if ((i + 1) % 100 === 0) {
      console.log(`Progress: ${i + 1}/${stories.length} (updated: ${updated}, skipped: ${skipped})`);
    }
  }

  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total stories: ${stories.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (no entities): ${skipped}`);
  console.log('');
  console.log('Next: Re-run recluster-simulation.js to test clustering');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
