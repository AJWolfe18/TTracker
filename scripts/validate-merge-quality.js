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
import { shouldMerge, skipReason, isTestOrUnreadyPair } from './lib/merge-logic.js';

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

  // Filter to only labeled records (case-insensitive, handle yes/no/maybe)
  const labeled = records.filter(r => {
    if (!r.are_duplicates) return false;
    const val = r.are_duplicates.trim().toLowerCase();
    return val === 'yes' || val === 'no' || val === 'maybe';
  });

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

  // Ground truth labels (treat "maybe" as "yes" for now - conservative merge)
  const groundTruth = labeled.map(r => {
    const val = r.are_duplicates.trim().toLowerCase();
    const story1_id = parseInt(r.story1_id);
    const story2_id = parseInt(r.story2_id);

    return {
      story1_id,
      story2_id,
      similarity: parseFloat(r.similarity),
      shared_entities: parseInt(r.shared_entities),
      are_duplicates: val === 'yes' || val === 'maybe',  // maybe = should merge
      is_maybe: val === 'maybe',
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
    TIME_WINDOW: 0,
    CATEGORY: 0,
    ACTOR: 0,
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
  const truePositives = cleanPairs.filter(g => g.are_duplicates).length;
  const trueNegatives = cleanPairs.filter(g => !g.are_duplicates).length;
  const maybes = cleanPairs.filter(g => g.is_maybe).length;
  console.log(`Ground truth (clean set): ${truePositives} should merge (${maybes} maybes), ${trueNegatives} should NOT merge\n`);

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

  // Show false positives (incorrectly merged)
  if (best.fp > 0) {
    console.log(`\n⚠️  FALSE POSITIVES (${best.fp} different stories incorrectly flagged for merge):`);
    const fps = best.predictions.filter(p => p.predicted && !p.are_duplicates);
    fps.slice(0, 5).forEach((p, idx) => {
      console.log(`  ${idx + 1}. Stories ${p.story1_id}/${p.story2_id} (sim=${p.similarity.toFixed(3)}, shared=${p.shared_entities})`);
      console.log(`     "${p.story1_headline.slice(0, 60)}"`);
      console.log(`     "${p.story2_headline.slice(0, 60)}"`);
    });
  }

  // Show false negatives (missed duplicates)
  if (best.fn > 0) {
    console.log(`\n⚠️  FALSE NEGATIVES (${best.fn} duplicates missed):`);
    const fns = best.predictions.filter(p => !p.predicted && p.are_duplicates);
    fns.slice(0, 5).forEach((p, idx) => {
      console.log(`  ${idx + 1}. Stories ${p.story1_id}/${p.story2_id} (sim=${p.similarity.toFixed(3)}, shared=${p.shared_entities})`);
      console.log(`     "${p.story1_headline.slice(0, 60)}"`);
      console.log(`     "${p.story2_headline.slice(0, 60)}"`);
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
