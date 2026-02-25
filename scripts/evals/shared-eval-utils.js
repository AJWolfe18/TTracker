/**
 * Reusable Eval Checkers
 *
 * Content-type agnostic utilities for eval dimensions.
 * Used by scotus-eval.js (and future pardons-eval.js, stories-eval.js, etc.)
 */

import { STATUS, dimResult } from './eval-types.js';

// ============================================================================
// D4: Opener Uniqueness (across items)
// ============================================================================

/**
 * Jaccard similarity between two strings (word-level)
 */
function jaccardSimilarity(a, b) {
  const setA = new Set(a.split(/\s+/).filter(Boolean));
  const setB = new Set(b.split(/\s+/).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Check if openers (first sentences) are sufficiently unique across items
 * @param {Array<{id: number, text: string}>} items - items with summary text
 * @param {number} [threshold=0.6] - Jaccard similarity threshold for "too similar"
 * @returns {{ status: string, notes: string, score: number|null, duplicates: Array }}
 */
export function checkOpenerUniqueness(items, threshold = 0.6) {
  if (!items || items.length < 2) {
    return { ...dimResult(STATUS.PASS, 'Too few items to compare'), duplicates: [] };
  }

  const openers = items.map(item => {
    const text = item.text || '';
    const match = text.match(/^.*?[.!?](?:\s|$)/);
    return {
      id: item.id,
      opener: (match ? match[0] : text.slice(0, 100)).trim().toLowerCase(),
    };
  });

  const duplicates = [];
  for (let i = 0; i < openers.length; i++) {
    for (let j = i + 1; j < openers.length; j++) {
      const sim = jaccardSimilarity(openers[i].opener, openers[j].opener);
      if (sim >= threshold) {
        duplicates.push({
          ids: [openers[i].id, openers[j].id],
          similarity: Math.round(sim * 100) / 100,
          openers: [openers[i].opener.slice(0, 80), openers[j].opener.slice(0, 80)],
        });
      }
    }
  }

  const maxSim = duplicates.length > 0
    ? Math.max(...duplicates.map(d => d.similarity))
    : 0;

  if (duplicates.length === 0) {
    return { ...dimResult(STATUS.PASS, 'All openers unique', 1), duplicates: [] };
  }
  return {
    ...dimResult(
      STATUS.WARN,
      `${duplicates.length} similar opener pair(s) (max similarity: ${maxSim})`,
      1 - maxSim
    ),
    duplicates,
  };
}

// ============================================================================
// D5: Section Uniqueness (within a single item)
// ============================================================================

/**
 * Check if sections within an item are sufficiently different
 * @param {Object} sections - { summary_spicy: string, why_it_matters: string, dissent_highlights: string }
 * @returns {{ status: string, notes: string, score: number|null }}
 */
export function checkSectionUniqueness(sections) {
  const texts = Object.entries(sections)
    .filter(([, v]) => v && typeof v === 'string' && v.length > 30)
    .map(([k, v]) => ({ key: k, text: v.toLowerCase() }));

  if (texts.length < 2) return dimResult(STATUS.PASS, 'Too few sections to compare');

  const issues = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const sim = jaccardSimilarity(texts[i].text, texts[j].text);
      if (sim >= 0.5) {
        issues.push(`${texts[i].key} <> ${texts[j].key}: ${Math.round(sim * 100)}% similar`);
      }
    }
  }

  if (issues.length === 0) return dimResult(STATUS.PASS, 'Sections are distinct', 1);
  return dimResult(STATUS.WARN, issues.join('; '), 0.5);
}

// ============================================================================
// D7: Enum Field Check
// ============================================================================

/**
 * Check if a field has a valid enum value (not null, not empty)
 * @param {string|null} value
 * @param {string[]} validValues
 * @param {string} fieldName - for error messages
 * @returns {{ status: string, notes: string, score: number|null }}
 */
export function checkEnumField(value, validValues, fieldName = 'field') {
  if (value === null || value === undefined) {
    return dimResult(STATUS.FAIL, `${fieldName} is null`);
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return dimResult(STATUS.FAIL, `${fieldName} is empty`);
  }
  if (!validValues.includes(value)) {
    return dimResult(STATUS.FAIL, `${fieldName} "${value}" not in valid set`);
  }
  return dimResult(STATUS.PASS, `${fieldName} = "${value}"`);
}

// ============================================================================
// D8: Evidence Anchor Quality
// ============================================================================

const GENERIC_ANCHOR_PATTERNS = [
  /^syllabus$/i,
  /^majority\s*§?\s*[IVX\d–-]+$/i,
  /^dissent[,\s]/i,
  /^concurrence[,\s]/i,
  /^majority\s+opinion$/i,
  /^(majority|dissent|concurrence)$/i,
];

/**
 * Check evidence anchor quality (format-level, no source text needed)
 * @param {string[]} anchors
 * @returns {{ status: string, notes: string, score: number|null, generic_count: number, total: number }}
 */
