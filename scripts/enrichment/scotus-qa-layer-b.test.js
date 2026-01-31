/**
 * Unit Tests for SCOTUS QA Layer B (ADO-310)
 *
 * Tests cover:
 * 1. Response validator tests
 * 2. Verdict computation tests
 * 3. Final verdict computation tests
 * 4. Severity score tests
 * 5. Combined directives tests
 * 6. affected_sentence validation tests
 * 7. Issue cap tests
 * 8. Capabilities enforcement tests
 */

import { strict as assert } from 'assert';
import {
  validateGrounding,
  buildCheckInstructions,
  truncateGrounding,
  normalizeForMatch,
  validateAffectedSentence,
  normalizeIssueSeverity,
  validateLLMResponse,
  filterIssuesByCapabilities,
  capIssues,
  deriveLayerBVerdict,
  computeFinalVerdict,
  computeSeverityScore,
  buildCombinedFixDirectives,
  extractErrorStatus,
  extractErrorCode,
  isRetryableError,
  MAX_ISSUES,
  FIELD_LENGTH_LIMITS,
  TOKEN_LIMITS,
} from './scotus-qa-layer-b.js';

import {
  LAYER_A_ISSUE_TYPES,
  LAYER_B_ISSUE_TYPES,
  INTERNAL_ISSUE_TYPES,
  SAFETY_ISSUE_TYPES,
  ISSUE_TYPE_SEVERITY,
} from './qa-issue-types.js';

// ============================================================================
// TEST UTILITIES
// ============================================================================

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function describe(name, fn) {
  console.log(`\n${name}`);
  fn();
}

// ============================================================================
// 1. RESPONSE VALIDATOR TESTS
// ============================================================================

describe('Response Validator Tests', () => {
  test('fixable=true but no fix_directive -> insufficient_qa_output', () => {
    const summary = 'Some summary text with the specific sentence here.';
    const response = {
      issues: [{
        type: 'scope_overreach',  // medium severity, so won't trigger affected_sentence check
        severity: 'medium',
        fixable: true,
        why: 'Summary overclaims scope',
        // Missing fix_directive
      }],
      raw_confidence: 80,
    };
    const result = validateLLMResponse(response, summary);
    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, INTERNAL_ISSUE_TYPES.insufficient_qa_output);
    assert.ok(result.error.includes('fixable'));
  });

  test('severity=high but no affected_sentence -> insufficient_qa_output', () => {
    const response = {
      issues: [{
        type: 'hallucination',
        severity: 'high',
        fixable: false,
        why: 'Hallucinated quote',
        // Missing affected_sentence
      }],
      raw_confidence: 80,
    };
    const result = validateLLMResponse(response, 'Some summary text');
    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, INTERNAL_ISSUE_TYPES.insufficient_qa_output);
  });

  test('affected_sentence not in summary -> insufficient_qa_output', () => {
    const response = {
      issues: [{
        type: 'accuracy_vs_holding',
        severity: 'high',
        fixable: false,
        affected_sentence: 'This text is not in the summary',
        why: 'Contradicts holding',
      }],
      raw_confidence: 80,
    };
    const result = validateLLMResponse(response, 'The actual summary text here');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('not verbatim'));
  });

  test('invalid issue type -> insufficient_qa_output', () => {
    const response = {
      issues: [{
        type: 'invalid_type_not_in_enum',
        severity: 'high',
        fixable: false,
        why: 'Some issue',
      }],
      raw_confidence: 80,
    };
    const result = validateLLMResponse(response, 'Some summary');
    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, INTERNAL_ISSUE_TYPES.insufficient_qa_output);
  });

  test('valid response parses successfully + severity normalized', () => {
    const summary = 'The Court reversed the decision and remanded.';
    const response = {
      issues: [{
        type: 'accuracy_vs_holding',
        severity: 'medium',  // Will be normalized to 'high'
        fixable: true,
        affected_sentence: 'The Court reversed the decision',
        why: 'Summary says reversed but holding says affirmed',
        fix_directive: 'Change reversed to affirmed',
      }],
      raw_confidence: 85,
    };
    const result = validateLLMResponse(response, summary);
    assert.equal(result.valid, true);
    assert.equal(result.issues[0].severity, 'high');  // Normalized
    assert.equal(result.issues[0]._severity_normalized, true);
  });

  test('empty issues array is valid', () => {
    const response = { issues: [], raw_confidence: 95 };
    const result = validateLLMResponse(response, 'Any summary');
    assert.equal(result.valid, true);
    assert.equal(result.issues.length, 0);
  });

  // ADO-310: raw_confidence validation tests
  test('invalid raw_confidence (string) -> insufficient_qa_output', () => {
    const response = { issues: [], raw_confidence: 'high' };
    const result = validateLLMResponse(response, 'Some summary');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('raw_confidence'));
  });

  test('invalid raw_confidence (>100) -> insufficient_qa_output', () => {
    const response = { issues: [], raw_confidence: 150 };
    const result = validateLLMResponse(response, 'Some summary');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('raw_confidence'));
  });

  test('invalid raw_confidence (negative) -> insufficient_qa_output', () => {
    const response = { issues: [], raw_confidence: -10 };
    const result = validateLLMResponse(response, 'Some summary');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('raw_confidence'));
  });

  test('invalid raw_confidence (float) -> insufficient_qa_output', () => {
    const response = { issues: [], raw_confidence: 85.5 };
    const result = validateLLMResponse(response, 'Some summary');
    assert.equal(result.valid, false);
    assert.ok(result.error.includes('raw_confidence'));
  });

  test('missing raw_confidence is valid (optional field)', () => {
    const response = { issues: [] };
    const result = validateLLMResponse(response, 'Some summary');
    assert.equal(result.valid, true);
  });
});

