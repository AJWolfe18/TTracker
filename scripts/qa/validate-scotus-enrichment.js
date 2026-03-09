#!/usr/bin/env node

/**
 * SCOTUS Enrichment Validation — Ground Truth Comparison (ADO-438)
 *
 * Queries the Supabase TEST database for 25 fact-checked SCOTUS cases
 * and compares enrichment output against known ground truth values.
 *
 * Ground truth sourced from SCOTUSblog, Wikipedia, and Oyez.
 * Fixture: tests/scotus-gold-truth.json
 *
 * Usage:
 *   node scripts/qa/validate-scotus-enrichment.js
 *   node scripts/qa/validate-scotus-enrichment.js --verbose
 *   node scripts/qa/validate-scotus-enrichment.js --ids=286,51,192
 *
 * Environment:
 *   SUPABASE_TEST_URL          - Required: TEST Supabase URL
 *   SUPABASE_TEST_SERVICE_KEY  - Required: TEST service role key
 *
 * Exit codes:
 *   0 = all checks PASS
 *   1 = one or more checks FAIL
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_TEST_URL or SUPABASE_TEST_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Fields to fetch — minimal egress (no content/embedding)
const SELECT_FIELDS = [
  'id', 'case_name', 'disposition', 'majority_author',
  'dissent_authors', 'vote_split', 'case_type', 'who_wins',
  'enrichment_status',
].join(',');

// ============================================================================
// CLI ARGS
// ============================================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { verbose: false, ids: null };

  for (const arg of args) {
    if (arg === '--verbose' || arg === '-v') {
      config.verbose = true;
    } else if (arg.startsWith('--ids=')) {
      config.ids = arg.split('=')[1].split(',').map(Number).filter(n => !isNaN(n));
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
SCOTUS Enrichment Validator — Compare DB output against ground truth.

Usage:
  node scripts/qa/validate-scotus-enrichment.js              # All 25 cases
  node scripts/qa/validate-scotus-enrichment.js --verbose     # Show PASS details too
  node scripts/qa/validate-scotus-enrichment.js --ids=286,51  # Specific cases only

Environment:
  SUPABASE_TEST_URL / SUPABASE_TEST_SERVICE_KEY
      `);
      process.exit(0);
    }
  }

  return config;
}

// ============================================================================
// GROUND TRUTH LOADER
// ============================================================================

function loadGroundTruth() {
  const truthPath = join(__dirname, '..', '..', 'tests', 'scotus-gold-truth.json');
  const raw = readFileSync(truthPath, 'utf-8');
  const data = JSON.parse(raw);

  // Flatten all case groups into a single array, preserving group info
  const allCases = [];
  for (const c of data.gold_cases) {
    allCases.push({ ...c, group: 'gold' });
  }
  for (const c of data.non_gold_cases) {
    allCases.push({ ...c, group: 'non_gold' });
  }
  for (const c of data.edge_cases) {
    allCases.push({ ...c, group: 'edge' });
  }

  return allCases;
}

// ============================================================================
// COMPARISON HELPERS
// ============================================================================

/**
 * Extract last name from a full justice name.
 * "Ketanji Brown Jackson" -> "Jackson"
 * "Amy Coney Barrett" -> "Barrett"
 * "Neil Gorsuch" -> "Gorsuch"
 */
