#!/usr/bin/env node

/**
 * Eval CLI Runner
 *
 * Usage:
 *   node scripts/evals/run-eval.js --type=scotus                    # Full baseline
 *   node scripts/evals/run-eval.js --type=scotus --gold-only        # Gold set only
 *   node scripts/evals/run-eval.js --type=scotus --case-ids=4,51    # Specific cases
 *   node scripts/evals/run-eval.js --type=scotus --no-llm           # Skip LLM judge calls
 *
 * Output:
 *   logs/evals/scotus-YYYY-MM-DD-<run_id>.jsonl     (per-case results)
 *   logs/evals/scotus-YYYY-MM-DD-<run_id>-summary.json  (aggregate stats)
 *
 * Environment:
 *   SUPABASE_TEST_URL / SUPABASE_URL
 *   SUPABASE_TEST_SERVICE_KEY / SUPABASE_SERVICE_ROLE_KEY
 *   OPENAI_API_KEY (optional if --no-llm)
 */

import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', '..', 'logs', 'evals');

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    type: 'scotus',
    goldOnly: false,
    caseIds: null,
    noLlm: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--type=')) {
      config.type = arg.split('=')[1];
    } else if (arg === '--gold-only') {
      config.goldOnly = true;
    } else if (arg.startsWith('--case-ids=')) {
      config.caseIds = arg.split('=')[1].split(',').map(Number).filter(n => !isNaN(n));
    } else if (arg === '--no-llm') {
      config.noLlm = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Eval Runner — Measure enrichment quality across content types.

Usage:
  node scripts/evals/run-eval.js --type=scotus                 # Full baseline
  node scripts/evals/run-eval.js --type=scotus --gold-only     # Gold set only
  node scripts/evals/run-eval.js --type=scotus --case-ids=4,51 # Specific cases
  node scripts/evals/run-eval.js --type=scotus --no-llm        # Skip LLM judges

Options:
  --type=<type>       Content type (scotus, pardons, stories, eos). Default: scotus
  --gold-only         Only evaluate gold set cases
  --case-ids=<ids>    Evaluate specific case IDs (comma-separated)
  --no-llm            Skip LLM judge calls (D1, D3, D6)
  --help              Show this help message
      `);
      process.exit(0);
    }
  }

  return config;
}

// ============================================================================
// INITIALIZE CLIENTS
// ============================================================================

function initSupabase() {
  const url = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Missing SUPABASE_TEST_URL/SUPABASE_URL or SUPABASE_TEST_SERVICE_KEY/SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  return createClient(url, key);
}

function initOpenAI(noLlm) {
  if (noLlm) {
    console.log('LLM judge calls disabled (--no-llm)');
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('Warning: OPENAI_API_KEY not set — LLM judge calls will be skipped');
    return null;
  }

  return new OpenAI({ apiKey });
}

// ============================================================================
// OUTPUT WRITERS
// ============================================================================

function generateRunId() {
  const now = new Date();
  const ts = now.toISOString().replace(/[T:.]/g, '-').slice(0, 19);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${ts}-${rand}`;
}

