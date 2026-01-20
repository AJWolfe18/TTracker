/**
 * Style Pattern Linter (ADO-273)
 *
 * Validates style patterns to ensure they contain approach descriptions,
 * not literal text that GPT will copy verbatim.
 *
 * FLAGGED (problematic): "Start with: 'The real story is...'" - literal starter
 * NOT FLAGGED (legitimate): "avoid phrases like 'shocking'" - quoting what to avoid
 *
 * Usage:
 *   import { lintStylePattern, lintAllPatterns, INSTRUCTIONAL_PATTERNS } from '../shared/style-patterns-lint.js';
 */

// ============================================================================
// INSTRUCTIONAL PATTERNS TO FLAG
// ============================================================================

/**
 * Patterns that indicate literal text instructions (problematic)
 * These suggest GPT should copy specific text verbatim
 */
export const INSTRUCTIONAL_PATTERNS = [
  /start with:/i,
  /open with:/i,
  /begin with:/i,
  /say:/i,
  /write:/i,
  /use exactly/i,
  /verbatim/i,
  /first line:/i,
  /first sentence:/i,
  /lead with ['"][^'"]+['"]/i,  // "lead with 'specific text'"
  /end with ['"][^'"]+['"]/i,   // "end with 'specific text'"
];

/**
 * Intensity words that should not appear in style pattern descriptions
 * These belong in tone calibration prompts, not style patterns
 */
export const INTENSITY_WORDS = [
  'fury',
  'furious',
  'outrage',
  'outrageous',
  'disaster',
  'catastrophe',
  'horrifying',
  'appalling',
  'disgusting',
  'terrifying'
];

// ============================================================================
// LINT FUNCTIONS
// ============================================================================

/**
 * Lint a single style pattern for problematic content
 * @param {Object} pattern - Style pattern object
 * @returns {Object} { valid: boolean, warnings: string[], errors: string[] }
 */
export function lintStylePattern(pattern) {
  const errors = [];
  const warnings = [];

  if (!pattern || typeof pattern !== 'object') {
    return { valid: false, errors: ['Pattern is not a valid object'], warnings: [] };
  }

  if (!pattern.id) {
    errors.push('Pattern missing required id field');
  }

  // Check all text fields in the pattern
  const textFields = [
    'opening_approach',
    'rhetorical_device',
    'structure',
    'closing_approach',
    'instruction' // Legacy field from old format
  ];

  for (const field of textFields) {
    const value = pattern[field];
    if (!value) continue;

    const text = String(value);

    // Check for instructional patterns (errors)
    for (const regex of INSTRUCTIONAL_PATTERNS) {
      if (regex.test(text)) {
        errors.push(`[${pattern.id}] Field '${field}' contains instructional pattern: ${regex}`);
      }
    }

    // Check for intensity words (warnings)
    for (const word of INTENSITY_WORDS) {
      const wordRegex = new RegExp(`\\b${word}\\b`, 'i');
      if (wordRegex.test(text)) {
        warnings.push(`[${pattern.id}] Field '${field}' contains intensity word '${word}' (should be in tone calibration, not style pattern)`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Lint an array of style patterns
 * @param {Object[]} patterns - Array of style pattern objects
 * @returns {Object} { valid: boolean, passed: number, failed: number, results: Object[] }
 */
export function lintAllPatterns(patterns) {
  if (!Array.isArray(patterns)) {
    return {
      valid: false,
      passed: 0,
      failed: 1,
      results: [{ valid: false, errors: ['Input is not an array'], warnings: [] }]
    };
  }

  const results = patterns.map(p => ({
    id: p?.id || 'unknown',
    ...lintStylePattern(p)
  }));

  const passed = results.filter(r => r.valid).length;
  const failed = results.filter(r => !r.valid).length;

  return {
    valid: failed === 0,
    passed,
    failed,
    results
  };
}

/**
 * Print lint results to console (for CI/testing)
 * @param {Object} lintResult - Result from lintAllPatterns
 * @param {boolean} verbose - Show passing patterns too
 */
export function printLintResults(lintResult, verbose = false) {
  console.log(`\nStyle Pattern Lint Results:`);
  console.log(`  Passed: ${lintResult.passed}`);
  console.log(`  Failed: ${lintResult.failed}`);
  console.log(`  Valid: ${lintResult.valid ? 'YES' : 'NO'}\n`);

  for (const result of lintResult.results) {
    if (!result.valid) {
      console.log(`\n  FAIL: ${result.id}`);
      for (const error of result.errors) {
        console.log(`    ERROR: ${error}`);
      }
    }
    if (result.warnings.length > 0) {
      if (result.valid) console.log(`\n  WARN: ${result.id}`);
      for (const warning of result.warnings) {
        console.log(`    WARNING: ${warning}`);
      }
    }
    if (verbose && result.valid && result.warnings.length === 0) {
      console.log(`  PASS: ${result.id}`);
    }
  }
}

// ============================================================================
// SELF-TEST (run with: node style-patterns-lint.js)
// ============================================================================

// Only run self-test if executed directly
const isMainModule = typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].includes('style-patterns-lint.js');

if (isMainModule) {
  console.log('Running style-patterns-lint self-test...\n');

  // Test cases
  const testPatterns = [
    // Should PASS
    {
      id: 'good-pattern-1',
      opening_approach: 'Lead with the contrast between official framing and practical effect.',
      rhetorical_device: 'Use tight A/B contrast structure.',
      structure: 'Official claim -> actual effect -> who is affected.',
      closing_approach: 'End with what this enables going forward.'
    },
    // Should PASS (quoting what to avoid is OK)
    {
      id: 'good-pattern-2',
      opening_approach: 'Avoid phrases like "shocking" or "outrageous" - let facts speak.',
      rhetorical_device: 'Deadpan delivery.',
      structure: 'Fact -> context -> implication.',
      closing_approach: 'End without editorializing.'
    },
    // Should FAIL (literal instruction)
    {
      id: 'bad-pattern-1',
      opening_approach: 'Start with: "The real story is..."',
      rhetorical_device: 'Be direct.',
      structure: 'Standard analysis.',
      closing_approach: 'End with impact.'
    },
    // Should WARN (intensity word)
    {
      id: 'warn-pattern-1',
      opening_approach: 'Lead with the most outrageous element.',
      rhetorical_device: 'Express fury at the corruption.',
      structure: 'Standard.',
      closing_approach: 'End strong.'
    }
  ];

  const result = lintAllPatterns(testPatterns);
  printLintResults(result, true);

  // Verify expected results
  console.log('\n--- Verification ---');
  const results = result.results;
  const good1 = results.find(r => r.id === 'good-pattern-1');
  const good2 = results.find(r => r.id === 'good-pattern-2');
  const bad1 = results.find(r => r.id === 'bad-pattern-1');
  const warn1 = results.find(r => r.id === 'warn-pattern-1');

  console.log(`good-pattern-1 valid: ${good1?.valid} (expected: true)`);
  console.log(`good-pattern-2 valid: ${good2?.valid} (expected: true)`);
  console.log(`bad-pattern-1 valid: ${bad1?.valid} (expected: false)`);
  console.log(`warn-pattern-1 valid: ${warn1?.valid} (expected: true, but with warnings)`);
  console.log(`warn-pattern-1 warnings: ${warn1?.warnings.length} (expected: 2)`);

  process.exit(result.valid && bad1?.valid === false ? 0 : 1);
}
