// Phase 1a: deterministic validators (Hyperbole lint + Procedural posture check)
// ADO-310: Now uses shared issue type constants for consistency with Layer B

import {
  LAYER_A_ISSUE_TYPES,
  ISSUE_TYPE_SEVERITY,
} from './qa-issue-types.js';

export const HYPERBOLE_BLOCKLIST = [
  "guts", "obliterates", "sweeping", "massive", "tyranny", "crisis",
  "devastating", "catastrophic", "unprecedented", "historic",
];

export const SCALE_WORDS_REQUIRE_SUPPORT = [
  "millions", "thousands", "nationwide", "across the country",
  "every american", "all americans", "everyone",
];

export const SCOPE_OVERCLAIM_PHRASES = [
  "broadly", "far-reaching", "opens the door", "sets a precedent",
  "for the first time", "effectively ends", "landmark", "groundbreaking",
  "across the board", "wholesale", "fundamentally changes",
];

const MERITS_IMPLICATION = [
  /\bheld that\b/i, /\bfound that\b/i, /\bruled that\b/i,
  /\bdeclared\b/i, /\bstruck down\b/i, /\bupheld\b/i,
  /\binvalidated\b/i, /\boverturned\b/i, /\bestablished\b/i,
  /\bprevailed\b/i, /\bwon\b/i, /\blost\b/i, /\bvictory\b/i, /\bdefeat\b/i,
];

const PROCEDURAL_KEYWORDS = [
  /\bdismissed\b/i, /\bremanded\b/i, /\bvacated\b/i,
  /\bstanding\b/i, /\bmoot\b/i, /\bjurisdiction\b/i,
  /\bprocedural\b/i, /\bDIG\b/, /\bcert denied\b/i, /\bno merits\b/i,
];

function safeLower(s) {
  return (s || "").toLowerCase();
}

/**
 * Normalize text for phrase matching:
 * - lowercase
 * - replace most punctuation with spaces (but keep hyphens in words)
 * - collapse whitespace
 * Preserving hyphens prevents "every American-made" from matching "every american"
 */
function normalizeForPhraseMatch(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")  // punctuation → space (keep hyphens)
    .replace(/\s+/g, " ")        // collapse whitespace
    .trim();
}

/**
 * Check if haystack contains phrase as complete words.
 * Normalizes both, then uses regex to match phrase bounded by spaces or string edges.
 * "every american made" does NOT contain "every american" as complete phrase.
 */
function includesPhrase(haystack, phrase) {
  const normalizedHaystack = normalizeForPhraseMatch(haystack);
  const normalizedPhrase = normalizeForPhraseMatch(phrase);

  // Match phrase bounded by start/space at beginning and space/end at end
  const regex = new RegExp(`(^|\\s)${normalizedPhrase}(\\s|$)`, 'i');
  return regex.test(normalizedHaystack);
}

/**
 * Check if any quote contains the phrase (lenient - allows hyphenated compounds).
 * For support checking, "millions-strong" should match "millions".
 */
