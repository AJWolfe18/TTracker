#!/usr/bin/env node
/**
 * TTRC-236: Inline Story Centroid Backfill
 *
 * Computes story centroids from article embeddings without using the
 * recompute_story_centroids() RPC (which times out on large datasets).
 *
 * For each story:
 *   centroid = AVG(article embeddings)
 *
 * No API cost - pure vector math.
 *
 * Usage:
 *   node scripts/backfill-story-centroids-inline.js [limit]
 *
 * Examples:
 *   node scripts/backfill-story-centroids-inline.js 10     # Test with 10
 *   node scripts/backfill-story-centroids-inline.js 100    # Backfill 100
 *   node scripts/backfill-story-centroids-inline.js all    # Backfill all
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Config
const BATCH_SIZE = 50;
const DELAY_MS = 50;

// Stats
let totalStories = 0;
let updatedStories = 0;
let skippedStories = 0;
let erroredStories = 0;

/**
 * Calculate average of multiple vectors
 * @param {number[][]} vectors - Array of embedding vectors
 * @returns {number[]} - Average vector
 */
function averageVectors(vectors) {
  if (!vectors || vectors.length === 0) return null;
  if (vectors.length === 1) return vectors[0];

  const dims = vectors[0].length;
  const avg = new Array(dims).fill(0);

  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) {
      avg[i] += vec[i];
    }
  }

  for (let i = 0; i < dims; i++) {
    avg[i] /= vectors.length;
  }

  return avg;
}

/**
 * Parse embedding from various formats
 * @param {any} embedding - Embedding in string or array format
 * @returns {number[]|null} - Parsed embedding array
 */
function parseEmbedding(embedding) {
  if (!embedding) return null;

  // Already an array
  if (Array.isArray(embedding)) {
    return embedding.length === 1536 ? embedding : null;
  }

  // JSON string format: "[0.1,0.2,...]"
  if (typeof embedding === 'string') {
    try {
      const parsed = JSON.parse(embedding);
      return Array.isArray(parsed) && parsed.length === 1536 ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Get stories that need centroid backfill
 * @param {string} limit - Number of stories or 'all'
 * @param {number} offset - Offset for pagination
 * @returns {object[]} - Array of stories
 */
async function getStoriesNeedingBackfill(limit, offset = 0) {
  let query = supabase
    .from('stories')
    .select('id, primary_headline')
    .is('centroid_embedding_v1', null)
    .order('id', { ascending: true });

  if (limit && limit !== 'all') {
    query = query.range(offset, offset + parseInt(limit) - 1);
  } else {
    query = query.range(offset, offset + BATCH_SIZE - 1);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Failed to fetch stories:', error.message);
    return null;
  }

  return data;
}

/**
 * Get article embeddings for a story
 * @param {number} storyId - Story ID
 * @returns {number[][]} - Array of embeddings
 */
async function getArticleEmbeddings(storyId) {
  const { data, error } = await supabase
    .from('article_story')
    .select('articles!inner(embedding_v1)')
    .eq('story_id', storyId);

  if (error) {
    console.error(`Failed to fetch articles for story ${storyId}:`, error.message);
    return [];
  }

  const embeddings = [];
  for (const row of data || []) {
    const embedding = parseEmbedding(row.articles?.embedding_v1);
    if (embedding) {
      embeddings.push(embedding);
    }
  }

  return embeddings;
}

/**
 * Update story centroid
 * @param {number} storyId - Story ID
 * @param {number[]} centroid - Centroid vector
 * @returns {boolean} - Success
 */
async function updateStoryCentroid(storyId, centroid) {
  // Format as PostgreSQL vector string: [x,y,z,...]
  const vectorString = `[${centroid.join(',')}]`;

  const { error } = await supabase
    .from('stories')
    .update({ centroid_embedding_v1: vectorString })
    .eq('id', storyId);

  if (error) {
    console.error(`Failed to update story ${storyId}:`, error.message);
    return false;
  }

  return true;
}

/**
 * Process a single story
 * @param {object} story - Story object
 * @returns {string} - Result: 'updated', 'skipped', 'error'
 */
async function processStory(story) {
  try {
    // Get article embeddings
    const embeddings = await getArticleEmbeddings(story.id);

    if (embeddings.length === 0) {
      // No articles with embeddings - skip
      return 'skipped';
    }

    // Calculate centroid
    const centroid = averageVectors(embeddings);

    if (!centroid) {
      return 'skipped';
    }

    // Update story
    const success = await updateStoryCentroid(story.id, centroid);

    return success ? 'updated' : 'error';
  } catch (err) {
    console.error(`Error processing story ${story.id}:`, err.message);
    return 'error';
  }
}

async function main() {
  const limit = process.argv[2] || '10';

  console.log('='.repeat(70));
  console.log('TTRC-236: Inline Story Centroid Backfill');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Limit: ${limit}`);
  console.log(`Batch size: ${BATCH_SIZE}`);
  console.log('Cost: $0 (pure vector math)');
  console.log('');

  // Get total count of stories needing backfill
  const { count: totalNeeding } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true })
    .is('centroid_embedding_v1', null);

  console.log(`Stories without centroids: ${totalNeeding}`);
  console.log('');

  if (totalNeeding === 0) {
    console.log('All stories already have centroids!');
    process.exit(0);
  }

  console.log('Processing...');
  console.log('');

  let offset = 0;
  const maxToProcess = limit === 'all' ? totalNeeding : parseInt(limit);

  while (totalStories < maxToProcess) {
    // Get batch of stories
    const stories = await getStoriesNeedingBackfill('all', offset);

    if (!stories || stories.length === 0) {
      break;
    }

    // Process each story
    for (const story of stories) {
      if (totalStories >= maxToProcess) break;

      const result = await processStory(story);
      totalStories++;

      switch (result) {
        case 'updated':
          updatedStories++;
          process.stdout.write('.');
          break;
        case 'skipped':
          skippedStories++;
          process.stdout.write('s');
          break;
        case 'error':
          erroredStories++;
          process.stdout.write('x');
          break;
      }

      // Progress indicator
      if (totalStories % 50 === 0) {
        process.stdout.write(` [${totalStories}/${maxToProcess}]\n`);
      }

      // Small delay to avoid overwhelming the DB
      if (totalStories < maxToProcess) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    offset += stories.length;
  }

  console.log('\n');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log('');
  console.log(`Stories processed: ${totalStories}`);
  console.log(`Updated: ${updatedStories}`);
  console.log(`Skipped (no articles with embeddings): ${skippedStories}`);
  console.log(`Errors: ${erroredStories}`);
  console.log('');

  // Verify results
  const { count: remainingWithout } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true })
    .is('centroid_embedding_v1', null);

  const { count: totalWith } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true })
    .not('centroid_embedding_v1', 'is', null);

  const { count: totalAll } = await supabase
    .from('stories')
    .select('*', { count: 'exact', head: true });

  console.log('Current state:');
  console.log(`  Total stories: ${totalAll}`);
  console.log(`  With centroids: ${totalWith} (${((totalWith / totalAll) * 100).toFixed(1)}%)`);
  console.log(`  Without centroids: ${remainingWithout}`);
  console.log('');

  if (updatedStories > 0) {
    console.log('Next step: Run the recluster simulation');
    console.log('  node scripts/recluster-simulation.js 100');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
