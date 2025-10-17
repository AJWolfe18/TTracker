/**
 * Recompute Story Centroids (TTRC-234)
 *
 * Triggers the recompute_story_centroids() SQL function to calculate
 * exact centroids for all stories that have articles with embeddings.
 *
 * This is normally run nightly, but can be triggered manually:
 * - After backfill of article embeddings
 * - To fix centroid drift
 * - To populate centroids for merge quality testing
 *
 * Usage:
 *   node scripts/recompute-centroids.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
dotenv.config();

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

async function recomputeCentroids() {
  console.log('='.repeat(60));
  console.log('Story Centroid Recomputation (TTRC-234)');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Get before stats
    console.log('Fetching stats BEFORE recomputation...');
    const { data: beforeStats, error: beforeError } = await supabase
      .from('stories')
      .select('id, centroid_embedding_v1', { count: 'exact' });

    if (beforeError) {
      throw new Error(`Failed to fetch before stats: ${beforeError.message}`);
    }

    const totalStories = beforeStats.length;
    const beforeCentroids = beforeStats.filter(s => s.centroid_embedding_v1).length;
    const beforePct = (100.0 * beforeCentroids / totalStories).toFixed(1);

    console.log(`  Total stories: ${totalStories}`);
    console.log(`  Stories with centroids: ${beforeCentroids} (${beforePct}%)`);
    console.log('');

    // Trigger recomputation
    console.log('Triggering recompute_story_centroids()...');
    const startTime = Date.now();

    const { error: recomputeError } = await supabase.rpc('recompute_story_centroids');

    const duration = Date.now() - startTime;

    if (recomputeError) {
      throw new Error(`Recomputation failed: ${recomputeError.message}`);
    }

    console.log(`✅ Recomputation completed in ${(duration / 1000).toFixed(2)}s`);
    console.log('');

    // Get after stats
    console.log('Fetching stats AFTER recomputation...');
    const { data: afterStats, error: afterError } = await supabase
      .from('stories')
      .select('id, centroid_embedding_v1', { count: 'exact' });

    if (afterError) {
      throw new Error(`Failed to fetch after stats: ${afterError.message}`);
    }

    const afterCentroids = afterStats.filter(s => s.centroid_embedding_v1).length;
    const afterPct = (100.0 * afterCentroids / totalStories).toFixed(1);
    const added = afterCentroids - beforeCentroids;

    console.log(`  Total stories: ${totalStories}`);
    console.log(`  Stories with centroids: ${afterCentroids} (${afterPct}%)`);
    console.log(`  Centroids added: ${added}`);
    console.log('');

    // Success message
    console.log('='.repeat(60));
    if (afterCentroids >= 10) {
      console.log('✅ SUCCESS: 10+ stories have centroids');
      console.log('   Ready for TTRC-231 merge quality testing!');
    } else {
      console.log(`⚠️  WARNING: Only ${afterCentroids} stories have centroids`);
      console.log('   Need 10+ for merge quality testing');
      console.log('');
      console.log('   Possible causes:');
      console.log('   - Stories have no articles');
      console.log('   - Articles missing embeddings');
      console.log('   - Stories not in article_story junction table');
    }
    console.log('='.repeat(60));

    process.exit(0);

  } catch (error) {
    console.error('');
    console.error('❌ ERROR:', error.message);
    console.error('');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
recomputeCentroids().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
