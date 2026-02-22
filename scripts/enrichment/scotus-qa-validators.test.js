/**
 * SCOTUS QA Validators Tests
 *
 * Tests for deterministic validators (Layer A):
 * - Hyperbole lint
 * - Scale word support checking
 * - Procedural posture validation
 *
 * Run: npm test -- --testPathPattern=scotus-qa-validators
 */

import {
  HYPERBOLE_BLOCKLIST,
  SCALE_WORDS_REQUIRE_SUPPORT,
  SCOPE_OVERCLAIM_PHRASES,
  extractSentenceContaining,
  isScaleSupported,
  lintHyperbole,
  checkProceduralPosture,
  checkDissentMismatch,  // ADO-324
  runDeterministicValidators,
  deriveVerdict,
  extractSourceExcerpt,
} from './scotus-qa-validators.js';

// ============================================================================
// extractSentenceContaining
// ============================================================================

describe('extractSentenceContaining', () => {
  test('finds sentence containing word', () => {
    const text = 'First sentence here. The Court obliterates the law. Final sentence.';
    const result = extractSentenceContaining(text, 'obliterates');
    expect(result).toBe('The Court obliterates the law.');
  });

  test('returns null for no match', () => {
    const text = 'First sentence. Second sentence.';
    expect(extractSentenceContaining(text, 'obliterates')).toBeNull();
  });

  test('handles empty text', () => {
    expect(extractSentenceContaining('', 'word')).toBeNull();
    expect(extractSentenceContaining(null, 'word')).toBeNull();
  });

  test('handles empty needle', () => {
    expect(extractSentenceContaining('Some text.', '')).toBeNull();
    expect(extractSentenceContaining('Some text.', null)).toBeNull();
  });

  test('matches case-insensitively', () => {
    const text = 'The ruling was DEVASTATING to plaintiffs.';
    expect(extractSentenceContaining(text, 'devastating')).toBe(text);
  });

  test('handles special regex characters in needle', () => {
    const text = 'The effect was (catastrophic) indeed.';
    expect(extractSentenceContaining(text, '(catastrophic)')).toBeNull(); // word boundary won't match
  });
});

// ============================================================================
// isScaleSupported
// ============================================================================

describe('isScaleSupported', () => {
  test('returns strong support when phrase in source_excerpt', () => {
    const grounding = {
      source_excerpt: 'This affects millions of Americans nationwide.',
    };
    const result = isScaleSupported('millions', grounding);
    expect(result.supported).toBe(true);
    expect(result.strong).toBe(true);
  });

  test('returns strong support when phrase in evidence_quotes', () => {
    const grounding = {
      source_excerpt: '',
      evidence_quotes: ['The impact reaches millions of people.'],
    };
    const result = isScaleSupported('millions', grounding);
    expect(result.supported).toBe(true);
    expect(result.strong).toBe(true);
  });

  test('returns weak support when only in holding', () => {
    const grounding = {
      source_excerpt: '',
      holding: 'Affects millions nationwide',
      practical_effect: '',
    };
    const result = isScaleSupported('millions', grounding);
    expect(result.supported).toBe(true);
    expect(result.strong).toBe(false);
  });

  test('returns not supported when phrase absent', () => {
    const grounding = {
      source_excerpt: 'A narrow ruling.',
      holding: 'Limited effect.',
      practical_effect: 'Minor impact.',
      evidence_quotes: [],
    };
    const result = isScaleSupported('millions', grounding);
    expect(result.supported).toBe(false);
    expect(result.strong).toBe(false);
  });

  test('handles null grounding', () => {
    const result = isScaleSupported('millions', null);
    expect(result.supported).toBe(false);
  });
});

// ============================================================================
// lintHyperbole
// ============================================================================

