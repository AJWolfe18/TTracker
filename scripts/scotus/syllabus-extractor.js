/**
 * Syllabus Judgment-Line Disposition Extractor
 *
 * Extracts the formal disposition from a SCOTUS opinion syllabus
 * using boundary detection and line-scoped regex matching.
 *
 * The syllabus always ends with a judgment line in the form:
 *   [reporter citation], [disposition].
 * e.g. "86 F. 4th 179, reversed and remanded."
 *
 * This is deterministic extraction from authoritative text — no LLM.
 */

// Strict 1:1 enum mappings — no lossy collapse
const DISPOSITION_MAP = new Map([
  ['reversed in part and remanded', 'reversed_and_remanded'],  // standard legal variant
  ['reversed and remanded', 'reversed_and_remanded'],
  ['affirmed and remanded', 'affirmed_and_remanded'],
  ['vacated and remanded', 'vacated_and_remanded'],
  ['reversed', 'reversed'],
  ['vacated', 'vacated'],
  ['affirmed', 'affirmed'],
  ['remanded', 'remanded'],
  ['dismissed', 'dismissed'],
]);

// Ordered longest-first to prevent "reversed" matching before "reversed and remanded"
const DISPOSITION_PATTERNS = [
  'reversed in part and remanded',   // variant of reversed_and_remanded
  'reversed and remanded',
  'affirmed and remanded',
  'vacated and remanded',
  'reversed',
  'vacated',
  'affirmed',
  'remanded',
  'dismissed',
];

// Reporter citation pattern — must appear on the same line as disposition
// Matches: "86 F. 4th 179", "598 U. S. 123", "144 S. Ct. 2228", etc.
const REPORTER_CITATION_RE = /\d+\s+(?:F\.\s*(?:\d+[a-z]{1,2}\s+)?|U\.\s*S\.\s*|S\.\s*Ct\.\s*)\d+/;

// Syllabus start marker — use the LAST occurrence before opinion body
const SYLLABUS_START_RE = /^\s*Syllabus\s*$/i;

// Syllabus end markers — tried in order, first match wins
const SYLLABUS_END_PATTERNS = [
  /^\s*[A-Z]+,\s*(?:C\.\s*)?J\.\s*,?\s*delivered/,          // Standard: "GORSUCH, J., delivered"
  /^\s*Per\s+Curiam/i,                                        // Per curiam opinions
  /^\s*(?:OPINION|Opinion)\s+of\s+the\s+Court/,               // Alternate formatting
  /^\s*[A-Z]+,\s*(?:C\.\s*)?J\.\s*,?\s*filed\s+the\s+opinion/, // "ROBERTS, C.J., filed the opinion"
];

/**
 * Extract disposition from SCOTUS opinion syllabus text.
 *
 * @param {string} opinionText - Full opinion text from scotus_opinions table
 * @returns {{ disposition: string|null, confidence: string, details?: object }}
 */
export function extractDispositionFromSyllabus(opinionText) {
  if (!opinionText || typeof opinionText !== 'string') {
    return { disposition: null, confidence: 'no_syllabus', details: { reason: 'no text provided' } };
  }

  const lines = opinionText.split('\n');

  // --- Step 1: Find syllabus boundary ---
  const boundary = findSyllabusBoundary(lines);
  if (boundary.confidence !== 'ok') {
    return { disposition: null, confidence: boundary.confidence, details: boundary.details };
  }

  const syllabusLines = lines.slice(boundary.startLine + 1, boundary.endLine);

  // --- Step 2: Find judgment lines (line-scoped) ---
  const candidates = findJudgmentLineCandidates(syllabusLines);

  if (candidates.length === 0) {
    return { disposition: null, confidence: 'no_match', details: { syllabusLineCount: syllabusLines.length } };
  }

  // --- Step 3: Check for ambiguity ---
  const distinctEnums = [...new Set(candidates.map(c => c.enumValue))];

  if (distinctEnums.length > 1) {
    return {
      disposition: null,
      confidence: 'multiple_dispositions',
      details: { matches: candidates.map(c => ({ line: c.lineText.trim(), enum: c.enumValue })) },
    };
  }

  const chosen = candidates[0];

  // --- Step 4: GVR detection ---
  if (chosen.enumValue === 'vacated_and_remanded') {
    // Check if "certiorari" appears within 200 chars before the judgment line in syllabus text
    const syllabusText = syllabusLines.join('\n');
    const judgmentIdx = syllabusText.indexOf(chosen.lineText.trim());
    if (judgmentIdx > 0) {
      const preceding = syllabusText.slice(Math.max(0, judgmentIdx - 200), judgmentIdx);
      if (/certiorari/i.test(preceding)) {
        return { disposition: 'GVR', confidence: 'syllabus_deterministic', details: { line: chosen.lineText.trim(), gvr: true } };
      }
    }
  }

  return {
    disposition: chosen.enumValue,
    confidence: 'syllabus_deterministic',
    details: { line: chosen.lineText.trim() },
  };
}

