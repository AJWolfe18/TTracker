/**
 * Shared QA Issue Type Constants (ADO-310)
 *
 * Single source of truth for issue types across:
 * - Layer A (deterministic validators)
 * - Layer B (LLM QA agent)
 * - Combined fix directive builder
 *
 * This module ensures consistency between validator outputs
 * and prevents string typos across the QA pipeline.
 */

// ============================================================================
// LAYER A ISSUE TYPES (deterministic validators)
// ============================================================================

export const LAYER_A_ISSUE_TYPES = {
  hyperbole: 'hyperbole',
  unsupported_scale: 'unsupported_scale',
  weakly_supported_scale: 'weakly_supported_scale',
  scope_overclaim_phrase: 'scope_overclaim_phrase',
  procedural_merits_implication: 'procedural_merits_implication',
  procedural_missing_framing: 'procedural_missing_framing',
  ungrounded_dissent_reference: 'ungrounded_dissent_reference',  // ADO-324
};

// ============================================================================
// LAYER B ISSUE TYPES (LLM QA agent)
// ============================================================================

export const LAYER_B_ISSUE_TYPES = {
  accuracy_vs_holding: 'accuracy_vs_holding',
  hallucination: 'hallucination',
  scope_overreach: 'scope_overreach',
  tone_label_mismatch: 'tone_label_mismatch',
};

// ============================================================================
// INTERNAL ISSUE TYPES (system-generated, not from validators)
// ============================================================================

export const INTERNAL_ISSUE_TYPES = {
  insufficient_grounding: 'insufficient_grounding',
  insufficient_qa_output: 'insufficient_qa_output',
  missing_grounding_for_check: 'missing_grounding_for_check',
  issues_truncated: 'issues_truncated',
};

// ============================================================================
// SAFETY ISSUE TYPES (high priority in combined directives)
// These are issues that should be addressed first during retry
// ============================================================================

export const SAFETY_ISSUE_TYPES = [
  LAYER_A_ISSUE_TYPES.procedural_merits_implication,
  LAYER_A_ISSUE_TYPES.hyperbole,
];

// ============================================================================
// SEVERITY MAPPING BY ISSUE TYPE
// Normalizes severity to ensure consistent verdict computation
// ============================================================================

export const ISSUE_TYPE_SEVERITY = {
  // Layer A - high severity (REJECT)
  [LAYER_A_ISSUE_TYPES.unsupported_scale]: 'high',
  [LAYER_A_ISSUE_TYPES.procedural_merits_implication]: 'high',
  [LAYER_A_ISSUE_TYPES.ungrounded_dissent_reference]: 'high',  // ADO-324: factual error

  // Layer A - medium severity (FLAG)
  [LAYER_A_ISSUE_TYPES.hyperbole]: 'medium',
  [LAYER_A_ISSUE_TYPES.procedural_missing_framing]: 'medium',

  // Layer A - low severity (FLAG)
  [LAYER_A_ISSUE_TYPES.weakly_supported_scale]: 'low',
  [LAYER_A_ISSUE_TYPES.scope_overclaim_phrase]: 'low',

  // Layer B - high severity (REJECT)
  [LAYER_B_ISSUE_TYPES.accuracy_vs_holding]: 'high',
  [LAYER_B_ISSUE_TYPES.hallucination]: 'high',

  // Layer B - medium severity (FLAG)
  [LAYER_B_ISSUE_TYPES.scope_overreach]: 'medium',
  [LAYER_B_ISSUE_TYPES.tone_label_mismatch]: 'medium',

  // Internal - medium severity (FLAG)
  [INTERNAL_ISSUE_TYPES.insufficient_grounding]: 'medium',

  // Internal - low severity (info only)
  [INTERNAL_ISSUE_TYPES.missing_grounding_for_check]: 'low',
  [INTERNAL_ISSUE_TYPES.issues_truncated]: 'low',

  // insufficient_qa_output has no severity - it causes NO_DECISION (null verdict)
};

// ============================================================================
// ALL ISSUE TYPES (for validation)
// ============================================================================

export const ALL_LAYER_A_TYPES = Object.values(LAYER_A_ISSUE_TYPES);
export const ALL_LAYER_B_TYPES = Object.values(LAYER_B_ISSUE_TYPES);
export const ALL_INTERNAL_TYPES = Object.values(INTERNAL_ISSUE_TYPES);

export const ALL_ISSUE_TYPES = [
  ...ALL_LAYER_A_TYPES,
  ...ALL_LAYER_B_TYPES,
  ...ALL_INTERNAL_TYPES,
];

// ============================================================================
// SEVERITY LEVELS
// ============================================================================

export const SEVERITY_LEVELS = ['low', 'medium', 'high'];

export const SEVERITY_WEIGHTS = {
  high: 100,
  medium: 60,
  low: 20,
};
