#!/usr/bin/env node

/**
 * Eval CLI Runner
 *
 * Restored from git history (pre-2c7572f, where the scotus-only harness was
 * retired along with the legacy GPT enrichment) and generalized: eval types
 * now live in a registry and declare their own client needs. The clustering
 * eval runs fully offline from precomputed data in its gold-set file — no
 * Supabase or OpenAI clients required (egress rule #11).
 *
 * Usage:
 *   node scripts/evals/run-eval.js --type=clustering              # Full baseline
 *   node scripts/evals/run-eval.js --type=clustering --ids=gs-001,gs-002
 *
 * Output:
 *   logs/evals/<type>-<run_id>.jsonl          (per-item results)
 *   logs/evals/<type>-<run_id>-summary.json   (aggregate stats)
 */

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', '..', 'logs', 'evals');

// ============================================================================
// EVAL TYPE REGISTRY
// ============================================================================
// scotus/pardons/eos GPT-enrichment evals were retired in commit 2c7572f when
// enrichment moved to Claude cloud agents (gold sets live in the agent prompts).
// New eval types register here and export: runEval({ runId, args }) →
//   { results: object[], stats: object, printSummary(): void }

const EVAL_TYPES = {
  clustering: {
    module: './clustering-eval.js',
    description: 'Clustering gold-set replay: precision/recall/F1 of the deterministic attach decision (ADO-532)',
  },
};

// ============================================================================
// CLI ARGUMENT PARSING
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    type: null,
    ids: null,          // subset of gold-set entry ids
    verbose: false,     // per-pair detail lines
    disagreementsOnly: false, // only print pairs where prediction != label
  };

  for (const arg of args) {
    if (arg.startsWith('--type=')) {
      config.type = arg.split('=')[1];
    } else if (arg.startsWith('--ids=')) {
      config.ids = arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
    } else if (arg === '--verbose') {
      config.verbose = true;
    } else if (arg === '--disagreements-only') {
      config.disagreementsOnly = true;
    } else if (arg === '--help' || arg === '-h') {
      const typeList = Object.entries(EVAL_TYPES)
        .map(([name, t]) => `  ${name.padEnd(12)} ${t.description}`)
        .join('\n');
      console.log(`
Eval Runner — Measure quality against gold sets.

Usage:
  node scripts/evals/run-eval.js --type=<type> [options]

Types:
${typeList}

Options:
  --ids=<ids>            Evaluate specific gold-set entry ids (comma-separated)
  --verbose              Print per-item detail
  --disagreements-only   Print only items where prediction != label
  --help                 Show this help message
`);
      process.exit(0);
    }
  }

  return config;
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

function writeResults(type, runId, results, stats) {
  mkdirSync(LOGS_DIR, { recursive: true });

  const baseName = `${type}-${runId}`;

  // JSONL: one line per evaluated item
  const jsonlPath = join(LOGS_DIR, `${baseName}.jsonl`);
  const lines = results.map(r => JSON.stringify(r));
  writeFileSync(jsonlPath, lines.join('\n') + '\n', 'utf-8');
  console.log(`\nJSONL written: ${jsonlPath} (${results.length} records)`);

  // Summary JSON
  const summaryPath = join(LOGS_DIR, `${baseName}-summary.json`);
  const summary = {
    run_id: runId,
    content_type: type,
    timestamp: new Date().toISOString(),
    evaluated_count: results.length,
    stats,
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Summary written: ${summaryPath}`);

  return { jsonlPath, summaryPath };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const config = parseArgs();

  if (!config.type || !EVAL_TYPES[config.type]) {
    const available = Object.keys(EVAL_TYPES).join(', ');
    console.error(`Unknown or missing eval type: ${config.type ?? '(none)'}. Available: ${available}`);
    process.exit(1);
  }

  const runId = generateRunId();
  console.log(`Eval Runner — ${config.type} eval`);
  console.log(`Run ID: ${runId}`);

  const evalModule = await import(EVAL_TYPES[config.type].module);

  const startTime = Date.now();
  const { results, stats, printSummary } = await evalModule.runEval({ runId, args: config });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nEval completed in ${elapsed}s`);

  writeResults(config.type, runId, results, stats);

  if (typeof printSummary === 'function') {
    printSummary();
  }
}

main().catch(err => {
  console.error('Eval failed:', err);
  process.exit(1);
});