/**
 * Find the syllabus region boundaries in the opinion text.
 *
 * @param {string[]} lines - Opinion text split into lines
 * @returns {{ startLine: number, endLine: number, confidence: string, details?: object }}
 */
function findSyllabusBoundary(lines) {
  // Find ALL syllabus start markers (SCOTUS opinions repeat "Syllabus" as page headers)
  const syllabusStarts = [];
  for (let i = 0; i < lines.length; i++) {
    if (SYLLABUS_START_RE.test(lines[i])) syllabusStarts.push(i);
  }

  if (syllabusStarts.length === 0) {
    return { startLine: -1, endLine: -1, confidence: 'no_syllabus', details: { reason: 'no Syllabus header found' } };
  }

  // Use the FIRST syllabus header — this gives us the full syllabus region including
  // all pages. Later "Syllabus" entries are page-break repeats with no content after them.
  const startLine = syllabusStarts[0];

  // Find FIRST end marker after syllabus start — this is always the correct boundary.
  // The syllabus is immediately followed by the opinion author attribution.
  // Any later matches of end-marker patterns are inside the opinion body (references, not boundaries).
  for (let i = startLine + 1; i < lines.length; i++) {
    for (const pattern of SYLLABUS_END_PATTERNS) {
      if (pattern.test(lines[i])) {
        return { startLine, endLine: i, confidence: 'ok' };
      }
    }
    // Syllabus is typically < 150 lines — stop searching if we've gone too far
    if (i - startLine > 200) break;
  }

  return { startLine, endLine: -1, confidence: 'no_syllabus_end', details: { reason: 'no end marker found within 200 lines of Syllabus header' } };
}

/**
 * Find judgment line candidates within the syllabus region.
 * Line-scoped: reporter citation + disposition must be on the same line.
 *
 * @param {string[]} syllabusLines - Lines within the syllabus region
 * @returns {Array<{ lineText: string, enumValue: string }>}
 */
function findJudgmentLineCandidates(syllabusLines) {
  const candidates = [];

  for (const line of syllabusLines) {
    // Must have a reporter citation on this line
    if (!REPORTER_CITATION_RE.test(line)) continue;

    // Reject if the entire relevant portion is inside quotes or parenthetical
    if (isInsideQuotesOrParens(line)) continue;

    // Check for disposition word followed by period on this line
    for (const pattern of DISPOSITION_PATTERNS) {
      const dispositionRe = new RegExp(`\\b${escapeRegex(pattern)}\\s*\\.`, 'i');
      if (dispositionRe.test(line)) {
        // Additional check: make sure the disposition part isn't in quotes/parens
        const match = line.match(dispositionRe);
        if (match && !isMatchInsideQuotesOrParens(line, match.index)) {
          const enumValue = DISPOSITION_MAP.get(pattern);
          candidates.push({ lineText: line, enumValue });
          break; // Longest match first, so first hit is correct
        }
      }
    }
  }

  return candidates;
}

/**
 * Check if the entire line is wrapped in quotes or parentheses.
 */
function isInsideQuotesOrParens(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) return true;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return true;
  return false;
}

/**
 * Check if a match at a specific index is inside quotes or parentheses.
 */
function isMatchInsideQuotesOrParens(line, matchIndex) {
  // Check if match position falls within any quoted or parenthetical span
  let inQuotes = false;
  let parenDepth = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === '(') parenDepth++;
    if (ch === ')' && parenDepth > 0) parenDepth--;

    if (i === matchIndex) {
      return inQuotes || parenDepth > 0;
    }
  }
  return false;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Export internals for testing
export { findSyllabusBoundary, findJudgmentLineCandidates, DISPOSITION_MAP };
