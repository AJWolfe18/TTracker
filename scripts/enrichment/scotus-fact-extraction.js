/**
 * SCOTUS Fact Extraction Module (ADO-280)
 *
 * Two-pass architecture for factual accuracy:
 * - Pass 0: Source quality gate (pre-GPT check)
 * - Pass 1: Fact extraction (neutral, no tone)
 *
 * This module exports:
 * - checkSourceQuality() - Pass 0 source validation
 * - extractFactsWithConsensus() - Pass 1 with self-consistency check
 * - validatePass1() - Validates and enhances Pass 1 output
 * - deriveCaseType() - Computes case_type from disposition/merits_reached
 *
 * Dependencies:
 * - OpenAI client (passed in)
 * - scotus-gpt-prompt.js (FACT_EXTRACTION_PROMPT)
 */

// ============================================================================
// CONSTANTS (SINGLE SOURCE OF TRUTH)
// ============================================================================

/**
 * Pass 1 fact extraction fields (written by extractFacts)
 */
export const FACT_FIELDS = [
  'disposition',
  'merits_reached',
  'case_type',
  'holding',
  'prevailing_party',
  'practical_effect',
  'evidence_quotes',
];

/**
 * Pass 2 editorial fields (written by applyEditorialTone)
 */
export const EDITORIAL_FIELDS = [
  'ruling_impact_level',
  'ruling_label',
  'who_wins',
  'who_loses',
  'summary_spicy',
  'why_it_matters',
  'dissent_highlights',
  'evidence_anchors',
];

/**
 * All enrichment fields that should be cleared on flag/fail
 */
export const ALL_ENRICHMENT_FIELDS = [...FACT_FIELDS, ...EDITORIAL_FIELDS];

/**
 * CLEAR DEFAULTS - Per-field defaults for clearing (respects NOT NULL constraints)
 */
export const CLEAR_DEFAULTS = {
  evidence_quotes: [],     // JSONB NOT NULL - must use empty array
  evidence_anchors: [],    // TEXT[] - use empty array for safety
};

/**
 * Helper: build a payload that clears all enrichment fields
 */
export function buildClearPayload() {
  const payload = {};
  for (const field of ALL_ENRICHMENT_FIELDS) {
    payload[field] = CLEAR_DEFAULTS[field] ?? null;
  }
  return payload;
}

/**
 * DB WRITE SAFETY: Column whitelist
 * Runtime objects may contain extra fields that don't exist in the DB schema.
 * ALWAYS use sanitizeForDB() before any .update() call.
 */
export const DB_COLUMNS = new Set([
  // Enrichment fields
  ...FACT_FIELDS,
  ...EDITORIAL_FIELDS,
  // Status/metadata
  'enrichment_status', 'enriched_at', 'is_public', 'needs_manual_review',
  'fact_extraction_confidence', 'low_confidence_reason', 'last_error',
  'source_char_count', 'contains_anchor_terms',
  'drift_detected', 'drift_reason',
  'manual_reviewed_at', 'manual_review_note',
  'prompt_version', 'updated_at',
  // DB-only fields (not from GPT)
  'vote_split', 'dissent_exists',
]);

// Known runtime-only fields that are expected to be dropped (not DB columns)
const RUNTIME_ONLY_FIELDS = new Set([
  'passed', 'validation_issues', 'consistency_check_failed',
  'evidence_quotes_truncated', 'raw_response', 'usage'
]);

export function sanitizeForDB(payload) {
  const clean = {};
  const dropped = [];

  for (const [key, value] of Object.entries(payload)) {
    if (DB_COLUMNS.has(key)) {
      clean[key] = value;
    } else if (!RUNTIME_ONLY_FIELDS.has(key)) {
      // Unknown field - log warning so we catch schema mismatches
      dropped.push(key);
    }
  }

  if (dropped.length > 0) {
    console.warn(`[sanitizeForDB] Dropped unknown fields: ${dropped.join(', ')}`);
  }

  return clean;
}

