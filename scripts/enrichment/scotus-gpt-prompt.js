/**
 * GPT Enrichment Prompt for SCOTUS Cases (TTRC-340 / ADO-280)
 *
 * Transforms CourtListener case data into reader-facing editorial copy.
 * Uses ruling_impact_level (0-5) to calibrate tone.
 *
 * ADO-280 Two-Pass Architecture:
 * - Pass 1: Fact extraction (handled by scotus-fact-extraction.js)
 * - Pass 2: Editorial framing (this module) - receives locked facts
 *
 * Voice: Pro-people, anti-corporate, anti-authoritarian.
 * SCOTUS should protect regular people but usually serves corporations,
 * billionaires, and government power. When they get it right, note it.
 *
 * Dependencies:
 *   - Variation pools: scripts/enrichment/scotus-variation-pools.js
 *   - Fact extraction: scripts/enrichment/scotus-fact-extraction.js
 *   - Schema: migrations/066_scotus_cases.sql, 067_scotus_two_pass.sql
 */

// ============================================================================
// RULING IMPACT LEVELS (0-5 scale)
// ============================================================================

// ADO-323: Prompt version for idempotency tracking
export const PASS2_PROMPT_VERSION = 'v3-ado354-concrete-facts';

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
// ADO-354: SOURCE TEXT SANITIZER FOR PASS 2
// ============================================================================

const PASS2_SOURCE_TEXT_CAP = 5000;

function sanitizeSourceText(text) {
  text = String(text || '');
  if (!text) return '';
  let cleaned = text;
  // Strip zero-width chars and prompt-ish artifacts
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
  // Only strip header-ish docket patterns near the top (first 500 chars)
  const top = cleaned.slice(0, 500);
  const rest = cleaned.slice(500);
  cleaned = top
    .replace(/SUPREME COURT OF THE UNITED STATES/gi, '')
    .replace(/No\.\s+\d+[-–]\d+/g, '')
    + rest;
  // Global cleanup
  cleaned = cleaned
    .replace(/<[^>]+>/g, '')           // HTML tags
    .replace(/<<<.*?>>>/g, '')         // Strip our own delimiters (prevent injection)
    .replace(/\n{3,}/g, '\n\n')        // collapse 3+ newlines
    .replace(/[ \t]{2,}/g, ' ')        // collapse whitespace
    .trim();
  if (cleaned.length > PASS2_SOURCE_TEXT_CAP) {
    cleaned = cleaned.slice(0, PASS2_SOURCE_TEXT_CAP) + '\n\n[TRUNCATED]';
  }
  return cleaned;
}

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

# BANNED OPENINGS (Never use these - they're boring and formulaic)
- "The Court..." or "The Supreme Court..." (NEVER start with this)
- "In a [X-Y] decision..." or "In a ruling..."
- "This is outrageous..."
- "In a shocking move..."
- "Once again..."
- "It's no surprise..."
- "Make no mistake..."
- "Let that sink in..."

# SUMMARY_SPICY OPENER RULES (Critical - read carefully)
Jump right into the IMPACT. Start with:
- The human cost: "Your voting rights just got gutted."
- The winner's gain: "Texas can now gerrymander freely."
- The stakes: "Federal prisoners finally caught a break."
- A punchy fact: "Unanimous. Not a single justice dissented."

Do NOT start with "The Court" - we know it's the Court, get to the point.

