/**
 * TTRC-329: Analyze SHADOW_POLICY_DIFF logs
 *
 * 1. Parse logs safely (attempt JSON.parse, skip malformed)
 * 2. Aggregate stats by threshold
 * 3. Stratified sampling for manual review
 * 4. Output TSV + summary
 */

import fs from 'fs';
import path from 'path';

const LOG_DIR = 'logs/shadow-policy';
const MIN_DIFFS = 20;  // Data sufficiency gate

// === SAFE JSON EXTRACTION (tolerant: find marker, backtrack to {) ===
function extractJSON(line) {
  // Tolerant marker - find this anywhere in the JSON
  const marker = '"type":"SHADOW_POLICY_DIFF"';
  const markerPos = line.indexOf(marker);
  if (markerPos < 0) return null;

  // Backtrack to find the opening brace
  let start = markerPos;
  while (start > 0 && line[start] !== '{') {
    start--;
  }
  if (line[start] !== '{') return null;

  // Now brace-count forward with string awareness
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < line.length; i++) {
    const ch = line[i];

    if (escape) { escape = false; continue; }
    if (ch === '\\') { if (inString) escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }

    if (!inString) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      if (depth === 0) return line.slice(start, i + 1);
    }
  }

  return null; // never closed - malformed
}

// === SAFE PARSING with run metadata ===
function parseLogFile(filepath, runId) {
  const records = [];
  const lines = fs.readFileSync(filepath, 'utf8').split('\n');

  for (const line of lines) {
    const jsonStr = extractJSON(line);
    if (!jsonStr) continue;

    try {
      const obj = JSON.parse(jsonStr);
      if (obj.type === 'SHADOW_POLICY_DIFF') {
        obj._run_id = runId;  // Attach run metadata
        records.push(obj);
      }
    } catch (e) {
      // Skip malformed JSON
    }
  }
  return records;
}

// === RISK SCORING (improved) ===
function riskScore(diff) {
  let score = 0;

  // Embed term: lower = riskier (clamped to avoid negative)
  score += Math.max(0, (0.92 - diff.embed_best) * 10);

  // Time term: longer = riskier
  score += (diff.time_diff_hours / 48) * 3;

  // Corroboration strength (weaker = riskier)
  if (diff.corroboration_type === 'title_only') score += 5;
  else if (diff.corroboration_type === 'entity') score += 1;
  // slug = 0 (strongest)

  // Margin penalty (only if meaningful)
  if (diff.margin !== null && diff.candidate_count >= 2) {
    if (diff.margin < 0.03) score += 3;
  }

  // Ambiguity penalty
  if (diff.candidate_count > 10) score += 2;

  return Math.round(score * 100) / 100;
}

// === FIELD ALIASING (defensive compatibility) ===
function coalesceId(r) {
  return r.best_candidate_id ?? r.best_story_id ?? r.story_id ?? r.candidate_story_id ?? null;
}
function coalesceHeadline(r) {
  return r.best_candidate_headline ?? r.story_headline ?? r.candidate_headline ?? '';
}

// === SCHEMA VALIDATION ===
const REQUIRED_FIELDS = ['article_id', 'embed_best', 'time_diff_hours', 'corroboration_type', 'shadow_results'];

function validateRecord(r) {
  // Normalize field aliases first
  r.best_candidate_id = coalesceId(r);
  r.best_candidate_headline = coalesceHeadline(r);

  // Check required fields
  if (!r.article_id || r.best_candidate_id === null) return false;
  for (const field of REQUIRED_FIELDS) {
    if (r[field] === undefined || r[field] === null) return false;
  }

  // Normalize numeric types
  r.embed_best = Number(r.embed_best);
  r.time_diff_hours = Number(r.time_diff_hours);
  r.candidate_count = Number(r.candidate_count) || 0;
  r.margin = r.margin !== null ? Number(r.margin) : null;

  return Number.isFinite(r.embed_best) && Number.isFinite(r.time_diff_hours);
}