function anyQuoteIncludes(evidenceQuotes, phrase) {
  if (!Array.isArray(evidenceQuotes)) return false;
  const normalizedPhrase = normalizeForPhraseMatch(phrase);
  // Lenient: match phrase at word boundary OR before hyphen
  const regex = new RegExp(`(^|\\s)${normalizedPhrase}(\\s|$|-)`, 'i');
  return evidenceQuotes.some((q) => regex.test(normalizeForPhraseMatch(q)));
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractSentenceContaining(text, needle) {
  const t = text || "";
  const n = needle || "";
  if (!t || !n) return null;
  const sentences = t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const re = new RegExp(`\\b${escapeRegExp(n)}\\b`, "i");
  return sentences.find((s) => re.test(s)) || null;
}

export function isScaleSupported(phrase, grounding) {
  const normalizedPhrase = normalizeForPhraseMatch(phrase);
  const normalizedExcerpt = normalizeForPhraseMatch(grounding?.source_excerpt);
  const evidenceQuotes = grounding?.evidence_quotes || [];

  // Lenient for support: match phrase at word boundary OR before hyphen
  // "millions-strong" should support "millions"
  const regex = new RegExp(`(^|\\s)${normalizedPhrase}(\\s|$|-)`, 'i');

  const strongSupport =
    (normalizedExcerpt && regex.test(normalizedExcerpt)) ||
    anyQuoteIncludes(evidenceQuotes, phrase);

  const weakSupport =
    includesPhrase(grounding?.holding, phrase) ||
    includesPhrase(grounding?.practical_effect, phrase);

  return { supported: strongSupport || weakSupport, strong: strongSupport };
}

export function lintHyperbole(summarySpicy, level, grounding) {
  const issues = [];
  const text = summarySpicy || "";

  // Hyperbole blocked at Levels 0-2
  if (typeof level === "number" && level <= 2) {
    for (const word of HYPERBOLE_BLOCKLIST) {
      const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
      if (re.test(text)) {
        issues.push({
          type: LAYER_A_ISSUE_TYPES.hyperbole,
          severity: ISSUE_TYPE_SEVERITY[LAYER_A_ISSUE_TYPES.hyperbole],
          fixable: true,
          word,
          affected_sentence: extractSentenceContaining(text, word),
          fix_directive: `Restate sentence containing "${word}" as narrow or technical effect`,
        });
      }
    }
  }

  // Scale words require support at any level
  for (const phrase of SCALE_WORDS_REQUIRE_SUPPORT) {
    if (includesPhrase(text, phrase)) {
      const support = isScaleSupported(phrase, grounding);
      if (!support.supported) {
        issues.push({
          type: LAYER_A_ISSUE_TYPES.unsupported_scale,
          severity: ISSUE_TYPE_SEVERITY[LAYER_A_ISSUE_TYPES.unsupported_scale],
          fixable: false,
          phrase,
          why: `Scale phrase "${phrase}" not supported by source_excerpt, evidence_quotes, holding, or practical_effect`,
        });
      } else if (!support.strong) {
        issues.push({
          type: LAYER_A_ISSUE_TYPES.weakly_supported_scale,
          severity: ISSUE_TYPE_SEVERITY[LAYER_A_ISSUE_TYPES.weakly_supported_scale],
          fixable: true,
          phrase,
          why: `Scale phrase "${phrase}" supported only by derived facts, not by source text`,
          fix_directive: `If keeping "${phrase}", ensure it appears in source text or remove the scale language`,
        });
      }
    }
  }

  // Scope overclaim phrases
  for (const phrase of SCOPE_OVERCLAIM_PHRASES) {
    if (includesPhrase(text, phrase)) {
      issues.push({
        type: LAYER_A_ISSUE_TYPES.scope_overclaim_phrase,
        severity: ISSUE_TYPE_SEVERITY[LAYER_A_ISSUE_TYPES.scope_overclaim_phrase],
        fixable: true,
        phrase,
        affected_sentence: extractSentenceContaining(text, phrase),
        fix_directive: `If "${phrase}" is not explicitly supported by source text, restate without broad scope language`,
      });
    }
  }

  return issues;
}

export function checkProceduralPosture(summarySpicy, facts) {
  const issues = [];
  const text = summarySpicy || "";

  const isProcedural =
    facts?.merits_reached === false || facts?.case_type === "procedural";

  if (!isProcedural) return issues;

  const hasProceduralKeyword = PROCEDURAL_KEYWORDS.some((p) => p.test(text));
  const hasMeritsImplication = MERITS_IMPLICATION.some((p) => p.test(text));

  if (hasMeritsImplication) {
    issues.push({
      type: LAYER_A_ISSUE_TYPES.procedural_merits_implication,
      severity: ISSUE_TYPE_SEVERITY[LAYER_A_ISSUE_TYPES.procedural_merits_implication],
      fixable: true,
      why: "Merits implication language present in a procedural case",
      fix_directive: "Remove merits framing and add explicit procedural posture (dismissed, remanded, vacated, standing, mootness)",
    });
  }

  if (!hasProceduralKeyword) {
    issues.push({
      type: LAYER_A_ISSUE_TYPES.procedural_missing_framing,
      severity: ISSUE_TYPE_SEVERITY[LAYER_A_ISSUE_TYPES.procedural_missing_framing],
      fixable: true,
      why: "Procedural case lacks procedural framing keywords",
      fix_directive: "Add procedural framing (dismissed, remanded, vacated, standing, mootness, jurisdiction, cert denied)",
    });
  }

  return issues;
}

export function runDeterministicValidators({ summary_spicy, ruling_impact_level, facts, grounding }) {
  const issues = [];

  issues.push(
    ...lintHyperbole(summary_spicy, ruling_impact_level, {
      holding: grounding?.holding ?? facts?.holding,
      practical_effect: grounding?.practical_effect ?? facts?.practical_effect,
      evidence_quotes: grounding?.evidence_quotes ?? facts?.evidence_quotes ?? [],
      source_excerpt: grounding?.source_excerpt ?? "",
    })
  );

  issues.push(...checkProceduralPosture(summary_spicy, facts));

  return issues;
}

export function deriveVerdict(issues) {
  // ADO-310: Use shared constants for type matching
  const highSeverity = issues.some(i =>
    i.severity === 'high' &&
    [LAYER_A_ISSUE_TYPES.unsupported_scale, LAYER_A_ISSUE_TYPES.procedural_merits_implication].includes(i.type)
  );
  if (highSeverity) return 'REJECT';
  if (issues.length > 0) return 'FLAG';
  return 'APPROVE';
}

export function extractSourceExcerpt(scotusCase, maxChars = 2400) {
  const source = scotusCase.opinion_full_text
    || scotusCase.syllabus
    || scotusCase.opinion_excerpt
    || '';

  if (source.length <= maxChars) return source;

  // Take first 1600 + last 800 for better coverage
  const first = source.slice(0, 1600);
  const last = source.slice(-800);
  return `${first}\n...\n${last}`;
}

// ============================================================================
// ADO-309: QA RETRY HELPERS
// ============================================================================

/**
 * Check if any issues in the array are fixable
 * @param {Array} issues - Array of QA issues from runDeterministicValidators
 * @returns {boolean} - True if at least one issue has fixable: true
 */
export function hasFixableIssues(issues) {
  if (!Array.isArray(issues)) return false;
  return issues.some(i => i.fixable === true);
}

/**
 * Build a prompt injection block with fix directives for fixable issues.
 * Returns empty string if no fixable issues.
 *
 * @param {Array} issues - Array of QA issues from runDeterministicValidators
 * @returns {string} - Formatted fix directives block for prompt injection
 */
export function buildQAFixDirectives(issues) {
  if (!Array.isArray(issues)) return '';

  const fixableIssues = issues.filter(i => i.fixable === true && i.fix_directive);
  if (fixableIssues.length === 0) return '';

  const directives = fixableIssues.map((issue, idx) => {
    const context = issue.word || issue.phrase || issue.type;
    return `${idx + 1}. [${issue.type}] ${issue.fix_directive}`;
  });

  return `
QA FIX DIRECTIVES (CRITICAL - your previous output failed QA validation):
The following issues were detected. You MUST fix them in this retry:
${directives.join('\n')}

Do NOT repeat the same issues. Apply these fixes while maintaining factual accuracy.`;
}