// ============================================================================
// 2. VERDICT COMPUTATION TESTS
// ============================================================================

describe('Verdict Computation Tests (deriveLayerBVerdict)', () => {
  test('deriveLayerBVerdict([insufficient_qa_output]) -> null', () => {
    const issues = [{ type: INTERNAL_ISSUE_TYPES.insufficient_qa_output }];
    assert.equal(deriveLayerBVerdict(issues), null);
  });

  test('deriveLayerBVerdict([insufficient_grounding]) -> FLAG', () => {
    const issues = [{ type: INTERNAL_ISSUE_TYPES.insufficient_grounding, severity: 'medium' }];
    assert.equal(deriveLayerBVerdict(issues), 'FLAG');
  });

  test('deriveLayerBVerdict([accuracy_vs_holding]) -> REJECT', () => {
    const issues = [{ type: 'accuracy_vs_holding', severity: 'high' }];
    assert.equal(deriveLayerBVerdict(issues), 'REJECT');
  });

  test('deriveLayerBVerdict([hallucination]) -> REJECT', () => {
    const issues = [{ type: 'hallucination', severity: 'high' }];
    assert.equal(deriveLayerBVerdict(issues), 'REJECT');
  });

  test('deriveLayerBVerdict([scope_overreach]) -> FLAG', () => {
    const issues = [{ type: 'scope_overreach', severity: 'medium' }];
    assert.equal(deriveLayerBVerdict(issues), 'FLAG');
  });

  test('deriveLayerBVerdict([tone_label_mismatch]) -> FLAG', () => {
    const issues = [{ type: 'tone_label_mismatch', severity: 'medium' }];
    assert.equal(deriveLayerBVerdict(issues), 'FLAG');
  });

  test('deriveLayerBVerdict([]) -> APPROVE', () => {
    assert.equal(deriveLayerBVerdict([]), 'APPROVE');
  });

  test('deriveLayerBVerdict(null/undefined) -> APPROVE', () => {
    assert.equal(deriveLayerBVerdict(null), 'APPROVE');
    assert.equal(deriveLayerBVerdict(undefined), 'APPROVE');
  });

  test('internal issues dont affect verdict', () => {
    const issues = [
      { type: INTERNAL_ISSUE_TYPES.missing_grounding_for_check, severity: 'low', internal: true },
      { type: INTERNAL_ISSUE_TYPES.issues_truncated, severity: 'low', internal: true },
    ];
    assert.equal(deriveLayerBVerdict(issues), 'APPROVE');
  });
});

// ============================================================================
// 3. FINAL VERDICT COMPUTATION TESTS
// ============================================================================