# OUTPUT FORMAT (JSON)
{
  "ruling_impact_level": 0-5,
  "ruling_label": "Label from scale above",
  "who_wins": "1-2 sentences. Who benefits from this ruling and HOW it specifically helps them.",
  "who_loses": "1-2 sentences. Who is harmed by this ruling and WHAT they lose because of it.",
  "summary_spicy": "3-4 sentences. Editorial spin using the designated tone for that level.",
  "why_it_matters": "2-3 sentences. The FIRST sentence MUST contain at least one concrete fact from the opinion: a party name, statute or citation (e.g. '18 U.S.C. §924(c)', 'Chapter 64'), a legal standard, a dollar amount, or a specific timeline/date. Do NOT restate the holding — assume the reader saw it. Use the fact as the hook, then go straight to real-world consequences. Example: 'Escolastica Harrison spent 15 years seeking DNA testing under Texas Chapter 64, and this ruling slams that door shut. Any Texas prisoner claiming innocence now faces a higher bar that most can't clear without a lawyer they can't afford.' If you fail to lead with a concrete fact, you will be asked to rewrite.",
  "dissent_highlights": "1-2 sentences. Key dissent warning. If no dissent, use null (not 'None' or 'N/A').",
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

// ADO-303: Generic party patterns to ban in who_wins/who_loses
const GENERIC_PARTY_PATTERNS = [
  /^the\s+(petitioner|respondent|plaintiff|defendant)s?\.?$/i,
  /^(petitioner|respondent|plaintiff|defendant)s?\.?$/i,
  /^(petitioner|respondent|plaintiff|defendant)s?\s+(wins|loses|prevails|benefits)\.?$/i,
];

/**
 * ADO-303: Check if text is a banned generic party label
 * Banned: "petitioner", "the petitioner", "respondent", etc.
 * Must include proper noun OR meaningful descriptor
 *
 * @param {string} text - who_wins or who_loses value
 * @returns {boolean} true if generic (banned), false if specific (ok)
 */
export function isGenericParty(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  return GENERIC_PARTY_PATTERNS.some(p => p.test(trimmed));
}

/**
 * ADO-303: Lint who_wins/who_loses for generic party labels
 * For use in publish gate
 *
 * @param {Object} editorial - Pass 2 output with who_wins, who_loses
 * @returns {{ valid: boolean, issues: string[], genericFields: string[] }}
 */
export function lintGenericParties(editorial) {
  const issues = [];
  const genericFields = [];

  if (isGenericParty(editorial?.who_wins)) {
    issues.push(`who_wins is generic: "${editorial.who_wins}"`);
    genericFields.push('who_wins');
  }

  if (isGenericParty(editorial?.who_loses)) {
    issues.push(`who_loses is generic: "${editorial.who_loses}"`);
    genericFields.push('who_loses');
  }

  return {
    valid: issues.length === 0,
    issues,
    genericFields
  };
}

/**
 * ADO-354: Check if first sentence contains a concrete fact marker
 * (name, statute, date, amount, or timeline)
 *
 * @param {string} text - why_it_matters text
 * @param {string} caseName - Case name for party-name extraction
 * @returns {{ passed: boolean, reason: string|null }}
 */
export function hasConcreteFactMarker(text, caseName = '') {
  if (!text || typeof text !== 'string') return { passed: false, reason: 'empty' };

  // Safe first-sentence extraction (no lookbehind)
  const m = text.match(/^.*?[.!?](?:\s|$)/);
  const firstSentence = (m ? m[0] : text).trim();

  // Digits (dates, dollar amounts, timelines, statute numbers)
  if (/\d/.test(firstSentence)) return { passed: true, reason: null };

  // Statute/citation markers
  if (/\bU\.?\s?S\.?\s?C\.?|\b§\b|\bChapter\s+\w+|\bRule\s+\d+|\bAmendment\b/i.test(firstSentence)) {
    return { passed: true, reason: null };
  }

  // Time references (require adjacent digit: "15 years", "60 days", not bare "years")
  if (/\d+\s*(year|years|months?|days?|decades?|centur(?:y|ies))\b/i.test(firstSentence)) {
    return { passed: true, reason: null };
  }

  // Party names from case_name
  if (caseName) {
    const parties = caseName
      .replace(/,?\s*et\s+al\.?/gi, '')
      .split(/\s+v\.?\s+/i)
      .map(p => p.trim())
      .filter(Boolean);
    for (const party of parties) {
      const words = party.split(/\s+/).filter(w =>
        w.length > 2 && !/^(the|and|for|inc|llc|corp|of)$/i.test(w)
      );
      const normalFirst = firstSentence.toLowerCase();
      if (words.some(w => normalFirst.includes(w.toLowerCase()))) {
        return { passed: true, reason: null };
      }
    }
  }

  return { passed: false, reason: 'First sentence lacks concrete fact (name, statute, date, amount, or timeline)' };
}

/**
 * ADO-354: Check for abstract openers (Option B — allows opener if fact marker present)
 *
 * @param {string} text - why_it_matters text
 * @param {string} caseName - Case name for party-name extraction
 * @returns {{ passed: boolean, reason: string|null }}
 */
const ABSTRACT_OPENERS = [
  /^this ruling\b/i,
  /^the court\b/i,
  /^the decision\b/i,
  /^this case\b/i,
  /^this decision\b/i,
  /^the ruling\b/i,
];

export function checkNoAbstractOpener(text, caseName = '') {
  if (!text || typeof text !== 'string') return { passed: true, reason: null };
  const trimmed = text.trimStart();
  for (const pattern of ABSTRACT_OPENERS) {
    if (pattern.test(trimmed)) {
      const factCheck = hasConcreteFactMarker(text, caseName);
      if (factCheck.passed) return { passed: true, reason: null };
      return { passed: false, reason: `why_it_matters starts with abstract opener: "${trimmed.slice(0, 30)}..."` };
    }
  }
  return { passed: true, reason: null };
}

/**
 * ADO-354: Validate that citations in why_it_matters are grounded in source text
 * Separate from validateEnrichmentResponse — needs sourceText which is only available in Pass 2
 *
 * @param {string} whyItMatters - why_it_matters text
 * @param {string} sourceText - Sanitized source text injected into Pass 2 prompt
 * @param {Object} facts - Pass 1 facts (holding, practical_effect)
 * @returns {{ passed: boolean, suspicious: string[] }}
 */
export function validateFactGrounding(whyItMatters, sourceText = '', facts = {}) {
  if (!whyItMatters) return { passed: true, suspicious: [] };

  // Skip grounding if source text is too short to be meaningful
  if ((sourceText || '').length < 200) return { passed: true, suspicious: [] };

  const normalize = (s) => (s || '').toLowerCase().replace(/[^\w§.]/g, ' ').replace(/\s+/g, ' ');
  const reference = normalize([
    sourceText,
    facts.holding || '',
    facts.practical_effect || '',
  ].join(' '));

  const suspicious = [];

  // Extract statute-like patterns (U.S.C., §, Chapter, Rule)
  const cites = whyItMatters.match(
    /\d+\s*U\.?\s?S\.?\s?C\.?\s*§?\s*\d+|\b§\s*\d+[\w.()]*|\bChapter\s+\d+|\bRule\s+\d+/gi
  ) || [];

  for (const cite of cites) {
    const normalCite = normalize(cite).trim();
    if (!reference.includes(normalCite)) {
      suspicious.push(cite);
    }
  }

  return { passed: suspicious.length === 0, suspicious };
}

/**
 * Validate GPT response structure
 * ADO-354: Updated signature to accept opts for caseName-based concrete fact checks
 *
 * @param {Object} response - Parsed JSON response
 * @param {Object} [opts] - Options: { caseName: string }
 * @returns {{valid: boolean, errors: string[]}}
 */
export function validateEnrichmentResponse(response, opts) {
  opts = (opts && typeof opts === 'object') ? opts : {};
  const caseName = typeof opts.caseName === 'string' ? opts.caseName : '';
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

  // Required: why_it_matters (ADO-354: updated bounds 80-800)
  if (!response.why_it_matters || typeof response.why_it_matters !== 'string') {
    errors.push('Missing or invalid why_it_matters');
  } else if (response.why_it_matters.length < 80) {
    errors.push('why_it_matters too short (min 80 chars)');
  } else if (response.why_it_matters.length > 800) {
    errors.push('why_it_matters too long (max 800 chars)');
  }

  // ADO-354: Concrete fact + no abstract opener checks
  if (response.why_it_matters && typeof response.why_it_matters === 'string') {
    const factMarker = hasConcreteFactMarker(response.why_it_matters, caseName);
    if (!factMarker.passed) {
      errors.push(`why_it_matters: ${factMarker.reason}`);
    }
    const openerCheck = checkNoAbstractOpener(response.why_it_matters, caseName);
    if (!openerCheck.passed) {
      errors.push(openerCheck.reason);
    }
  }

  // Optional: dissent_highlights (can be null for unanimous/no-dissent rulings)
  // Strings < 30 chars are treated as "no meaningful content" and allowed
  // Only validate length if >= 30 chars (then must be <= 500)
  {
    const dissent = response.dissent_highlights;

    if (dissent !== null && dissent !== undefined) {
      if (typeof dissent !== 'string') {
        errors.push('dissent_highlights must be string or null');
      } else {
        const trimmed = dissent.trim();
        // Only enforce max length if there's substantial content
        if (trimmed.length >= 30 && trimmed.length > 500) {
          errors.push('dissent_highlights too long (max 500 chars)');
        }
        // Anything < 30 chars is treated as null-equivalent (placeholder text)
      }
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

// ============================================================================
// PASS 2: EDITORIAL FRAMING (ADO-280)
// ============================================================================

/**
 * Pass 2 System Prompt - Editorial framing with locked facts
 * Uses the same voice/tone system as SYSTEM_PROMPT but with constraints
 */
export const PASS2_SYSTEM_PROMPT = `You are the editorial engine for TrumpyTracker's SCOTUS tracker.

═══════════════════════════════════════════════════════════════════════════════
VOICE: "THE BETRAYAL"
═══════════════════════════════════════════════════════════════════════════════

The people supposed to protect the law are lighting it on fire.

The Supreme Court is meant to be the guardian of rights. Instead, we're watching guardians become arsonists. When billionaire donors get favorable rulings from justices they wined and dined, when precedent gets torched to serve power, when "originalism" becomes whatever serves the agenda—that's The Betrayal.

# MISSION
Analyze Supreme Court rulings from a fiercely pro-people, anti-corporate, and anti-authoritarian perspective. You do NOT do "both sides." You expose how the Court favors capital and control over human life.

# CRITICAL: FACTS ARE LOCKED
You are receiving PASS 1 FACTS that have been extracted and verified. Your job is to apply EDITORIAL TONE to these facts.

DO NOT:
- Contradict the Pass 1 facts
- Add claims not supported by the facts
- Change who won/lost from what facts indicate
- Invent numbers or statistics

DO:
- Use the appropriate tone for the ruling_impact_level you assign
- Make the facts accessible and impactful for readers
- Follow any CASE TYPE CONSTRAINTS provided (procedural, cert stage, shadow docket)
- Follow the REQUIRED VARIATION block in user message (see below)

# REQUIRED VARIATION (ADO-275)
You will receive a REQUIRED VARIATION block with:
- FRAME: The directional stance to use (procedural, alarmed, critical, grudging_credit)
- STYLE PATTERN: A structural approach to follow (opening, device, structure, closing)

RULES:
- MUST follow the pattern's APPROACH and SPIRIT
- DO NOT copy any literal phrases from the pattern - create fresh openers
- DO NOT use banned template starters (e.g., "Years of precedent. Gone.", "The game was rigged")
- If a MISMATCH FUSE is mentioned, it tells you when/whether to adjust stance
- For CLAMPED cases: mismatch fuse is DISABLED - procedural frame is authoritative

═══════════════════════════════════════════════════════════════════════════════
TONE CALIBRATION BY RULING IMPACT LEVEL (0-5)
═══════════════════════════════════════════════════════════════════════════════

LEVEL 5 🔴 [Constitutional Crisis]
Tone: Cold fury. Prosecutorial. The guardians have become arsonists.
Profanity: YES - for incredulity, not spray. "They actually fucking did it."

LEVEL 4 🟠 [Rubber-stamping Tyranny]
Tone: Angry accountability. The bench just blessed authoritarianism.
Profanity: YES - when it lands.

LEVEL 3 🟡 [Institutional Sabotage]
Tone: Sardonic/Snarky. "This ruling sounds boring. That's the point."
Profanity: NO.

LEVEL 2 🔵 [Judicial Sidestepping]
Tone: Eye-roll. Lazy employees energy. Nine robes, zero courage.
Profanity: NO.

LEVEL 1 ⚪ [Crumbs from the Bench]
Tone: Cautiously skeptical. Credit the win, but flag the limiting language.
Profanity: NO.

LEVEL 0 🟢 [Democracy Wins]
Tone: Suspicious celebration. Genuine disbelief the system worked.
Profanity: NO.

═══════════════════════════════════════════════════════════════════════════════
LABEL-TO-OUTCOME ALIGNMENT (Critical - ADO-305)
═══════════════════════════════════════════════════════════════════════════════

The label MUST match the SYSTEMIC IMPACT on regular people and government power—not just who won this specific case.

"Regular people" = individuals, workers, consumers, tenants, patients, voters, immigrants/asylum seekers, prisoners—i.e., non-institutional actors without structural power.

# WHAT MATTERS MOST:
Priority 1: Does this ruling EXPAND or RESTRICT government/corporate power over people?
Priority 2: Does this ruling SET PRECEDENT that helps or hurts people broadly?
Priority 3: Does the specific litigant's win/loss affect others like them?

A defendant winning a narrow technical case that only affects them personally is NOT automatically Level 0-1.
A ruling that restricts government overreach or expands rights for everyone IS Level 0-1.

# LEVEL MAPPING (use this exactly):
| Level | Label                    | When to use                                      |
|-------|--------------------------|--------------------------------------------------|
| 0     | Democracy Wins           | Clear, durable, broad win for rights/people      |
| 1     | Crumbs from the Bench    | Narrow, fragile, or fact-specific win (may not last) |
| 2     | Judicial Sidestepping    | Procedural - no merits decided                   |
| 3     | Institutional Sabotage   | Incremental/technical harm or tilted procedure   |
| 4     | Rubber-stamping Tyranny  | Clear expansion of coercive state power or major rollback of protections |
| 5     | Constitutional Crisis    | System-level democratic threat                   |

Level 0 vs 1: Use Level 0 when win is durable/broad; Level 1 when narrow, easily reversible, or fact-specific.
Level 3 vs 4: Level 3 = incremental/technical harm; Level 4 = clear expansion of coercive power or major rollback.

# BENEFICIARY BUCKETS (classify the winner into one):

PEOPLE-SIDE (Levels 0-1 when they win AND the ruling has systemic impact):
- Rulings that RESTRICT government/police/prosecutorial overreach broadly
- Rulings that EXPAND rights or protections for a class of people
- Voting rights protected, gerrymandering blocked
- Agency authority to protect people upheld (EPA, CFPB, etc.)
- Immigrants winning on issues that affect immigration policy broadly
- Workers/consumers winning against corporate practices
- Civil rights plaintiffs setting helpful precedent

NOT automatically people-side (even if individual wins):
- Criminal defendant wins narrow technical case affecting only them
- One-off procedural victories with no broader application
- Wealthy/powerful individuals winning against government

POWER-SIDE (Levels 3-5 when they win):
- Government/prosecutors/police expanding coercive power
- Corporations/employers
- Regulatory agency loses power/authority to protect people
- Deregulation outcomes that reduce protections (e.g., limiting agency authority, narrowing enforcement tools)
- Voting restrictions, gerrymandering
- Qualified immunity for officials
- States restricting individual rights

PROCEDURE (Level 2):
- Standing dismissal, jurisdiction, mootness
- Cert denied, DIG (dismissed as improvidently granted)
- Remand that is purely procedural (no new standard, no clear signaling)
- BUT: If procedural dismissal leaves harmful/helpful lower-court outcome in place,
  note in summary who benefits from the status quo staying in effect.

# IMPORTANT NUANCES:

1. Don't moralize the parties by default:
   - Government/corporation ≠ automatically bad
   - Classify by practical effect on people (protections expanded vs reduced)

2. "Defendant wins" is NOT always people-side:
   - Defendant wins AND ruling restricts prosecutorial/government power broadly → Level 0-1
   - Defendant wins narrow technical case affecting only them → Level 2-3 (not systemic)
   - Defendant is corporation/state/wealthy actor → classify by who actually benefits

3. Vacate-and-remand is NOT always Level 2:
   - If opinion includes a substantive legal test or standard of review change, it's NOT Level 2
   - If remand signals clear winner → classify by who benefits
   - Only use Level 2 if outcome is genuinely procedural with no substantive direction

4. Mixed outcomes (both sides win/lose on different issues):
   - Label by the practical bottom-line effect on regular people
   - Ask: "What happens next for the person affected?" - not issue scorekeeping

5. Individual wins but harmful precedent (rare edge case):
   - If immediate winner is people-side but the reasoning narrows rights broadly
   - Classify by NET EFFECT on people generally, not just this case's winner

# MISMATCH CHECK (verify before finalizing):

WRONG:
- Ruling restricts government overreach → "Institutional Sabotage" ❌
- Immigrant wins on issue affecting all deportees → "Rubber-stamping Tyranny" ❌
- Corporation beats workers → "Crumbs from the Bench" ❌
- State gets expanded police power → "Democracy Wins" ❌

RIGHT:
- Ruling restricts prosecutorial/police power broadly → "Crumbs" or "Democracy Wins" ✓
- Defendant wins narrow technical case (no systemic impact) → "Institutional Sabotage" or "Sidestepping" ✓
- Government expands power over immigrants → "Rubber-stamping Tyranny" ✓
- Ruling protects voting rights broadly → "Crumbs" or "Democracy Wins" ✓
- Corporation wins immunity from accountability → "Institutional Sabotage" or higher ✓
- Cert denied / standing dismissal → "Judicial Sidestepping" ✓ (note who benefits)

# SUMMARY_SPICY OPENER RULES (Critical)
BANNED OPENERS - Never start with:
- "The Court..." or "The Supreme Court..."
- "In a [X-Y] decision..." or "In a ruling..."
- "In a move..." or "In a landmark..."

REQUIRED - Jump right into the IMPACT:
- Human cost: "Your voting rights just got gutted."
- Winner's gain: "Texas can now gerrymander freely."
- Stakes: "Federal prisoners finally caught a break."
- Punchy fact: "Unanimous. Not a single justice dissented."

We know it's the Court - get to the point.

# OUTPUT FORMAT (JSON)
{
  "ruling_impact_level": 0-5,
  "ruling_label": "Label from scale above",
  "who_wins": "1-2 sentences. Who benefits from this ruling and HOW it specifically helps them.",
  "who_loses": "1-2 sentences. Who is harmed by this ruling and WHAT they lose because of it.",
  "summary_spicy": "3-4 sentences. Jump straight into impact - NO 'The Court' openers. MUST include disposition word.",
  "why_it_matters": "2-3 sentences. The FIRST sentence MUST contain at least one concrete fact from the opinion: a party name, statute or citation (e.g. '18 U.S.C. §924(c)', 'Chapter 64'), a legal standard, a dollar amount, or a specific timeline/date. Do NOT restate the holding — assume the reader saw it. Use the fact as the hook, then go straight to real-world consequences. Example: 'Escolastica Harrison spent 15 years seeking DNA testing under Texas Chapter 64, and this ruling slams that door shut. Any Texas prisoner claiming innocence now faces a higher bar that most can't clear without a lawyer they can't afford.' If you fail to lead with a concrete fact, you will be asked to rewrite.",
  "dissent_highlights": "1-2 sentences. Key dissent warning. If no dissent, use null.",
  "evidence_anchors": ["syllabus", "majority §III", "dissent, Jackson J."]
}

# WHO_WINS / WHO_LOSES RULES (STRICT - ADO-303)
BANNED standalone labels (will fail validation):
- "petitioner", "the petitioner"
- "respondent", "the respondent"
- "plaintiff", "defendant"

MUST include EITHER:
- A proper noun (e.g., "Texas", "Smith", "the EPA", "Google")
- OR a meaningful descriptor (e.g., "the federal government", "state election officials", "parents challenging the policy", "voters", "corporate defendants")

GOOD examples:
- "Texas and other Republican-led states gain expanded authority to..."
- "Voters in gerrymandered districts lose their ability to..."
- "The federal government loses regulatory power over..."

BAD examples (will be rejected):
- "The petitioner wins"
- "Respondent"

═══════════════════════════════════════════════════════════════════════════════
ACCURACY CONSTRAINTS (Critical - QA will reject violations)
═══════════════════════════════════════════════════════════════════════════════

These constraints override earlier guidance. Spicy tone is allowed (sarcasm, anger, blunt framing),
but factual claims must remain bounded to the holding and this case.

1) WHAT THE COURT ACTUALLY HELD:
   - Only state what the opinion explicitly says
   - Do NOT claim "reversed" unless the holding says reversed
   - Do NOT claim outcomes beyond this specific case

2) BANNED SCALE WORDS (unless the source explicitly supports):
   - "nationwide", "across the country", "millions", "thousands"
   - "every American", "all Americans", "everyone"
   - Use case-specific impact only

3) BANNED SCOPE PHRASES (unless the source explicitly supports):
   - "sets a precedent", "opens the door", "paves the way"
   - "landmark", "groundbreaking", "for the first time"
   - "far-reaching", "sweeping", "broad implications"

4) STAY IN YOUR LANE:
   - If holding is about standing → don't claim merits outcome
   - If holding is about procedure → don't claim substantive rights impact
   - If holding is narrow → don't generalize to all similar cases
   - Standing/procedure examples:
     Good: "The Court tossed this on standing, so the merits never get answered here."
     Bad:  "Rights are gutted" or "the policy is upheld nationwide."

5) TONE-SEVERITY ALIGNMENT:
   - Level 0–1: Positive but not triumphant
   - Level 2: Procedural, matter-of-fact, not dramatic
   - Level 3–5: Critical but grounded — fury must cite specific facts

6) IMPACT WITHOUT OVERCLAIM:
   - Good: "In this case, the plaintiffs lose their challenge to this specific policy."
   - Bad:  "Voting rights nationwide are gutted"
   - Good: "This defendant's conviction stands."
   - Bad:  "Criminal defendants everywhere just lost rights."`;

// ============================================================================
// ADO-300: LABEL CONSTRAINTS FOR CLAMP SYSTEM
// ============================================================================

/**
 * Build label constraints block for Pass 2 prompt
 * Tells GPT which labels are allowed/forbidden based on clamp rules
 *
 * @param {Object} facts - Clamped facts with label_policy from clampAndLabel()
 * @returns {string} Constraint block to inject into Pass 2 prompt
 */
export function buildLabelConstraintsBlock(facts) {
  const allow = facts?.label_policy?.allow || [];
  const forbid = facts?.label_policy?.forbid || [];
  const clamp_reason = facts?.clamp_reason || null;

  // If clamped, be very explicit
  if (clamp_reason) {
    return `
LABEL CONSTRAINT (MANDATORY):
This is a ${clamp_reason.replace(/_/g, ' ')} case.
- ruling_label MUST be "Judicial Sidestepping"
- who_wins MUST be "Procedural ruling - no merits decision"
- who_loses MUST be "Case resolved without a merits ruling"
- Do NOT claim a substantive winner or loser
`.trim();
  }

  // Normal case: provide allowed/forbidden lists
  let block = 'LABEL CONSTRAINTS:\n';

  if (allow.length > 0) {
    block += `- Allowed labels: ${allow.join(', ')}\n`;
  }
  if (forbid.length > 0) {
    block += `- FORBIDDEN labels (do NOT use): ${forbid.join(', ')}\n`;
  }

  if (forbid.includes('Judicial Sidestepping')) {
    block += `- This case has a clear merits disposition and prevailing party. "Judicial Sidestepping" is NOT appropriate.\n`;
  }

  return block.trim();
}

/**
 * Build Pass 2 user prompt with facts and constraints
 *
 * @param {Object} scotusCase - Case record
 * @param {Object} facts - Pass 1 output (disposition, holding, case_type, etc.)
 * @param {string} variationInjection - Creative direction from variation pools
 * @returns {string} User prompt for Pass 2
 */
export function buildPass2UserPrompt(scotusCase, facts, variationInjection = '') {
  // ADO-300: Build and inject label constraints from clampAndLabel()
  const labelConstraints = buildLabelConstraintsBlock(facts);
  let constraints = labelConstraints ? `${labelConstraints}\n\n` : '';

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
`;
  }

  // DISPOSITION LOCK
  if (facts.disposition) {
    constraints += `
DISPOSITION LOCK:
The disposition is "${facts.disposition}". This word MUST appear in summary_spicy.
`;
  }

  // Format dissent info
  const dissentInfo = scotusCase.dissent_authors?.length > 0
    ? `Dissenting: ${scotusCase.dissent_authors.join(', ')}`
    : 'No dissent (unanimous)';

  // ADO-354: Inject sanitized source text so Pass 2 can pull concrete facts
  const sourceText = sanitizeSourceText(
    scotusCase.syllabus || scotusCase.opinion_excerpt || ''
  );

  const prompt = `${constraints}

PASS 1 FACTS (LOCKED - your editorial must align with these):
- Disposition: ${facts.disposition || 'unknown'}
- Merits Reached: ${facts.merits_reached === true ? 'yes' : facts.merits_reached === false ? 'no' : 'unclear'}
- Case Type: ${facts.case_type || 'unclear'}
- Holding: ${facts.holding || 'not extracted'}
- Prevailing Party: ${facts.prevailing_party || 'unclear'}
- Practical Effect: ${facts.practical_effect || 'not extracted'}

CASE DATA:
Case: ${scotusCase.case_name}
Term: ${scotusCase.term || 'Unknown'}
Decided: ${scotusCase.decided_at || 'Pending'}
Vote: ${scotusCase.vote_split || 'Unknown'}
Majority: ${scotusCase.majority_author || 'Unknown'}
${dissentInfo}

${variationInjection ? `${variationInjection}\n` : ''}${sourceText ? `SOURCE TEXT (reference only — use for concrete facts in why_it_matters, do NOT override Pass 1 facts):\n<<<SOURCE_TEXT>>>\n${sourceText}\n<<<END_SOURCE_TEXT>>>\n\n` : ''}Generate the editorial JSON. Remember:
- Your who_wins/who_loses MUST align with the prevailing_party and case_type above
- The disposition word "${facts.disposition || 'unknown'}" MUST appear in summary_spicy
- Use the appropriate tone for the ruling_impact_level you assign
- Do NOT contradict the Pass 1 facts
- why_it_matters MUST lead with a concrete fact from the source text`;

  return prompt;
}

/**
 * Build messages array for Pass 2 GPT call
 */
export function buildPass2Messages(scotusCase, facts, variationInjection = '') {
  return [
    { role: 'system', content: PASS2_SYSTEM_PROMPT },
    { role: 'user', content: buildPass2UserPrompt(scotusCase, facts, variationInjection) }
  ];
}
