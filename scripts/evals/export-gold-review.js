/**
 * Export Gold Set Review CSV + JSON Snapshot (ADO-394)
 *
 * Produces two files for human review:
 *   1. CSV with Josh's exact column spec (one row per gold case)
 *   2. JSON snapshot of raw enrichment output per gold case
 *
 * Usage:
 *   node scripts/evals/export-gold-review.js
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = join(__dirname, '..', '..', 'logs', 'evals');

// ============================================================================
// CONFIG
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_TEST_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_TEST_URL or SUPABASE_TEST_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// GOLD SET
// ============================================================================

function loadGoldSet() {
  const goldPath = join(__dirname, '..', 'scotus', 'gold-set.json');
  return JSON.parse(readFileSync(goldPath, 'utf-8')).cases;
}

// ============================================================================
// EVAL FLAGS (deterministic, no LLM)
// ============================================================================

/**
 * Extract justice names mentioned in dissent_highlights text
 */
function extractDissentMentions(text) {
  if (!text || typeof text !== 'string') return [];
  const names = new Set();
  const justicePattern = /(?:Justice|J\.|Judge)\s+([A-Z][a-z]+)/g;
  let match;
  while ((match = justicePattern.exec(text)) !== null) {
    names.add(match[1]);
  }
  return [...names];
}

/**
 * Check if evidence anchors contain at least one real quote (not a generic section label)
 */
function hasRealQuote(anchors) {
  if (!anchors || !Array.isArray(anchors)) return false;
  const GENERIC = [
    /^syllabus$/i, /^majority\s*§?\s*[IVX\d–-]+$/i, /^dissent[,\s]/i,
    /^concurrence[,\s]/i, /^majority\s+opinion$/i, /^(majority|dissent|concurrence)$/i,
  ];
  return anchors.some(a => !GENERIC.some(p => p.test(a.trim())) && a.trim().length >= 10);
}

/**
 * Check if who_wins/who_loses have internal contradictions
 * (winning language in loses, losing language in wins)
 */
function checkWinnerLoserContradiction(whoWins, whoLoses) {
  const losingInWins = whoWins && /\b(lose|loses|lost|denied|limits?\s+(his|her|their|the)\s+ability|cannot|unable)\b/i.test(whoWins);
  const winningInLoses = whoLoses && /^[^.]*\b(wins|gains|benefits|prevails|succeeds)\b/i.test(whoLoses);
  return losingInWins || winningInLoses;
}

/**
 * Check dissent integrity: highlights present when metadata says no dissent
 */
function checkDissentIntegrity(c) {
  const hasHighlights = c.dissent_highlights && typeof c.dissent_highlights === 'string' && c.dissent_highlights.trim().length > 10;
  const noMetadata = !c.dissent_exists && (!c.dissent_authors || c.dissent_authors.length === 0);
  return hasHighlights && noMetadata;
}