describe('Final Verdict Computation Tests (computeFinalVerdict)', () => {
  test('computeFinalVerdict(APPROVE, REJECT) -> REJECT', () => {
    assert.equal(computeFinalVerdict('APPROVE', 'REJECT'), 'REJECT');
  });

  test('computeFinalVerdict(APPROVE, null) -> APPROVE (graceful defer)', () => {
    assert.equal(computeFinalVerdict('APPROVE', null), 'APPROVE');
  });

  test('computeFinalVerdict(FLAG, null) -> FLAG (graceful defer)', () => {
    assert.equal(computeFinalVerdict('FLAG', null), 'FLAG');
  });

  test('computeFinalVerdict(FLAG, APPROVE) -> FLAG', () => {
    assert.equal(computeFinalVerdict('FLAG', 'APPROVE'), 'FLAG');
  });

  test('computeFinalVerdict(REJECT, APPROVE) -> REJECT', () => {
    assert.equal(computeFinalVerdict('REJECT', 'APPROVE'), 'REJECT');
  });

  test('computeFinalVerdict(APPROVE, FLAG) -> FLAG', () => {
    assert.equal(computeFinalVerdict('APPROVE', 'FLAG'), 'FLAG');
  });

  test('computeFinalVerdict(FLAG, REJECT) -> REJECT', () => {
    assert.equal(computeFinalVerdict('FLAG', 'REJECT'), 'REJECT');
  });

  // ADO-310: Additional null handling tests
  test('computeFinalVerdict(null, null) -> APPROVE (both null)', () => {
    assert.equal(computeFinalVerdict(null, null), 'APPROVE');
  });

  test('computeFinalVerdict(null, FLAG) -> FLAG (Layer A null)', () => {
    assert.equal(computeFinalVerdict(null, 'FLAG'), 'FLAG');
  });

  test('computeFinalVerdict(null, REJECT) -> REJECT (Layer A null)', () => {
    assert.equal(computeFinalVerdict(null, 'REJECT'), 'REJECT');
  });
});

// ============================================================================
// 4. SEVERITY SCORE TESTS
// ============================================================================

describe('Severity Score Tests', () => {
  test('issues with insufficient_qa_output -> score ignores them', () => {
    const issues = [
      { type: INTERNAL_ISSUE_TYPES.insufficient_qa_output, internal: true },
      { type: 'accuracy_vs_holding', severity: 'high' },
    ];
    // Should only score the accuracy_vs_holding
    assert.equal(computeSeverityScore(issues), 100);
  });

  test('issues with issues_truncated -> score ignores them', () => {
    const issues = [
      { type: INTERNAL_ISSUE_TYPES.issues_truncated, severity: 'low', internal: true },
      { type: 'scope_overreach', severity: 'medium' },
    ];
    assert.equal(computeSeverityScore(issues), 60);
  });

  test('only internal issues -> score is 0', () => {
    const issues = [
      { type: INTERNAL_ISSUE_TYPES.missing_grounding_for_check, severity: 'low', internal: true },
    ];
    assert.equal(computeSeverityScore(issues), 0);
  });

  test('normal issues -> max-based scoring', () => {
    const issues = [
      { type: 'scope_overreach', severity: 'medium' },
      { type: 'hallucination', severity: 'high' },
    ];
    assert.equal(computeSeverityScore(issues), 100);  // max of 60, 100
  });

  test('empty issues -> score 0', () => {
    assert.equal(computeSeverityScore([]), 0);
    assert.equal(computeSeverityScore(null), 0);
  });
});

// ============================================================================
// 5. COMBINED DIRECTIVES TESTS
// ============================================================================

