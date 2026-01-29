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
 * - opinion-utils.js (section extraction, disposition evidence)
 */

import {
  extractDispositionEvidence,
  safeTruncate,
  normalizeDispositionText,
} from '../scotus/opinion-utils.js';

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
  'source_data_version',  // tracks v1-syllabus vs v2-full-opinion
  // ADO-300: Clamp/retry fields
  'clamp_reason', 'publish_override', 'facts_model_used', 'retry_reason',
  // ADO-308: QA columns
  // ADO-309: Added qa_retry_count to track retry attempts
  'qa_status', 'qa_verdict', 'qa_issues', 'qa_reviewed_at', 'qa_review_note', 'qa_retry_count',
  // NOTE: opinion_full_text is in scotus_opinions table, not here
]);

// Known runtime-only fields that are expected to be dropped (not DB columns)
// NOTE: disposition_* telemetry fields will be added to schema in future migration
const RUNTIME_ONLY_FIELDS = new Set([
  'passed', 'validation_issues', 'consistency_check_failed',
  'evidence_quotes_truncated', 'raw_response', 'usage',
  // Disposition telemetry (TODO: add to schema for QA visibility)
  'disposition_source', 'disposition_window', 'disposition_pattern', 'disposition_raw',
  // ADO-300: Clamp ephemeral fields (used for Pass 2 prompt, never persisted)
  'label_policy', '_evidence_text', '_sidestepping_forbidden', '_is_vr', '_is_gvr',
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

// Thresholds (updated for full opinion support)
const HARD_MIN = 1000;       // Full opinion should be at least 1K
const SOFT_MIN = 5000;       // Expect at least 5K for real opinions

/**
 * SCOTUS structural markers - at least ONE must be present
 * Catches padded junk, malformed captures, duplicate headers
 *
 * INCLUDES our own section headers (=== MAJORITY/DISSENT ===)
 * to handle edge cases where CourtListener text is stripped but
 * canonical builder still produced valid output
 */
const SCOTUS_STRUCTURAL_MARKERS = [
  /SUPREME COURT OF THE UNITED STATES/i,
  /\bSyllabus\b/i,
  /\bJUSTICE\s+\w+\s+delivered/i,
  /\bPER CURIAM\b/i,
  /\b(affirmed|reversed|vacated|remanded)\b/i,
  /\bCertiorari\b/i,
  // Our canonical section headers (v2)
  /===\s*MAJORITY OPINION\s*===/,
  /===\s*DISSENT\b/,
];

/**
 * TOKEN WINDOWING STRATEGY
 * For very long opinions (>100K chars / ~25K tokens):
 * - First 40K chars: captures syllabus + majority holding
 * - Last 30K chars: captures dissents (always at end)
 * - Middle gap is acceptable - key facts are at ends
 */
const MAX_CHARS_FOR_GPT = 100000;  // ~25K tokens
const FIRST_WINDOW = 40000;
const LAST_WINDOW = 30000;

/**
 * Get the best source text for enrichment
 * Prefers full opinion (v2), falls back to syllabus/excerpt (v1)
 * Applies windowing for very long opinions
 */
export function getSourceText(scotusCase) {
  // Prefer full opinion if available (v2)
  let text = scotusCase.opinion_full_text
    || scotusCase.syllabus
    || scotusCase.opinion_excerpt
    || '';

  // Apply windowing for very long opinions
  const originalLength = text.length;
  if (originalLength > MAX_CHARS_FOR_GPT) {
    const first = text.slice(0, FIRST_WINDOW);
    const last = text.slice(-LAST_WINDOW);
    const omitted = originalLength - FIRST_WINDOW - LAST_WINDOW;
    text = `${first}\n\n[... ${omitted} chars omitted ...]\n\n${last}`;
    console.log(`   [WINDOW] Applied windowing: ${scotusCase.case_name} (${originalLength} -> ${text.length} chars)`);
  }

  return text;
}

/**
 * Pass 0: Check source quality before calling GPT
 * Returns Pass 1-shaped object for consistent handling
 *
 * @param {Object} scotusCase - Case record with syllabus/opinion_excerpt/opinion_full_text
 * @returns {Object} Either { passed: true, ...metadata } or { passed: false, ...failure_details }
 */
export function checkSourceQuality(scotusCase) {
  const sourceText = scotusCase.opinion_full_text
    || scotusCase.syllabus
    || scotusCase.opinion_excerpt
    || '';
  const charCount = sourceText.length;

  // Length check - hard minimum
  if (charCount < HARD_MIN) {
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
      low_confidence_reason: `Too short: ${charCount} chars < ${HARD_MIN}`,

      // Metadata
      source_char_count: charCount,
      contains_anchor_terms: false,

      // Review flags
      needs_manual_review: true,
      is_public: false
    };
  }

  // Structural validation: must have at least one SCOTUS marker
  const hasStructuralMarker = SCOTUS_STRUCTURAL_MARKERS.some(p => p.test(sourceText));
  if (!hasStructuralMarker) {
    return {
      passed: false,

      holding: null,
      disposition: null,
      merits_reached: null,
      prevailing_party: null,
      practical_effect: null,
      evidence_quotes: [],

      fact_extraction_confidence: 'low',
      low_confidence_reason: 'No SCOTUS structural markers found (may be junk/malformed)',

      source_char_count: charCount,
      contains_anchor_terms: false,

      needs_manual_review: true,
      is_public: false
    };
  }

  const hasAnchors = ANCHOR_PATTERNS.some(p => p.test(sourceText));

  // Soft minimum with anchor rescue
  if (charCount < SOFT_MIN && !hasAnchors) {
    return {
      passed: false,

      holding: null,
      disposition: null,
      merits_reached: null,
      prevailing_party: null,
      practical_effect: null,
      evidence_quotes: [],

      fact_extraction_confidence: 'low',
      low_confidence_reason: `Below soft min (${charCount} < ${SOFT_MIN}) and no anchors`,

      source_char_count: charCount,
      contains_anchor_terms: hasAnchors,

      needs_manual_review: true,
      is_public: false
    };
  }

  // Source quality OK - return success object with metadata
  return {
    passed: true,
    source_char_count: charCount,
    contains_anchor_terms: hasAnchors,
    hasStructuralMarker: true
  };
}

// ============================================================================
// PASS 1: FACT EXTRACTION PROMPT
// ============================================================================

export const FACT_EXTRACTION_PROMPT = `You are a SCOTUS fact extractor. You will receive the FULL opinion text with section headers.

DOCUMENT STRUCTURE (sections marked with ===):
1. === MAJORITY OPINION === - Contains syllabus + full legal reasoning
2. === CONCURRENCE (Justice Name) === - Agreeing justices' separate views (if any)
3. === DISSENT (Justice Name) === - Disagreeing justices' arguments (if any)

EXTRACTION PRIORITY:
1. Find DISPOSITION early in majority (syllabus section): affirmed/reversed/vacated/remanded
2. Extract HOLDING from syllabus (first ~5K chars of majority)
3. For DISSENT_EXISTS: check if === DISSENT sections exist
4. For DISSENT highlights: look at === DISSENT sections specifically
5. For vote split: look for "X-X" pattern near case header

IMPORTANT:
- Dissents are EXPLICITLY marked with === DISSENT headers - use them
- If no dissent section exists, dissent_exists = false
- Concurrences are NOT dissents

OUTPUT SCHEMA:
{
  "disposition": "affirmed|reversed|vacated|remanded|dismissed|granted|denied|other|null",
  "merits_reached": true/false/null,
  "holding": "1-2 sentences, neutral. What did the Court decide? If unclear, null.",
  "prevailing_party": "petitioner|respondent|partial|unclear|null",
  "practical_effect": "1 sentence. What changes? If unclear, null.",
  "evidence_quotes": ["anchor snippet 1", "anchor snippet 2"],
  "fact_extraction_confidence": "high|medium|low",
  "low_confidence_reason": "if not high, explain why"
}

EVIDENCE_QUOTES RULES (STRICT - ADO-303):
- Max 2 quotes total
- Max 25 words per quote (~150 chars)
- Purpose: anchor snippets for disposition verification, NOT verbatim paragraph copying
- Example good: "The judgment of the Court of Appeals is reversed" or "We hold that the statute requires..."
- Example bad: Multiple-sentence paragraph copied from opinion

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
  // Use getSourceText which handles windowing for long opinions
  const sourceText = getSourceText(scotusCase);

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

// ADO-303: Quote limits (anchor snippets, not verbatim copying)
// Phase 0.1: Changed from hard gate to truncate+telemetry approach
// Quotes are not user-facing; truncation preserves grounding without false failures
const MAX_QUOTE_COUNT = 2;   // Max evidence_quotes items (truncate excess)
const MAX_QUOTE_WORDS = 25;  // Max words per quote (truncate, don't fail)

/**
 * ADO-303: Truncate and lint evidence_quotes (no longer a hard gate)
 *
 * Strategy: Truncate+telemetry instead of fail
 * - Excess quotes: keep first MAX_QUOTE_COUNT
 * - Long quotes: truncate to MAX_QUOTE_WORDS + "..."
 * - Return telemetry for monitoring (not failures)
 *
 * @param {string[]} quotes - evidence_quotes array (MUTATED in place)
 * @returns {{ truncated: boolean, telemetry: string[], originalCount: number }}
 */
export function lintQuotes(quotes) {
  const telemetry = [];
  let truncated = false;
  const originalCount = quotes?.length || 0;

  if (!quotes || !Array.isArray(quotes)) {
    return { truncated: false, telemetry: [], originalCount: 0 };
  }

  // Truncate excess quotes (keep first MAX_QUOTE_COUNT)
  if (quotes.length > MAX_QUOTE_COUNT) {
    telemetry.push(`Truncated ${quotes.length} quotes to ${MAX_QUOTE_COUNT}`);
    quotes.length = MAX_QUOTE_COUNT;  // Mutate in place
    truncated = true;
  }

  // Truncate long quotes
  quotes.forEach((quote, i) => {
    if (typeof quote !== 'string') return;
    const words = quote.trim().split(/\s+/).filter(Boolean);
    if (words.length > MAX_QUOTE_WORDS) {
      const truncatedQuote = words.slice(0, MAX_QUOTE_WORDS).join(' ') + '...';
      telemetry.push(`Quote ${i + 1} truncated: ${words.length} → ${MAX_QUOTE_WORDS} words`);
      quotes[i] = truncatedQuote;  // Mutate in place
      truncated = true;
    }
  });

  return {
    truncated,
    telemetry,
    originalCount
  };
}

/**
 * Extract anchor quote using section-aware disposition extraction
 * IMPORTANT: Only searches syllabus → majority section, NEVER dissent/concurrence
 *
 * @param {Object} scotusCase - Case object with syllabus field
 * @param {string} sourceText - Full opinion text
 * @returns {{ quote: string|null, telemetry: Object }} Quote and telemetry
 */
function extractAnchorQuoteFromSource(scotusCase, sourceText) {
  const result = extractDispositionEvidence(scotusCase, sourceText);

  // Always return telemetry for tracking (even on failure)
  if (!result.disposition || result.telemetry.disposition_source === 'unknown') {
    return {
      quote: null,
      telemetry: result.telemetry,
    };
  }

  // Build a readable quote from the matched disposition phrase
  // Use safeTruncate for clean truncation
  const quote = safeTruncate(result.telemetry.disposition_raw || '', 150);

  return {
    quote: quote || null,
    telemetry: result.telemetry,
  };
}

/**
 * Validate Pass 1 output and inject metadata
 * Forces low confidence if grounding requirements not met
 *
 * @param {Object} facts - Raw GPT output
 * @param {Object} pass0Metadata - { source_char_count, contains_anchor_terms }
 * @param {Object} scotusCase - Case object with syllabus field (for section-aware extraction)
 * @param {string} [sourceText] - Optional source text for fallback anchor extraction
 * @returns {Object} Enhanced facts object
 */
export function validatePass1(facts, pass0Metadata, scotusCase = null, sourceText = null) {
  const issues = [];

  // Inject Pass 0 metadata
  facts.source_char_count = pass0Metadata.source_char_count;
  facts.contains_anchor_terms = pass0Metadata.contains_anchor_terms;

  // Initialize telemetry (always set, even on failure - for QA visibility)
  facts.disposition_source = 'unknown';
  facts.disposition_window = 'none';
  facts.disposition_pattern = null;
  facts.disposition_raw = null;

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

  // ADO-303: Truncate+telemetry for quotes (NOT a failure condition)
  // Quotes are internal grounding - truncation preserves utility without false failures
  const quoteLint = lintQuotes(facts.evidence_quotes);
  if (quoteLint.truncated) {
    facts.evidence_quotes_truncated = true;
    // Log telemetry but don't fail - quotes are not user-facing
    console.log(`   [QUOTE TELEMETRY] ${quoteLint.telemetry.join('; ')}`);
  }

  // Check: HIGH requires at least one quote with anchor token
  // Uses section-aware extraction: syllabus → majority → NEVER dissent
  if (facts.fact_extraction_confidence === 'high') {
    const hasAnchorQuote = (facts.evidence_quotes || []).some(q => ANCHOR_TOKEN_REGEX.test(q));
    if (!hasAnchorQuote) {
      // TRY FALLBACK: Section-aware extraction (never searches dissent)
      if (pass0Metadata.contains_anchor_terms && sourceText && scotusCase) {
        const { quote, telemetry } = extractAnchorQuoteFromSource(scotusCase, sourceText);

        // Always inject telemetry (for QA visibility)
        facts.disposition_source = telemetry.disposition_source;
        facts.disposition_window = telemetry.disposition_window;
        facts.disposition_pattern = telemetry.disposition_pattern;
        facts.disposition_raw = telemetry.disposition_raw;

        if (quote) {
          // Add fallback quote to evidence_quotes
          facts.evidence_quotes = facts.evidence_quotes || [];
          facts.evidence_quotes.push(quote);
          console.log(`   [FALLBACK] Section-aware extraction: "${safeTruncate(quote, 60)}" (${telemetry.disposition_source}/${telemetry.disposition_window})`);
        } else {
          issues.push('High confidence requires quote with anchor token');
        }
      } else {
        issues.push('High confidence requires quote with anchor token');
      }
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
 * Normalize disposition for comparison and DB storage.
 * "reversed and remanded" -> "reversed"
 * "affirmed in part" -> "affirmed"
 * Handles compound dispositions by extracting primary action.
 *
 * DB constraint allows: affirmed, reversed, vacated, remanded, dismissed, granted, denied, other
 */
export function normalizeDisposition(val) {
  if (!val || typeof val !== 'string') return val;
  const lower = val.toLowerCase().trim();

  // Extract primary disposition from compound forms
  // "reversed and remanded" -> "reversed"
  // "vacated and remanded" -> "vacated"
  // "affirmed in part, reversed in part" -> "other" (mixed outcome)
  if (/affirmed.*reversed|reversed.*affirmed/i.test(lower)) {
    return 'other';  // DB constraint doesn't have 'partial'
  }
  if (lower.startsWith('reversed')) return 'reversed';
  if (lower.startsWith('vacated')) return 'vacated';
  if (lower.startsWith('affirmed')) return 'affirmed';
  if (lower.startsWith('remanded')) return 'remanded';
  if (lower.startsWith('dismissed')) return 'dismissed';
  if (lower.startsWith('granted')) return 'granted';
  if (lower.startsWith('denied')) return 'denied';

  return 'other'; // Return 'other' for unrecognized patterns (DB-safe)
}

/**
 * Compares two Pass 1 outputs and merges them.
 * If critical fields mismatch, force low confidence.
 */
export function consensusMerge(a, b) {
  const mismatches = [];

  for (const field of CONSENSUS_FIELDS) {
    // Normalize null/undefined for comparison
    let aVal = a?.[field] ?? null;
    let bVal = b?.[field] ?? null;

    // Normalize dispositions before comparing (handles "reversed and remanded" vs "reversed")
    if (field === 'disposition') {
      aVal = normalizeDisposition(aVal);
      bVal = normalizeDisposition(bVal);
    }

    if (aVal !== bVal) {
      mismatches.push(`${field}: "${a?.[field]}" vs "${b?.[field]}"`);
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
 * @param {Object} openai - OpenAI client
 * @param {Array} messages - Chat messages
 * @param {Object} opts - Options: temperature, maxRetries, model
 */
export async function callGPTWithRetry(openai, messages, { temperature = 0, maxRetries = 1, model = 'gpt-4o-mini' } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // gpt-5 series uses different parameters:
      // - max_completion_tokens instead of max_tokens
      // - temperature only supports 1 (default), not 0
      const isGpt5 = model.startsWith('gpt-5');
      const tokenParam = isGpt5
        ? { max_completion_tokens: 1500 }
        : { max_tokens: 1500 };
      const tempParam = isGpt5 ? {} : { temperature }; // gpt-5 doesn't support temperature=0

      const response = await openai.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
        ...tempParam,
        ...tokenParam
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
 * @param {Object} pass0Metadata - From checkSourceQuality(). May include facts_model_override.
 * @param {boolean} skipConsensus - Skip second pass (for testing)
 * @returns {Object} Validated and merged facts
 */
export async function extractFactsWithConsensus(openai, scotusCase, pass0Metadata, skipConsensus = false) {
  const messages = buildPass1Messages(scotusCase);

  // Get source text for fallback anchor extraction
  const sourceText = getSourceText(scotusCase);

  // ADO-300: Model override for retry ladder
  const model = pass0Metadata?.facts_model_override ?? 'gpt-4o-mini';

  // First pass
  const { parsed: facts1, usage: usage1 } = await callGPTWithRetry(openai, messages, { temperature: 0, model });

  if (skipConsensus) {
    return {
      facts: validatePass1(facts1, pass0Metadata, scotusCase, sourceText),
      usage: usage1
    };
  }

  // Second pass for consensus
  const { parsed: facts2, usage: usage2 } = await callGPTWithRetry(openai, messages, { temperature: 0, model });

  const merged = consensusMerge(facts1, facts2);
  const validated = validatePass1(merged, pass0Metadata, scotusCase, sourceText);

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
// ADO-300: CLAMP AND LABEL POST-PROCESSING
// ============================================================================

/**
 * Build evidence text blob from quotes array
 */
function buildEvidenceText(evidenceQuotes) {
  if (!Array.isArray(evidenceQuotes)) return '';
  return evidenceQuotes.filter(Boolean).join(' | ');
}

/**
 * Detect if case looks like cert stage or procedural
 * @param {Object} facts - Pass 1 output
 * @param {string} evidenceText - Combined evidence text (raw source or joined quotes)
 */
function looksCertOrProcedural(facts, evidenceText) {
  const typeRaw = (facts?.case_type || '').toLowerCase();
  const disp = (facts?.disposition || '').toLowerCase();
  const ev = (evidenceText || '').toLowerCase();

  // IMPORTANT: Don't clamp merits cases just because they mention "certiorari"
  // All SCOTUS cases have "ON WRIT OF CERTIORARI" - that's not a cert-stage case
  // Only clamp if: (1) case_type is cert_stage, OR (2) disposition is granted/denied AND no merits reached
  const isCert =
    typeRaw === 'cert_stage' ||
    ((disp === 'granted' || disp === 'denied') && facts?.merits_reached !== true);

  // Procedural: explicit merits_reached=false OR dismissed on procedural grounds
  // Don't clamp affirmed/reversed cases even if they mention "standing" etc.
  const isProcedural =
    typeRaw === 'procedural' ||
    (facts?.merits_reached === false && !['affirmed', 'reversed'].includes(disp));

  return { isCert, isProcedural };
}

/**
 * Detect GVR-ish patterns (vacated & remanded for reconsideration)
 */
function detectGVRish(evidenceText) {
  const ev = (evidenceText || '').toLowerCase();
  return (
    /granted.{0,60}vacat.{0,60}remand/i.test(ev) ||
    /vacat.{0,40}remand.{0,80}(in light of|for further|for reconsideration)/i.test(ev) ||
    /remand.{0,80}(in light of|for further|for reconsideration)/i.test(ev)
  );
}

/**
 * Fallback label picker when model violates constraints
 */
function fallbackMeritsLabel(facts) {
  const disp = (facts?.disposition || '').toLowerCase();
  const prevailing = (facts?.prevailing_party || 'unknown').toLowerCase();

  if (prevailing === 'petitioner') return 'Crumbs from the Bench';
  if (prevailing === 'respondent') return 'Rubber-stamping Tyranny';

  // Coarse fallback from disposition only
  if (disp.includes('affirm')) return 'Rubber-stamping Tyranny';
  if (disp.includes('revers') || disp.includes('vacat')) return 'Crumbs from the Bench';
  return 'Institutional Sabotage';
}

/**
 * Post-processing: Clamp and route facts to publishable output
 * Runs AFTER Pass 1 facts extraction, BEFORE Pass 2 editorial
 *
 * Goals:
 * 1. Turn drift detection into "route + clamp + publish" (not block)
 * 2. Remove "Sidestepping" as the model's safety blanket
 * 3. Deterministic label assignment when rules are clear
 *
 * @param {Object} facts - Pass 1 output
 * @param {Object} opts - Options: { sourceText } for reliable pattern detection
 * @returns {Object} Clamped facts with label_policy for Pass 2
 */
export function clampAndLabel(facts, { sourceText } = {}) {
  // ADO-300: Use raw source text first, fall back to joined quotes
  // For long opinions: check first 12K + last 12K to catch procedural patterns at end
  let evidenceText = '';
  if (sourceText) {
    if (sourceText.length <= 24000) {
      evidenceText = sourceText;
    } else {
      evidenceText = sourceText.slice(0, 12000) + ' ... ' + sourceText.slice(-12000);
    }
  }
  evidenceText = evidenceText || buildEvidenceText(facts?.evidence_quotes || []);

  const disp = (facts?.disposition || '').toLowerCase();

  const { isCert, isProcedural } = looksCertOrProcedural(facts, evidenceText);

  // Deterministic clamp for cert/procedural
  let clamp_reason = null;
  let publish_override = false;

  if (isCert) {
    clamp_reason = 'cert_no_merits';
    publish_override = true;
  } else if (isProcedural) {
    clamp_reason = 'procedural_no_merits';
    publish_override = true;
  }

  // Check for explicit precedent overrule
  const explicitOverrule = /\boverrule(d|s)?\b|\bwe overrule\b/i.test(evidenceText);

  // V&R subtype detection
  const isVR = disp.includes('vacat') || disp.includes('remand');
  const gvrish = isVR ? detectGVRish(evidenceText) : false;

  // Sidestepping forbidden when clear merits disposition + clear winner
  const meritsDisposition = /(affirm|revers)/i.test(disp) || (isVR && !gvrish);
  const prevailing = (facts?.prevailing_party || 'unknown').toLowerCase();
  const clearWinner = prevailing && prevailing !== 'unknown' && prevailing !== 'unclear';

  const sidesteppingForbidden = !!(meritsDisposition && clearWinner);

  // Build label policy for Pass 2
  const label_policy = {
    forbid: [],
    allow: []
  };

  if (clamp_reason) {
    // Clamped: force Sidestepping
    label_policy.allow = ['Judicial Sidestepping'];
  } else if (explicitOverrule) {
    // Explicit overrule: force Constitutional Crisis
    label_policy.allow = ['Constitutional Crisis'];
  } else {
    // Normal merits: forbid Sidestepping when clear winner
    if (sidesteppingForbidden) {
      label_policy.forbid.push('Judicial Sidestepping');
    }
    label_policy.allow = [
      'Crumbs from the Bench',
      'Institutional Sabotage',
      'Rubber-stamping Tyranny',
      'Constitutional Crisis',
      'Democracy Wins'
    ];
  }

  return {
    ...facts,
    _evidence_text: evidenceText, // ephemeral, not persisted
    clamp_reason,
    publish_override,
    _sidestepping_forbidden: sidesteppingForbidden,
    _is_vr: isVR,
    _is_gvr: gvrish,
    label_policy
  };
}

/**
 * Enforce clamp rules + label constraints after Pass 2
 * Called AFTER Pass 2 returns, as the "last mile" guardrail
 *
 * @param {Object} facts - Clamped facts from clampAndLabel()
 * @param {Object} editorial - Raw Pass 2 output
 * @param {Object} driftResult - Output from validateNoDrift()
 * @returns {Object} Constrained editorial output
 */
export function enforceEditorialConstraints(facts, editorial, driftResult = {}) {
  const out = { ...(editorial || {}) };
  const clamp_reason = facts?.clamp_reason || null;

  // Clamp behavior: force safe procedural output
  if (clamp_reason === 'cert_no_merits' || clamp_reason === 'procedural_no_merits') {
    out.who_wins = 'Procedural ruling - no merits decision';
    out.who_loses = 'Case resolved without a merits ruling';
    out.ruling_label = 'Judicial Sidestepping';
    // NOTE: ruling_impact_level derived from label in enrich-scotus.js (ADO-302)
    console.log(`   [CLAMP] Applied ${clamp_reason} → Sidestepping`);
    return out;
  }

  // If drift detected but not already clamped, check if it looks cert/procedural
  const isDrift = driftResult?.severity === 'hard';
  if (isDrift) {
    const evidenceText = facts?._evidence_text || buildEvidenceText(facts?.evidence_quotes || []);
    const { isCert, isProcedural } = looksCertOrProcedural(facts, evidenceText);
    if (isCert || isProcedural) {
      out.who_wins = 'Procedural ruling - no merits decision';
      out.who_loses = 'Case resolved without a merits ruling';
      out.ruling_label = 'Judicial Sidestepping';
      // NOTE: ruling_impact_level derived from label in enrich-scotus.js (ADO-302)
      console.log(`   [CLAMP] Drift + procedural → Sidestepping`);
      return out;
    }
  }

  // Enforce label policy constraints
  const label = out.ruling_label || '';
  const forbid = facts?.label_policy?.forbid || [];
  const allow = facts?.label_policy?.allow || [];

  const violatesForbid = forbid.includes(label);
  const violatesAllow = allow.length > 0 && !allow.includes(label);

  if (violatesForbid || violatesAllow) {
    const newLabel = fallbackMeritsLabel(facts);
    console.log(`   [CLAMP] Label violation: ${label} → ${newLabel}`);
    out.ruling_label = newLabel;
  }

  return out;
}

// ============================================================================
// DB HELPERS
// ============================================================================

/**
 * Marks a case as flagged (low confidence) - will NOT be retried automatically.
 * @param {string} caseId - Case ID
 * @param {Object} details - Pass 0/1 details
 * @param {Object} supabase - Supabase client
 * @param {Object} extraFields - ADO-300: Additional fields like clamp_reason, facts_model_used
 */
export async function flagAndSkip(caseId, details, supabase, extraFields = {}) {
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

    // ADO-300: Extra clamp/retry fields
    clamp_reason: extraFields.clamp_reason ?? null,
    publish_override: extraFields.publish_override ?? false,
    facts_model_used: extraFields.facts_model_used ?? null,
    retry_reason: extraFields.retry_reason ?? null,

    // ADO-308: QA fields (for REJECT cases when ENABLE_QA_GATE=true)
    // ADO-309: Added qa_retry_count
    qa_status: extraFields.qa_status ?? null,
    qa_verdict: extraFields.qa_verdict ?? null,
    qa_issues: extraFields.qa_issues ?? null,
    qa_retry_count: extraFields.qa_retry_count ?? 0,
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

    // Pass 1 facts (normalize disposition for DB constraint)
    disposition: normalizeDisposition(data.disposition),
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

    // ADO-300: Clamp/retry fields
    // - For Pass 0 failures: only clamp_reason set (facts_model_used/retry_reason are null)
    // - For Pass 1 low confidence: all fields set (tracking which model failed and why)
    clamp_reason: data.clamp_reason ?? null,
    // Validate: publish_override only allowed when clamp_reason is set
    publish_override: (data.publish_override && data.clamp_reason) ? true : false,
    facts_model_used: data.facts_model_used ?? null,
    retry_reason: data.retry_reason ?? null,

    // Review flags
    needs_manual_review: data.needs_manual_review,
    is_public: data.is_public,

    // ADO-308: QA columns (always written, even in shadow mode)
    // ADO-309: Added qa_retry_count
    qa_status: data.qa_status ?? 'pending_qa',
    qa_verdict: data.qa_verdict ?? null,
    qa_issues: data.qa_issues ?? null,
    qa_retry_count: data.qa_retry_count ?? 0,
    // qa_reviewed_at and qa_review_note are set by human reviewers, not enrichment

    // Versioning
    prompt_version: 'v2-ado308',
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('scotus_cases')
    .update(sanitizeForDB(payload))
    .eq('id', caseId);

  if (error) throw error;
  console.log(`[writeEnrichment] Case ${caseId} enriched (public: ${data.is_public}, clamp: ${data.clamp_reason || 'none'})`);
}

/**
 * Get cases to enrich
 * Uses LEFT JOIN to scotus_opinions for full text (v2 approach)
 * CRITICAL: Use !left to ensure cases WITHOUT opinion rows are still returned
 */
export async function getCasesToEnrich(limit, supabase) {
  const { data, error } = await supabase
    .from('scotus_cases')
    .select(`
      id, case_name, syllabus, opinion_excerpt, term, decided_at,
      vote_split, majority_author, dissent_authors, issue_area, docket_number,
      source_data_version,
      scotus_opinions!left(opinion_full_text)
    `)
    .in('enrichment_status', ['pending', 'failed'])
    // REMOVED: .or('syllabus.not.is.null,opinion_excerpt.not.is.null')
    // Reason: Would exclude v2 cases where only opinion_full_text exists
    // Pass 0 gate handles "no source text" cases - don't filter here
    .order('decided_at', { ascending: false })
    .limit(limit);

  if (error) throw error;

  // Flatten joined opinion text (Supabase can return object OR array depending on FK inference)
  return data.map(row => {
    const joined = row.scotus_opinions;
    const opinion_full_text = Array.isArray(joined)
      ? joined[0]?.opinion_full_text
      : joined?.opinion_full_text;

    return {
      ...row,
      opinion_full_text: opinion_full_text || null,
      scotus_opinions: undefined  // Remove nested object
    };
  });
}