// === SEEDED PRNG (mulberry32) ===
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(str) {
  let h = 2166136261;  // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// === STRATIFIED SAMPLING ===
const BASELINE_RESERVE = 15;  // Always reserve slots for random baseline
const STRATIFIED_BUDGET = 45; // Max slots for stratified buckets (60 - 15)

function stratifiedSample(records, runsCount, targetSize = 60) {
  const samples = [];
  const used = new Set();
  let stratifiedCount = 0;

  // Helper: uses composite key matching dedupe, respects budget
  const addSamples = (filtered, count, reason) => {
    if (count <= 0) return;  // Guard against zero/negative
    const remaining = STRATIFIED_BUDGET - stratifiedCount;
    const actualCount = Math.min(count, remaining);
    if (actualCount <= 0) return;

    const sorted = filtered
      .filter(r => {
        const key = `${r.article_id}::${r.best_candidate_id}`;
        return !used.has(key);
      })
      .sort((a, b) => riskScore(b) - riskScore(a));

    for (let i = 0; i < Math.min(actualCount, sorted.length); i++) {
      const key = `${sorted[i].article_id}::${sorted[i].best_candidate_id}`;
      used.add(key);
      samples.push({ ...sorted[i], sample_reason: reason });
      stratifiedCount++;
    }
  };

  // PRIORITY ORDER: must-have buckets first, then fill with highest risk
  // Budget enforced: total stratified <= 45, leaving 15 for baseline

  // 1. Decision boundary cases (where 0.88 vs 0.89 matters)
  addSamples(records.filter(r =>
    r.shadow_results?.tierB_0_88 && !r.shadow_results?.tierB_0_89
  ), 10, 'marginal_0_88');

  // 2. Title-only (safety rule validation)
  addSamples(records.filter(r => r.corroboration_type === 'title_only'), 8, 'title_only');

  // 3. Low embed (aggressive thresholds)
  addSamples(records.filter(r => r.embed_best < 0.88), 8, 'low_embed');

  // 4. Long time (time gate edges)
  addSamples(records.filter(r => r.time_diff_hours > 36), 6, 'long_time');

  // 5. Entity corroboration
  addSamples(records.filter(r => r.corroboration_type === 'entity'), 8, 'entity');

  // 6. Slug corroboration
  addSamples(records.filter(r => r.corroboration_type === 'slug'), 8, 'slug');

  // 7. Fill remainder of stratified budget with highest risk
  addSamples(records, STRATIFIED_BUDGET - stratifiedCount, 'highest_risk');

  // 8. Random baseline (ALWAYS gets its reserved 15 slots - unbiased)
  // Proper seeded Fisher-Yates for reproducibility
  const unused = records.filter(r => {
    const key = `${r.article_id}::${r.best_candidate_id}`;
    return !used.has(key);
  });

  // Seed from env (for reproducibility) or data shape (default stable)
  const seedStr = process.env.SHADOW_SAMPLE_SEED || `${records.length}:${runsCount}`;
  const rand = mulberry32(hashStringToSeed(seedStr));
  const shuffled = [...unused];
  shuffleInPlace(shuffled, rand);

  for (let i = 0; i < Math.min(BASELINE_RESERVE, shuffled.length); i++) {
    const key = `${shuffled[i].article_id}::${shuffled[i].best_candidate_id}`;
    used.add(key);
    samples.push({ ...shuffled[i], sample_reason: 'random_baseline' });
  }

  return samples.slice(0, targetSize);
}

// === CORROBORATION TYPE NORMALIZATION ===
function normalizeCorroborationType(type) {
  const map = {
    'slug': 'slug', 'slug_token': 'slug',
    'entity': 'entity', 'entity_overlap': 'entity',
    'title_only': 'title_only', 'title_token': 'title_only',
    'none': 'none'
  };
  return map[type] || type;
}

// === MAIN ===
async function main() {
  // Load run metadata
  const runsPath = path.join(LOG_DIR, 'runs.json');
  const runs = fs.existsSync(runsPath) ? JSON.parse(fs.readFileSync(runsPath, 'utf8')) : [];
  const runMap = Object.fromEntries(runs.map(r => [r.databaseId, r]));

  // Load all log files
  const logFiles = fs.readdirSync(LOG_DIR).filter(f => f.startsWith('run-') && f.endsWith('.log'));

  let allRecords = [];
  for (const file of logFiles) {
    const runId = file.match(/run-(\d+)\.log/)?.[1];
    const records = parseLogFile(path.join(LOG_DIR, file), runId);

    // Attach run metadata to each record
    for (const r of records) {
      r._run_sha = runMap[runId]?.headSha || r.commit_sha || 'unknown';
      r._run_created = runMap[runId]?.createdAt;
      r.corroboration_type = normalizeCorroborationType(r.corroboration_type);
    }
    allRecords.push(...records);
  }

  // Schema validation - filter invalid records
  const validRecords = [];
  let invalidCount = 0;
  for (const r of allRecords) {
    if (validateRecord(r)) {
      validRecords.push(r);
    } else {
      invalidCount++;
    }
  }
  if (invalidCount > 0) {
    console.log(`⚠️  Skipped ${invalidCount} records with missing/invalid fields`);
  }
  allRecords = validRecords;

  // Dedupe by article_id + best_candidate_id (preserves variation, tracks occurrences)
  const occurrences = new Map();  // key -> { record, count, run_ids }
  for (const r of allRecords) {
    const key = `${r.article_id}::${r.best_candidate_id}`;
    if (occurrences.has(key)) {
      const entry = occurrences.get(key);
      entry.count++;
      if (r._run_id) entry.run_ids.add(r._run_id);
    } else {
      occurrences.set(key, { record: r, count: 1, run_ids: new Set([r._run_id].filter(Boolean)) });
    }
  }

  // Attach occurrence count to each record
  allRecords = Array.from(occurrences.values()).map(({ record, count, run_ids }) => ({
    ...record,
    _occurrences: count,
    _run_ids: Array.from(run_ids)
  }));

  console.log(`\n=== SHADOW POLICY ANALYSIS ===`);
  console.log(`Total unique diffs: ${allRecords.length}`);

  // Data sufficiency check
  if (allRecords.length < MIN_DIFFS) {
    console.log(`\n⚠️  Need at least ${MIN_DIFFS} diffs for meaningful analysis.`);
    console.log(`   Wait for more RSS runs before proceeding.`);
    process.exit(1);
  }

  // === AGGREGATE STATS ===
  const stats = {
    total: allRecords.length,
    by_corroboration: {},
    by_threshold: { '0.86': 0, '0.87': 0, '0.88': 0, '0.89': 0 },
    embed_distribution: { '<0.87': 0, '0.87-0.88': 0, '0.88-0.89': 0, '0.89-0.90': 0, '>=0.90': 0 },
    time_distribution: { '0-12h': 0, '12-24h': 0, '24-36h': 0, '36-48h': 0, '>48h': 0 }
  };

  for (const r of allRecords) {
    // Corroboration type
    stats.by_corroboration[r.corroboration_type] = (stats.by_corroboration[r.corroboration_type] || 0) + 1;

    // Which thresholds would attach
    if (r.shadow_results) {
      if (r.shadow_results.tierB_0_86) stats.by_threshold['0.86']++;
      if (r.shadow_results.tierB_0_87) stats.by_threshold['0.87']++;
      if (r.shadow_results.tierB_0_88) stats.by_threshold['0.88']++;
      if (r.shadow_results.tierB_0_89) stats.by_threshold['0.89']++;
    }

    // Embed distribution
    const e = r.embed_best;
    if (e < 0.87) stats.embed_distribution['<0.87']++;
    else if (e < 0.88) stats.embed_distribution['0.87-0.88']++;
    else if (e < 0.89) stats.embed_distribution['0.88-0.89']++;
    else if (e < 0.90) stats.embed_distribution['0.89-0.90']++;
    else stats.embed_distribution['>=0.90']++;

    // Time distribution
    const t = r.time_diff_hours;
    if (t <= 12) stats.time_distribution['0-12h']++;
    else if (t <= 24) stats.time_distribution['12-24h']++;
    else if (t <= 36) stats.time_distribution['24-36h']++;
    else if (t <= 48) stats.time_distribution['36-48h']++;
    else stats.time_distribution['>48h']++;
  }

  console.log(`\nBy corroboration type:`);
  for (const [k, v] of Object.entries(stats.by_corroboration)) {
    console.log(`  ${k}: ${v} (${(v/stats.total*100).toFixed(1)}%)`);
  }

  console.log(`\nWould attach at threshold:`);
  for (const [k, v] of Object.entries(stats.by_threshold)) {
    console.log(`  ${k}: ${v} cases`);
  }

  console.log(`\nEmbed distribution:`);
  for (const [k, v] of Object.entries(stats.embed_distribution)) {
    console.log(`  ${k}: ${v}`);
  }

  console.log(`\nTime distribution:`);
  for (const [k, v] of Object.entries(stats.time_distribution)) {
    console.log(`  ${k}: ${v}`);
  }

  // Check for sampling bias - FAIL if dominated AND minority types too sparse
  const corrobCounts = Object.values(stats.by_corroboration);
  const maxCorrobPct = Math.max(...corrobCounts) / stats.total;
  const minCorrobCount = Math.min(...corrobCounts.filter(c => c > 0));

  if (maxCorrobPct > 0.80 && minCorrobCount < 5) {
    console.log(`\n❌ One corroboration type dominates (${(maxCorrobPct*100).toFixed(0)}%) AND minority types too sparse (<5).`);
    console.log(`   Results would not be representative. Wait for more diverse data.`);
    process.exit(1);
  } else if (maxCorrobPct > 0.80) {
    console.log(`\n⚠️  One corroboration type dominates (${(maxCorrobPct*100).toFixed(0)}%).`);
    console.log(`   Proceeding but results may be skewed.`);
  }

  // === STRATIFIED SAMPLE ===
  const samples = stratifiedSample(allRecords, runs.length, 60);
  console.log(`\nStratified sample: ${samples.length} cases`);

  // Warn if baseline reserve couldn't be filled
  const baselineCount = samples.filter(s => s.sample_reason === 'random_baseline').length;
  if (baselineCount < BASELINE_RESERVE) {
    console.log(`⚠️  Only ${baselineCount}/${BASELINE_RESERVE} baseline slots filled (not enough unused records after stratified)`);
  }

  // === OUTPUT CSV ===
  // Helper to escape CSV fields (wrap in quotes if contains comma, quote, or newline)
  const csvEscape = (val) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };

  const csvHeader = [
    'row', 'article_id', 'best_candidate_id', 'article_title', 'story_headline',
    'embed_best', 'margin', 'time_diff_hours',
    'corroboration_type', 'candidate_count', 'risk_score',
    'shadow_0_86', 'shadow_0_87', 'shadow_0_88', 'shadow_0_89',
    'sample_reason', 'occurrences', 'run_id', 'run_created', 'commit_sha', 'label'
  ].join(',');

  const csvRows = samples.map((r, i) => {
    return [
      i + 1,
      csvEscape(r.article_id || ''),
      csvEscape(r.best_candidate_id || ''),
      csvEscape(r.article_title || ''),
      csvEscape(r.best_candidate_headline || ''),
      r.embed_best?.toFixed(3) || '',
      r.margin?.toFixed(3) || '',
      r.time_diff_hours?.toFixed(1) || '',
      r.corroboration_type || '',
      r.candidate_count || '',
      riskScore(r),
      r.shadow_results?.tierB_0_86 ? 'Y' : 'N',
      r.shadow_results?.tierB_0_87 ? 'Y' : 'N',
      r.shadow_results?.tierB_0_88 ? 'Y' : 'N',
      r.shadow_results?.tierB_0_89 ? 'Y' : 'N',
      r.sample_reason || '',
      r._occurrences || 1,
      r._run_id || '',
      r._run_created || '',
      csvEscape(r._run_sha || r.commit_sha || ''),
      ''  // label column for user to fill
    ].join(',');
  });

  const csv = [csvHeader, ...csvRows].join('\n');
  fs.writeFileSync(path.join(LOG_DIR, 'risky-cases.csv'), csv);
  console.log(`\n✅ Wrote ${LOG_DIR}/risky-cases.csv`);

  // === OUTPUT SUMMARY JSON ===
  fs.writeFileSync(path.join(LOG_DIR, 'summary.json'), JSON.stringify(stats, null, 2));
  console.log(`✅ Wrote ${LOG_DIR}/summary.json`);

  console.log(`\nNext: Open risky-cases.csv in Excel, fill 'label' column (S/A/D), save as risky-cases-labeled.csv`);
}

main().catch(console.error);