describe('Combined Directives Tests', () => {
  test('Layer A procedural_merits_implication appears in safety section', () => {
    const layerAIssues = [{
      type: LAYER_A_ISSUE_TYPES.procedural_merits_implication,
      fixable: true,
      fix_directive: 'Remove merits framing',
    }];
    const result = buildCombinedFixDirectives(layerAIssues, []);
    assert.ok(result.includes('Remove merits framing'));
    assert.ok(result.includes('FIXES TO APPLY'));
  });

  test('Layer A hyperbole appears in safety section', () => {
    const layerAIssues = [{
      type: LAYER_A_ISSUE_TYPES.hyperbole,
      fixable: true,
      fix_directive: 'Remove hyperbolic language',
    }];
    const result = buildCombinedFixDirectives(layerAIssues, []);
    assert.ok(result.includes('Remove hyperbolic language'));
  });

  test('uses shared constants (not hardcoded strings)', () => {
    // Verify SAFETY_ISSUE_TYPES matches expected
    assert.ok(SAFETY_ISSUE_TYPES.includes(LAYER_A_ISSUE_TYPES.procedural_merits_implication));
    assert.ok(SAFETY_ISSUE_TYPES.includes(LAYER_A_ISSUE_TYPES.hyperbole));
  });

  test('non-fixable issues not included', () => {
    const layerAIssues = [{
      type: LAYER_A_ISSUE_TYPES.unsupported_scale,
      fixable: false,
      fix_directive: 'This should not appear',
    }];
    const result = buildCombinedFixDirectives(layerAIssues, []);
    assert.equal(result, '');
  });

  test('combines Layer A and Layer B issues', () => {
    const layerAIssues = [{
      type: LAYER_A_ISSUE_TYPES.hyperbole,
      fixable: true,
      fix_directive: 'Fix hyperbole',
    }];
    const layerBIssues = [{
      type: 'accuracy_vs_holding',
      fixable: true,
      fix_directive: 'Fix accuracy issue',
    }];
    const result = buildCombinedFixDirectives(layerAIssues, layerBIssues);
    assert.ok(result.includes('Fix hyperbole'));
    assert.ok(result.includes('Fix accuracy issue'));
  });
});

// ============================================================================
// 6. AFFECTED_SENTENCE VALIDATION TESTS
// ============================================================================

describe('affected_sentence Validation Tests', () => {
  test('exact match -> valid', () => {
    const issue = { affected_sentence: 'The Court reversed the decision.' };
    const summary = 'In this case, The Court reversed the decision. The matter is closed.';
    const result = validateAffectedSentence(issue, summary);
    assert.equal(result.valid, true);
  });

  test('match after whitespace normalization -> valid', () => {
    const issue = { affected_sentence: 'The  Court   reversed' };  // Extra spaces
    const summary = 'The Court reversed the decision.';
    const result = validateAffectedSentence(issue, summary);
    assert.equal(result.valid, true);
  });

  test('match after quote normalization -> valid', () => {
    const issue = { affected_sentence: "The Court's decision" };  // Curly quote
    const summary = "The Court's decision was final.";  // Straight quote
    const result = validateAffectedSentence(issue, summary);
    assert.equal(result.valid, true);
  });

  test('paraphrased (not substring) -> invalid', () => {
    const issue = { affected_sentence: 'The Court decided to reverse' };
    const summary = 'The Court reversed the decision.';
    const result = validateAffectedSentence(issue, summary);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('not verbatim'));
  });

  test('too long (>350 chars) -> invalid', () => {
    const longSentence = 'A'.repeat(FIELD_LENGTH_LIMITS.affected_sentence + 1);
    const issue = { affected_sentence: longSentence };
    const summary = longSentence + ' more text';
    const result = validateAffectedSentence(issue, summary);
    assert.equal(result.valid, false);
    assert.ok(result.reason.includes('too long'));
  });

  test('missing affected_sentence -> invalid', () => {
    const issue = {};
    const result = validateAffectedSentence(issue, 'Some summary');
    assert.equal(result.valid, false);
    assert.equal(result.reason, 'missing');
  });
});

// ============================================================================
// 7. ISSUE CAP TESTS
// ============================================================================

describe('Issue Cap Tests', () => {
  test('6 issues -> returns 6 (unchanged)', () => {
    const issues = Array(6).fill(null).map((_, i) => ({ type: 'scope_overreach', id: i }));
    const result = capIssues(issues);
    assert.equal(result.length, 6);
    assert.equal(result[5].id, 5);
  });

  test('7 issues -> returns 6 (5 LLM + 1 truncated marker)', () => {
    const issues = Array(7).fill(null).map((_, i) => ({ type: 'scope_overreach', id: i }));
    const result = capIssues(issues);
    assert.equal(result.length, 6);
    assert.equal(result[5].type, INTERNAL_ISSUE_TYPES.issues_truncated);
    assert.equal(result[5].original_count, 7);
  });

  test('10 issues -> returns 6 (5 LLM + 1 truncated marker with original_count=10)', () => {
    const issues = Array(10).fill(null).map((_, i) => ({ type: 'scope_overreach', id: i }));
    const result = capIssues(issues);
    assert.equal(result.length, 6);
    assert.equal(result[5].type, INTERNAL_ISSUE_TYPES.issues_truncated);
    assert.equal(result[5].original_count, 10);
    assert.equal(result[5].internal, true);
  });

  test('5 issues -> returns 5 (no truncation)', () => {
    const issues = Array(5).fill(null).map((_, i) => ({ type: 'scope_overreach', id: i }));
    const result = capIssues(issues);
    assert.equal(result.length, 5);
    assert.ok(!result.some(i => i.type === INTERNAL_ISSUE_TYPES.issues_truncated));
  });
});