// ============================================================================
// PASS 0: SOURCE QUALITY GATE
// ============================================================================

// TIGHTER anchor detection - require dispositive PHRASES not single words
const ANCHOR_PATTERNS = [
  /\bjudgment\s+(is\s+)?(affirmed|reversed|vacated|remanded)\b/i,
  /\b(dismiss(ed|es)?)\b.{0,30}\b(standing|jurisdiction|moot)\b/i,
  /\bheld\s+that\b/i,
  /\bwe\s+hold\b/i,
  /\bthe\s+(petition|application)\s+(is\s+)?(granted|denied)\b/i,
];

// Thresholds
const HARD_MIN = 200;        // Below this, always fail (likely just a header)
const SOFT_MIN = 600;        // Below this, need anchors to pass

/**
 * Pass 0: Check source quality before calling GPT
 * Returns Pass 1-shaped object for consistent handling
 *
 * @param {Object} scotusCase - Case record with syllabus/opinion_excerpt
 * @returns {Object} Either { passed: true, ...metadata } or { passed: false, ...failure_details }
 */
export function checkSourceQuality(scotusCase) {
  const sourceText = scotusCase.syllabus || scotusCase.opinion_excerpt || '';
  const charCount = sourceText.length;

  const hasAnchors = ANCHOR_PATTERNS.some(p => p.test(sourceText));
  const tooShort = charCount < SOFT_MIN;

  // Logic: anchors can rescue short text, but not impossibly short
  const isLow = (charCount < HARD_MIN) || (tooShort && !hasAnchors);

  if (isLow) {
    // Determine the specific failure reason
    let reason;
    if (charCount < HARD_MIN) {
      reason = `Source text critically short (${charCount} chars < ${HARD_MIN}) - likely header-only junk`;
    } else if (tooShort && !hasAnchors) {
      reason = `Source text short (${charCount} chars < ${SOFT_MIN}) with no anchor phrases - high hallucination risk`;
    } else {
      reason = 'No dispositive anchor phrases found';
    }

    // Return failure object
    return {
      passed: false,

      // Facts (all null for failed gate)
      holding: null,
      disposition: null,
      merits_reached: null,
      prevailing_party: null,
      practical_effect: null,
      evidence_quotes: [],

      // Confidence
      fact_extraction_confidence: 'low',
      low_confidence_reason: reason,

      // Metadata
      source_char_count: charCount,
      contains_anchor_terms: hasAnchors,

      // Review flags
      needs_manual_review: true,
      is_public: false
    };
  }

  // Source quality OK - return success object with metadata
  return {
    passed: true,
    source_char_count: charCount,
    contains_anchor_terms: hasAnchors
  };
}

// ============================================================================
// PASS 1: FACT EXTRACTION PROMPT
// ============================================================================

