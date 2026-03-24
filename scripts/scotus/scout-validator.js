/**
 * SCOTUS Scout Validator
 *
 * Deterministic validation of parsed Scout output.
 * Checks: required fields, enum validity, consistency, source quality.
 * May downgrade status from "ok" to "uncertain".
 */

import { VALID_DISPOSITIONS, VALID_OPINION_TYPES, VALID_ISSUE_AREAS } from './scout-parser.js';

// ============================================================
// Source tier classification
// ============================================================

const TIER_1_PATTERNS = [
  /supremecourt\.gov/i,
  /courtlistener\.com/i,
];

const TIER_2_PATTERNS = [
  /scotusblog\.com/i,
  /oyez\.org/i,
];

const TIER_3_PATTERNS = [
  /wikipedia\.org/i,
];

/**
 * Classify a URL into source tier (1, 2, or 3)
 */
function classifySourceTier(url) {
  if (!url || typeof url !== 'string') return 3;
  for (const p of TIER_1_PATTERNS) {
    if (p.test(url)) return 1;
  }
  for (const p of TIER_2_PATTERNS) {
    if (p.test(url)) return 2;
  }
  return 3;
}

/**
 * Determine actual source tiers from URLs (independent of what Scout self-reported)
 */
function computeActualSourceTiers(urls) {
  const tiers = new Set();
  for (const url of urls) {
    tiers.add(classifySourceTier(url));
  }
  return [...tiers].sort();
}

// ============================================================
// Validator
// ============================================================

/**
 * Validate parsed Scout output. Returns validated result with potentially downgraded status.
 *
 * @param {object} scout - Parsed Scout output from scout-parser.js
 * @returns {{ result: object, issues: string[], isValid: boolean }}
 */
export function validateScoutResult(scout) {
  const issues = [];

  // --- Required fields ---
  if (!scout.formal_disposition) {
    issues.push('Missing required field: formal_disposition');
  }
  if (!scout.vote_split) {
    issues.push('Missing required field: vote_split');
  }
  // majority_author can be null for per curiam — only required if opinion_type is "majority" or "plurality"
  if (scout.opinion_type === 'majority' && !scout.majority_author) {
    issues.push('majority_author is null but opinion_type is "majority"');
  }
  if (!scout.substantive_winner) {
    issues.push('Missing required field: substantive_winner');
  }

  // --- Enum validity ---
  if (scout.formal_disposition && !VALID_DISPOSITIONS.includes(scout.formal_disposition)) {
    issues.push(`Invalid formal_disposition enum: "${scout.formal_disposition}"`);
  }
  if (scout.opinion_type && !VALID_OPINION_TYPES.includes(scout.opinion_type)) {
    issues.push(`Invalid opinion_type enum: "${scout.opinion_type}"`);
  }
  if (scout.issue_area && !VALID_ISSUE_AREAS.includes(scout.issue_area)) {
    issues.push(`Invalid issue_area enum: "${scout.issue_area}"`);
  }

  // --- Vote split format ---
  if (scout.vote_split) {
    const match = scout.vote_split.match(/^(\d+)-(\d+)$/);
    if (!match) {
      issues.push(`vote_split not in N-N format: "${scout.vote_split}"`);
    } else {
      const total = parseInt(match[1]) + parseInt(match[2]);
      if (total > 9) {
        issues.push(`vote_split sums to ${total} (max 9): "${scout.vote_split}"`);
      }
    }
  }

  // --- Consistency rules ---

  // Unanimous => no dissent authors
  if (scout.vote_split) {
    const parts = scout.vote_split.split('-').map(Number);
    const isUnanimous = parts[1] === 0;
    if (isUnanimous && scout.dissent_authors && scout.dissent_authors.length > 0) {
      issues.push(`Unanimous vote (${scout.vote_split}) but dissent_authors is non-empty: [${scout.dissent_authors.join(', ')}]`);
    }
    // Split vote => should have dissent authors (warning, not blocking)
    if (!isUnanimous && (!scout.dissent_authors || scout.dissent_authors.length === 0)) {
      issues.push(`Split vote (${scout.vote_split}) but no dissent_authors listed`);
    }
  }

  // Per curiam / unsigned => majority_author must be null
  if ((scout.opinion_type === 'per_curiam' || scout.opinion_type === 'unsigned_per_curiam') && scout.majority_author) {
    issues.push(`opinion_type is "${scout.opinion_type}" but majority_author is "${scout.majority_author}" (should be null)`);
  }

  // Vacated must not be normalized into reversed
  // (This is a parser concern, but double-check here)
  if (scout.formal_disposition === 'reversed' && scout.formal_disposition_detail) {
    const detail = scout.formal_disposition_detail.toLowerCase();
    if (detail.includes('vacat')) {
      issues.push('formal_disposition is "reversed" but detail mentions "vacated" — may be mis-normalized');
    }
  }

  // --- Source quality ---
  const actualTiers = computeActualSourceTiers(scout.source_urls || []);
  const hasTier1Or2 = actualTiers.includes(1) || actualTiers.includes(2);
  const onlyTier3 = actualTiers.length > 0 && !hasTier1Or2;

  if (!scout.source_urls || scout.source_urls.length === 0) {
    issues.push('No source URLs provided');
  }
  if (onlyTier3) {
    issues.push('Only Tier 3 (Wikipedia/other) sources — no Tier 1 or Tier 2 corroboration');
  }

  // --- Determine final status ---
  const hasBlockingIssues = issues.some(i =>
    i.startsWith('Missing required field') ||
    i.startsWith('Invalid formal_disposition enum') ||
    i.startsWith('Invalid opinion_type enum') ||
    i.startsWith('vote_split not in N-N format') ||
    i.includes('Only Tier 3') ||
    i.includes('Unanimous vote') ||
    i.includes('may be mis-normalized') ||
    i.includes('No source URLs') ||
    i.includes('should be null')
  );

  let finalStatus = scout.status;
  if (scout.status === 'failed') {
    // Already failed, keep it
  } else if (hasBlockingIssues) {
    finalStatus = 'uncertain';
  }

  const result = {
    ...scout,
    status: finalStatus,
    needs_review: finalStatus !== 'ok',
    review_reason: issues.length > 0 ? issues.join('; ') : null,
    _actual_source_tiers: actualTiers,
  };

  return {
    result,
    issues,
    isValid: finalStatus === 'ok',
  };
}
