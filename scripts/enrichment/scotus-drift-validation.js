/**
 * SCOTUS Drift Validation Module (ADO-280)
 *
 * Pass 2 drift checker - validates that editorial framing
 * doesn't contradict Pass 1 facts.
 *
 * Drift Severity Levels:
 * - HARD: Procedural/cert/shadow mismatch (clear contradiction) -> flagAndSkip
 * - SOFT: Inversion, disposition missing, suspicious numbers -> flag but keep draft
 *
 * Exports:
 * - validateNoDrift() - Main drift checker
 * - buildPass2Prompt() - Builds Pass 2 prompt with constraints
 */

// ============================================================================
// PASS 2 PROMPT BUILDER
// ============================================================================

/**
 * Build Pass 2 prompt with constraints based on case type
 *
 * @param {Object} scotusCase - Case record
 * @param {Object} facts - Pass 1 output with case_type, disposition, etc.
 * @param {string} variationInjection - Creative direction from variation pools
 * @returns {string} Full prompt with constraints
 */
export function buildPass2Prompt(scotusCase, facts, variationInjection = '') {
  let constraints = '';

  // PROCEDURAL CASES: Lock who_wins/who_loses
  if (facts.merits_reached === false || facts.case_type === 'procedural') {
    constraints += `
PROCEDURAL CASE CONSTRAINT:
This is a procedural ruling (${facts.disposition || 'dismissal'}).
- who_wins MUST be: "Procedural ruling - no merits decision" or similar
- who_loses MUST be: "Case dismissed on procedural grounds" or similar
- Do NOT claim a substantive winner/loser
- summary_spicy should focus on WHY it was dismissed and who benefits from delay
`;
  }

  // CERT_STAGE CASES: Grant/deny cert language only
  if (facts.case_type === 'cert_stage') {
    constraints += `
CERT STAGE CONSTRAINT:
This is a cert-stage action (grant/deny of certiorari).
- Do NOT describe a merits outcome - no merits were decided
- who_wins/who_loses must reflect access to SCOTUS review ONLY
- Example who_wins: "Petitioner gains Supreme Court review"
- Example who_loses: "Respondent must defend at highest level"
- For cert denied: "Lower court ruling stands" NOT "X wins on the merits"
`;
  }

  // SHADOW_DOCKET CASES: Emergency order language
  if (facts.case_type === 'shadow_docket') {
    constraints += `
SHADOW DOCKET CONSTRAINT:
This is an emergency order (stay/injunction/application) - NOT a final merits ruling.
- Do NOT claim a final merits holding
- Focus on IMMEDIATE operational effect only
- who_wins/who_loses should reflect emergency posture
- Use language like "emergency relief granted/denied" NOT "Court rules..."
- Note this is temporary/expedited if applicable
`;
  }

  // DISPOSITION LOCK: Must appear verbatim
  if (facts.disposition) {
    constraints += `
DISPOSITION LOCK:
The disposition is "${facts.disposition}". This word MUST appear in summary_spicy.
`;
  }

  // FACTS TO INCORPORATE
  const factsSection = `
PASS 1 FACTS (LOCKED - do not contradict these):
- Disposition: ${facts.disposition || 'unknown'}
- Merits Reached: ${facts.merits_reached === true ? 'yes' : facts.merits_reached === false ? 'no' : 'unclear'}
- Case Type: ${facts.case_type || 'unclear'}
- Holding: ${facts.holding || 'not extracted'}
- Prevailing Party: ${facts.prevailing_party || 'unclear'}
- Practical Effect: ${facts.practical_effect || 'not extracted'}
`;

  // Build base prompt
  const basePrompt = `${factsSection}

${variationInjection}

CASE DATA:
Case: ${scotusCase.case_name}
Term: ${scotusCase.term || 'Unknown'}
Decided: ${scotusCase.decided_at || 'Pending'}
Vote: ${scotusCase.vote_split || 'Unknown'}
Majority: ${scotusCase.majority_author || 'Unknown'}
Dissent: ${scotusCase.dissent_authors?.join(', ') || 'None'}

Generate the editorial JSON. Your summary_spicy and why_it_matters must be CONSISTENT with the Pass 1 facts above.
The disposition word "${facts.disposition || '[unknown]'}" MUST appear in summary_spicy.`;

  return constraints ? `${constraints}\n\n${basePrompt}` : basePrompt;
}

// ============================================================================
// DRIFT VALIDATION
// ============================================================================

/**
 * Validates that Pass 2 editorial doesn't contradict Pass 1 facts.
 * Returns severity: 'hard' (auto-flag+clear), 'soft' (flag+keep draft), or 'none' (clean)
 *
 * @param {Object} facts - Pass 1 output
 * @param {Object} editorial - Pass 2 output
 * @returns {Object} { severity, hasDrift, reason, hardIssues, softIssues }
 */
