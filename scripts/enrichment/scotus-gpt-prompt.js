/**
 * GPT Enrichment Prompt for SCOTUS Cases (TTRC-340)
 *
 * Transforms CourtListener case data into reader-facing editorial copy.
 * Uses ruling_impact_level (0-5) to calibrate tone.
 *
 * Voice: Pro-people, anti-corporate, anti-authoritarian.
 * SCOTUS should protect regular people but usually serves corporations,
 * billionaires, and government power. When they get it right, note it.
 *
 * Dependencies:
 *   - Variation pools: scripts/enrichment/scotus-variation-pools.js
 *   - Schema: migrations/050-scotus-cases.sql (TBD)
 */

// ============================================================================
// RULING IMPACT LEVELS (0-5 scale)
// ============================================================================

export const RULING_IMPACT_LEVELS = {
  5: {
    label: 'Constitutional Crisis',
    color: '🔴',
    editorial_logic: 'Precedent is dead. Raw power or billionaire money has replaced the law.',
    profanity: true,
    tone: 'Alarm bells. Name who killed what precedent and who profits. Be furious.'
  },
  4: {
    label: 'Rubber-stamping Tyranny',
    color: '🟠',
    editorial_logic: "They didn't just fail to stop overreach; they gave it a legal high-five.",
    profanity: true,
    tone: 'Angry. Focus on the victims. Name the power they just blessed.'
  },
  3: {
    label: 'Institutional Sabotage',
    color: '🟡',
    editorial_logic: 'Technical, "boring" legal moves that make rights impossible to use or gut regulations.',
    profanity: false,
    tone: 'Sardonic/Snarky. Explain the "trick" - how this technical move screws people in practice.'
  },
  2: {
    label: 'Judicial Sidestepping',
    color: '🔵',
    editorial_logic: 'The "Kick the Can" move. Avoiding the merits to let a bad status quo continue.',
    profanity: false,
    tone: 'Eye-roll. Lazy employees energy. Explain what they refused to decide and who benefits from delay.'
  },
  1: {
    label: 'Crumbs from the Bench',
    color: '⚪',
    editorial_logic: "A win for the people, but it's narrow, fragile, and temporary.",
    profanity: false,
    tone: 'Cautiously skeptical. Credit the win, then flag the limiting language and why it might not last.'
  },
  0: {
    label: 'Democracy Wins',
    color: '🟢',
    editorial_logic: 'A rare win where the system protects the vulnerable over the powerful.',
    profanity: false,
    tone: 'Sincere. Credit where due. Note why this actually protects people and is hard to walk back.'
  }
};

// ============================================================================
// ISSUE AREA LABELS
// ============================================================================

export const ISSUE_AREA_LABELS = {
  voting_rights: 'Voting rights, election law, gerrymandering',
  agency_power: 'Agency authority, Chevron deference, regulations',
  executive_power: 'Presidential power, immunity, executive privilege',
  criminal_procedure: 'Fourth Amendment, police power, incarceration',
  civil_rights: 'Discrimination, equal protection, civil liberties',
  first_amendment: 'Speech, religion, press, assembly',
  corporate_liability: 'Business regulation, liability, consumer protection',
  labor_rights: 'Workers, unions, employment law',
  environmental: 'EPA, climate, environmental regulation',
  healthcare: 'ACA, reproductive rights, medical decisions',
  immigration: 'Border, asylum, deportation',
  gun_rights: 'Second Amendment, gun regulations',
  other: 'Other constitutional or statutory interpretation'
};

// ============================================================================
// SYSTEM PROMPT
// ============================================================================

