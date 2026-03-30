/**
 * SCOTUS Scout Validator
 *
 * Deterministic validation of parsed Scout output.
 * Checks: required fields, enum validity, consistency, source quality.
 * May downgrade status from "ok" to "uncertain".
 */

import { VALID_DISPOSITIONS, VALID_OPINION_TYPES, VALID_ISSUE_AREAS } from './scout-parser.js';

// ============================================================
// Error codes — stable contracts (do not rename or remove)
// New codes can be added freely; existing codes are frozen.
// Retry logic in scotus-scout.js keys on these codes.
// ============================================================

export const SCOUT_ERROR_CODES = {
  MISSING_DISPOSITION:         'MISSING_DISPOSITION',
  MISSING_VOTE_SPLIT:          'MISSING_VOTE_SPLIT',
  MISSING_MAJORITY_AUTHOR:     'MISSING_MAJORITY_AUTHOR',
  MISSING_SUBSTANTIVE_WINNER:  'MISSING_SUBSTANTIVE_WINNER',
  INVALID_DISPOSITION_ENUM:    'INVALID_DISPOSITION_ENUM',
  INVALID_OPINION_TYPE_ENUM:   'INVALID_OPINION_TYPE_ENUM',
  INVALID_ISSUE_AREA_ENUM:     'INVALID_ISSUE_AREA_ENUM',
  INVALID_VOTE_SPLIT_FORMAT:   'INVALID_VOTE_SPLIT_FORMAT',
  VOTE_SPLIT_SUM_EXCEEDS_9:    'VOTE_SPLIT_SUM_EXCEEDS_9',
  UNANIMOUS_WITH_DISSENTERS:   'UNANIMOUS_WITH_DISSENTERS',
  SPLIT_VOTE_NO_DISSENTERS:    'SPLIT_VOTE_NO_DISSENTERS',
  PER_CURIAM_WITH_AUTHOR:      'PER_CURIAM_WITH_AUTHOR',
  VACATED_MIS_NORMALIZED:      'VACATED_MIS_NORMALIZED',
  NO_SOURCE_URLS:              'NO_SOURCE_URLS',
  ONLY_TIER_3_SOURCES:         'ONLY_TIER_3_SOURCES',
};

// Codes that downgrade status from "ok" to "uncertain"
export const BLOCKING_CODES = new Set([
  'MISSING_DISPOSITION', 'MISSING_VOTE_SPLIT', 'MISSING_SUBSTANTIVE_WINNER',
  'INVALID_DISPOSITION_ENUM', 'INVALID_OPINION_TYPE_ENUM',
  'INVALID_VOTE_SPLIT_FORMAT', 'ONLY_TIER_3_SOURCES',
  'UNANIMOUS_WITH_DISSENTERS', 'VACATED_MIS_NORMALIZED',
  'NO_SOURCE_URLS', 'PER_CURIAM_WITH_AUTHOR',
]);

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
 * @returns {{ result: object, issues: Array<{code: string, field: string, message: string, value?: string}>, isValid: boolean }}
 */