export const FACT_EXTRACTION_PROMPT = `You are a SCOTUS fact extractor. Extract ONLY verifiable facts from the source text.

OUTPUT SCHEMA:
{
  "disposition": "affirmed|reversed|vacated|remanded|dismissed|granted|denied|other|null",
  "merits_reached": true/false/null,
  "holding": "1-2 sentences, neutral. What did the Court decide? If unclear, null.",
  "prevailing_party": "petitioner|respondent|partial|unclear|null",
  "practical_effect": "1 sentence. What changes? If unclear, null.",
  "evidence_quotes": ["verbatim quote 1 (<=50 words)", "quote 2", ...],
  "fact_extraction_confidence": "high|medium|low",
  "low_confidence_reason": "if not high, explain why"
}

NOTE: Do NOT output vote_split, dissent_exists, or case_type - those are computed from DB.

ANCHOR DETECTION - Accept any of:
- "Held that..." / "We hold..."
- "The judgment is affirmed/reversed/vacated/remanded..."
- "The Court dismisses... for lack of standing/jurisdiction..."
- "The application is granted/denied..."

EXTRACTION ORDER:
1. Find DISPOSITION first (affirmed/reversed/etc.)
2. Determine if MERITS were reached (procedural dismissal = false)
3. Extract HOLDING and PRACTICAL_EFFECT
4. Identify PREVAILING_PARTY (see rules below)

PREVAILING_PARTY RULES:
- "petitioner": Party seeking SCOTUS relief got favorable disposition
- "respondent": Party defending lower court ruling prevailed
- "partial": Split outcome (some claims won, some lost)
- "unclear": Use for vacated+remanded (procedural win, merits unclear),
             dismissed on standing/jurisdiction (no merits winner),
             or genuinely ambiguous outcomes

CONFIDENCE RULES:
- HIGH: disposition + holding present + >=1 evidence quote with anchor token
- MEDIUM: disposition OR holding present + quotes present, but effect unclear
- LOW: missing anchors OR no quotes OR merits_reached unclear

GROUNDING REQUIREMENT:
- Every non-null claim MUST have a supporting quote
- For HIGH confidence, at least one quote must contain an anchor token
  (held, judgment, affirmed, reversed, vacated, dismissed, granted, denied)

RULES:
- Do NOT editorialize or add opinion
- Do NOT speculate beyond explicit source text
- Do NOT guess the holding - if unclear, return null
- If procedural (standing/jurisdiction), set merits_reached=false`;

/**
 * Build Pass 1 messages for GPT
 */
export function buildPass1Messages(scotusCase) {
  const sourceText = scotusCase.syllabus || scotusCase.opinion_excerpt || '';

  const userPrompt = `CASE: ${scotusCase.case_name}
DOCKET: ${scotusCase.docket_number || 'N/A'}
DECIDED: ${scotusCase.decided_at || 'Unknown'}
TERM: ${scotusCase.term || 'Unknown'}

SOURCE TEXT:
${sourceText}

Extract the facts from this SCOTUS ruling. Return JSON only.`;

  return [
    { role: 'system', content: FACT_EXTRACTION_PROMPT },
    { role: 'user', content: userPrompt }
  ];
}

// ============================================================================
// PASS 1: VALIDATION
// ============================================================================

// Expanded anchor tokens - include all verb forms
const ANCHOR_TOKEN_REGEX = /\b(held|hold|holds|holding|judgment|affirm(ed|s|ing)?|revers(ed|es|ing)?|vacat(ed|es|ing)?|remand(ed|s|ing)?|dismiss(ed|es|al|ing)?|grant(ed|s|ing)?|den(ied|ies|ying)?)\b/i;

const MAX_QUOTE_WORDS = 50; // Increased from 25 - legal quotes are often longer

/**
 * Validate Pass 1 output and inject metadata
 * Forces low confidence if grounding requirements not met
 *
 * @param {Object} facts - Raw GPT output
 * @param {Object} pass0Metadata - { source_char_count, contains_anchor_terms }
 * @returns {Object} Enhanced facts object
 */