export const SYSTEM_PROMPT = `You are the editorial engine for TrumpyTracker's SCOTUS tracker.

═══════════════════════════════════════════════════════════════════════════════
VOICE: "THE BETRAYAL"
═══════════════════════════════════════════════════════════════════════════════

The people supposed to protect the law are lighting it on fire.

The Supreme Court is meant to be the guardian of rights. Instead, we're watching guardians become arsonists. When billionaire donors get favorable rulings from justices they wined and dined, when precedent gets torched to serve power, when "originalism" becomes whatever serves the agenda—that's The Betrayal.

# MISSION
Analyze Supreme Court rulings from a fiercely pro-people, anti-corporate, and anti-authoritarian perspective. You do NOT do "both sides." You expose how the Court favors capital and control over human life.

═══════════════════════════════════════════════════════════════════════════════
TONE CALIBRATION BY RULING IMPACT LEVEL (0-5)
═══════════════════════════════════════════════════════════════════════════════

LEVEL 5 🔴 [Constitutional Crisis]
Meaning: Precedent is dead. Raw power or billionaire money has replaced the law.
Tone: Cold fury. Prosecutorial. The guardians have become arsonists.
Profanity: YES - for incredulity, not spray. "They actually fucking did it."
Focus: Name the corrupt actors. Name who bought this ruling. Name the precedent they killed.

LEVEL 4 🟠 [Rubber-stamping Tyranny]
Meaning: The Court green-lights police violence, surveillance, state overreach, or executive power grabs.
Tone: Angry accountability. The bench just blessed authoritarianism.
Profanity: YES - when it lands. "Another bullshit ruling that lets cops kill with impunity."
Focus: The victims. The power they just blessed. The dissent's warning.

LEVEL 3 🟡 [Institutional Sabotage]
Meaning: Technical, "boring" legal moves that make rights impossible to use or gut regulations.
Tone: Sardonic/Snarky. "This ruling sounds boring. That's the point."
Profanity: NO.
Focus: Explain the "trick" - how this technical move screws people in practice.

LEVEL 2 🔵 [Judicial Sidestepping]
Meaning: The "Kick the Can" move. Avoiding the merits to let a bad status quo continue.
Tone: Eye-roll. Lazy employees energy. Nine robes, zero courage.
Profanity: NO.
Focus: What they refused to decide. Who benefits from delay.

LEVEL 1 ⚪ [Crumbs from the Bench]
Meaning: A win for the people, but it's narrow, fragile, and temporary.
Tone: Cautiously skeptical. Credit the win, but flag the limiting language.
Profanity: NO.
Focus: Why this might not last. The asterisk matters.

LEVEL 0 🟢 [Democracy Wins]
Meaning: A rare win where the system protects the vulnerable over the powerful.
Tone: Suspicious celebration. Genuine disbelief the system worked. Don't get used to it.
Profanity: NO.
Focus: Why this actually protects people. Why it's hard to walk back.

# TONE & STYLE RULES

1. **FOLLOW THE MONEY**: If a ruling benefits Federalist Society donors (Leonard Leo, Koch network, Harlan Crow), dark money groups, or billionaire-funded plaintiffs, CALL IT OUT by name in Levels 4-5.

2. **THE HUMAN COST**: Always explain how this affects a real person's wallet, body, or freedom. Not abstract "rights" - YOUR rights, YOUR money, YOUR freedom.

3. **NO LEGALESE**: Translate legal jargon into plain English:
   - "Standing" = "technical excuse to avoid ruling"
   - "Deference" = "letting agencies do their job" (or not)
   - "Certiorari denied" = "refused to hear it"
   - "Remanded" = "punted back to lower court"

4. **NO BOTH-SIDES**: Do NOT provide balanced "on the other hand" framing. This is pro-people, anti-fascist editorial. When corporations or authoritarians win, say so plainly.

5. **PROFANITY**: Use for maximum impact in Levels 4-5 ONLY. Make it land, don't spray it.

6. **EVIDENCE ANCHORED**: Every claim must reference the opinion. Use these tags:
   - [syllabus] for official summary
   - [majority §II.A] for majority opinion sections
   - [dissent, Sotomayor J.] for dissent quotes
   - [concurrence, Kagan J.] for concurrences

# BANNED OPENINGS (Never use these)
- "This is outrageous..."
- "In a shocking move..."
- "Once again..."
- "It's no surprise..."
- "Make no mistake..."
- "Let that sink in..."

# OUTPUT FORMAT (JSON)
{
  "ruling_impact_level": 0-5,
  "ruling_label": "Label from scale above",
  "who_wins": "Explicit beneficiary - be specific (corporations, police, billionaires, etc.)",
  "who_loses": "Explicit victim - be specific (workers, voters, patients, etc.)",
  "summary_spicy": "3-4 sentences. Editorial spin using the designated tone for that level.",
  "why_it_matters": "1-2 sentences. Systemic implication, pattern, or precedent impact.",
  "dissent_highlights": "1-2 sentences. Key dissent warning. Use null if unanimous good ruling.",
  "evidence_anchors": ["syllabus", "majority §III", "dissent, Jackson J."]
}`;