function extractLastName(fullName) {
  if (!fullName) return null;
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/**
 * Fuzzy match: does the DB author's last name match the expected last name?
 * Handles null on both sides.
 */
function matchAuthorLastName(dbAuthor, expectedLastName) {
  if (expectedLastName === null && dbAuthor === null) return true;
  if (expectedLastName === null && dbAuthor !== null) return false;
  if (expectedLastName !== null && dbAuthor === null) return false;

  const dbLast = extractLastName(dbAuthor);
  return dbLast?.toLowerCase() === expectedLastName.toLowerCase();
}

/**
 * Fuzzy match dissent authors (set comparison, last name only, order-independent).
 * Returns { pass, expected, actual, missing, extra }
 */
function matchDissentAuthors(dbDissents, expectedLastNames) {
  const dbArray = Array.isArray(dbDissents) ? dbDissents : [];
  const expectedSet = new Set(expectedLastNames.map(n => n.toLowerCase()));
  const actualSet = new Set(dbArray.map(n => extractLastName(n)?.toLowerCase()).filter(Boolean));

  const missing = [];
  for (const exp of expectedSet) {
    if (!actualSet.has(exp)) missing.push(exp);
  }

  const extra = [];
  for (const act of actualSet) {
    if (!expectedSet.has(act)) extra.push(act);
  }

  return {
    pass: missing.length === 0 && extra.length === 0,
    expected: [...expectedSet].sort(),
    actual: [...actualSet].sort(),
    missing,
    extra,
  };
}

/**
 * Check who_wins contains at least one of the expected substrings (case-insensitive).
 */
function matchWhoWins(dbWhoWins, expectedContains) {
  if (!expectedContains || expectedContains.length === 0) return { pass: true, reason: 'no check' };
  if (!dbWhoWins) return { pass: false, reason: 'who_wins is null' };

  const lower = dbWhoWins.toLowerCase();
  const matched = expectedContains.filter(s => lower.includes(s.toLowerCase()));

  return {
    pass: matched.length > 0,
    reason: matched.length > 0
      ? `matched: ${matched.join(', ')}`
      : `none of [${expectedContains.join(', ')}] found in "${dbWhoWins}"`,
  };
}

// ============================================================================
// MAIN VALIDATION
// ============================================================================

async function main() {
  const config = parseArgs();
  const truthCases = loadGroundTruth();

  // Filter by --ids if specified
  const casesToCheck = config.ids
    ? truthCases.filter(c => config.ids.includes(c.id))
    : truthCases;

  if (casesToCheck.length === 0) {
    console.error('No cases to validate (check --ids filter)');
    process.exit(1);
  }

  const caseIds = casesToCheck.map(c => c.id);
  console.log(`Validating ${casesToCheck.length} SCOTUS cases against ground truth...\n`);

  // Fetch from DB — single query, minimal fields
  const { data: dbCases, error } = await supabase
    .from('scotus_cases')
    .select(SELECT_FIELDS)
    .in('id', caseIds)
    .order('id', { ascending: true });

  if (error) {
    console.error(`DB query failed: ${error.message}`);
    process.exit(1);
  }

  // Index by ID for fast lookup
  const dbMap = new Map(dbCases.map(c => [c.id, c]));

  let totalChecks = 0;
  let passedChecks = 0;
  let failedChecks = 0;
  const failedDetails = [];

  for (const truth of casesToCheck) {
    const db = dbMap.get(truth.id);

    if (!db) {
      console.log(`\n--- ID ${truth.id} (${truth.label}) [${truth.group}] ---`);
      console.log('  MISSING: Case not found in database');
      failedChecks++;
      totalChecks++;
      failedDetails.push({ id: truth.id, label: truth.label, field: 'exists', expected: 'present', actual: 'missing' });
      continue;
    }

    const results = [];

    // --- disposition ---
    const dispPass = db.disposition?.toLowerCase() === truth.disposition.toLowerCase();
    results.push({
      field: 'disposition',
      pass: dispPass,
      expected: truth.disposition,
      actual: db.disposition,
    });

    // --- majority_author (fuzzy last name) ---
    const authPass = matchAuthorLastName(db.majority_author, truth.majority_author_last);
    results.push({
      field: 'majority_author',
      pass: authPass,
      expected: truth.majority_author_last ?? '(null)',
      actual: db.majority_author ?? '(null)',
    });

    // --- dissent_authors (set comparison, fuzzy) ---
    const dissentResult = matchDissentAuthors(db.dissent_authors, truth.dissent_authors_last);
    results.push({
      field: 'dissent_authors',
      pass: dissentResult.pass,
      expected: dissentResult.expected.join(', ') || '(none)',
      actual: dissentResult.actual.join(', ') || '(none)',
      detail: dissentResult.pass ? null : `missing=[${dissentResult.missing.join(',')}] extra=[${dissentResult.extra.join(',')}]`,
    });

    // --- vote_split ---
    const votePass = db.vote_split === truth.vote_split;
    results.push({
      field: 'vote_split',
      pass: votePass,
      expected: truth.vote_split,
      actual: db.vote_split ?? '(null)',
    });

    // --- case_type ---
    const typePass = db.case_type?.toLowerCase() === truth.case_type.toLowerCase();
    results.push({
      field: 'case_type',
      pass: typePass,
      expected: truth.case_type,
      actual: db.case_type ?? '(null)',
    });

    // --- Gold-only checks ---
    if (truth.group === 'gold') {
      // who_wins contains check
      const whoWinsResult = matchWhoWins(db.who_wins, truth.who_wins_contains);
      results.push({
        field: 'who_wins',
        pass: whoWinsResult.pass,
        expected: `contains one of [${truth.who_wins_contains.join(', ')}]`,
        actual: db.who_wins ?? '(null)',
        detail: whoWinsResult.pass ? null : whoWinsResult.reason,
      });

      // enrichment_status check
      const statusPass = db.enrichment_status === truth.enrichment_status;
      results.push({
        field: 'enrichment_status',
        pass: statusPass,
        expected: truth.enrichment_status,
        actual: db.enrichment_status ?? '(null)',
      });
    }

    // --- Print results ---
    const caseLabel = `ID ${truth.id} (${truth.label}) [${truth.group}]`;
    const caseFails = results.filter(r => !r.pass);

    if (caseFails.length === 0) {
      if (config.verbose) {
        console.log(`\n--- ${caseLabel} ---`);
        for (const r of results) {
          console.log(`  PASS  ${r.field.padEnd(20)} expected=${r.expected}  actual=${r.actual}`);
        }
      } else {
        console.log(`  PASS  ${caseLabel} (${results.length}/${results.length} fields)`);
      }
    } else {
      console.log(`\n--- ${caseLabel} ---`);
      for (const r of results) {
        const status = r.pass ? 'PASS' : 'FAIL';
        const line = `  ${status}  ${r.field.padEnd(20)} expected=${r.expected}  actual=${r.actual}`;
        console.log(line);
        if (!r.pass && r.detail) {
          console.log(`        ${' '.padEnd(20)} ${r.detail}`);
        }
      }
    }

    for (const r of results) {
      totalChecks++;
      if (r.pass) {
        passedChecks++;
      } else {
        failedChecks++;
        failedDetails.push({
          id: truth.id,
          label: truth.label,
          field: r.field,
          expected: r.expected,
          actual: r.actual,
          detail: r.detail,
        });
      }
    }
  }

  // ============================================================================
  // AGGREGATE SUMMARY
  // ============================================================================

  console.log('\n' + '='.repeat(60));
  console.log(`SCOTUS Enrichment Validation Summary`);
  console.log('='.repeat(60));
  console.log(`Cases checked:  ${casesToCheck.length}`);
  console.log(`Cases in DB:    ${dbCases.length}`);
  console.log(`Total checks:   ${totalChecks}`);
  console.log(`Passed:         ${passedChecks}/${totalChecks}`);
  console.log(`Failed:         ${failedChecks}/${totalChecks}`);
  console.log(`Pass rate:      ${totalChecks > 0 ? ((passedChecks / totalChecks) * 100).toFixed(1) : 0}%`);

  if (failedDetails.length > 0) {
    console.log(`\nFailed checks:`);
    for (const f of failedDetails) {
      console.log(`  - ID ${f.id} (${f.label}): ${f.field} expected=${f.expected} actual=${f.actual}`);
    }
  }

  console.log('='.repeat(60));

  if (failedChecks > 0) {
    console.log(`\nRESULT: FAIL (${failedChecks} checks failed)`);
    process.exit(1);
  } else {
    console.log(`\nRESULT: PASS (${passedChecks}/${totalChecks} checks passed)`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Validation failed:', err.message);
  process.exit(1);
});