export function validatePass1(facts, pass0Metadata) {
  const issues = [];

  // Inject Pass 0 metadata
  facts.source_char_count = pass0Metadata.source_char_count;
  facts.contains_anchor_terms = pass0Metadata.contains_anchor_terms;

  // Check: non-null facts MUST have quotes
  const claimFields = ['holding', 'disposition', 'practical_effect', 'prevailing_party', 'merits_reached'];
  const hasAnyClaim = claimFields.some(f => facts[f] !== null && facts[f] !== undefined);

  if (hasAnyClaim && (!facts.evidence_quotes || facts.evidence_quotes.length === 0)) {
    issues.push('Claims present but no evidence_quotes provided');
  }

  // Check: high/medium confidence requires quotes
  if (['high', 'medium'].includes(facts.fact_extraction_confidence) &&
      (!facts.evidence_quotes || facts.evidence_quotes.length === 0)) {
    issues.push('High/medium confidence requires evidence_quotes');
  }

  // Check: max 3 quotes
  if (facts.evidence_quotes && facts.evidence_quotes.length > 3) {
    issues.push('Too many quotes (max 3)');
  }

  // Check: quote word count (<=25 words each)
  let hasLongQuotes = false;
  if (facts.evidence_quotes) {
    facts.evidence_quotes.forEach((quote, i) => {
      const words = quote.trim().split(/\s+/);
      if (words.length > MAX_QUOTE_WORDS) {
        issues.push(`Quote ${i + 1} too long (${words.length} words > ${MAX_QUOTE_WORDS})`);
        hasLongQuotes = true;
      }
    });

    // Flag but don't truncate - keep original for inspection
    if (hasLongQuotes) {
      facts.evidence_quotes_truncated = true;
    }
  }

  // Check: HIGH requires at least one quote with anchor token
  if (facts.fact_extraction_confidence === 'high') {
    const hasAnchorQuote = (facts.evidence_quotes || []).some(q => ANCHOR_TOKEN_REGEX.test(q));
    if (!hasAnchorQuote) {
      issues.push('High confidence requires quote with anchor token');
    }
  }

  // Downgrade confidence if validation fails (hard failures)
  if (issues.length > 0) {
    return {
      ...facts,
      fact_extraction_confidence: 'low',
      low_confidence_reason: (facts.low_confidence_reason || '') +
        (facts.low_confidence_reason ? '; ' : '') + issues.join('; '),
      validation_issues: issues
    };
  }

  // Soft cap: no anchor terms in source caps HIGH to MEDIUM (not a failure)
  // This allows enrichment to proceed but flags for review
  if (!pass0Metadata.contains_anchor_terms && facts.fact_extraction_confidence === 'high') {
    facts.fact_extraction_confidence = 'medium';
    facts.low_confidence_reason = (facts.low_confidence_reason || '') +
      (facts.low_confidence_reason ? '; ' : '') + 'Capped to medium (no anchor terms in source)';
  }

  return facts;
}

// ============================================================================
// PASS 1: SELF-CONSISTENCY CHECK
// ============================================================================

// Only compare fields GPT actually outputs
const CONSENSUS_FIELDS = ['disposition', 'merits_reached', 'prevailing_party'];

/**
 * Compares two Pass 1 outputs and merges them.
 * If critical fields mismatch, force low confidence.
 */
export function consensusMerge(a, b) {
  const mismatches = [];

  for (const field of CONSENSUS_FIELDS) {
    // Normalize null/undefined for comparison
    const aVal = a?.[field] ?? null;
    const bVal = b?.[field] ?? null;
    if (aVal !== bVal) {
      mismatches.push(`${field}: "${aVal}" vs "${bVal}"`);
    }
  }

  if (mismatches.length > 0) {
    return {
      ...a,
      fact_extraction_confidence: 'low',
      low_confidence_reason: `Pass 1 consensus mismatch: ${mismatches.join(', ')}`,
      consistency_check_failed: true,
      needs_manual_review: true,
    };
  }

  // If they match on key fields, prefer the one with better quotes/holding filled
  const aQuotes = a.evidence_quotes?.length || 0;
  const bQuotes = b.evidence_quotes?.length || 0;
  return aQuotes >= bQuotes ? a : b;
}

/**
 * Call GPT with retry logic
 */