export function validateNoDrift(facts, editorial) {
  const hardIssues = [];
  const softIssues = [];

  const practicalLower = (facts.practical_effect || '').toLowerCase();
  const summaryLower = (editorial.summary_spicy || '').toLowerCase();
  const whoWinsLower = (editorial.who_wins || '').toLowerCase();

  // ===== HARD DRIFT: Auto-flag + CLEAR editorial =====
  // These are factual contradictions where Pass 2 claims something Pass 1 explicitly denies

  // 1. Procedural mismatch (HARD) - claims substantive winner when no merits reached
  // Use word boundary regex to avoid false positives like "long-standing" or "outstanding"
  if (facts.merits_reached === false || facts.case_type === 'procedural') {
    const proceduralSignals = /\b(procedural|dismissed|no merits|standing dismissal|lack of standing|standing to)\b/i;
    if (!proceduralSignals.test(whoWinsLower)) {
      hardIssues.push('Procedural mismatch: who_wins claims substantive winner');
    }
  }

  // 2. Cert stage mismatch (HARD) - claims merits outcome for cert grant/deny
  // Added "stands" for "Lower court ruling stands" language
  if (facts.case_type === 'cert_stage') {
    if (!whoWinsLower.includes('review') && !whoWinsLower.includes('cert') &&
        !whoWinsLower.includes('denied') && !whoWinsLower.includes('granted') &&
        !whoWinsLower.includes('stands')) {
      hardIssues.push('Cert stage mismatch: who_wins claims merits outcome');
    }
  }

  // 3. Shadow docket mismatch (HARD) - claims final merits ruling for emergency order
  if (facts.case_type === 'shadow_docket') {
    if (summaryLower.includes('final') || summaryLower.includes('ruled on the merits')) {
      hardIssues.push('Shadow docket mismatch: summary claims final merits ruling');
    }
  }

  // ===== SOFT DRIFT: Flag but KEEP editorial draft for review =====
  // These are suspicious but not explicit contradictions

  // 4. Disposition word missing (SOFT) - editorial should mention the disposition
  if (facts.disposition && !summaryLower.includes(facts.disposition.toLowerCase())) {
    softIssues.push(`Disposition missing: "${facts.disposition}" not in summary`);
  }

  // 5. Meaning inversion (SOFT) - opposite words used
  // Use word boundary regex to avoid false positives like "unlimited" matching "limits"
  const invertPairs = [
    ['harder', 'easier'],
    ['restricts', 'expands'],
    ['limits', 'broadens'],
    ['narrows', 'widens'],
    ['strengthens', 'weakens'],
    ['helps', 'hurts'],
    ['benefits', 'harms'],
  ];

  for (const [word1, word2] of invertPairs) {
    const regex1 = new RegExp(`\\b${word1}\\b`, 'i');
    const regex2 = new RegExp(`\\b${word2}\\b`, 'i');

    if (regex1.test(practicalLower) && regex2.test(summaryLower)) {
      softIssues.push(`Inversion: facts say "${word1}", editorial says "${word2}"`);
    }
    if (regex2.test(practicalLower) && regex1.test(summaryLower)) {
      softIssues.push(`Inversion: facts say "${word2}", editorial says "${word1}"`);
    }
  }

  // 6. Suspicious numbers (SOFT) - numbers in editorial not grounded in facts
  const meaningfulNumberPattern = /\$[\d,]+|\d+\s*%|\d+\s*(million|billion|years?)/gi;
  const numbersInSummary = (summaryLower.match(meaningfulNumberPattern) || [])
    .map(n => n.replace(/\s+/g, ' ').trim());
  const numbersInFacts = [
    ...(practicalLower.match(meaningfulNumberPattern) || []),
    ...((facts.holding || '').toLowerCase().match(meaningfulNumberPattern) || [])
  ].map(n => n.replace(/\s+/g, ' ').trim());

  for (const num of numbersInSummary) {
    if (!numbersInFacts.some(f => f.includes(num) || num.includes(f))) {
      softIssues.push(`Suspicious number: "${num}" not in facts`);
    }
  }

  // 7. Speculative language (SOFT) - hedged claims not in facts
  const speculativePatterns = ['could lead to', 'might result in', 'potentially'];
  for (const phrase of speculativePatterns) {
    if (summaryLower.includes(phrase) && !practicalLower.includes(phrase)) {
      softIssues.push(`Speculative language: "${phrase}"`);
    }
  }

  // Determine severity
  if (hardIssues.length > 0) {
    return {
      severity: 'hard',
      hasDrift: true,
      reason: hardIssues.join('; '),
      hardIssues,
      softIssues
    };
  }

  if (softIssues.length > 0) {
    return {
      severity: 'soft',
      hasDrift: true,
      reason: softIssues.join('; '),
      hardIssues: [],
      softIssues
    };
  }

  return {
    severity: 'none',
    hasDrift: false,
    reason: null,
    hardIssues: [],
    softIssues: []
  };
}

/**
 * Check if case data is eligible for automatic publishing
 */
export function isPublishEligible(caseData) {
  // Required conditions
  if (caseData.fact_extraction_confidence !== 'high') return false;
  if (caseData.enrichment_status !== 'enriched') return false;
  if (caseData.drift_detected === true) return false;
  if (caseData.consistency_check_failed === true) return false;

  return true;
}