describe('lintHyperbole', () => {
  describe('hyperbole blocklist', () => {
    test('flags blocked words at level 0-2', () => {
      const summary = 'The ruling obliterates protections for workers.';
      const issues = lintHyperbole(summary, 2, {});

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('hyperbole');
      expect(issues[0].word).toBe('obliterates');
      expect(issues[0].severity).toBe('medium');
      expect(issues[0].fixable).toBe(true);
    });

    test('does not flag blocked words at level 3+', () => {
      const summary = 'The ruling obliterates protections for workers.';
      const issues = lintHyperbole(summary, 3, {});

      const hyperboleIssues = issues.filter(i => i.type === 'hyperbole');
      expect(hyperboleIssues).toHaveLength(0);
    });

    test('flags multiple blocked words', () => {
      const summary = 'A devastating and catastrophic ruling.';
      const issues = lintHyperbole(summary, 1, {});

      const hyperboleIssues = issues.filter(i => i.type === 'hyperbole');
      expect(hyperboleIssues).toHaveLength(2);
    });

    test.each(HYPERBOLE_BLOCKLIST)('detects "%s" as hyperbole at low levels', (word) => {
      const summary = `The ruling was ${word} in scope.`;
      const issues = lintHyperbole(summary, 1, {});

      const found = issues.find(i => i.type === 'hyperbole' && i.word === word);
      expect(found).toBeDefined();
    });
  });

  describe('scale words', () => {
    test('flags unsupported scale phrase as high severity', () => {
      const summary = 'This affects millions of Americans.';
      const grounding = { source_excerpt: 'A narrow ruling.' };
      const issues = lintHyperbole(summary, 4, grounding);

      const scaleIssue = issues.find(i => i.type === 'unsupported_scale');
      expect(scaleIssue).toBeDefined();
      expect(scaleIssue.severity).toBe('high');
      expect(scaleIssue.fixable).toBe(false);
    });

    test('flags weakly supported scale as low severity', () => {
      const summary = 'This affects millions of Americans.';
      const grounding = {
        source_excerpt: 'Some other text.',
        holding: 'Impacts millions nationwide.',
      };
      const issues = lintHyperbole(summary, 4, grounding);

      const scaleIssue = issues.find(i => i.type === 'weakly_supported_scale');
      expect(scaleIssue).toBeDefined();
      expect(scaleIssue.severity).toBe('low');
      expect(scaleIssue.fixable).toBe(true);
    });

    test('no issue when scale word is strongly supported', () => {
      const summary = 'This affects millions of Americans.';
      const grounding = {
        source_excerpt: 'The law impacts millions of citizens.',
      };
      const issues = lintHyperbole(summary, 4, grounding);

      const scaleIssues = issues.filter(i =>
        i.type === 'unsupported_scale' || i.type === 'weakly_supported_scale'
      );
      expect(scaleIssues).toHaveLength(0);
    });
  });

  describe('scope overclaim phrases', () => {
    test.each(SCOPE_OVERCLAIM_PHRASES)('flags "%s" as scope overclaim', (phrase) => {
      const summary = `The ruling ${phrase} changes everything.`;
      const issues = lintHyperbole(summary, 4, {});

      const found = issues.find(i => i.type === 'scope_overclaim_phrase' && i.phrase === phrase);
      expect(found).toBeDefined();
      expect(found.severity).toBe('low');
    });
  });

  describe('edge cases', () => {
    test('handles empty summary', () => {
      expect(lintHyperbole('', 2, {})).toEqual([]);
      expect(lintHyperbole(null, 2, {})).toEqual([]);
    });

    test('handles undefined level', () => {
      const summary = 'The ruling obliterates protections.';
      // undefined level should not trigger hyperbole check (level <= 2 check fails)
      const issues = lintHyperbole(summary, undefined, {});
      const hyperboleIssues = issues.filter(i => i.type === 'hyperbole');
      expect(hyperboleIssues).toHaveLength(0);
    });
  });
});

// ============================================================================
// checkProceduralPosture
// ============================================================================