export async function callGPTWithRetry(openai, messages, { temperature = 0, maxRetries = 1 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        response_format: { type: 'json_object' },
        temperature,
        max_tokens: 1500
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Empty GPT response');

      return {
        parsed: JSON.parse(content),
        usage: response.usage
      };
    } catch (err) {
      console.warn(`[GPT] Attempt ${attempt + 1} failed:`, err.message);
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

/**
 * Runs Pass 1 twice and merges with consensus check.
 *
 * @param {Object} openai - OpenAI client
 * @param {Object} scotusCase - Case record
 * @param {Object} pass0Metadata - From checkSourceQuality()
 * @param {boolean} skipConsensus - Skip second pass (for testing)
 * @returns {Object} Validated and merged facts
 */
export async function extractFactsWithConsensus(openai, scotusCase, pass0Metadata, skipConsensus = false) {
  const messages = buildPass1Messages(scotusCase);

  // First pass
  const { parsed: facts1, usage: usage1 } = await callGPTWithRetry(openai, messages, { temperature: 0 });

  if (skipConsensus) {
    return {
      facts: validatePass1(facts1, pass0Metadata),
      usage: usage1
    };
  }

  // Second pass for consensus
  const { parsed: facts2, usage: usage2 } = await callGPTWithRetry(openai, messages, { temperature: 0 });

  const merged = consensusMerge(facts1, facts2);
  const validated = validatePass1(merged, pass0Metadata);

  // Combine usage
  const totalUsage = {
    prompt_tokens: (usage1?.prompt_tokens || 0) + (usage2?.prompt_tokens || 0),
    completion_tokens: (usage1?.completion_tokens || 0) + (usage2?.completion_tokens || 0),
    total_tokens: (usage1?.total_tokens || 0) + (usage2?.total_tokens || 0)
  };

  return {
    facts: validated,
    usage: totalUsage
  };
}

// ============================================================================
// CASE TYPE DERIVATION
// ============================================================================

/**
 * Shadow docket detection patterns (MVP)
 */
const SHADOW_DOCKET_PATTERNS = [
  /application for stay/i,
  /emergency application/i,
  /motion for injunctive relief/i,
  /application to vacate stay/i,
  /stay pending appeal/i,
  /application for injunction/i,
  /motion to stay/i,
  /emergency motion/i,
  /application for recall/i,
];

function isShadowDocket(caseName) {
  return SHADOW_DOCKET_PATTERNS.some(p => p.test(caseName || ''));
}

/**
 * Derives case_type from disposition, merits_reached, and case name.
 * NEVER ask GPT for case_type - compute it deterministically.
 *
 * @param {Object} facts - Pass 1 output with disposition and merits_reached
 * @param {string} caseName - Case name for shadow docket detection
 * @returns {string} One of: 'merits', 'procedural', 'cert_stage', 'shadow_docket', 'unclear'
 */
export function deriveCaseType({ disposition, merits_reached }, caseName = '') {
  // FIRST: Check shadow docket by case name (takes priority)
  if (isShadowDocket(caseName)) {
    return 'shadow_docket';
  }

  // Cert stage: grant/deny cert (no merits decided)
  if (disposition === 'granted' || disposition === 'denied') {
    if (merits_reached !== true) {
      return 'cert_stage';
    }
  }

  // Procedural: explicit merits_reached=false OR dismissal dispositions
  if (merits_reached === false) {
    return 'procedural';
  }
  if (disposition === 'dismissed') {
    return 'procedural';
  }

  // Merits: affirmed/reversed are clear merits indicators
  if (['affirmed', 'reversed'].includes(disposition)) {
    if (merits_reached === true || merits_reached === null) {
      return 'merits';
    }
  }

  // TRAP: vacated/remanded is often NOT a merits ruling
  // Many are procedural cleanups ("go re-evaluate under X standard")
  // Truth-first: require explicit merits_reached=true, otherwise unclear
  if (['vacated', 'remanded'].includes(disposition)) {
    if (merits_reached === true) {
      return 'merits';
    }
    return 'unclear';
  }

  return 'unclear';
}

// ============================================================================
// DB HELPERS
// ============================================================================

/**
 * Marks a case as flagged (low confidence) - will NOT be retried automatically.
 */
export async function flagAndSkip(caseId, details, supabase) {
  const payload = {
    // Clear all enrichment fields first
    ...buildClearPayload(),

    // Status
    enrichment_status: 'flagged',
    enriched_at: null,

    // Confidence tracking
    fact_extraction_confidence: details.fact_extraction_confidence,
    low_confidence_reason: details.low_confidence_reason,

    // Source quality metadata
    source_char_count: details.source_char_count,
    contains_anchor_terms: details.contains_anchor_terms,

    // Drift tracking
    drift_detected: details.drift_detected || false,
    drift_reason: details.drift_reason || null,

    // Review flags
    needs_manual_review: true,
    is_public: false,

    // Versioning
    prompt_version: 'v2-ado280-flagged',
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('scotus_cases')
    .update(sanitizeForDB(payload))
    .eq('id', caseId);

  if (error) throw error;

  console.log(`[flagAndSkip] Case ${caseId} flagged: ${details.low_confidence_reason}`);
  return { skipped: true, reason: details.low_confidence_reason || details.drift_reason || 'flagged' };
}

/**
 * Marks a case as failed (will be retried on next run).
 */
export async function markFailed(caseId, errorMessage, supabase) {
  // Build payload that clears only editorial fields (keep Pass 1 if valid)
  const editorialClear = {};
  for (const field of EDITORIAL_FIELDS) {
    editorialClear[field] = CLEAR_DEFAULTS[field] ?? null;
  }

  const payload = {
    ...editorialClear,
    enrichment_status: 'failed',
    enriched_at: null,
    last_error: errorMessage,
    is_public: false,
    needs_manual_review: false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('scotus_cases')
    .update(sanitizeForDB(payload))
    .eq('id', caseId);

  if (error) throw error;
  console.error(`[markFailed] Case ${caseId}: ${errorMessage}`);
}

/**
 * Writes successful enrichment (high or medium confidence).
 */
export async function writeEnrichment(caseId, scotusCase, data, supabase) {
  const payload = {
    // Status
    enrichment_status: 'enriched',
    enriched_at: new Date().toISOString(),

    // Pass 1 facts
    disposition: data.disposition,
    merits_reached: data.merits_reached,
    case_type: data.case_type,
    holding: data.holding,
    prevailing_party: data.prevailing_party,
    practical_effect: data.practical_effect,
    evidence_quotes: data.evidence_quotes || [],

    // DB PRECEDENCE: vote_split from DB wins if non-null
    vote_split: scotusCase.vote_split || null,
    // DB PRECEDENCE: dissent_exists computed from DB
    dissent_exists: (scotusCase.dissent_authors?.length || 0) > 0,

    // Confidence
    fact_extraction_confidence: data.fact_extraction_confidence,
    low_confidence_reason: data.low_confidence_reason || null,

    // Metadata
    source_char_count: data.source_char_count,
    contains_anchor_terms: data.contains_anchor_terms,

    // Pass 2 editorial
    ruling_impact_level: data.ruling_impact_level,
    ruling_label: data.ruling_label,
    who_wins: data.who_wins,
    who_loses: data.who_loses,
    summary_spicy: data.summary_spicy,
    why_it_matters: data.why_it_matters,
    dissent_highlights: data.dissent_highlights,
    evidence_anchors: data.evidence_anchors || [],

    // Drift detection
    drift_detected: data.drift_detected || false,
    drift_reason: data.drift_reason || null,

    // Review flags
    needs_manual_review: data.needs_manual_review,
    is_public: data.is_public,

    // Versioning
    prompt_version: 'v2-ado280',
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('scotus_cases')
    .update(sanitizeForDB(payload))
    .eq('id', caseId);

  if (error) throw error;
  console.log(`[writeEnrichment] Case ${caseId} enriched (public: ${data.is_public})`);
}

/**
 * Get cases to enrich
 */
export async function getCasesToEnrich(limit, supabase) {
  const { data, error } = await supabase
    .from('scotus_cases')
    .select('id, case_name, syllabus, opinion_excerpt, term, decided_at, vote_split, majority_author, dissent_authors, issue_area, docket_number')
    .in('enrichment_status', ['pending', 'failed'])
    .or('syllabus.not.is.null,opinion_excerpt.not.is.null')
    .order('decided_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data;
}
