#!/usr/bin/env node
/**
 * Re-cluster All Articles
 *
 * Resets story assignments and re-runs clustering from scratch.
 * Use this after entity normalization or threshold changes.
 *
 * Usage:
 *   node scripts/recluster-all.mjs [--dry-run]
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { clusterArticle } from './rss/hybrid-clustering.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 50;
const DELAY_MS = 100;

async function main() {
  console.log('='.repeat(60));
  console.log('RE-CLUSTER ALL ARTICLES');
  console.log('='.repeat(60));
  console.log('');
  console.log('Mode:', DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE');
  console.log('');

  // Step 1: Get counts
  const { count: articleCount } = await supabase
    .from('articles')
    .select('*', { count: 'exact', head: true });

  const { count: storyCount } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });

  console.log('Current state:');
  console.log('  Articles:', articleCount);
  console.log('  Stories:', storyCount);
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN - would reset all stories and re-cluster');
    console.log('Run without --dry-run to execute');
    return;
  }

  // Step 2: Confirm
  console.log('⚠️  This will DELETE all stories and re-cluster from scratch.');
  console.log('Press Ctrl+C within 5 seconds to cancel...');
  await new Promise(r => setTimeout(r, 5000));
  console.log('');
  console.log('Proceeding...');
  console.log('');

  // Step 3: Backup enrichment data before deletion
  console.log('Backing up enrichment data...');
  const { data: enrichmentBackup } = await supabase
    .from('stories')
    .select('story_hash, summary_neutral, summary_spicy, category, severity, primary_actor, last_enriched_at')
    .not('summary_neutral', 'is', null);

  const enrichmentMap = new Map(
    (enrichmentBackup || []).map(s => [s.story_hash, s])
  );
  console.log(`  ✓ Backed up ${enrichmentMap.size} enriched stories`);
  console.log('');

  // Step 4: Delete article_story links
  console.log('Step 1/4: Clearing article_story links...');
  const { error: linkError } = await supabase
    .from('article_story')
    .delete()
    .neq('article_id', 'impossible-id'); // Delete all

  if (linkError) {
    console.error('Failed to clear links:', linkError);
    return;
  }
  console.log('  ✓ Links cleared');

  // Step 5: Delete stories
  console.log('Step 2/4: Deleting stories...');
  const { error: storyError } = await supabase
    .from('stories')
    .delete()
    .neq('id', -99999); // Delete all

  if (storyError) {
    console.error('Failed to delete stories:', storyError);
    return;
  }
  console.log('  ✓ Stories deleted');

  // Step 6: Get all articles ordered by published_at (with pagination to get all)
  console.log('Step 3/4: Re-clustering articles...');

  let articles = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: batch, error: fetchError } = await supabase
      .from('articles')
      .select('id, title, published_at')
      .not('embedding_v1', 'is', null)
      .order('published_at', { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (fetchError) {
      console.error('Failed to fetch articles:', fetchError);
      return;
    }

    articles = articles.concat(batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`  Found ${articles.length} articles with embeddings`);
  console.log('');

  const results = {
    processed: 0,
    attached: 0,
    created: 0,
    errors: 0
  };

  const startTime = Date.now();

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];

    try {
      const result = await clusterArticle(article.id);

      results.processed++;
      if (result.created_new) {
        results.created++;
        process.stdout.write('.');
      } else {
        results.attached++;
        process.stdout.write('+');
      }

      // Progress indicator
      if ((i + 1) % 50 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (results.processed / elapsed).toFixed(1);
        console.log(` [${i + 1}/${articles.length}] ${elapsed}s (${rate}/s)`);
      }

      // Small delay
      await new Promise(r => setTimeout(r, DELAY_MS));

    } catch (err) {
      results.errors++;
      process.stdout.write('X');
      console.error(`\nError on article ${article.id}: ${err.message}`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('');
  console.log('');
  console.log('='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log('');
  console.log('Processed:', results.processed);
  console.log('Stories created:', results.created);
  console.log('Attached to existing:', results.attached);
  console.log('Errors:', results.errors);
  console.log('');
  console.log('Time:', totalTime, 'seconds');
  console.log('');

  // Verify
  const { count: newStoryCount } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });

  console.log('Final story count:', newStoryCount);
  console.log('Reduction:', storyCount, '→', newStoryCount,
    `(${((1 - newStoryCount/storyCount) * 100).toFixed(0)}% fewer)`);
  console.log('');

  // Step 7: Restore enrichment data
  if (enrichmentMap.size > 0) {
    console.log('Step 4/4: Restoring enrichment data...');
    let restored = 0;
    let notFound = 0;

    for (const [storyHash, enrichment] of enrichmentMap) {
      const { data, error } = await supabase
        .from('stories')
        .update({
          summary_neutral: enrichment.summary_neutral,
          summary_spicy: enrichment.summary_spicy,
          category: enrichment.category,
          severity: enrichment.severity,
          primary_actor: enrichment.primary_actor,
          last_enriched_at: enrichment.last_enriched_at
        })
        .eq('story_hash', storyHash)
        .select('id');

      if (!error && data?.length > 0) {
        restored++;
      } else {
        notFound++;
      }
    }

    console.log(`  ✓ Restored enrichment for ${restored}/${enrichmentMap.size} stories`);
    if (notFound > 0) {
      console.log(`  ⚠ ${notFound} stories no longer exist (headlines changed)`);
    }
  } else {
    console.log('No enrichment data to restore (none was backed up)');
  }
}

main().catch(console.error);