// ============================================================================
// 8. CAPABILITIES ENFORCEMENT TESTS
// ============================================================================

describe('Capabilities Enforcement Tests', () => {
  test('canCheckAccuracy=false filters accuracy_vs_holding', () => {
    const capabilities = { canCheckAccuracy: false, canCheckScope: true, canCheckTone: true };
    const issues = [
      { type: 'accuracy_vs_holding', severity: 'high' },
      { type: 'scope_overreach', severity: 'medium' },
    ];
    const result = filterIssuesByCapabilities(issues, capabilities);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'scope_overreach');
  });

  test('canCheckTone=false filters tone_label_mismatch', () => {
    const capabilities = { canCheckAccuracy: true, canCheckScope: true, canCheckTone: false };
    const issues = [
      { type: 'tone_label_mismatch', severity: 'medium' },
      { type: 'hallucination', severity: 'high' },
    ];
    const result = filterIssuesByCapabilities(issues, capabilities);
    assert.equal(result.length, 1);
    assert.equal(result[0].type, 'hallucination');
  });

  test('canCheckScope=false filters scope_overreach', () => {
    const capabilities = { canCheckAccuracy: true, canCheckScope: false, canCheckTone: true };
    const issues = [
      { type: 'scope_overreach', severity: 'medium' },
    ];
    const result = filterIssuesByCapabilities(issues, capabilities);
    assert.equal(result.length, 0);
  });

  test('skip instructions included when capabilities missing', () => {
    const capabilities = {
      canCheckAccuracy: false,
      canCheckScope: false,
      canCheckTone: false,
      canCheckQuotes: true,
      canCheckOutcome: true,
    };
    const instructions = buildCheckInstructions(capabilities);
    assert.ok(instructions.includes('SKIP THESE CHECKS'));
    assert.ok(instructions.includes('accuracy_vs_holding'));
    assert.ok(instructions.includes('scope_overreach'));
    assert.ok(instructions.includes('tone_label_mismatch'));
  });

  test('no skip instructions when all capabilities available', () => {
    const capabilities = {
      canCheckAccuracy: true,
      canCheckScope: true,
      canCheckTone: true,
      canCheckQuotes: true,
      canCheckOutcome: true,
    };
    const instructions = buildCheckInstructions(capabilities);
    assert.equal(instructions, '');
  });
});

// ============================================================================
// 9. GROUNDING VALIDATION TESTS
// ============================================================================

describe('Grounding Validation Tests', () => {
  test('complete grounding returns valid with all capabilities', () => {
    const grounding = {
      holding: 'The Court held that the statute was unconstitutional.',
      practical_effect: 'The law is struck down.',
      evidence_quotes: ['The statute violates the First Amendment.'],
      disposition: 'reversed',
      prevailing_party: 'petitioner',
    };
    const input = { ruling_impact_level: 3, ruling_label: 'Constitutional Crisis' };
    const result = validateGrounding(grounding, input);
    assert.equal(result.valid, true);
    assert.equal(result.capabilities.canCheckAccuracy, true);
    assert.equal(result.capabilities.canCheckTone, true);
  });

  test('missing holding disables accuracy/scope checks', () => {
    const grounding = {
      evidence_quotes: ['Some quote.'],
      disposition: 'reversed',
      prevailing_party: 'petitioner',
    };
    const input = { ruling_impact_level: 3, ruling_label: 'Some Label' };
    const result = validateGrounding(grounding, input);
    assert.equal(result.valid, true);
    assert.equal(result.capabilities.canCheckAccuracy, false);
    assert.equal(result.capabilities.canCheckScope, false);
  });

  test('no grounding at all returns insufficient_grounding', () => {
    const grounding = {};
    const input = {};
    const result = validateGrounding(grounding, input);
    assert.equal(result.valid, false);
    assert.equal(result.issues[0].type, INTERNAL_ISSUE_TYPES.insufficient_grounding);
  });
});

