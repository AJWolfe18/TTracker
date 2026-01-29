// Phase 1a: deterministic validators (Hyperbole lint + Procedural posture check)

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

function includesPhrase(haystack, phrase) {
  return safeLower(haystack).includes(safeLower(phrase));
}

function anyQuoteIncludes(evidenceQuotes, phrase) {
  if (!Array.isArray(evidenceQuotes)) return false;
  const p = safeLower(phrase);
  return evidenceQuotes.some((q) => safeLower(q).includes(p));
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
  const phraseLower = safeLower(phrase);
  const sourceExcerpt = safeLower(grounding?.source_excerpt);
  const evidenceQuotes = grounding?.evidence_quotes || [];

  const strongSupport =
    (sourceExcerpt && sourceExcerpt.includes(phraseLower)) ||
    anyQuoteIncludes(evidenceQuotes, phraseLower);

  const weakSupport =
    includesPhrase(grounding?.holding, phraseLower) ||
    includesPhrase(grounding?.practical_effect, phraseLower);

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
          type: "hyperbole",
          severity: "medium",
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
          type: "unsupported_scale",
          severity: "high",
          fixable: false,
          phrase,
          why: `Scale phrase "${phrase}" not supported by source_excerpt, evidence_quotes, holding, or practical_effect`,
        });
      } else if (!support.strong) {
        issues.push({
          type: "weakly_supported_scale",
          severity: "low",
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
        type: "scope_overclaim_phrase",
        severity: "low",
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
      type: "procedural_merits_implication",
      severity: "high",
      fixable: true,
      why: "Merits implication language present in a procedural case",
      fix_directive: "Remove merits framing and add explicit procedural posture (dismissed, remanded, vacated, standing, mootness)",
    });
  }

  if (!hasProceduralKeyword) {
    issues.push({
      type: "procedural_missing_framing",
      severity: "medium",
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
  const highSeverity = issues.some(i =>
    i.severity === 'high' &&
    ['unsupported_scale', 'procedural_merits_implication'].includes(i.type)
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