// ============================================================================
// USER PROMPT BUILDER
// ============================================================================

/**
 * Build the user message for GPT enrichment
 * @param {Object} scotusCase - Case record from scotus_cases table
 * @param {string} variationInjection - Creative direction from variation pools
 * @returns {string} User prompt
 */
export function buildUserPrompt(scotusCase, variationInjection = '') {
  const {
    case_name,
    case_name_short,
    docket_number,
    term,
    decided_at,
    argued_at,
    vote_split,
    majority_author,
    dissent_authors,
    syllabus,
    opinion_excerpt,
    issue_area,
    petitioner_type,
    respondent_type
  } = scotusCase;

  // Normalize text fields (handle null/empty)
  const docketNumber = (docket_number || '').trim();
  const syllabusText = (syllabus || '').trim();
  const excerptText = (opinion_excerpt || '').trim();

  // Use syllabus if available, otherwise fall back to opinion excerpt
  const textToAnalyze = syllabusText || excerptText || 'No syllabus available - use opinion text provided';

  // Format dissenting justices
  const dissentText = dissent_authors?.length > 0
    ? `Dissenting: ${dissent_authors.join(', ')}`
    : 'No dissent (unanimous or per curiam)';

  // Issue area label
  const issueLabel = ISSUE_AREA_LABELS[issue_area] || issue_area || 'General';

  // Party context if available
  const partyContext = (petitioner_type || respondent_type)
    ? `\nParties: ${petitioner_type || 'Unknown'} v. ${respondent_type || 'Unknown'}`
    : '';

  let prompt = `CASE DATA:
Case: ${case_name}${case_name_short ? ` (${case_name_short})` : ''}
Docket: ${docketNumber || 'N/A'}
Term: ${term || 'Unknown'}
Decided: ${decided_at || 'Pending'}${argued_at ? `\nArgued: ${argued_at}` : ''}
${partyContext}

VOTE:
Split: ${vote_split || 'Unknown'}
Majority Author: ${majority_author || 'Unknown'}
${dissentText}

ISSUE AREA: ${issueLabel}

SYLLABUS/HOLDING:
${textToAnalyze}

${variationInjection ? `\n${variationInjection}\n` : ''}
Analyze this ruling and generate the editorial JSON. Remember:
- Identify WHO WINS and WHO LOSES explicitly
- Use the appropriate tone for the ruling_impact_level you assign
- Anchor claims to [syllabus], [majority], or [dissent]
- No both-sides framing`;

  return prompt;
}

// ============================================================================
// CLASSIFICATION HELPER
// ============================================================================

/**
 * Suggest a ruling impact level based on case metadata
 * This is a hint for GPT - it makes final determination
 *
 * @param {Object} caseData - Case metadata
 * @returns {number|null} Suggested level 0-5, or null if uncertain
 */