// ============================================================================
// 10. TRUNCATION TESTS
// ============================================================================

describe('Truncation Tests', () => {
  test('truncateGrounding respects limits', () => {
    const grounding = {
      holding: 'A'.repeat(TOKEN_LIMITS.holding_max_chars + 100),
      practical_effect: 'B'.repeat(TOKEN_LIMITS.practical_effect_max_chars + 100),
      source_excerpt: 'C'.repeat(TOKEN_LIMITS.source_excerpt_max_chars + 100),
      evidence_quotes: Array(10).fill('D'.repeat(TOKEN_LIMITS.evidence_quotes_max_chars_each + 50)),
    };
    const result = truncateGrounding(grounding);
    assert.ok(result.holding.length <= TOKEN_LIMITS.holding_max_chars + 3);
    assert.ok(result.practical_effect.length <= TOKEN_LIMITS.practical_effect_max_chars + 3);
    assert.ok(result.source_excerpt.length <= TOKEN_LIMITS.source_excerpt_max_chars + 3);
    assert.equal(result.evidence_quotes.length, TOKEN_LIMITS.evidence_quotes_max_count);
  });
});

// ============================================================================
// 11. ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling Tests', () => {
  test('extractErrorStatus handles various error shapes', () => {
    assert.equal(extractErrorStatus({ status: 429 }), 429);
    assert.equal(extractErrorStatus({ statusCode: 500 }), 500);
    assert.equal(extractErrorStatus({ response: { status: 502 } }), 502);
    assert.equal(extractErrorStatus({}), null);
  });

  test('extractErrorCode handles various error shapes', () => {
    assert.equal(extractErrorCode({ code: 'ECONNRESET' }), 'ECONNRESET');
    assert.equal(extractErrorCode({ cause: { code: 'ETIMEDOUT' } }), 'ETIMEDOUT');
    assert.equal(extractErrorCode({}), null);
  });

  test('isRetryableError identifies retryable errors', () => {
    assert.equal(isRetryableError({ status: 429 }), true);
    assert.equal(isRetryableError({ status: 500 }), true);
    assert.equal(isRetryableError({ code: 'ECONNRESET' }), true);
    assert.equal(isRetryableError({ message: 'timeout occurred' }), true);
    assert.equal(isRetryableError({ status: 400 }), false);
    assert.equal(isRetryableError({ status: 401 }), false);
  });
});

// ============================================================================
// 12. SEVERITY NORMALIZATION TESTS
// ============================================================================

describe('Severity Normalization Tests', () => {
  test('accuracy_vs_holding normalized to high', () => {
    const issue = { type: 'accuracy_vs_holding', severity: 'medium' };
    normalizeIssueSeverity(issue);
    assert.equal(issue.severity, 'high');
    assert.equal(issue._severity_normalized, true);
  });

  test('scope_overreach normalized to medium', () => {
    const issue = { type: 'scope_overreach', severity: 'high' };
    normalizeIssueSeverity(issue);
    assert.equal(issue.severity, 'medium');
    assert.equal(issue._severity_normalized, true);
  });

  test('correct severity not changed', () => {
    const issue = { type: 'hallucination', severity: 'high' };
    normalizeIssueSeverity(issue);
    assert.equal(issue.severity, 'high');
    assert.equal(issue._severity_normalized, undefined);
  });
});

// ============================================================================
// 13. TEXT NORMALIZATION TESTS
// ============================================================================

describe('Text Normalization Tests', () => {
  test('normalizeForMatch handles curly quotes', () => {
    const input = '\u201CQuoted text\u201D with \u2018single\u2019 quotes';
    const expected = '"Quoted text" with \'single\' quotes';
    assert.equal(normalizeForMatch(input), expected);
  });

  test('normalizeForMatch collapses whitespace', () => {
    const input = 'Multiple   spaces\n\tand\ttabs';
    const expected = 'Multiple spaces and tabs';
    assert.equal(normalizeForMatch(input), expected);
  });

  test('normalizeForMatch trims', () => {
    const input = '  padded text  ';
    assert.equal(normalizeForMatch(input), 'padded text');
  });
});

// ============================================================================
// RUN TESTS
// ============================================================================

console.log('\n========================================');
console.log('SCOTUS QA Layer B Unit Tests (ADO-310)');
console.log('========================================');

// All tests are defined above and run automatically

console.log('\n========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
}