// ============================================================================
// CSV HELPERS
// ============================================================================

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvRow(fields) {
  return fields.map(csvEscape).join(',');
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const goldCases = loadGoldSet();
  const goldIds = goldCases.map(g => g.case_id);

  console.log(`\n📋 Gold Set Review Export (ADO-394)`);
  console.log(`   Gold cases: ${goldIds.length} [${goldIds.join(', ')}]\n`);

  // Fetch all gold cases from DB (regardless of is_public or enrichment_status)
  const { data: dbCases, error } = await supabase
    .from('scotus_cases')
    .select(`
      id, case_name, decided_at, majority_author, vote_split,
      dissent_exists, dissent_authors, enrichment_status,
      ruling_impact_level, ruling_label, issue_area,
      who_wins, who_loses, summary_spicy, why_it_matters,
      dissent_highlights, evidence_anchors, evidence_quotes,
      prompt_version, holding, prevailing_party, practical_effect,
      disposition, merits_reached, case_type,
      is_public, needs_manual_review, clamp_reason
    `)
    .in('id', goldIds)
    .order('id');

  if (error) {
    console.error('Failed to fetch cases:', error.message);
    process.exit(1);
  }

  // Build lookup by case_id
  const dbMap = new Map(dbCases.map(c => [c.id, c]));

  // ---- CSV ----
  const headers = [
    // Identifiers
    'case_id', 'case_name', 'decided_at', 'majority_author', 'vote_split',
    'dissent_exists', 'dissent_authors', 'enrichment_status',
    'prompt_version', 'model',
    // Expected vs Actual
    'expected_level_min', 'expected_level_max', 'actual_ruling_impact_level', 'actual_ruling_label',
    'expected_issue_area', 'actual_issue_area',
    'expected_winner', 'actual_who_wins',
    'expected_loser', 'actual_who_loses',
    'expected_dissent_expected', 'actual_dissent_highlights', 'actual_dissent_mentions',
    'expected_quote_required', 'actual_evidence_anchor_count', 'actual_evidence_anchor_has_real_quote',
    // Eval flags
    'fail_dissent_integrity', 'fail_winner_loser_specificity', 'fail_internal_contradiction',
    'fail_quote_integrity', 'severity_out_of_expected_range',
    // Notes
    'notes',
  ];

  const rows = [csvRow(headers)];
  const jsonSnapshot = [];

  for (const gold of goldCases) {
    const c = dbMap.get(gold.case_id);
    if (!c) {
      console.log(`   ⚠️ Case ${gold.case_id} not found in DB`);
      continue;
    }

    const actualLevel = c.ruling_impact_level;
    const dissentMentions = extractDissentMentions(c.dissent_highlights);
    const anchorCount = Array.isArray(c.evidence_anchors) ? c.evidence_anchors.length : 0;
    const hasReal = hasRealQuote(c.evidence_anchors);

    // Eval flags
    const failDissent = checkDissentIntegrity(c);
    const failWinnerLoser = !c.who_wins || c.who_wins.length < 10 || !c.who_loses || c.who_loses.length < 10;
    const failContradiction = checkWinnerLoserContradiction(c.who_wins, c.who_loses);
    const failQuote = anchorCount > 0 && !hasReal;
    const severityOOR = actualLevel !== null && (actualLevel < gold.expected_level_range[0] || actualLevel > gold.expected_level_range[1]);

    // Build notes
    const notes = [];
    if (c.enrichment_status === 'failed') notes.push(`ENRICHMENT FAILED: ${c.clamp_reason || 'validation error'}`);
    if (c.enrichment_status === 'flagged') notes.push(`FLAGGED: Pass 1 low confidence`);
    if (failDissent) notes.push('Phantom dissent: highlights present but metadata says no dissent');
    if (failContradiction) notes.push('who_wins/who_loses contain contradictory language');
    if (severityOOR) notes.push(`Severity ${actualLevel} outside expected [${gold.expected_level_range[0]}-${gold.expected_level_range[1]}]`);

    const row = [
      // Identifiers
      c.id,
      c.case_name,
      c.decided_at,
      c.majority_author,
      c.vote_split,
      c.dissent_exists,
      (c.dissent_authors || []).join('; '),
      c.enrichment_status,
      c.prompt_version,
      'gpt-4o-mini',
      // Expected vs Actual
      gold.expected_level_range[0],
      gold.expected_level_range[1],
      actualLevel,
      c.ruling_label,
      gold.expected_issue_area,
      c.issue_area,
      gold.expected_winner,
      c.who_wins,
      gold.expected_loser,
      c.who_loses,
      gold.dissent_expected,
      c.dissent_highlights,
      dissentMentions.join('; '),
      'true',  // All gold cases have opinion text
      anchorCount,
      hasReal,
      // Eval flags
      failDissent,
      failWinnerLoser,
      failContradiction,
      failQuote,
      severityOOR,
      // Notes
      notes.join(' | '),
    ];

    rows.push(csvRow(row));

    // JSON snapshot: all enrichment fields
    jsonSnapshot.push({
      case_id: c.id,
      case_name: c.case_name,
      decided_at: c.decided_at,
      enrichment_status: c.enrichment_status,
      gold_expectations: gold,
      actual_enrichment: {
        ruling_impact_level: c.ruling_impact_level,
        ruling_label: c.ruling_label,
        issue_area: c.issue_area,
        who_wins: c.who_wins,
        who_loses: c.who_loses,
        summary_spicy: c.summary_spicy,
        why_it_matters: c.why_it_matters,
        dissent_highlights: c.dissent_highlights,
        evidence_anchors: c.evidence_anchors,
        evidence_quotes: c.evidence_quotes,
        prompt_version: c.prompt_version,
        disposition: c.disposition,
        holding: c.holding,
        prevailing_party: c.prevailing_party,
        practical_effect: c.practical_effect,
        case_type: c.case_type,
        merits_reached: c.merits_reached,
      },
      metadata: {
        majority_author: c.majority_author,
        vote_split: c.vote_split,
        dissent_exists: c.dissent_exists,
        dissent_authors: c.dissent_authors,
        is_public: c.is_public,
        needs_manual_review: c.needs_manual_review,
        clamp_reason: c.clamp_reason,
      },
      eval_flags: {
        fail_dissent_integrity: failDissent,
        fail_winner_loser_specificity: failWinnerLoser,
        fail_internal_contradiction: failContradiction,
        fail_quote_integrity: failQuote,
        severity_out_of_expected_range: severityOOR,
      },
    });

    const statusEmoji = c.enrichment_status === 'enriched' ? '✅' :
                        c.enrichment_status === 'failed' ? '❌' : '⚠️';
    const flags = [
      failDissent ? 'DISS' : null,
      failContradiction ? 'W/L' : null,
      failQuote ? 'QUOTE' : null,
      severityOOR ? 'SEV' : null,
    ].filter(Boolean);

    console.log(`   ${statusEmoji} Case ${c.id} (${c.case_name.slice(0, 40)}...) ` +
      `level=${actualLevel ?? 'N/A'} ` +
      `${flags.length > 0 ? 'flags=[' + flags.join(',') + ']' : 'no flags'}`);
  }

  // Write files
  mkdirSync(LOGS_DIR, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const csvPath = join(LOGS_DIR, `gold-set-review-${today}.csv`);
  const jsonPath = join(LOGS_DIR, `gold-set-snapshot-${today}.json`);

  writeFileSync(csvPath, rows.join('\n'), 'utf-8');
  writeFileSync(jsonPath, JSON.stringify(jsonSnapshot, null, 2), 'utf-8');

  console.log(`\n📄 CSV written: ${csvPath}`);
  console.log(`📦 JSON snapshot written: ${jsonPath}`);
  console.log(`\n   ${rows.length - 1} cases exported.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
