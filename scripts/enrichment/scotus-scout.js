#!/usr/bin/env node
/**
 * SCOTUS Scout — Perplexity-powered fact extraction for SCOTUS cases
 *
 * Replaces GPT Pass 1 with a validated, source-tiered extraction subsystem.
 * Scout owns factual fields only; Pass 2 Writer remains the editorial layer.
 *
 * Usage:
 *   node scripts/enrichment/scotus-scout.js --dry-run --ids=51,64,137
 *   node scripts/enrichment/scotus-scout.js --dry-run --gold-set
 *   node scripts/enrichment/scotus-scout.js --dry-run --limit=20
 *   node scripts/enrichment/scotus-scout.js --dry-run --all
 *   node scripts/enrichment/scotus-scout.js --ids=51 --write-fields=formal_disposition,vote_split
 *   node scripts/enrichment/scotus-scout.js --dry-run --output-json=results.json
 *   node scripts/enrichment/scotus-scout.js --dry-run --fail-on-uncertain
 *   node scripts/enrichment/scotus-scout.js --dry-run --show-sources
 *
 * Environment:
 *   SUPABASE_URL / SUPABASE_TEST_URL
 *   SUPABASE_SERVICE_ROLE_KEY / SUPABASE_TEST_SERVICE_KEY
 *   PERPLEXITY_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { PerplexityClient } from './perplexity-client.js';
import { buildScoutPrompt, SCOUT_PROMPT_VERSION, SCOUT_SYSTEM_PROMPT } from '../scotus/scout-prompt.js';
import { parseScoutResponse } from '../scotus/scout-parser.js';
import { validateScoutResult } from '../scotus/scout-validator.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================
// Constants
// ============================================================

const DELAY_BETWEEN_CALLS_MS = 2000;
const RUNTIME_LIMIT_MS = 8 * 60 * 1000; // 8 minutes

// Scout-owned DB fields (only these get written in live mode)
const SCOUT_DB_FIELDS = [
  'disposition',        // ← formal_disposition
  'vote_split',
  'majority_author',
  'dissent_authors',
  'prevailing_party',   // ← substantive_winner
  'practical_effect',
  'holding',
  'issue_area',
  'case_type',          // derived from opinion_type/disposition
  'merits_reached',     // derived
];

// Metadata fields written alongside facts
const SCOUT_META_FIELDS = [
  'fact_extraction_confidence',
  'low_confidence_reason',
  'prompt_version',
];

// ============================================================
// Gold set loader
// ============================================================

function loadGoldSet() {
  const goldPath = resolve(__dirname, '../../tests/scotus-gold-truth.json');
  const raw = JSON.parse(readFileSync(goldPath, 'utf-8'));
  // Flatten all categories
  return [
    ...(raw.gold_cases || []),
    ...(raw.non_gold_cases || []),
    ...(raw.edge_cases || []),
  ];
}

// ============================================================
// CLI arg parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: args.includes('--dry-run'),
    goldSet: args.includes('--gold-set'),
    all: args.includes('--all'),
    showSources: args.includes('--show-sources'),
    failOnUncertain: args.includes('--fail-on-uncertain'),
    ids: null,
    limit: null,
    writeFields: null,
    outputJson: null,
  };

  for (const arg of args) {
    if (arg.startsWith('--ids=')) {
      opts.ids = arg.split('=')[1].split(',').map(Number).filter(n => !isNaN(n));
    }
    if (arg.startsWith('--limit=')) {
      opts.limit = parseInt(arg.split('=')[1], 10);
    }
    if (arg.startsWith('--write-fields=')) {
      opts.writeFields = arg.split('=')[1].split(',');
    }
    if (arg.startsWith('--output-json=')) {
      opts.outputJson = arg.split('=')[1];
    }
  }

  // Validate --ids
  if (opts.ids && opts.ids.length === 0) {
    console.error('Error: --ids provided but no valid numeric IDs found');
    process.exit(1);
  }

  // Validate --write-fields
  if (opts.writeFields) {
    const validWriteFields = [
      'disposition', 'vote_split', 'majority_author', 'dissent_authors',
      'prevailing_party', 'practical_effect', 'holding', 'issue_area',
      'case_type', 'merits_reached',
    ];
    const invalid = opts.writeFields.filter(f => !validWriteFields.includes(f));
    if (invalid.length > 0) {
      console.error(`Error: Unknown --write-fields: ${invalid.join(', ')}`);
      console.error(`  Valid fields: ${validWriteFields.join(', ')}`);
      process.exit(1);
    }
  }

  return opts;
}

// ============================================================
// DB helpers
// ============================================================

async function fetchCases(supabase, opts) {
  const select = 'id,case_name,case_name_short,case_name_full,docket_number,term,decided_at,disposition,vote_split,majority_author,dissent_authors,prevailing_party,holding,issue_area,case_type,enrichment_status';

  let query = supabase.from('scotus_cases').select(select);

  if (opts.ids) {
    query = query.in('id', opts.ids);
  } else if (opts.all) {
    // No filter
  } else if (opts.goldSet) {
    const goldIds = loadGoldSet().map(c => c.id);
    query = query.in('id', goldIds);
  }

  query = query.order('id', { ascending: true });

  if (opts.limit) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to fetch cases: ${error.message}`);
  return data || [];
}

// ============================================================
// Gold set comparison
// ============================================================

function compareToGoldSet(scoutResult, caseId) {
  const goldCases = loadGoldSet();
  const gold = goldCases.find(g => g.id === caseId);
  if (!gold) return null;

  const diffs = [];

  // Disposition — map Scout formal_disposition to gold's disposition field
  if (gold.disposition && scoutResult.formal_disposition) {
    // Gold uses simple names; Scout uses underscored names
    const scoutDisp = scoutResult.formal_disposition.replace(/_/g, ' ');
    const goldDisp = gold.disposition;
    // Special case: gold may say "vacated" where scout says "vacated_and_remanded"
    const match = scoutDisp === goldDisp ||
      scoutResult.formal_disposition === goldDisp ||
      (goldDisp === 'vacated' && scoutResult.formal_disposition.startsWith('vacated'));
    if (!match) {
      diffs.push({ field: 'disposition', gold: goldDisp, scout: scoutResult.formal_disposition });
    }
  }

  // Vote split
  if (gold.vote_split && scoutResult.vote_split && gold.vote_split !== scoutResult.vote_split) {
    diffs.push({ field: 'vote_split', gold: gold.vote_split, scout: scoutResult.vote_split });
  }

  // Majority author
  if (gold.majority_author_last !== undefined) {
    if (gold.majority_author_last !== scoutResult.majority_author) {
      diffs.push({ field: 'majority_author', gold: gold.majority_author_last, scout: scoutResult.majority_author });
    }
  }

  // Dissent authors
  if (gold.dissent_authors_last) {
    const goldSet = new Set(gold.dissent_authors_last);
    const scoutSet = new Set(scoutResult.dissent_authors || []);
    const missing = [...goldSet].filter(a => !scoutSet.has(a));
    const extra = [...scoutSet].filter(a => !goldSet.has(a));
    if (missing.length > 0 || extra.length > 0) {
      diffs.push({
        field: 'dissent_authors',
        gold: gold.dissent_authors_last,
        scout: scoutResult.dissent_authors,
        missing,
        extra,
      });
    }
  }

  return { caseId, label: gold.label, diffs, perfect: diffs.length === 0 };
}

// ============================================================
// DB comparison (Scout vs current DB values)
// ============================================================

function compareToDb(scoutResult, dbCase) {
  const diffs = [];
  const fieldMap = [
    ['formal_disposition', 'disposition'],
    ['vote_split', 'vote_split'],
    ['majority_author', 'majority_author'],
    ['dissent_authors', 'dissent_authors'],
    ['substantive_winner', 'prevailing_party'],
    ['holding', 'holding'],
    ['issue_area', 'issue_area'],
  ];

  for (const [scoutField, dbField] of fieldMap) {
    const scoutVal = scoutResult[scoutField];
    const dbVal = dbCase[dbField];

    // Skip if both null/undefined
    if (scoutVal == null && dbVal == null) continue;

    // Array comparison
    if (Array.isArray(scoutVal) || Array.isArray(dbVal)) {
      const a = JSON.stringify(scoutVal || []);
      const b = JSON.stringify(dbVal || []);
      if (a !== b) {
        diffs.push({ field: dbField, db: dbVal, scout: scoutVal });
      }
    } else if (String(scoutVal || '') !== String(dbVal || '')) {
      diffs.push({ field: dbField, db: dbVal, scout: scoutVal });
    }
  }

  return diffs;
}

// ============================================================
// Map Scout result → DB update payload
// ============================================================

function buildDbPayload(scoutResult, writeFields) {
  const payload = {};

  const fieldMap = {
    'disposition': scoutResult.formal_disposition,
    'vote_split': scoutResult.vote_split,
    'majority_author': scoutResult.majority_author,
    'dissent_authors': scoutResult.dissent_authors || [],
    'prevailing_party': scoutResult.substantive_winner,
    'practical_effect': scoutResult.practical_effect,
    'holding': scoutResult.holding,
    'issue_area': scoutResult.issue_area,
  };

  // Derive case_type from opinion_type
  if (scoutResult.opinion_type === 'DIG') {
    fieldMap['case_type'] = 'procedural';
  } else if (scoutResult.formal_disposition === 'GVR') {
    fieldMap['case_type'] = 'merits'; // GVR is technically cert-stage but we treat as merits
  } else {
    fieldMap['case_type'] = 'merits';
  }

  // Derive merits_reached
  fieldMap['merits_reached'] = scoutResult.opinion_type !== 'DIG';

  // Metadata
  const meta = {
    'fact_extraction_confidence': computeOverallConfidence(scoutResult.fact_confidence),
    'low_confidence_reason': scoutResult.review_reason,
    'prompt_version': SCOUT_PROMPT_VERSION,
  };

  // Apply write filter if specified
  const allowedFields = writeFields ? new Set(writeFields) : null;

  for (const [field, value] of Object.entries(fieldMap)) {
    if (!allowedFields || allowedFields.has(field)) {
      payload[field] = value;
    }
  }

  // Always include metadata
  Object.assign(payload, meta);

  return payload;
}

function computeOverallConfidence(conf) {
  if (!conf) return 'low';
  const vals = Object.values(conf);
  if (vals.includes('low')) return 'low';
  if (vals.includes('medium')) return 'medium';
  return 'high';
}

// ============================================================
// Main
// ============================================================

async function main() {
  const opts = parseArgs();

  // Validate environment
  const supabaseUrl = process.env.SUPABASE_URL || process.env.SUPABASE_TEST_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_KEY;
  const perplexityKey = process.env.PERPLEXITY_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if (!perplexityKey) {
    console.error('Missing PERPLEXITY_API_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const perplexity = new PerplexityClient(perplexityKey);

  // Header
  console.log('='.repeat(60));
  console.log('SCOTUS Scout — Perplexity Fact Extraction');
  console.log(`  Prompt: ${SCOUT_PROMPT_VERSION}`);
  console.log(`  Mode: ${opts.dryRun ? 'DRY RUN (no DB writes)' : 'LIVE'}`);
  if (opts.writeFields) console.log(`  Write fields: ${opts.writeFields.join(', ')}`);
  if (opts.goldSet) console.log('  Target: Gold set (25 cases)');
  if (opts.ids) console.log(`  Target: IDs [${opts.ids.join(', ')}]`);
  if (opts.limit) console.log(`  Limit: ${opts.limit}`);
  console.log('='.repeat(60));

  // Fetch cases
  const cases = await fetchCases(supabase, opts);
  console.log(`\nFetched ${cases.length} cases\n`);

  if (cases.length === 0) {
    console.log('No cases to process. Exiting.');
    return;
  }

  // Process each case
  const startTime = Date.now();
  const results = [];
  const stats = { ok: 0, uncertain: 0, failed: 0, parseError: 0, totalCost: 0, written: 0 };

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];

    // Runtime guard
    if (Date.now() - startTime > RUNTIME_LIMIT_MS) {
      console.log('\nRuntime limit reached. Stopping.');
      break;
    }

    console.log(`[${i + 1}/${cases.length}] ${c.case_name_short || c.case_name} (ID: ${c.id})`);

    // Build prompt
    const prompt = buildScoutPrompt(c);

    // Query Perplexity
    let rawContent, usage, citations;
    try {
      const resp = await perplexity.research(prompt, {
        systemPrompt: SCOUT_SYSTEM_PROMPT,
        temperature: 0.2,
        maxTokens: 2000,
      });
      rawContent = resp.content;
      usage = resp.usage;
      citations = resp.citations || [];
    } catch (err) {
      console.log(`  API error: ${err.message}`);
      results.push({ caseId: c.id, label: c.case_name_short, status: 'failed', error: err.message });
      stats.failed++;
      continue;
    }

    const cost = perplexity.calculateCost(usage);
    stats.totalCost += cost;

    // Parse
    const { parsed, parseError } = parseScoutResponse(rawContent, citations);
    if (parseError) {
      console.log(`  Parse error: ${parseError}`);
      results.push({ caseId: c.id, label: c.case_name_short, status: 'failed', error: parseError, rawContent });
      stats.parseError++;
      continue;
    }

    // Validate
    const { result: validated, issues, isValid } = validateScoutResult(parsed);

    // Stats
    stats[validated.status]++;

    // Gold set comparison
    const goldComp = compareToGoldSet(validated, c.id);

    // DB comparison
    const dbDiffs = compareToDb(validated, c);

    // Print summary
    const statusIcon = validated.status === 'ok' ? '+' : validated.status === 'uncertain' ? '?' : 'X';
    console.log(`  [${statusIcon}] status=${validated.status}, disposition=${validated.formal_disposition}, vote=${validated.vote_split}, author=${validated.majority_author}, cost=$${cost.toFixed(4)}`);

    if (issues.length > 0) {
      console.log(`  Issues: ${issues.join('; ')}`);
    }

    if (goldComp) {
      if (goldComp.perfect) {
        console.log(`  Gold: MATCH (${goldComp.label})`);
      } else {
        console.log(`  Gold: MISMATCH (${goldComp.label})`);
        for (const d of goldComp.diffs) {
          console.log(`    ${d.field}: gold="${JSON.stringify(d.gold)}" scout="${JSON.stringify(d.scout)}"`);
        }
      }
    }

    if (dbDiffs.length > 0) {
      console.log(`  DB diffs: ${dbDiffs.length} fields differ`);
      for (const d of dbDiffs) {
        console.log(`    ${d.field}: db="${d.db}" scout="${d.scout}"`);
      }
    }

    if (opts.showSources && validated.source_urls.length > 0) {
      console.log(`  Sources (${validated._actual_source_tiers.map(t => `T${t}`).join(',')}):`);
      for (const url of validated.source_urls) {
        console.log(`    ${url}`);
      }
    }

    // Live write
    if (!opts.dryRun && validated.status === 'ok') {
      const payload = buildDbPayload(validated, opts.writeFields);
      const { error } = await supabase
        .from('scotus_cases')
        .update(payload)
        .eq('id', c.id);

      if (error) {
        console.log(`  DB write error: ${error.message}`);
      } else {
        console.log(`  Written ${Object.keys(payload).length} fields to DB`);
        stats.written++;
      }
    }

    // Collect result
    results.push({
      caseId: c.id,
      label: c.case_name_short || c.case_name,
      status: validated.status,
      scoutResult: validated,
      goldComparison: goldComp,
      dbDiffs,
      issues,
      cost,
    });

    // Delay between calls
    if (i < cases.length - 1) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_CALLS_MS));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SCOTUS Scout Summary');
  console.log(`  OK: ${stats.ok}`);
  console.log(`  Uncertain: ${stats.uncertain}`);
  console.log(`  Failed: ${stats.failed}`);
  console.log(`  Parse errors: ${stats.parseError}`);
  console.log(`  Total cost: $${stats.totalCost.toFixed(4)}`);
  if (!opts.dryRun) console.log(`  Written: ${stats.written}`);
  console.log(`  Duration: ${Math.round((Date.now() - startTime) / 1000)}s`);

  // Gold set summary
  const goldResults = results.filter(r => r.goldComparison);
  if (goldResults.length > 0) {
    const perfect = goldResults.filter(r => r.goldComparison.perfect).length;
    console.log(`  Gold set: ${perfect}/${goldResults.length} perfect match`);
    const mismatches = goldResults.filter(r => !r.goldComparison.perfect);
    if (mismatches.length > 0) {
      console.log('  Gold mismatches:');
      for (const m of mismatches) {
        for (const d of m.goldComparison.diffs) {
          console.log(`    ${m.label} — ${d.field}: gold="${JSON.stringify(d.gold)}" scout="${JSON.stringify(d.scout)}"`);
        }
      }
    }
  }

  console.log('='.repeat(60));

  // Output JSON
  if (opts.outputJson) {
    const outPath = resolve(process.cwd(), opts.outputJson);
    writeFileSync(outPath, JSON.stringify({ stats, results }, null, 2));
    console.log(`\nResults written to ${outPath}`);
  }

  // Exit code
  if (opts.failOnUncertain && stats.uncertain > 0) {
    console.log('\n--fail-on-uncertain: exiting with code 1');
    process.exit(1);
  }
  if (stats.failed > 0 || stats.parseError > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