function writeResults(type, runId, goldResults, aggregateResults, aggregateStats) {
  mkdirSync(LOGS_DIR, { recursive: true });

  // runId already contains the date, so just use type-runId
  const baseName = `${type}-${runId}`;

  // JSONL: one line per evaluated case
  const jsonlPath = join(LOGS_DIR, `${baseName}.jsonl`);
  const allResults = [...goldResults, ...aggregateResults];
  const lines = allResults.map(r => JSON.stringify(r));
  writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`\nJSONL written: ${jsonlPath} (${allResults.length} records)`);

  // Summary JSON
  const summaryPath = join(LOGS_DIR, `${baseName}-summary.json`);
  const summary = {
    run_id: runId,
    content_type: type,
    timestamp: new Date().toISOString(),
    gold_set_count: goldResults.length,
    aggregate_count: aggregateResults.length,
    stats: aggregateStats,
    gold_case_ids: goldResults.map(r => r.content_id),
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Summary written: ${summaryPath}`);

  return { jsonlPath, summaryPath };
}

// ============================================================================
// PRINT SUMMARY
// ============================================================================

function printSummary(goldResults, aggregateStats) {
  console.log('\n' + '='.repeat(70));
  console.log('BASELINE EVAL SUMMARY');
  console.log('='.repeat(70));

  const s = aggregateStats;

  console.log(`\nTotal public cases: ${s.total_public}`);
  console.log(`Total evaluated: ${s.total_evaluated}`);

  console.log(`\n--- SEVERITY DISTRIBUTION ---`);
  if (s.severity_distribution) {
    for (const [level, count] of Object.entries(s.severity_distribution)) {
      const bar = '#'.repeat(count);
      console.log(`  Level ${level}: ${String(count).padStart(3)} ${bar}`);
    }
  }
  console.log(`  Level 4-5: ${s.severity_level4plus_pct}% of cases`);

  console.log(`\n--- KEY RATES ---`);
  console.log(`  issue_area null:          ${s.issue_area_null_count}/${s.total_public} (${s.issue_area_null_rate_pct}%)`);
  console.log(`  evidence_anchors generic: ${s.evidence_anchor_all_generic_count}/${s.total_public} (${s.evidence_anchor_all_generic_rate_pct}%)`);
  console.log(`  string "null" in fields:  ${s.string_null_count}/${s.total_public} (${s.string_null_rate_pct}%)`);
  console.log(`  phantom dissent:          ${s.phantom_dissent_count}/${s.total_public} (${s.phantom_dissent_rate_pct}%)`);
  console.log(`  generic who_wins/loses:   ${s.generic_party_count}/${s.total_public} (${s.generic_party_rate_pct}%)`);
  console.log(`  similar opener pairs:     ${s.opener_similar_pairs}`);

  console.log(`\n--- CONTRADICTION RATE (KEY KPI) ---`);
  const cr = s.contradiction_rate;
  if (cr && cr.rate_pct !== null) {
    console.log(`  Gold set cases evaluated: ${cr.evaluated}`);
    console.log(`  Contradictions found:     ${cr.contradictions}`);
    console.log(`  Contradiction rate:       ${cr.rate_pct}%`);
  } else {
    console.log(`  (LLM judge not run — use without --no-llm to get this metric)`);
  }

  console.log(`\n--- BLOCKING ERRORS ---`);
  console.log(`  Cases with blocking errors: ${s.blocking_count}/${s.total_evaluated} (${s.blocking_rate_pct}%)`);

  // Gold set detail
  if (goldResults.length > 0) {
    console.log(`\n--- GOLD SET DETAIL ---`);
    for (const r of goldResults) {
      const status = r.blocking ? 'BLOCK' : r.warn_reasons.length > 0 ? 'WARN' : 'PASS';
      console.log(`  [${status}] Case ${r.content_id}:`);
      for (const [dim, val] of Object.entries(r.dimensions)) {
        if (val.status === 'skip') continue;
        const icon = val.status === 'pass' ? 'OK' : val.status === 'warn' ? '!!' : 'XX';
        console.log(`    ${icon} ${dim}: ${val.notes.slice(0, 100)}`);
      }
      if (r.block_reasons.length > 0) {
        console.log(`    BLOCK: ${r.block_reasons.join(', ')}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const config = parseArgs();
  const runId = generateRunId();

  console.log(`Eval Runner v1.0 — ${config.type} eval`);
  console.log(`Run ID: ${runId}`);

  // Initialize clients
  const supabase = initSupabase();
  const openai = initOpenAI(config.noLlm);

  // Load content-type eval module
  let evalModule;
  if (config.type === 'scotus') {
    evalModule = await import('./scotus-eval.js');
  } else {
    console.error(`Unknown eval type: ${config.type}. Available: scotus`);
    process.exit(1);
  }

  // Run eval
  const startTime = Date.now();
  const { goldResults, aggregateResults, aggregateStats } = await evalModule.runScotusEval({
    supabase,
    openai,
    goldOnly: config.goldOnly,
    caseIds: config.caseIds,
    runId,
  });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nEval completed in ${elapsed}s`);

  // Write output files
  writeResults(config.type, runId, goldResults, aggregateResults, aggregateStats);

  // ADO-394: Save raw gold case snapshot alongside eval results
  if (goldResults.length > 0 && evalModule.fetchGoldCaseSnapshots) {
    try {
      const snapshots = await evalModule.fetchGoldCaseSnapshots(supabase);
      const snapshotPath = join(LOGS_DIR, `${config.type}-${runId}-gold-snapshot.json`);
      writeFileSync(snapshotPath, JSON.stringify(snapshots, null, 2), 'utf-8');
      console.log(`Gold snapshot written: ${snapshotPath}`);
    } catch (err) {
      console.log(`Warning: Could not save gold snapshot: ${err.message}`);
    }
  }

  // Print summary
  printSummary(goldResults, aggregateStats);

  // Cost estimate — count non-skipped LLM judge dimensions
  let actualLlmCalls = 0;
  for (const r of goldResults) {
    for (const dim of ['D1_severity_congruence', 'D3_tone_alignment', 'D6_factual_accuracy']) {
      if (r.dimensions[dim] && r.dimensions[dim].status !== 'skip') {
        actualLlmCalls++;
      }
    }
  }
  const estimatedCost = actualLlmCalls * 0.0002;
  console.log(`\nEstimated LLM cost: ~$${estimatedCost.toFixed(4)} (${actualLlmCalls} judge calls)`);
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
