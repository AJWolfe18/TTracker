/**
 * Eval System Type Definitions & Verdict Logic
 *
 * Shared across all content-type evals (SCOTUS, Pardons, Stories, EOs).
 * Defines the standard eval output contract.
 *
 * Session 1: Foundation — measurement only, no enforcement.
 */

// Dimension status values
export const STATUS = {
  PASS: 'pass',
  WARN: 'warn',
  FAIL: 'fail',
  SKIP: 'skip', // when check can't run (missing data)
};

/**
 * Create a dimension result
 * @param {string} status - pass|warn|fail|skip
 * @param {string} [notes] - human-readable explanation
 * @param {number|null} [score] - optional numeric score (0-1)
 * @returns {{ status: string, score: number|null, notes: string }}
 */
export function dimResult(status, notes = '', score = null) {
  return { status, score, notes };
}

/**
 * Compute verdict from dimension results
 * @param {Object} dimensions - { D1_name: { status, score, notes }, ... }
 * @param {Object} blockConfig - { D1_name: true|false } - true = blocking dimension
 * @returns {{ blocking: boolean, block_reasons: string[], warn_reasons: string[] }}
 */
export function computeVerdict(dimensions, blockConfig = {}) {
  const block_reasons = [];
  const warn_reasons = [];

  for (const [key, result] of Object.entries(dimensions)) {
    if (!result) continue;
    if (result.status === STATUS.FAIL) {
      if (blockConfig[key]) {
        block_reasons.push(`${key}: ${result.notes}`);
      } else {
        warn_reasons.push(`${key}: ${result.notes}`);
      }
    } else if (result.status === STATUS.WARN) {
      warn_reasons.push(`${key}: ${result.notes}`);
    }
  }

  return {
    blocking: block_reasons.length > 0,
    block_reasons,
    warn_reasons,
  };
}

/**
 * Build a full eval result (standard contract for all content types)
 * @param {Object} params
 * @returns {Object} EvalResult
 */
export function buildEvalResult({
  content_type,
  content_id,
  prompt_version,
  model,
  run_id,
  dimensions,
  blockConfig = {},
}) {
  const verdict = computeVerdict(dimensions, blockConfig);
  return {
    content_type,
    content_id,
    prompt_version: prompt_version || 'unknown',
    model: model || 'gpt-4o-mini',
    run_id,
    timestamp: new Date().toISOString(),
    dimensions,
    ...verdict,
  };
}

/**
 * SCOTUS blocking config — Session 1 measures everything, Session 2 enforces.
 * Listed here as documentation of the future gate policy.
 *
 * BLOCK (hard fail): D6_factual_accuracy, D7_issue_area, D9_dissent_integrity,
 *   D8_evidence_anchors (when source text available), D10_party_specificity
 * WARN ONLY: D1_severity, D3_tone, D5_section_uniqueness, D11_why_grounding
 *
 * NOTE: D2 (severity distribution) and D4 (opener uniqueness) are AGGREGATE-ONLY
 * dimensions — computed across all cases, not per-case. They do not appear in
 * per-case dimension maps and are excluded from this config intentionally.
 */
export const SCOTUS_BLOCK_CONFIG = {
  D1_severity_congruence: false,
  // D2 and D4 are aggregate-only — see runScotusEval() return value
  D3_tone_alignment: false,
  D5_section_uniqueness: false,
  D6_factual_accuracy: true,
  D7_issue_area: true,
  D8_evidence_anchors: true,
  D9_dissent_integrity: true,
  D10_party_specificity: true,
  D11_why_grounding: false,
};
