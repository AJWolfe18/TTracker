/**
 * Shared utilities for SCOTUS opinion processing
 *
 * Used by:
 * - fetch-cases.js (new case ingestion)
 * - backfill-opinions.js (backfilling existing v1 cases)
 * - scotus-fact-extraction.js (disposition extraction)
 */

import crypto from 'crypto';

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Window size for first/last window searches (chars)
 * 5K is ~1250 tokens - captures syllabus disposition or judgment line
 */
const WINDOW_SIZE = 5000;

/**
 * Section markers used in canonical opinion text
 * These are inserted by buildCanonicalOpinionText()
 */
const SECTION_MARKERS = {
  majority: /===\s*MAJORITY OPINION(?:\s*\([^)]+\))?\s*===/,
  concurrence: /===\s*CONCURRENCE\s*\([^)]+\)\s*===/,
  dissent: /===\s*DISSENT\s*\([^)]+\)\s*===/,
  other: /===\s*OTHER\s*\([^)]+\)\s*===/,
};

/**
 * Disposition search order - explicit configuration
 * Search stops at first match
 */
export const DISPOSITION_SEARCH_ORDER = [
  { scope: 'syllabus', window: 'first' },
  { scope: 'syllabus', window: 'last' },
  { scope: 'majority', window: 'first' },
  { scope: 'majority', window: 'last' },
  { scope: 'majority', window: 'full' },  // guarded: stops at dissent/concurrence marker
];

/**
 * Disposition patterns - ordered by specificity (most specific first)
 * Each pattern has an ID for telemetry and a DB-safe enum value
 */
export const DISPOSITION_PATTERNS = [
  // Compound dispositions (most specific)
  { id: 'affirmed_in_part_reversed_in_part', re: /\baffirmed\s+in\s+part[,\s]+(?:and\s+)?reversed\s+in\s+part\b/i, enum: 'other' },
  { id: 'reversed_in_part_affirmed_in_part', re: /\breversed\s+in\s+part[,\s]+(?:and\s+)?affirmed\s+in\s+part\b/i, enum: 'other' },
  { id: 'reversed_and_remanded', re: /\breversed\s+and\s+remanded\b/i, enum: 'reversed' },
  { id: 'vacated_and_remanded', re: /\bvacated\s+and\s+remanded\b/i, enum: 'vacated' },
  { id: 'affirmed_and_remanded', re: /\baffirmed\s+and\s+remanded\b/i, enum: 'affirmed' },

  // Judgment + disposition (formal)
  { id: 'judgment_affirmed', re: /\bjudgment[^.]{0,30}(?:is\s+)?(?:hereby\s+)?affirmed\b/i, enum: 'affirmed' },
  { id: 'judgment_reversed', re: /\bjudgment[^.]{0,30}(?:is\s+)?(?:hereby\s+)?reversed\b/i, enum: 'reversed' },
  { id: 'judgment_vacated', re: /\bjudgment[^.]{0,30}(?:is\s+)?(?:hereby\s+)?vacated\b/i, enum: 'vacated' },
  { id: 'judgment_remanded', re: /\bjudgment[^.]{0,30}(?:is\s+)?(?:hereby\s+)?remanded\b/i, enum: 'remanded' },

  // Citation + disposition (SCOTUS syllabus format)
  { id: 'citation_reversed', re: /\d+\s+[A-Z][a-z]*\.?\s+(?:\d+[a-z]{2}\s+)?\d+,\s+reversed/i, enum: 'reversed' },
  { id: 'citation_affirmed', re: /\d+\s+[A-Z][a-z]*\.?\s+(?:\d+[a-z]{2}\s+)?\d+,\s+affirmed/i, enum: 'affirmed' },
  { id: 'citation_vacated', re: /\d+\s+[A-Z][a-z]*\.?\s+(?:\d+[a-z]{2}\s+)?\d+,\s+vacated/i, enum: 'vacated' },

  // Simple dispositions (least specific - fallback)
  { id: 'dismissed', re: /\bdismissed\b/i, enum: 'dismissed' },
  { id: 'granted', re: /\b(?:petition|application)[^.]{0,20}(?:is\s+)?granted\b/i, enum: 'granted' },
  { id: 'denied', re: /\b(?:petition|application)[^.]{0,20}(?:is\s+)?denied\b/i, enum: 'denied' },
  { id: 'affirmed', re: /\baffirmed\b/i, enum: 'affirmed' },
  { id: 'reversed', re: /\breversed\b/i, enum: 'reversed' },
  { id: 'vacated', re: /\bvacated\b/i, enum: 'vacated' },
  { id: 'remanded', re: /\bremanded\b/i, enum: 'remanded' },
];

// ============================================================================
// SECTION EXTRACTION
// ============================================================================

/**
 * Extract a named section from canonical opinion text
 * Stops at the next section marker (dissent, concurrence, other)
 *
 * @param {string} text - Full canonical opinion text
 * @param {string} sectionType - 'majority' | 'concurrence' | 'dissent' | 'other'
 * @returns {string|null} Section text or null if not found
 */