export function checkAnchorFormat(anchors) {
  if (!anchors || !Array.isArray(anchors) || anchors.length === 0) {
    return { ...dimResult(STATUS.FAIL, 'No evidence anchors', 0), generic_count: 0, total: 0 };
  }

  let genericCount = 0;
  for (const anchor of anchors) {
    if (GENERIC_ANCHOR_PATTERNS.some(p => p.test(anchor.trim()))) {
      genericCount++;
    }
  }

  const genericRate = genericCount / anchors.length;

  if (genericRate >= 0.8) {
    return {
      ...dimResult(
        STATUS.FAIL,
        `${genericCount}/${anchors.length} anchors are generic section labels (not real quotes)`,
        1 - genericRate
      ),
      generic_count: genericCount,
      total: anchors.length,
    };
  }
  if (genericRate >= 0.5) {
    return {
      ...dimResult(STATUS.WARN, `${genericCount}/${anchors.length} anchors are generic`, 1 - genericRate),
      generic_count: genericCount,
      total: anchors.length,
    };
  }
  return {
    ...dimResult(STATUS.PASS, `${anchors.length} anchors, ${genericCount} generic`, 1 - genericRate),
    generic_count: genericCount,
    total: anchors.length,
  };
}

/**
 * Check if quote-like anchors appear in source text
 * @param {string[]} anchors
 * @param {string} sourceText - opinion or syllabus text
 * @returns {{ status: string, notes: string, score: number|null, grounded: number, ungrounded: number }}
 */
export function checkQuoteGrounding(anchors, sourceText) {
  if (!anchors || anchors.length === 0) {
    return { ...dimResult(STATUS.SKIP, 'No anchors to check'), grounded: 0, ungrounded: 0 };
  }
  if (!sourceText || sourceText.length < 200) {
    return { ...dimResult(STATUS.SKIP, 'Source text too short for grounding check'), grounded: 0, ungrounded: 0 };
  }

  const normalizedSource = sourceText.toLowerCase().replace(/\s+/g, ' ');
  let grounded = 0;
  let ungrounded = 0;

  for (const anchor of anchors) {
    // Skip generic section labels — covered by checkAnchorFormat
    if (GENERIC_ANCHOR_PATTERNS.some(p => p.test(anchor.trim()))) continue;

    const normalizedAnchor = anchor.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalizedAnchor.length < 10) continue; // Too short to be a meaningful quote

    if (normalizedSource.includes(normalizedAnchor)) {
      grounded++;
    } else {
      ungrounded++;
    }
  }

  const total = grounded + ungrounded;
  if (total === 0) {
    return { ...dimResult(STATUS.SKIP, 'No quote-like anchors found (all generic)'), grounded: 0, ungrounded: 0 };
  }

  if (ungrounded > 0) {
    return {
      ...dimResult(STATUS.FAIL, `${ungrounded}/${total} quote anchors not found in source`, grounded / total),
      grounded,
      ungrounded,
    };
  }
  return {
    ...dimResult(STATUS.PASS, `${grounded}/${total} quotes grounded in source`, 1),
    grounded,
    ungrounded,
  };
}

// ============================================================================
// D9: String-Null Detection
// ============================================================================

const STRING_NULL_PATTERNS = [
  /^null$/i,
  /^none$/i,
  /^n\/?a$/i,
  /^undefined$/i,
  /^"null"$/,
  /^'null'$/,
];

/**
 * Check for string "null", "None", "N/A" values that should be actual null
 * @param {*} value
 * @param {string} fieldName
 * @returns {{ status: string, notes: string, score: number|null }}
 */
export function checkStringNull(value, fieldName = 'field') {
  if (value === null || value === undefined) {
    return dimResult(STATUS.PASS, `${fieldName} is properly null`);
  }
  if (typeof value !== 'string') {
    return dimResult(STATUS.PASS, `${fieldName} is non-string type`);
  }

  const trimmed = value.trim();
  if (STRING_NULL_PATTERNS.some(p => p.test(trimmed))) {
    return dimResult(STATUS.FAIL, `${fieldName} is string "${trimmed}" instead of actual null`);
  }
  return dimResult(STATUS.PASS, `${fieldName} has real content`);
}

// ============================================================================
// D9 (extended): Dissent Integrity
// ============================================================================

/**
 * Check for phantom dissent and string-null issues in dissent fields
 * @param {Object} caseData - { dissent_exists, dissent_authors, dissent_highlights }
 * @returns {{ status: string, notes: string, score: number|null }}
 */
export function checkDissentIntegrity(caseData) {
  const { dissent_exists, dissent_authors, dissent_highlights } = caseData;

  // First check string-null on dissent_highlights
  const stringNullCheck = checkStringNull(dissent_highlights, 'dissent_highlights');
  if (stringNullCheck.status === STATUS.FAIL) return stringNullCheck;

  // If no dissent exists per metadata, but highlights are present and substantive
  const hasSubstantiveHighlights = dissent_highlights
    && typeof dissent_highlights === 'string'
    && dissent_highlights.trim().length > 30;

  const noDissentMetadata = !dissent_exists
    && (!dissent_authors || dissent_authors.length === 0);

  if (noDissentMetadata && hasSubstantiveHighlights) {
    // CourtListener metadata is often incomplete — this may be a real dissent
    // that CourtListener didn't tag, or a phantom dissent from GPT
    return dimResult(
      STATUS.WARN,
      'dissent_highlights present but dissent_exists=false and dissent_authors=[] — verify source'
    );
  }

  if (!noDissentMetadata && !hasSubstantiveHighlights) {
    return dimResult(
      STATUS.WARN,
      `dissent_exists=${dissent_exists}, dissent_authors=${JSON.stringify(dissent_authors)} but no substantive dissent_highlights`
    );
  }

  return dimResult(STATUS.PASS, 'Dissent data consistent');
}
