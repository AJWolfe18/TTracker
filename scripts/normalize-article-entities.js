#!/usr/bin/env node
/**
 * Entity ID Normalization Migration
 *
 * Normalizes article.entities to use canonical entity IDs.
 * Fixes issues like ORG-US → LOC-USA, and filters invalid IDs.
 *
 * Features:
 *   - Batch processing (100 articles per batch)
 *   - Dry-run mode (--dry-run)
 *   - Progress logging
 *   - Idempotent (safe to re-run)
 *
 * Usage:
 *   node scripts/normalize-article-entities.js           # Dry run (preview)
 *   node scripts/normalize-article-entities.js --apply   # Apply changes
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { normalizeEntities } from './lib/entity-normalization.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 100;
const DRY_RUN = !process.argv.includes('--apply');

// === BAD_IDS: Generic/non-entity IDs to filter out ===
// These are NOT aliases - they have no valid canonical target.
// Used only in migration, not in runtime validation.
const BAD_IDS = new Set([
  // Generic/abstract - not real entities
  'US-FUNDING',
  'US-POLICY',
  'US-CITIZENS',
  'US-PUBLIC',
  'US-POLL',
  'US-REFORM',
  'US-GOV',
  // Ambiguous roles - can't map to specific person across time
  'US-PRESIDENT',
  'IL-PRESIDENT',
  'US-REPUBLICAN-LEADER',
]);

async function main() {
  console.log('='.repeat(60));
  console.log('Entity ID Normalization Migration');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'APPLY (will modify data)'}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('');

  // Get total count of articles with entities
  const { count: totalArticles } = await supabase
    .from('articles')
    .select('*', { count: 'exact', head: true })
    .not('entities', 'is', null);

  console.log(`Total articles with entities: ${totalArticles}`);
  console.log('');

  let processed = 0;
  let changed = 0;
  let unchanged = 0;
  let errors = 0;
  let cursor = null;

  while (true) {
    // Fetch batch using cursor-based pagination
    let query = supabase
      .from('articles')
      .select('id, entities')
      .not('entities', 'is', null)
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (cursor) {
      query = query.gt('id', cursor);
    }

    const { data: articles, error } = await query;

    if (error) {
      console.error('Failed to fetch articles:', error.message);
      process.exit(1);
    }

    if (!articles || articles.length === 0) {
      break;
    }

    // Process batch
    for (const article of articles) {
      try {
        const original = article.entities;

        // Skip if entities is not an array
        if (!Array.isArray(original)) {
          unchanged++;
          continue;
        }

        // Normalize entities, then filter out BAD_IDS
        const normalized = normalizeEntities(original)
          .filter(e => e.id && !BAD_IDS.has(e.id));

        // Check if anything changed
        const originalJSON = JSON.stringify(original);
        const normalizedJSON = JSON.stringify(normalized);

        if (originalJSON === normalizedJSON) {
          unchanged++;
        } else {
          changed++;

          if (DRY_RUN) {
            // Preview changes
            console.log(`\n[WOULD CHANGE] Article ${article.id}:`);

            // Show removed entities
            const originalIds = new Set(original.map(e => e?.id).filter(Boolean));
            const normalizedIds = new Set(normalized.map(e => e?.id).filter(Boolean));

            for (const id of originalIds) {
              if (!normalizedIds.has(id)) {
                // Check if it was normalized, filtered as BAD_ID, or invalid
                const normalizedVersion = normalizeEntities([{ id }]);
                if (normalizedVersion.length > 0 && normalizedVersion[0].id !== id) {
                  // Aliased to different ID
                  if (BAD_IDS.has(normalizedVersion[0].id)) {
                    console.log(`  ${id} → (removed - bad ID after normalization)`);
                  } else {
                    console.log(`  ${id} → ${normalizedVersion[0].id}`);
                  }
                } else if (BAD_IDS.has(id)) {
                  console.log(`  ${id} → (removed - generic/non-entity)`);
                } else {
                  console.log(`  ${id} → (removed - invalid format)`);
                }
              }
            }
          } else {
            // Apply changes
            const { error: updateError } = await supabase
              .from('articles')
              .update({ entities: normalized })
              .eq('id', article.id);

            if (updateError) {
              console.error(`Failed to update article ${article.id}:`, updateError.message);
              errors++;
            }
          }
        }
      } catch (err) {
        console.error(`Error processing article ${article.id}:`, err.message);
        errors++;
      }
    }

    processed += articles.length;
    cursor = articles[articles.length - 1].id;

    // Progress update
    const pct = Math.round((processed / totalArticles) * 100);
    process.stdout.write(`\rProcessed: ${processed}/${totalArticles} (${pct}%) | Changed: ${changed} | Unchanged: ${unchanged}`);
  }

  console.log('\n');
  console.log('='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log('');
  console.log(`Articles processed: ${processed}`);
  console.log(`Changed: ${changed}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Errors: ${errors}`);
  console.log('');

  if (DRY_RUN && changed > 0) {
    console.log('To apply these changes, run:');
    console.log('  node scripts/normalize-article-entities.js --apply');
    console.log('');
  }

  if (!DRY_RUN) {
    console.log('Migration complete. Run aggregation script next:');
    console.log('  node scripts/aggregate-story-entities.js');
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