describe('checkProceduralPosture', () => {
  test('flags merits implication in procedural case', () => {
    const summary = 'The Court held that the law was unconstitutional.';
    const facts = { merits_reached: false };
    const issues = checkProceduralPosture(summary, facts);

    const found = issues.find(i => i.type === 'procedural_merits_implication');
    expect(found).toBeDefined();
    expect(found.severity).toBe('high');
  });

  test('flags missing procedural framing', () => {
    const summary = 'The case was resolved on technical grounds.';
    const facts = { merits_reached: false };
    const issues = checkProceduralPosture(summary, facts);

    const found = issues.find(i => i.type === 'procedural_missing_framing');
    expect(found).toBeDefined();
    expect(found.severity).toBe('medium');
  });

  test('no issues when procedural case properly framed', () => {
    const summary = 'The case was dismissed for lack of standing.';
    const facts = { merits_reached: false };
    const issues = checkProceduralPosture(summary, facts);

    expect(issues).toHaveLength(0);
  });

  test('no issues for non-procedural case', () => {
    const summary = 'The Court held that the law was unconstitutional.';
    const facts = { merits_reached: true };
    const issues = checkProceduralPosture(summary, facts);

    expect(issues).toHaveLength(0);
  });

  test('triggers on case_type=procedural', () => {
    const summary = 'The Court struck down the regulation.';
    const facts = { case_type: 'procedural' };
    const issues = checkProceduralPosture(summary, facts);

    expect(issues.some(i => i.type === 'procedural_merits_implication')).toBe(true);
  });

  test.each([
    'dismissed', 'remanded', 'vacated', 'standing', 'moot',
    'jurisdiction', 'procedural', 'DIG', 'cert denied', 'no merits'
  ])('accepts procedural keyword "%s"', (keyword) => {
    const summary = `The case was ${keyword} by the Court.`;
    const facts = { merits_reached: false };
    const issues = checkProceduralPosture(summary, facts);

    const missingFraming = issues.find(i => i.type === 'procedural_missing_framing');
    expect(missingFraming).toBeUndefined();
  });

  test.each([
    'held that', 'found that', 'ruled that', 'declared',
    'struck down', 'upheld', 'invalidated', 'overturned',
    'established', 'prevailed', 'won', 'lost', 'victory', 'defeat'
  ])('rejects merits language "%s" in procedural case', (phrase) => {
    const summary = `The Court ${phrase} in this case.`;
    const facts = { merits_reached: false };
    const issues = checkProceduralPosture(summary, facts);

    const found = issues.find(i => i.type === 'procedural_merits_implication');
    expect(found).toBeDefined();
  });
});

// ============================================================================
// runDeterministicValidators
// ============================================================================

describe('runDeterministicValidators', () => {
  test('runs all validators and aggregates issues', () => {
    const input = {
      summary_spicy: 'The Court obliterates the law and affects millions nationwide.',
      ruling_impact_level: 2,
      facts: { merits_reached: true },
      grounding: { source_excerpt: 'A narrow ruling.' },
    };

    const issues = runDeterministicValidators(input);

    // Should have: hyperbole (obliterates), unsupported_scale (millions), scope_overclaim (nationwide)
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues.some(i => i.type === 'hyperbole')).toBe(true);
    expect(issues.some(i => i.type === 'unsupported_scale')).toBe(true);
  });

  test('returns empty array for clean summary', () => {
    const input = {
      summary_spicy: 'The Court resolved a narrow technical question.',
      ruling_impact_level: 2,
      facts: { merits_reached: true },
      grounding: { source_excerpt: 'Technical resolution of narrow issue.' },
    };

    const issues = runDeterministicValidators(input);
    expect(issues).toHaveLength(0);
  });

  test('handles missing grounding gracefully', () => {
    const input = {
      summary_spicy: 'A simple ruling.',
      ruling_impact_level: 2,
      facts: { merits_reached: true },
      grounding: null,
    };

    // Should not throw
    const issues = runDeterministicValidators(input);
    expect(Array.isArray(issues)).toBe(true);
  });
});

// ============================================================================
// checkDissentMismatch (ADO-324)
// ============================================================================