export function validateScoutResult(scout) {
  const issues = [];

  // --- Required fields ---
  if (!scout.formal_disposition) {
    issues.push({ code: 'MISSING_DISPOSITION', field: 'formal_disposition', message: 'Missing required field: formal_disposition' });
  }
  if (!scout.vote_split) {
    issues.push({ code: 'MISSING_VOTE_SPLIT', field: 'vote_split', message: 'Missing required field: vote_split' });
  }
  // majority_author can be null for per curiam — only required if opinion_type is "majority" or "plurality"
  if (scout.opinion_type === 'majority' && !scout.majority_author) {
    issues.push({ code: 'MISSING_MAJORITY_AUTHOR', field: 'majority_author', message: 'majority_author is null but opinion_type is "majority"' });
  }
  if (!scout.substantive_winner) {
    issues.push({ code: 'MISSING_SUBSTANTIVE_WINNER', field: 'substantive_winner', message: 'Missing required field: substantive_winner' });
  }

  // --- Enum validity ---
  if (scout.formal_disposition && !VALID_DISPOSITIONS.includes(scout.formal_disposition)) {
    issues.push({ code: 'INVALID_DISPOSITION_ENUM', field: 'formal_disposition', value: scout.formal_disposition, message: `Invalid formal_disposition enum: "${scout.formal_disposition}"` });
  }
  if (scout.opinion_type && !VALID_OPINION_TYPES.includes(scout.opinion_type)) {
    issues.push({ code: 'INVALID_OPINION_TYPE_ENUM', field: 'opinion_type', value: scout.opinion_type, message: `Invalid opinion_type enum: "${scout.opinion_type}"` });
  }
  if (scout.issue_area && !VALID_ISSUE_AREAS.includes(scout.issue_area)) {
    issues.push({ code: 'INVALID_ISSUE_AREA_ENUM', field: 'issue_area', value: scout.issue_area, message: `Invalid issue_area enum: "${scout.issue_area}"` });
  }

  // --- Vote split format ---
  if (scout.vote_split) {
    const match = scout.vote_split.match(/^(\d+)-(\d+)$/);
    if (!match) {
      issues.push({ code: 'INVALID_VOTE_SPLIT_FORMAT', field: 'vote_split', value: scout.vote_split, message: `vote_split not in N-N format: "${scout.vote_split}"` });
    } else {
      const total = parseInt(match[1]) + parseInt(match[2]);
      if (total > 9) {
        issues.push({ code: 'VOTE_SPLIT_SUM_EXCEEDS_9', field: 'vote_split', value: scout.vote_split, message: `vote_split sums to ${total} (max 9): "${scout.vote_split}"` });
      }
    }
  }

  // --- Consistency rules ---

  // Unanimous => no dissent authors
  if (scout.vote_split) {
    const parts = scout.vote_split.split('-').map(Number);
    const isUnanimous = parts[1] === 0;
    if (isUnanimous && scout.dissent_authors && scout.dissent_authors.length > 0) {
      issues.push({ code: 'UNANIMOUS_WITH_DISSENTERS', field: 'dissent_authors', message: `Unanimous vote (${scout.vote_split}) but dissent_authors is non-empty: [${scout.dissent_authors.join(', ')}]` });
    }
    // Split vote => should have dissent authors (warning, not blocking)
    if (!isUnanimous && (!scout.dissent_authors || scout.dissent_authors.length === 0)) {
      issues.push({ code: 'SPLIT_VOTE_NO_DISSENTERS', field: 'dissent_authors', message: `Split vote (${scout.vote_split}) but no dissent_authors listed` });
    }
  }

  // Per curiam / unsigned => majority_author must be null
  if ((scout.opinion_type === 'per_curiam' || scout.opinion_type === 'unsigned_per_curiam') && scout.majority_author) {
    issues.push({ code: 'PER_CURIAM_WITH_AUTHOR', field: 'majority_author', message: `opinion_type is "${scout.opinion_type}" but majority_author is "${scout.majority_author}" (should be null)` });
  }

  // Vacated must not be normalized into reversed
  // (This is a parser concern, but double-check here)
  if (scout.formal_disposition === 'reversed' && scout.formal_disposition_detail) {
    const detail = scout.formal_disposition_detail.toLowerCase();
    if (detail.includes('vacat')) {
      issues.push({ code: 'VACATED_MIS_NORMALIZED', field: 'formal_disposition', message: 'formal_disposition is "reversed" but detail mentions "vacated" — may be mis-normalized' });
    }
  }

  // --- Source quality ---
  const actualTiers = computeActualSourceTiers(scout.source_urls || []);
  const hasTier1Or2 = actualTiers.includes(1) || actualTiers.includes(2);
  const onlyTier3 = actualTiers.length > 0 && !hasTier1Or2;

  if (!scout.source_urls || scout.source_urls.length === 0) {
    issues.push({ code: 'NO_SOURCE_URLS', field: 'source_urls', message: 'No source URLs provided' });
  }
  if (onlyTier3) {
    issues.push({ code: 'ONLY_TIER_3_SOURCES', field: 'source_urls', message: 'Only Tier 3 (Wikipedia/other) sources — no Tier 1 or Tier 2 corroboration' });
  }

  // --- Determine final status ---
  const hasBlockingIssues = issues.some(i => BLOCKING_CODES.has(i.code));

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
    review_reason: issues.length > 0 ? issues.map(i => i.message).join('; ') : null,
    _actual_source_tiers: actualTiers,
  };

  return {
    result,
    issues,
    isValid: finalStatus === 'ok',
  };
}
