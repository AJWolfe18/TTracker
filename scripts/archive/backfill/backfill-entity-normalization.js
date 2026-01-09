#!/usr/bin/env node
/**
 * Backfill Script: Normalize Entity IDs in Existing Stories
 *
 * TTRC-236: Fixes inconsistent entity IDs (e.g., "Donald Trump" → "US-TRUMP")
 * that block merge detection from finding matching stories.
 *
 * Usage:
 *   DRY_RUN=true node scripts/backfill-entity-normalization.js   # Preview only
 *   node scripts/backfill-entity-normalization.js                 # Execute updates
 *
 * Cost: $0 (no OpenAI calls, SQL updates only)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  normalizeTopEntities,
  needsNormalization,
  getAliasMappings
} from './lib/entity-normalization.js';

dotenv.config();

// Configuration
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 100;

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Main backfill function
 */
async function backfillEntityNormalization() {
  console.log('='.repeat(70));
  console.log('TTRC-236: Entity ID Normalization Backfill');
  console.log('='.repeat(70));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'LIVE (will update DB)'}`);
  console.log('');

  // Stats tracking
  const stats = {
    totalStories: 0,
    storiesWithEntities: 0,
    storiesNeedingUpdate: 0,
    storiesUpdated: 0,
    entitiesNormalized: 0,
    errors: 0,
    entityChanges: {} // Track which entities were normalized
  };

  try {
    // ========================================
    // 1. FETCH ALL STORIES WITH ENTITIES
    // ========================================
    console.log('Fetching stories with top_entities...');

    let allStories = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('stories')
        .select('id, primary_headline, top_entities')
        .not('top_entities', 'is', null)
        .order('id', { ascending: true })
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        console.error(`Error fetching stories: ${error.message}`);
        throw error;
      }

      if (data && data.length > 0) {
        allStories = allStories.concat(data);
        offset += data.length;
        process.stdout.write(`  Fetched ${allStories.length} stories...\r`);
      }

      hasMore = data && data.length === BATCH_SIZE;
    }

    console.log(`\nTotal stories fetched: ${allStories.length}`);
    stats.totalStories = allStories.length;

    // Filter to only stories with non-empty entities
    const storiesWithEntities = allStories.filter(
      s => Array.isArray(s.top_entities) && s.top_entities.length > 0
    );
    stats.storiesWithEntities = storiesWithEntities.length;
    console.log(`Stories with non-empty entities: ${storiesWithEntities.length}`);
    console.log('');

    // ========================================
    // 2. IDENTIFY STORIES NEEDING NORMALIZATION
    // ========================================
    console.log('Analyzing entity IDs for normalization needs...');

    const storiesToUpdate = [];

    for (const story of storiesWithEntities) {
      const originalEntities = story.top_entities;
      const normalizedEntities = normalizeTopEntities(originalEntities);

      // Check if any entity changed
      const hasChanges = originalEntities.some(
        (e, i) => e !== normalizedEntities[i]
      ) || originalEntities.length !== normalizedEntities.length;

      if (hasChanges) {
        storiesToUpdate.push({
          id: story.id,
          headline: story.primary_headline,
          original: originalEntities,
          normalized: normalizedEntities
        });

        // Track which entities were normalized
        for (let i = 0; i < originalEntities.length; i++) {
          const orig = originalEntities[i];
          const norm = normalizedEntities[i] || orig;
          if (orig !== norm) {
            stats.entityChanges[orig] = stats.entityChanges[orig] || {
              canonical: norm,
              count: 0
            };
            stats.entityChanges[orig].count++;
            stats.entitiesNormalized++;
          }
        }
      }
    }

    stats.storiesNeedingUpdate = storiesToUpdate.length;

    console.log(`Stories needing normalization: ${storiesToUpdate.length}`);
    console.log('');

    // ========================================
    // 3. SHOW SAMPLE CHANGES
    // ========================================
    if (storiesToUpdate.length > 0) {
      console.log('Sample changes (first 10):');
      console.log('-'.repeat(70));

      for (const story of storiesToUpdate.slice(0, 10)) {
        console.log(`Story ${story.id}: "${story.headline?.slice(0, 50)}..."`);
        console.log(`  Before: [${story.original.join(', ')}]`);
        console.log(`  After:  [${story.normalized.join(', ')}]`);
        console.log('');
      }

      // Show entity mapping summary
      console.log('-'.repeat(70));
      console.log('Entity normalization summary:');
      const sortedChanges = Object.entries(stats.entityChanges)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 20);

      for (const [orig, info] of sortedChanges) {
        console.log(`  "${orig}" → "${info.canonical}" (${info.count} occurrences)`);
      }
      console.log('');
    }

    // ========================================
    // 4. EXECUTE UPDATES (unless DRY_RUN)
    // ========================================
    if (DRY_RUN) {
      console.log('='.repeat(70));
      console.log('DRY RUN COMPLETE - No changes made');
      console.log('='.repeat(70));
      console.log('');
      console.log('To execute updates, run without DRY_RUN:');
      console.log('  node scripts/backfill-entity-normalization.js');
    } else if (storiesToUpdate.length > 0) {
      console.log('='.repeat(70));
      console.log('Executing updates...');
      console.log('='.repeat(70));

      let updated = 0;
      let errors = 0;

      for (const story of storiesToUpdate) {
        try {
          const { error } = await supabase
            .from('stories')
            .update({ top_entities: story.normalized })
            .eq('id', story.id);

          if (error) {
            console.error(`  Error updating story ${story.id}: ${error.message}`);
            errors++;
          } else {
            updated++;
            if (updated % 50 === 0) {
              process.stdout.write(`  Updated ${updated}/${storiesToUpdate.length}...\r`);
            }
          }
        } catch (err) {
          console.error(`  Exception updating story ${story.id}: ${err.message}`);
          errors++;
        }
      }

      stats.storiesUpdated = updated;
      stats.errors = errors;

      console.log(`\n\nUpdates complete: ${updated} stories updated, ${errors} errors`);
    } else {
      console.log('No stories need normalization. All entity IDs are already canonical.');
    }

    // ========================================
    // 5. FINAL SUMMARY
    // ========================================
    console.log('');
    console.log('='.repeat(70));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total stories scanned:        ${stats.totalStories}`);
    console.log(`Stories with entities:        ${stats.storiesWithEntities}`);
    console.log(`Stories needing update:       ${stats.storiesNeedingUpdate}`);
    console.log(`Stories updated:              ${stats.storiesUpdated}`);
    console.log(`Individual entities changed:  ${stats.entitiesNormalized}`);
    console.log(`Errors:                       ${stats.errors}`);
    console.log('='.repeat(70));

    return stats;

  } catch (error) {
    console.error('Backfill failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
backfillEntityNormalization()
  .then(stats => {
    if (!DRY_RUN && stats.storiesUpdated > 0) {
      console.log('\nNext step: Verify fix with:');
      console.log('  Run merge validation queries from docs/plans/ttrc-236-merge-validation.md');
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