describe('checkDissentMismatch', () => {
  test('flags dissent reference when dissent_exists=false (Case 173 pattern)', () => {
    const summary = 'Dissenters warned about the dangers of tightening amendment standards.';
    const facts = { dissent_exists: false };
    const issues = checkDissentMismatch(summary, facts);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('ungrounded_dissent_reference');
    expect(issues[0].severity).toBe('high');
    expect(issues[0].fixable).toBe(true);
  });

  test('flags various dissent-related words', () => {
    const testCases = ['dissent', 'dissenter', 'dissenters', 'dissenting', 'dissented'];
    const facts = { dissent_exists: false };

    for (const word of testCases) {
      const summary = `The ${word} opinion raised concerns.`;
      const issues = checkDissentMismatch(summary, facts);
      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('ungrounded_dissent_reference');
    }
  });

  test('no issue when dissent_exists=true', () => {
    const summary = 'Dissenters warned about the dangers.';
    const facts = { dissent_exists: true };
    const issues = checkDissentMismatch(summary, facts);

    expect(issues).toHaveLength(0);
  });

  test('no issue when dissent_exists is undefined', () => {
    const summary = 'Dissenters warned about the dangers.';
    const facts = {};
    const issues = checkDissentMismatch(summary, facts);

    expect(issues).toHaveLength(0);
  });

  test('no issue when no dissent words in summary', () => {
    const summary = 'The Court reversed the lower court decision.';
    const facts = { dissent_exists: false };
    const issues = checkDissentMismatch(summary, facts);

    expect(issues).toHaveLength(0);
  });

  test('case-insensitive matching', () => {
    const summary = 'DISSENTERS warned about these changes.';
    const facts = { dissent_exists: false };
    const issues = checkDissentMismatch(summary, facts);

    expect(issues).toHaveLength(1);
  });

  test('extracts affected sentence correctly', () => {
    const summary = 'The majority ruled. Dissenters raised concerns. The case was decided.';
    const facts = { dissent_exists: false };
    const issues = checkDissentMismatch(summary, facts);

    expect(issues[0].affected_sentence).toBe('Dissenters raised concerns.');
  });
});

// ============================================================================
// deriveVerdict
// ============================================================================

describe('deriveVerdict', () => {
  test('returns APPROVE for no issues', () => {
    expect(deriveVerdict([])).toBe('APPROVE');
  });

  test('returns FLAG for low severity issues', () => {
    const issues = [
      { type: 'scope_overclaim_phrase', severity: 'low' },
    ];
    expect(deriveVerdict(issues)).toBe('FLAG');
  });

  test('returns FLAG for medium severity issues', () => {
    const issues = [
      { type: 'hyperbole', severity: 'medium' },
    ];
    expect(deriveVerdict(issues)).toBe('FLAG');
  });

  test('returns REJECT for high severity unsupported_scale', () => {
    const issues = [
      { type: 'unsupported_scale', severity: 'high' },
    ];
    expect(deriveVerdict(issues)).toBe('REJECT');
  });

  test('returns REJECT for high severity procedural_merits_implication', () => {
    const issues = [
      { type: 'procedural_merits_implication', severity: 'high' },
    ];
    expect(deriveVerdict(issues)).toBe('REJECT');
  });

  // ADO-324: ungrounded_dissent_reference should cause REJECT
  test('returns REJECT for high severity ungrounded_dissent_reference (ADO-324)', () => {
    const issues = [
      { type: 'ungrounded_dissent_reference', severity: 'high' },
    ];
    expect(deriveVerdict(issues)).toBe('REJECT');
  });

  test('returns FLAG for other high severity issues', () => {
    // High severity but not in the REJECT list
    const issues = [
      { type: 'some_other_type', severity: 'high' },
    ];
    expect(deriveVerdict(issues)).toBe('FLAG');
  });
});

// ============================================================================
// extractSourceExcerpt
// ============================================================================

describe('extractSourceExcerpt', () => {
  test('returns full text if under limit', () => {
    const scotusCase = { opinion_full_text: 'Short opinion text.' };
    expect(extractSourceExcerpt(scotusCase, 2400)).toBe('Short opinion text.');
  });

  test('extracts first + last chars when over limit', () => {
    const longText = 'A'.repeat(3000);
    const scotusCase = { opinion_full_text: longText };
    const result = extractSourceExcerpt(scotusCase, 2400);

    // Should have first 1600 + "..." + last 800
    expect(result.startsWith('A'.repeat(100))).toBe(true);
    expect(result.endsWith('A'.repeat(100))).toBe(true);
    expect(result).toContain('...');
  });

  test('falls back to syllabus if no opinion_full_text', () => {
    const scotusCase = { syllabus: 'Syllabus content here.' };
    expect(extractSourceExcerpt(scotusCase)).toBe('Syllabus content here.');
  });

  test('falls back to opinion_excerpt', () => {
    const scotusCase = { opinion_excerpt: 'Excerpt content.' };
    expect(extractSourceExcerpt(scotusCase)).toBe('Excerpt content.');
  });

  test('returns empty string if no source', () => {
    const scotusCase = {};
    expect(extractSourceExcerpt(scotusCase)).toBe('');
  });
});