export function extractSection(text, sectionType) {
  if (!text) return null;

  const startPattern = SECTION_MARKERS[sectionType];
  if (!startPattern) return null;

  const startMatch = text.match(startPattern);
  if (!startMatch) return null;

  const startIdx = startMatch.index + startMatch[0].length;
  const afterStart = text.slice(startIdx);

  // Find the next section marker (any type except our own)
  const nextMarkerPatterns = Object.entries(SECTION_MARKERS)
    .filter(([key]) => key !== sectionType)
    .map(([, pattern]) => pattern);

  let endIdx = afterStart.length;
  for (const pattern of nextMarkerPatterns) {
    const match = afterStart.match(pattern);
    if (match && match.index < endIdx) {
      endIdx = match.index;
    }
  }

  return afterStart.slice(0, endIdx).trim();
}

/**
 * Extract majority section from canonical opinion text
 * Stops at dissent or concurrence marker
 */
export function extractMajoritySection(text) {
  return extractSection(text, 'majority');
}

/**
 * Get syllabus text - prefers distinct syllabus field, falls back to first 8K of majority
 *
 * @param {Object} scotusCase - Case object with syllabus field
 * @param {string} opinionText - Full opinion text (for fallback)
 * @returns {string|null} Syllabus text
 */
export function getSyllabusText(scotusCase, opinionText) {
  // Prefer distinct syllabus field if available and non-empty
  if (scotusCase?.syllabus && scotusCase.syllabus.trim().length > 100) {
    return scotusCase.syllabus;
  }

  // Fallback: first 8K of majority section (syllabus is usually at start)
  const majority = extractMajoritySection(opinionText);
  if (majority) {
    return majority.slice(0, 8000);
  }

  // Last resort: first 8K of full text
  return opinionText ? opinionText.slice(0, 8000) : null;
}

// ============================================================================
// DISPOSITION EXTRACTION
// ============================================================================

/**
 * Search for disposition in a text window
 *
 * @param {string} text - Text to search
 * @param {'first'|'last'|'full'} windowType - Which window to search
 * @returns {{ match: string, patternId: string, enumValue: string }|null}
 */
function searchWindowForDisposition(text, windowType) {
  if (!text) return null;

  let searchText;
  switch (windowType) {
    case 'first':
      searchText = text.slice(0, WINDOW_SIZE);
      break;
    case 'last':
      searchText = text.slice(Math.max(0, text.length - WINDOW_SIZE));
      break;
    case 'full':
      searchText = text;
      break;
    default:
      return null;
  }

  // Try patterns in order (most specific first)
  for (const pattern of DISPOSITION_PATTERNS) {
    const match = searchText.match(pattern.re);
    if (match) {
      return {
        match: match[0],
        patternId: pattern.id,
        enumValue: pattern.enum,
      };
    }
  }

  return null;
}

/**
 * Extract disposition evidence from opinion text
 * Follows strict search order: syllabus → majority → (never dissent)
 *
 * IMPORTANT: Never searches dissent/concurrence sections
 *
 * @param {Object} scotusCase - Case object with syllabus field
 * @param {string} opinionText - Full canonical opinion text
 * @returns {Object} Disposition result with telemetry
 */
export function extractDispositionEvidence(scotusCase, opinionText) {
  // Initialize telemetry (always set, even on failure)
  const telemetry = {
    disposition_source: 'unknown',
    disposition_window: 'none',
    disposition_pattern: null,
    disposition_raw: null,
  };

  // Get section texts
  const syllabusText = getSyllabusText(scotusCase, opinionText);
  const majorityText = extractMajoritySection(opinionText);

  // Follow explicit search order
  for (const step of DISPOSITION_SEARCH_ORDER) {
    const text = step.scope === 'syllabus' ? syllabusText : majorityText;

    if (!text) continue;

    const result = searchWindowForDisposition(text, step.window);

    if (result) {
      telemetry.disposition_source = step.scope;
      telemetry.disposition_window = step.window;
      telemetry.disposition_pattern = result.patternId;
      telemetry.disposition_raw = result.match.toLowerCase().replace(/\s+/g, ' ').trim();

      return {
        disposition: result.enumValue,
        telemetry,
      };
    }
  }

  // No match found
  return {
    disposition: null,
    telemetry,
  };
}

// ============================================================================
// TEXT UTILITIES
// ============================================================================

/**
 * Safely truncate text at word/sentence boundary
 * Never cuts mid-word; prefers sentence boundaries
 *
 * @param {string} text - Text to truncate
 * @param {number} maxChars - Maximum characters
 * @returns {string} Truncated text with ellipsis if needed
 */
export function safeTruncate(text, maxChars = 150) {
  if (!text || text.length <= maxChars) return text || '';

  const slice = text.slice(0, maxChars);

  // Try sentence boundary first (. ! ?)
  const sentenceEnd = Math.max(
    slice.lastIndexOf('. '),
    slice.lastIndexOf('! '),
    slice.lastIndexOf('? ')
  );
  if (sentenceEnd > maxChars * 0.5) {
    return slice.slice(0, sentenceEnd + 1).trim();
  }

  // Fall back to word boundary
  const lastSpace = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'));
  if (lastSpace > maxChars * 0.5) {
    return slice.slice(0, lastSpace).trim() + '…';
  }

  // Last resort: hard cut (shouldn't happen with normal text)
  return slice.trim() + '…';
}

