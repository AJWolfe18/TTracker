/**
 * TTRC-329: Generate threshold recommendation from labeled data
 *
 * Reads risky-cases-labeled.csv, calculates FP rates per threshold
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs/shadow-policy';

// Simple CSV parser (handles quoted fields with commas)
function parseCSV(content) {
  const lines = content.split('\n').filter(l => l.trim());

  // Parse a single CSV line handling quoted fields
  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/\r$/, '')); // Handle Windows line endings
    return result;
  };

  const header = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseLine(line);
    const obj = {};
    header.forEach((h, i) => obj[h] = values[i] || '');
    return obj;
  });
}

async function main() {
  const csvPath = path.join(LOG_DIR, 'risky-cases-labeled.csv');
  const summaryPath = path.join(LOG_DIR, 'summary.json');

  if (!fs.existsSync(csvPath)) {
    console.log('❌ risky-cases-labeled.csv not found.');
    console.log('   Label risky-cases.csv and save as risky-cases-labeled.csv first.');
    process.exit(1);
  }

  // Load global stats from analyzer
  let globalStats = null;
  if (fs.existsSync(summaryPath)) {
    globalStats = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  }

  const records = parseCSV(fs.readFileSync(csvPath, 'utf8'));
  const labeled = records.filter(r => ['S', 'A', 'D'].includes(r.label?.toUpperCase()));

  // Warn if sample sizes too small
  const baseline = labeled.filter(r => r.sample_reason === 'random_baseline');
  if (labeled.length < 50) {
    console.log(`⚠️  Only ${labeled.length} labeled cases (recommend 60+)`);
  }
  if (baseline.length < 10) {
    console.log(`⚠️  Only ${baseline.length} random baseline cases (recommend 10+)`);
  }

  console.log(`\n=== THRESHOLD RECOMMENDATION REPORT ===`);
  console.log(`Labeled cases: ${labeled.length}`);

  // Show attach counts among diffs (not total pipeline coverage)
  if (globalStats?.by_threshold) {
    console.log(`\n=== ATTACH COUNTS AMONG DIFFS (shadow-diff population only) ===`);
    console.log(`Total unique diffs logged: ${globalStats.total}`);
    console.log(`Note: This is NOT total Tier B evaluations - only cases where shadow would attach.`);
    for (const [thresh, count] of Object.entries(globalStats.by_threshold)) {
      console.log(`  Threshold ${thresh}: ${count} would attach`);
    }
  }

  if (labeled.length < 20) {
    console.log(`\n⚠️  Need at least 20 labeled cases for reliable analysis.`);
  }

  // Count by label
  const counts = { S: 0, A: 0, D: 0 };
  for (const r of labeled) {
    counts[r.label.toUpperCase()]++;
  }

  console.log(`\nLabel distribution:`);
  console.log(`  S (Same Event): ${counts.S}`);
  console.log(`  A (Same Saga):  ${counts.A}`);
  console.log(`  D (Different):  ${counts.D}`);

  // Split labeled by sample type
  const stratifiedLabeled = labeled.filter(r => r.sample_reason !== 'random_baseline');
  const baselineLabeled = labeled.filter(r => r.sample_reason === 'random_baseline');

  // Helper to compute FP stats for a subset
  function computeThresholdStats(subset, label, showUpperBound = false) {
    const thresholds = ['0.86', '0.87', '0.88', '0.89'];
    const results = [];

    for (const thresh of thresholds) {
      const col = `shadow_${thresh.replace('.', '_')}`;
      const wouldAttach = subset.filter(r => r[col] === 'Y');
      const correct = wouldAttach.filter(r => r.label.toUpperCase() === 'S');
      const fpStrict = wouldAttach.filter(r => r.label.toUpperCase() === 'D');
      const fpCons = wouldAttach.filter(r => ['A', 'D'].includes(r.label.toUpperCase()));

      // Per-threshold upper bound: only applies to wouldAttach population
      let upperBound = null;
      if (showUpperBound && fpStrict.length === 0 && wouldAttach.length > 0) {
        upperBound = (3 / wouldAttach.length * 100).toFixed(1);
      }

      results.push({
        thresh,
        n: wouldAttach.length,
        correct: correct.length,
        fpStrict: fpStrict.length,
        fpCons: fpCons.length,
        upperBound
      });
    }

    console.log(`\n=== ${label} (n=${subset.length}) ===`);
    if (showUpperBound) {
      console.log(`Threshold | Coverage | Correct | FP(D) | FP(A+D) | Upper Bound (D)`);
      console.log(`----------|----------|---------|-------|---------|----------------`);
      for (const r of results) {
        const ub = r.upperBound ? `~${r.upperBound}%` : (r.fpStrict > 0 ? 'N/A' : '-');
        console.log(`   ${r.thresh}   |    ${String(r.n).padStart(3)}   |   ${String(r.correct).padStart(3)}   |   ${String(r.fpStrict).padStart(2)}  |   ${String(r.fpCons).padStart(2)}    |   ${ub}`);
      }
    } else {
      console.log(`Threshold | Coverage | Correct | FP(D) | FP(A+D)`);
      console.log(`----------|----------|---------|-------|--------`);
      for (const r of results) {
        console.log(`   ${r.thresh}   |    ${String(r.n).padStart(3)}   |   ${String(r.correct).padStart(3)}   |   ${String(r.fpStrict).padStart(2)}  |   ${String(r.fpCons).padStart(2)}`);
      }
    }
    return results;
  }

  // Show both stratified (safety-focused) and baseline (rate sanity check)
  // Stratified: no upper bound (biased sample)
  // Baseline: show per-threshold upper bounds (unbiased)
  const stratResults = computeThresholdStats(stratifiedLabeled, 'STRATIFIED SAMPLE (use to hunt worst-case FPs)');
  const baseResults = computeThresholdStats(baselineLabeled, 'RANDOM BASELINE (use for rate estimation)', true);

  // Recommendation with explicit decision rules
  console.log(`\n=== DECISION RULES ===`);
  console.log(`1. Use BASELINE for rate estimation (upper bounds shown above)`);
  console.log(`2. Use STRATIFIED to hunt worst-case FPs`);
  console.log(`3. If STRATIFIED shows ANY D at a threshold → REJECT that threshold (regardless of baseline)`);

  console.log(`\n=== RECOMMENDATION ===`);
  console.log(`With small n, you cannot prove "FP <= 1%". Upper bound is per-threshold above.`);
  console.log(`To claim "FP <= 1%" at a threshold, need ~300 wouldAttach cases with 0 D observed.`);
  console.log(`\nReview the numbers above and choose:`);
  console.log(`  - If A (Same Saga) is acceptable to merge → use FP(D only) column`);
  console.log(`  - If A should NOT merge → use FP(A + D) column`);
  console.log(`\nIf results are borderline, expand labeling to 150-300 cases.`);

  // Safety rule validation
  const titleOnly = labeled.filter(r => r.corroboration_type === 'title_only');
  const titleOnlyD = titleOnly.filter(r => r.label.toUpperCase() === 'D');
  console.log(`\n=== SAFETY RULE VALIDATION ===`);
  console.log(`Title-only cases: ${titleOnly.length}`);
  console.log(`Title-only FPs:   ${titleOnlyD.length}`);
  if (titleOnlyD.length > 0) {
    console.log(`⚠️  Title-only has FPs - safety rule (require 0.90) may need strengthening`);
  } else if (titleOnly.length > 0) {
    console.log(`✅ Title-only safety rule holding`);
  }
}

main().catch(console.error);
