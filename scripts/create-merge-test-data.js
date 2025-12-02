/**
 * Generate merge candidate pairs for validation testing
 *
 * 4-bucket strategy:
 * - Bucket A: High-confidence same-event story pairs (precision validation)
 * - Bucket B: High similarity unmerged pairs (recall gaps)
 * - Bucket C: 1-entity overlap pairs (stress test)
 * - Bucket D: Same topic, different events (false positive prevention)
 *
 * Output: merge-candidates.csv with bucket column for per-bucket analysis
 *
 * Usage:
 *   node scripts/create-merge-test-data.js [--limit N]
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Parse embedding from Supabase (may be string or array)
// Defensive: handles string embeddings from Supabase and logs for diagnosis
function parseEmbedding(emb, label = '') {
  if (!emb) {
    return null;
  }
  if (Array.isArray(emb)) {
    return emb;
  }
  if (typeof emb === 'string') {
    try {
      const parsed = JSON.parse(emb);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Only log once per run to avoid spam
        if (!parseEmbedding._loggedStringParse) {
          console.error(`  [DEBUG] Parsed string embedding to array (len=${parsed.length}) ${label}`);
          parseEmbedding._loggedStringParse = true;
        }
        return parsed;
      }
      console.error(`  [WARN] Parsed embedding is not a valid array ${label}`);
      return null;
    } catch (e) {
      console.error(`  [WARN] Failed to parse embedding string: ${e.message} ${label}`);
      return null;
    }
  }
  console.error(`  [WARN] Unknown embedding type: ${typeof emb} ${label}`);
  return null;
}

// Cosine similarity for embeddings (with defensive parsing)
function cosineSimilarity(a, b) {
  const arrA = parseEmbedding(a, 'storyA');
  const arrB = parseEmbedding(b, 'storyB');

  if (!arrA || !arrB || arrA.length !== arrB.length) {
    return 0;
  }

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < arrA.length; i++) {
    dot += arrA[i] * arrB[i];
    normA += arrA[i] * arrA[i];
    normB += arrB[i] * arrB[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Calculate shared entities between two stories
function getSharedEntities(entitiesA, entitiesB) {
  if (!entitiesA || !entitiesB) return [];
  const setB = new Set(entitiesB);
  return entitiesA.filter(e => setB.has(e));
}

// Escape CSV field
function escapeCSV(str) {
  if (!str) return '';
  str = String(str);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Format candidate as CSV row
function formatCandidate(bucket, story1, story2, similarity, sharedEntities) {
  return [
    bucket,
    story1.id,
    story2.id,
    similarity ? similarity.toFixed(4) : '',
    sharedEntities.join('|'),
    escapeCSV(story1.primary_headline),
    escapeCSV(story2.primary_headline),
    '' // are_duplicates - to be filled in manually
  ].join(',');
}

async function generateBucketA(limit = 15) {
  console.error(`\n[Bucket A] Generating high-confidence same-event pairs...`);

  // Find stories with source_count > 1 that have entities (merged clusters)
  const { data: mergedStories, error } = await supabase
    .from('stories')
    .select('id, primary_headline, top_entities, source_count, centroid_embedding_v1')
    .gt('source_count', 1)
    .not('top_entities', 'eq', '{}')
    .order('source_count', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching merged stories:', error.message);
    return [];
  }

  console.error(`  Found ${mergedStories?.length || 0} merged stories with entities`);

  // For each merged story, find similar stories that could be same event
  // (This helps us validate that merges were correct)
  const candidates = [];

  for (const merged of (mergedStories || [])) {
    if (!merged.top_entities?.length) continue;

    // Find other stories with entity overlap in same time window
    const { data: similar, error: simError } = await supabase
      .from('stories')
      .select('id, primary_headline, top_entities, centroid_embedding_v1')
      .neq('id', merged.id)
      .not('top_entities', 'eq', '{}')
      .overlaps('top_entities', merged.top_entities)
      .limit(5);

    if (simError || !similar?.length) continue;

    for (const s of similar) {
      const shared = getSharedEntities(merged.top_entities, s.top_entities);
      if (shared.length < 1) continue;

      const similarity = cosineSimilarity(
        merged.centroid_embedding_v1,
        s.centroid_embedding_v1
      );

      candidates.push({
        bucket: 'A',
        story1: merged,
        story2: s,
        similarity,
        sharedEntities: shared
      });

      if (candidates.length >= limit) break;
    }
    if (candidates.length >= limit) break;
  }

  console.error(`  Generated ${candidates.length} Bucket A candidates`);
  return candidates;
}

async function generateBucketB(limit = 20) {
  console.error(`\n[Bucket B] Generating high-similarity unmerged pairs...`);

  // IMPORTANT: Filter for stories WITH embeddings (not just recent)
  // Many recent stories lack embeddings - enrichment backfill needed
  const { data: embeddedStories, error } = await supabase
    .from('stories')
    .select('id, primary_headline, top_entities, first_seen_at, centroid_embedding_v1')
    .not('top_entities', 'eq', '{}')
    .not('centroid_embedding_v1', 'is', null) // MUST have embedding
    .order('id', { ascending: true }) // Stable ordering for repeatability
    .limit(100);

  if (error) {
    console.error('Error fetching stories with embeddings:', error.message);
    return [];
  }

  console.error(`  Found ${embeddedStories?.length || 0} stories with entities AND embeddings`);

  const candidates = [];
  const stories = embeddedStories || [];

  // Find pairs with 2+ shared entities that aren't currently merged
  for (let i = 0; i < stories.length && candidates.length < limit; i++) {
    for (let j = i + 1; j < stories.length && candidates.length < limit; j++) {
      const s1 = stories[i];
      const s2 = stories[j];

      const shared = getSharedEntities(s1.top_entities, s2.top_entities);
      if (shared.length < 2) continue;

      const similarity = cosineSimilarity(
        s1.centroid_embedding_v1,
        s2.centroid_embedding_v1
      );

      // Include moderate-to-high similarity pairs (potential recall gaps)
      // Lower threshold to 0.50 to catch more candidates for analysis
      if (similarity >= 0.50) {
        candidates.push({
          bucket: 'B',
          story1: s1,
          story2: s2,
          similarity,
          sharedEntities: shared
        });
      }
    }
  }

  console.error(`  Generated ${candidates.length} Bucket B candidates`);
  return candidates;
}

async function generateBucketC(limit = 12) {
  console.error(`\n[Bucket C] Generating 1-entity overlap pairs...`);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  const { data: recentStories, error } = await supabase
    .from('stories')
    .select('id, primary_headline, top_entities, first_seen_at, centroid_embedding_v1')
    .gte('first_seen_at', fourteenDaysAgo.toISOString())
    .not('top_entities', 'eq', '{}')
    .order('id', { ascending: true }) // Stable ordering
    .limit(80);

  if (error) {
    console.error('Error fetching stories:', error.message);
    return [];
  }

  console.error(`  Found ${recentStories?.length || 0} recent stories with entities`);

  const candidates = [];
  const stories = recentStories || [];

  // Find pairs with exactly 1 shared entity
  for (let i = 0; i < stories.length && candidates.length < limit; i++) {
    for (let j = i + 1; j < stories.length && candidates.length < limit; j++) {
      const s1 = stories[i];
      const s2 = stories[j];

      const shared = getSharedEntities(s1.top_entities, s2.top_entities);
      if (shared.length !== 1) continue;

      const similarity = cosineSimilarity(
        s1.centroid_embedding_v1,
        s2.centroid_embedding_v1
      );

      candidates.push({
        bucket: 'C',
        story1: s1,
        story2: s2,
        similarity,
        sharedEntities: shared
      });
    }
  }

  console.error(`  Generated ${candidates.length} Bucket C candidates`);
  return candidates;
}

async function generateBucketD(limit = 10) {
  console.error(`\n[Bucket D] Generating same-topic different-event pairs...`);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // Find stories mentioning common topics
  const keywords = ['Trump', 'Ukraine', 'Congress', 'immigration', 'tariff'];
  const candidates = [];

  for (const keyword of keywords) {
    if (candidates.length >= limit) break;

    const { data: matches, error } = await supabase
      .from('stories')
      .select('id, primary_headline, top_entities, first_seen_at, centroid_embedding_v1')
      .gte('first_seen_at', fourteenDaysAgo.toISOString())
      .not('top_entities', 'eq', '{}')
      .ilike('primary_headline', `%${keyword}%`)
      .order('id', { ascending: true }) // Stable ordering
      .limit(20);

    if (error || !matches?.length) continue;

    // Create pairs from stories about same topic but likely different events
    // Look for pairs with low entity overlap but similar keywords
    for (let i = 0; i < matches.length && candidates.length < limit; i++) {
      for (let j = i + 1; j < matches.length && candidates.length < limit; j++) {
        const s1 = matches[i];
        const s2 = matches[j];

        const shared = getSharedEntities(s1.top_entities, s2.top_entities);
        // Prefer pairs with 0-1 shared entities (likely different events)
        if (shared.length > 1) continue;

        const similarity = cosineSimilarity(
          s1.centroid_embedding_v1,
          s2.centroid_embedding_v1
        );

        candidates.push({
          bucket: 'D',
          story1: s1,
          story2: s2,
          similarity,
          sharedEntities: shared
        });

        // Only take 2 pairs per keyword
        if (candidates.filter(c => c.bucket === 'D').length % 2 === 0) break;
      }
    }
  }

  console.error(`  Generated ${candidates.length} Bucket D candidates`);
  return candidates;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const totalLimit = limitArg ? parseInt(limitArg.split('=')[1]) : 50;

  console.error('Generating merge candidate pairs...');
  console.error(`Total target: ~${totalLimit} pairs`);

  // Generate candidates for each bucket
  const bucketA = await generateBucketA(Math.ceil(totalLimit * 0.25));
  const bucketB = await generateBucketB(Math.ceil(totalLimit * 0.35));
  const bucketC = await generateBucketC(Math.ceil(totalLimit * 0.20));
  const bucketD = await generateBucketD(Math.ceil(totalLimit * 0.20));

  const allCandidates = [...bucketA, ...bucketB, ...bucketC, ...bucketD];

  console.error(`\n=== Summary ===`);
  console.error(`Bucket A (same-event): ${bucketA.length}`);
  console.error(`Bucket B (high-sim): ${bucketB.length}`);
  console.error(`Bucket C (1-entity): ${bucketC.length}`);
  console.error(`Bucket D (same-topic): ${bucketD.length}`);
  console.error(`Total: ${allCandidates.length} candidates`);

  // Output CSV to stdout
  console.log(`Merge candidate pairs for TTRC-236 validation`);
  console.log(`Generated: ${allCandidates.length} pairs across 4 buckets (A=${bucketA.length}, B=${bucketB.length}, C=${bucketC.length}, D=${bucketD.length})`);
  console.log('bucket,story1_id,story2_id,similarity,shared_entities,story1_headline,story2_headline,are_duplicates');

  for (const c of allCandidates) {
    console.log(formatCandidate(c.bucket, c.story1, c.story2, c.similarity, c.sharedEntities));
  }

  console.error(`\nOutput written to stdout. Redirect to file:`);
  console.error(`  node scripts/create-merge-test-data.js > merge-candidates.csv`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