/**
 * Normalize disposition text for storage/comparison
 * Lowercases, collapses whitespace, trims
 */
export function normalizeDispositionText(text) {
  if (!text || typeof text !== 'string') return null;
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Compute sha256 hex hash of text
 * Used to detect content changes and skip no-op writes
 */
export function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Upsert opinion only if content changed (hash mismatch)
 * Prevents wasted DB writes during backfill/retries
 *
 * @param {Object} supabase - Supabase client
 * @param {string} caseId - ID of the case (BIGINT)
 * @param {string} canonicalText - Full canonical opinion text
 * @returns {{ changed: boolean, content_hash: string, error?: string }}
 */
export async function upsertOpinionIfChanged(supabase, caseId, canonicalText) {
  const content_hash = sha256Hex(canonicalText);

  // Check existing hash
  const { data: existing, error: readErr } = await supabase
    .from('scotus_opinions')
    .select('content_hash')
    .eq('case_id', caseId)
    .maybeSingle();

  if (readErr) {
    return { changed: false, content_hash, error: readErr.message };
  }

  // Skip if unchanged
  if (existing?.content_hash === content_hash) {
    return { changed: false, content_hash };
  }

  // Upsert with new content
  const { error: upsertErr } = await supabase
    .from('scotus_opinions')
    .upsert({
      case_id: caseId,
      opinion_full_text: canonicalText,
      content_hash,
      updated_at: new Date().toISOString()
    }, { onConflict: 'case_id' });

  if (upsertErr) {
    return { changed: false, content_hash, error: upsertErr.message };
  }

  return { changed: true, content_hash };
}

/**
 * Build canonical opinion text from all opinion documents
 * Order: MAJORITY/LEAD -> CONCURRENCES -> DISSENTS -> UNKNOWN
 * Adds section headers for GPT parsing
 *
 * ROBUST HANDLING:
 * - Includes ALL majority/lead docs (not just first)
 * - Logs unknown opinion types for future tuning
 * - Handles missing type values gracefully
 *
 * @param {Array} opinions - Array of opinion objects from CourtListener
 * @returns {string|null} Concatenated text with section headers
 */
export function buildCanonicalOpinionText(opinions) {
  if (!opinions || opinions.length === 0) return null;

  const sections = [];
  const unknownTypes = [];
  const processed = new Set();  // Track processed opinion IDs to avoid dupes

  // Category patterns (order matters for classification)
  const MAJORITY_PATTERN = /majority|lead|per.?curiam|combined|opinion.of.the.court/i;
  const CONCUR_PATTERN = /concur/i;
  const DISSENT_PATTERN = /dissent/i;
  const STATEMENT_PATTERN = /statement/i;  // "statement of X" - treat as concurrence-like

  // 1. ALL Majority/Lead/Per Curiam opinions (not just first)
  const majorities = opinions.filter(o =>
    MAJORITY_PATTERN.test(o.type || '') && !DISSENT_PATTERN.test(o.type || '')
  );
  for (const op of majorities) {
    if (op.plain_text) {
      const author = op.author_str || '';
      const label = author ? `MAJORITY OPINION (${author})` : 'MAJORITY OPINION';
      sections.push(`=== ${label} ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 2. Concurrences (including "statement of")
  const concurrences = opinions.filter(o => {
    const type = o.type || '';
    return (CONCUR_PATTERN.test(type) || STATEMENT_PATTERN.test(type))
      && !DISSENT_PATTERN.test(type)
      && !processed.has(o.id);
  });
  for (const op of concurrences) {
    if (op.plain_text) {
      const author = op.author_str || 'Unknown';
      sections.push(`=== CONCURRENCE (${author}) ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 3. Dissents last (critical for Pass 1 dissent extraction)
  const dissents = opinions.filter(o =>
    DISSENT_PATTERN.test(o.type || '') && !processed.has(o.id)
  );
  for (const op of dissents) {
    if (op.plain_text) {
      const author = op.author_str || 'Unknown';
      sections.push(`=== DISSENT (${author}) ===\n${op.plain_text}`);
      processed.add(op.id);
    }
  }

  // 4. Handle unclassified opinions (log for future tuning)
  const unprocessed = opinions.filter(o => !processed.has(o.id) && o.plain_text);
  for (const op of unprocessed) {
    const type = op.type || 'null';
    unknownTypes.push(type);
    const author = op.author_str || 'Unknown';
    sections.push(`=== OTHER (${author}, type: ${type}) ===\n${op.plain_text}`);
  }

  // Log unknown types for debugging/tuning
  if (unknownTypes.length > 0) {
    console.log(`   [CANONICAL] Unknown opinion types encountered: ${unknownTypes.join(', ')}`);
  }

  // Fallback: if somehow nothing matched, use all opinions in order
  if (sections.length === 0) {
    for (const op of opinions) {
      if (op.plain_text) {
        sections.push(op.plain_text);
      }
    }
  }

  return sections.join('\n\n') || null;
}
