/**
 * Validate merge quality using ground truth labels
 *
 * Tests different threshold combinations to find optimal settings:
 * - Multi-signal gating: 2 entities @ high sim OR 3+ entities @ lower sim
 * - Filters test data ([VARIATION] stories)
 * - Tracks skip reasons for coverage analysis
 * - Grid search to find best thresholds
 *
 * Usage:
 *   node scripts/validate-merge-quality.js merge-test-ground-truth.csv
 */

import fs from 'node:fs';
import { parse } from 'csv-parse/sync';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { MERGE_CFG } from './lib/merge-thresholds.js';
import { shouldMerge, skipReason, isTestOrUnreadyPair, explainMergeDecision } from './lib/merge-logic.js';

// Load environment variables
dotenv.config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const csvPath = process.argv[2] || 'merge-test-ground-truth.csv';

  if (!fs.existsSync(csvPath)) {
    console.error(`Error: File not found: ${csvPath}`);
    console.error('Run: node scripts/create-merge-test-data.js > merge-test-ground-truth.csv');
    process.exit(1);
  }

  // Parse CSV (skip first 2 lines which are log messages from generation)
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  const csvContent = lines.slice(2).join('\n'); // Skip "Loaded..." and "Generated..." lines

  const records = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true, // Handle inconsistent column counts
  });

  console.log(`Loaded ${records.length} labeled pairs from ${csvPath}`);
  console.log('='.repeat(70));

  // Filter to only YES/NO labeled records (MAYBE is excluded from metrics)
  const labeled = records.filter(r => {
    if (!r.are_duplicates) return false;
    const val = r.are_duplicates.trim().toLowerCase();
    return val === 'yes' || val === 'no';  // MAYBE excluded per plan
  });

  const maybeCount = records.filter(r => {
    const val = (r.are_duplicates || '').trim().toLowerCase();
    return val === 'maybe';
  }).length;

  if (maybeCount > 0) {
    console.log(`Note: ${maybeCount} MAYBE pairs excluded from metrics\n`);
  }

  if (labeled.length === 0) {
    console.error('Error: No labeled data found in CSV');
    console.error('Fill in "are_duplicates" column with YES/NO for each pair');
    process.exit(1);
  }

  console.log(`Found ${labeled.length} labeled pairs\n`);

  // Fetch story data from database (need full entity lists)
  console.log('Fetching story data from database...');
  const storyIds = new Set();
  labeled.forEach(r => {
    storyIds.add(parseInt(r.story1_id));
    storyIds.add(parseInt(r.story2_id));
  });

  const { data: stories, error: fetchError } = await supabase
    .from('stories')
    .select('id, primary_headline, top_entities, first_seen_at, last_updated_at, category, primary_actor')
    .in('id', Array.from(storyIds));

  if (fetchError) {
    console.error('Error fetching stories from database:', fetchError.message);
    process.exit(1);
  }

  // Create lookup map
  const storyMap = new Map();
  stories.forEach(s => storyMap.set(s.id, s));

  console.log(`Fetched ${stories.length} stories from database\n`);

  // Ground truth labels (YES/NO only - MAYBE already filtered out)
  const groundTruth = labeled.map(r => {
    // Defensive: coerce to string before string methods
    const val = String(r.are_duplicates ?? '').trim().toLowerCase();

    // Validate story IDs are pure integers
    const s1 = String(r.story1_id ?? '').trim();
    const s2 = String(r.story2_id ?? '').trim();
    if (!/^\d+$/.test(s1) || !/^\d+$/.test(s2)) {
      console.error(`Warning: Invalid story ID(s) in row: story1_id='${r.story1_id}', story2_id='${r.story2_id}'`);
    }
    const story1_id = parseInt(s1, 10) || 0;
    const story2_id = parseInt(s2, 10) || 0;

    // Blocker #5: Defensive shared_entities parsing (handles both numeric and pipe-delimited)
    // Note: Use String() coercion since r.shared_entities may be a number
    let sharedCount = 0;
    const rawShared = String(r.shared_entities ?? '').trim();
    if (rawShared) {
      // If it's a pure number, use it directly
      if (/^\d+$/.test(rawShared)) {
        sharedCount = parseInt(rawShared, 10);
      } else {
        // Otherwise parse as pipe-delimited entity IDs
        sharedCount = rawShared.split('|').map(e => e.trim()).filter(Boolean).length;
      }
    }

    return {
      bucket: r.bucket || 'UNKNOWN',  // Track bucket for per-bucket metrics
      story1_id,
      story2_id,
      similarity: parseFloat(r.similarity) || 0,
      shared_entities: sharedCount,
      are_duplicates: val === 'yes',  // YES = should merge, NO = should not
      story1_headline: r.story1_headline,
      story2_headline: r.story2_headline,
      // Use real story objects from database
      story1: storyMap.get(story1_id) || {
        id: story1_id,
        primary_headline: r.story1_headline,
        top_entities: [],
        first_seen_at: new Date(),
      },
      story2: storyMap.get(story2_id) || {
        id: story2_id,
        primary_headline: r.story2_headline,
        top_entities: [],
        first_seen_at: new Date(),
      },
    };
  });

  // Filter test data and track coverage
  const SKIPS = {
    TEST_DATA: 0,
    NO_ENTITIES: 0,
    NO_TIME: 0,
    TIME_WINDOW: 0,
    CATEGORY: 0,
    CATEGORY_MISSING: 0,
    ACTOR: 0,
    ACTOR_MISSING: 0,
  };

  const cleanPairs = [];

  for (const pair of groundTruth) {
    // Filter [VARIATION] test data
    if (isTestOrUnreadyPair(pair.story1, pair.story2)) {
      SKIPS.TEST_DATA++;
      continue;
    }

    // Check skip reason
    const reason = skipReason(pair.story1, pair.story2);
    if (reason) {
      SKIPS[reason] = (SKIPS[reason] || 0) + 1;
      continue;
    }

    cleanPairs.push(pair);
  }

  const coverage = cleanPairs.length / groundTruth.length;

  console.log(`Coverage: ${(coverage * 100).toFixed(1)}% (${cleanPairs.length}/${groundTruth.length} pairs after filters)`);
  console.log(`Skip Reasons: ${JSON.stringify(SKIPS, null, 2)}\n`);

  if (cleanPairs.length === 0) {
    console.error('Error: No clean pairs after filtering');
    console.error('All pairs were filtered out (test data or missing entities)');
    process.exit(1);
  }

  // Count ground truth positives/negatives
  const posCount = cleanPairs.filter(g => g.are_duplicates).length;
  const negCount = cleanPairs.filter(g => !g.are_duplicates).length;
  console.log(`Ground truth (clean set): ${posCount} YES (should merge), ${negCount} NO (should NOT merge)\n`);

  // Per-bucket distribution
  const buckets = ['A', 'B', 'C', 'D', 'UNKNOWN'];
  console.log('Per-bucket distribution:');
  for (const b of buckets) {
    const count = cleanPairs.filter(p => p.bucket === b).length;
    if (count > 0) {
      const yes = cleanPairs.filter(p => p.bucket === b && p.are_duplicates).length;
      const no = cleanPairs.filter(p => p.bucket === b && !p.are_duplicates).length;
      console.log(`  Bucket ${b}: ${count} pairs (${yes} YES, ${no} NO)`);
    }
  }
  console.log('');

  // Grid search: Test different threshold combinations
  const sweepConfigs = [
    { name: 'SIM_FOR_2=0.75, SIM_FOR_3=0.65', SIM_FOR_2: 0.75, SIM_FOR_3: 0.65 },
    { name: 'SIM_FOR_2=0.80, SIM_FOR_3=0.70', SIM_FOR_2: 0.80, SIM_FOR_3: 0.70 },
    { name: 'SIM_FOR_2=0.82, SIM_FOR_3=0.72', SIM_FOR_2: 0.82, SIM_FOR_3: 0.72 },
    { name: 'SIM_FOR_2=0.85, SIM_FOR_3=0.75', SIM_FOR_2: 0.85, SIM_FOR_3: 0.75 },
    { name: 'SIM_FOR_2=0.88, SIM_FOR_3=0.78', SIM_FOR_2: 0.88, SIM_FOR_3: 0.78 },
    { name: 'SIM_FOR_2=0.90, SIM_FOR_3=0.80', SIM_FOR_2: 0.90, SIM_FOR_3: 0.80 },
  ];

  console.log('Threshold Sweep Results:');
  console.log('='.repeat(70));

  const results = [];

  for (const sweepCfg of sweepConfigs) {
    // Create config override
    const testConfig = {
      ...MERGE_CFG,
      SIM_FOR_2: sweepCfg.SIM_FOR_2,
      SIM_FOR_3: sweepCfg.SIM_FOR_3,
    };

    // Apply threshold to predict merges
    const predictions = cleanPairs.map(pair => {
      const wouldMerge = shouldMerge(pair.story1, pair.story2, pair.similarity, testConfig);

      return {
        ...pair,
        predicted: wouldMerge,
        correct: wouldMerge === pair.are_duplicates,
      };
    });

    // Calculate confusion matrix
    const tp = predictions.filter(p => p.predicted && p.are_duplicates).length;  // True Positives
    const fp = predictions.filter(p => p.predicted && !p.are_duplicates).length; // False Positives
    const tn = predictions.filter(p => !p.predicted && !p.are_duplicates).length; // True Negatives
    const fn = predictions.filter(p => !p.predicted && p.are_duplicates).length; // False Negatives

    // Metrics
    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 = precision + recall > 0 ? 2 * (precision * recall) / (precision + recall) : 0;
    const accuracy = (tp + tn) / predictions.length;

    results.push({
      config: sweepCfg,
      tp,
      fp,
      tn,
      fn,
      precision,
      recall,
      f1,
      accuracy,
      predictions,
    });

    console.log(`\n${sweepCfg.name}:`);
    console.log(`  Precision: ${(precision * 100).toFixed(1)}% (${tp}/${tp + fp} predicted merges correct)`);
    console.log(`  Recall:    ${(recall * 100).toFixed(1)}% (${tp}/${tp + fn} true duplicates found)`);
    console.log(`  F1 Score:  ${(f1 * 100).toFixed(1)}%`);
    console.log(`  Accuracy:  ${(accuracy * 100).toFixed(1)}%`);
    console.log(`  Confusion: TP=${tp}, FP=${fp}, TN=${tn}, FN=${fn}`);
  }

  // Find best configuration
  console.log('\n' + '='.repeat(70));
  console.log('RECOMMENDATION:');
  console.log('='.repeat(70));

  // Sort by F1 score
  results.sort((a, b) => b.f1 - a.f1);
  const best = results[0];

  console.log(`\nBest configuration: ${best.config.name}`);
  console.log(`  F1 Score: ${(best.f1 * 100).toFixed(1)}%`);
  console.log(`  Precision: ${(best.precision * 100).toFixed(1)}%`);
  console.log(`  Recall: ${(best.recall * 100).toFixed(1)}%`);

  // Per-bucket metrics for best config
  console.log(`\nPer-Bucket Metrics:`);
  console.log('bucket    n_pairs    precision    recall    f1');
  console.log('-'.repeat(50));

  for (const b of buckets) {
    const bucketPreds = best.predictions.filter(p => p.bucket === b);
    if (bucketPreds.length === 0) continue;

    const btp = bucketPreds.filter(p => p.predicted && p.are_duplicates).length;
    const bfp = bucketPreds.filter(p => p.predicted && !p.are_duplicates).length;
    const bfn = bucketPreds.filter(p => !p.predicted && p.are_duplicates).length;

    const bprec = btp + bfp > 0 ? btp / (btp + bfp) : 0;
    const brec = btp + bfn > 0 ? btp / (btp + bfn) : 0;
    const bf1 = bprec + brec > 0 ? 2 * (bprec * brec) / (bprec + brec) : 0;

    console.log(`${b.padEnd(9)} ${String(bucketPreds.length).padEnd(10)} ${(bprec * 100).toFixed(0).padStart(8)}%    ${(brec * 100).toFixed(0).padStart(6)}%    ${(bf1 * 100).toFixed(0).padStart(3)}%`);
  }
  console.log('-'.repeat(50));
  console.log(`${'OVERALL'.padEnd(9)} ${String(best.predictions.length).padEnd(10)} ${(best.precision * 100).toFixed(0).padStart(8)}%    ${(best.recall * 100).toFixed(0).padStart(6)}%    ${(best.f1 * 100).toFixed(0).padStart(3)}%`);

  // Build config for explainMergeDecision
  const bestConfig = { ...MERGE_CFG, SIM_FOR_2: best.config.SIM_FOR_2, SIM_FOR_3: best.config.SIM_FOR_3 };

  // Show false positives (incorrectly merged) with explainMergeDecision diagnostics
  if (best.fp > 0) {
    console.log(`\n⚠️  FALSE POSITIVES (${best.fp} different stories incorrectly flagged for merge):`);
    const fps = best.predictions.filter(p => p.predicted && !p.are_duplicates);
    fps.slice(0, 5).forEach((p, idx) => {
      const ctx = explainMergeDecision(p.story1, p.story2, p.similarity, bestConfig);
      console.log(`  ${idx + 1}. Stories ${p.story1_id}/${p.story2_id} (bucket=${p.bucket}, lane=${ctx.lane}, passed=${ctx.passed.join(',')})`);
      console.log(`     sim=${p.similarity.toFixed(3)}, shared=${ctx.sharedCount} entities`);
      console.log(`     "${(p.story1_headline || '').slice(0, 60)}"`);
      console.log(`     "${(p.story2_headline || '').slice(0, 60)}"`);
    });
  }

  // Show false negatives (missed duplicates) with explainMergeDecision diagnostics
  if (best.fn > 0) {
    console.log(`\n⚠️  FALSE NEGATIVES (${best.fn} duplicates missed):`);
    const fns = best.predictions.filter(p => !p.predicted && p.are_duplicates);
    fns.slice(0, 5).forEach((p, idx) => {
      const ctx = explainMergeDecision(p.story1, p.story2, p.similarity, bestConfig);
      console.log(`  ${idx + 1}. Stories ${p.story1_id}/${p.story2_id} (bucket=${p.bucket}, lane=${ctx.lane}, blockedBy=${ctx.blockedBy.join(',')})`);
      console.log(`     sim=${p.similarity.toFixed(3)}, shared=${ctx.sharedCount} entities`);
      console.log(`     "${(p.story1_headline || '').slice(0, 60)}"`);
      console.log(`     "${(p.story2_headline || '').slice(0, 60)}"`);
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log('NEXT STEPS:');
  console.log(`1. Update merge-thresholds.js with best config:`);
  console.log(`   - SIM_FOR_2: ${best.config.SIM_FOR_2}`);
  console.log(`   - SIM_FOR_3: ${best.config.SIM_FOR_3}`);
  console.log(`2. Review false positives/negatives above`);
  console.log(`3. Queue +30 labeled pairs to reach 70-100 for statistical confidence`);
  console.log(`4. A/B test DISCOUNT_MEDIA_ORGS flag`);

  // Summary for JIRA
  console.log('\n' + '='.repeat(70));
  console.log('JIRA UPDATE (TTRC-236):');
  console.log('='.repeat(70));
  console.log(`Coverage: ${(coverage * 100).toFixed(1)}% (${cleanPairs.length}/${groundTruth.length})`);
  console.log(`Best Config: ${best.config.name}`);
  console.log(`F1: ${(best.f1 * 100).toFixed(1)}%, Precision: ${(best.precision * 100).toFixed(1)}%, Recall: ${(best.recall * 100).toFixed(1)}%`);
  console.log(`Skip Reasons: ${JSON.stringify(SKIPS)}`);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