export function suggestImpactLevel(caseData) {
  const {
    precedent_overturned,
    vote_split,
    issue_area,
    petitioner_type,
    respondent_type
  } = caseData;

  // Level 5: Precedent overturned + corporate/government wins
  if (precedent_overturned) {
    return 5;
  }

  // Level 0: Unanimous + individual wins against corporation/government
  if (vote_split === '9-0') {
    if (petitioner_type === 'individual' &&
        (respondent_type === 'corporation' || respondent_type === 'government')) {
      return 0;
    }
  }

  // Let GPT determine based on content
  return null;
}

// ============================================================================
// RESPONSE VALIDATION
// ============================================================================

/**
 * Validate GPT response structure
 * @param {Object} response - Parsed JSON response
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEnrichmentResponse(response) {
  const errors = [];

  // Required: ruling_impact_level
  if (response.ruling_impact_level === undefined ||
      response.ruling_impact_level === null ||
      response.ruling_impact_level < 0 ||
      response.ruling_impact_level > 5) {
    errors.push('ruling_impact_level must be 0-5');
  }

  // Required: ruling_label
  const validLabels = [
    'Constitutional Crisis',
    'Rubber-stamping Tyranny',
    'Institutional Sabotage',
    'Judicial Sidestepping',
    'Crumbs from the Bench',
    'Democracy Wins'
  ];
  if (!response.ruling_label || !validLabels.includes(response.ruling_label)) {
    errors.push(`ruling_label must be one of: ${validLabels.join(', ')}`);
  }

  // Required: who_wins
  if (!response.who_wins || typeof response.who_wins !== 'string' || response.who_wins.length < 5) {
    errors.push('who_wins must be a specific description (min 5 chars)');
  }

  // Required: who_loses
  if (!response.who_loses || typeof response.who_loses !== 'string' || response.who_loses.length < 5) {
    errors.push('who_loses must be a specific description (min 5 chars)');
  }

  // Required: summary_spicy
  if (!response.summary_spicy || typeof response.summary_spicy !== 'string') {
    errors.push('Missing or invalid summary_spicy');
  } else if (response.summary_spicy.length < 100) {
    errors.push('summary_spicy too short (min 100 chars)');
  } else if (response.summary_spicy.length > 1500) {
    errors.push('summary_spicy too long (max 1500 chars)');
  }

  // Required: why_it_matters
  if (!response.why_it_matters || typeof response.why_it_matters !== 'string') {
    errors.push('Missing or invalid why_it_matters');
  } else if (response.why_it_matters.length < 50) {
    errors.push('why_it_matters too short (min 50 chars)');
  } else if (response.why_it_matters.length > 600) {
    errors.push('why_it_matters too long (max 600 chars)');
  }

  // Optional: dissent_highlights (can be null for unanimous good rulings)
  if (response.dissent_highlights !== null && response.dissent_highlights !== undefined) {
    if (typeof response.dissent_highlights !== 'string') {
      errors.push('dissent_highlights must be string or null');
    } else if (response.dissent_highlights.length > 0 && response.dissent_highlights.length < 30) {
      errors.push('dissent_highlights too short if provided (min 30 chars)');
    } else if (response.dissent_highlights.length > 500) {
      errors.push('dissent_highlights too long (max 500 chars)');
    }
  }

  // Required: evidence_anchors (array of strings)
  if (!response.evidence_anchors || !Array.isArray(response.evidence_anchors)) {
    errors.push('Missing or invalid evidence_anchors array');
  } else if (response.evidence_anchors.length === 0) {
    errors.push('evidence_anchors cannot be empty - must cite sources');
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// PROFANITY CHECK
// ============================================================================

/**
 * Check if profanity is allowed for this level
 * @param {number} level - Ruling impact level (0-5)
 * @returns {boolean}
 */
export function profanityAllowed(level) {
  return RULING_IMPACT_LEVELS[level]?.profanity ?? false;
}

/**
 * Get level info by number
 * @param {number} level - Ruling impact level (0-5)
 * @returns {Object} Level configuration
 */
export function getLevelInfo(level) {
  return RULING_IMPACT_LEVELS[level] || RULING_IMPACT_LEVELS[3];
}
