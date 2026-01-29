# SCOTUS QA System - Implementation Plan

**Feature:** ADO-306 (Parent)
**Status:** Planning Complete
**Created:** 2026-01-27

---

## Overview

An automated quality checker that reviews AI-generated SCOTUS case summaries **before they go public**. Catches exaggerated language, made-up statistics, and summaries that don't match the ruling.

### Pipeline Position

```
CourtListener Data → Pass 1 (Facts) → Pass 2 (Editorial) → QA Bot → Publish
```

### Architecture

| Layer | What | Cost | Phase |
|-------|------|------|-------|
| **Layer A** | Deterministic validators (regex, word lists) | Free | Phase 1 |
| **Layer B** | AI QA agent (checks nuance, hallucination) | ~$0.02/case | Phase 2 |

**Phase 2 only built if Phase 1 miss rate >10%.**

---

## Phase 1: Layer A (Deterministic Validators)

### ADO Cards

| Card | Title | Dependency |
|------|-------|------------|
| ADO-307 | Layer A: Deterministic Validators | None |
| ADO-308 | QA Schema & Pipeline Integration | ADO-307 |
| ADO-309 | QA Retry & Review Workflow | ADO-307, ADO-308 |

### ADO-307: Deterministic Validators

**File:** `scripts/enrichment/scotus-qa-validators.js`

**Validators:**

1. **Hyperbole Lint (A1)**
   - Block at Level 0-2: `guts, obliterates, sweeping, massive, tyranny, crisis, devastating, catastrophic, unprecedented, historic`
   - Flag scale words unless supported: `millions, thousands, nationwide, across the country, every american, all americans, everyone`
   - Flag scope overclaim phrases: `broadly, far-reaching, opens the door, sets a precedent, for the first time, effectively ends, landmark, groundbreaking, across the board, wholesale, fundamentally changes`

2. **Procedural Posture Check (A3)**
   - If `merits_reached=false` OR `case_type='procedural'`:
     - REQUIRE procedural keyword: `dismissed, remanded, vacated, standing, moot, jurisdiction, procedural, DIG, cert denied, no merits`
     - FORBID merits implication: `held that, found that, ruled that, declared, struck down, upheld, invalidated, overturned, established, prevailed, won, lost, victory, defeat`

**Output Schema:**
```javascript
{
  type: 'hyperbole' | 'unsupported_scale' | 'weakly_supported_scale' |
        'scope_overclaim_phrase' | 'procedural_merits_implication' | 'procedural_missing_framing',
  severity: 'low' | 'medium' | 'high',
  fixable: boolean,
  fix_directive: string,
  // type-specific fields: word, phrase, affected_sentence, why
}
```

**Code:** Implementation ready - see `## Implementation Code` section below.

### ADO-308: Schema & Integration

**Migration:**
```sql
ALTER TABLE scotus_cases ADD COLUMN qa_status TEXT DEFAULT 'pending_qa';
-- Values: pending_qa, approved, flagged, rejected, human_override

ALTER TABLE scotus_cases ADD COLUMN qa_verdict TEXT;
-- Values: APPROVE, FLAG, REJECT

ALTER TABLE scotus_cases ADD COLUMN qa_issues JSONB;

ALTER TABLE scotus_cases ADD COLUMN qa_reviewed_at TIMESTAMPTZ;
ALTER TABLE scotus_cases ADD COLUMN qa_review_note TEXT;
```

**Feature Flag:**
- Environment variable: `ENABLE_QA_GATE`
- Default: `false` (shadow mode)
- Shadow mode: Writes qa_* fields but never blocks enrichment
- Enabled mode: REJECT blocks write, FLAG writes with `is_public=false`

**Integration Point:**
```javascript
// In enrich-scotus.js, after Pass 2 completes
import { runDeterministicValidators } from './scotus-qa-validators.js';

const grounding = {
  holding: facts.holding,
  practical_effect: facts.practical_effect,
  evidence_quotes: facts.evidence_quotes || [],
  source_excerpt: extractSourceExcerpt(scotusCase, 2400), // first 1600 + last 800
};

const issues = runDeterministicValidators({
  summary_spicy: pass2.summary_spicy,
  ruling_impact_level: pass2.ruling_impact_level,
  facts,
  grounding,
});

const verdict = deriveVerdict(issues);
// ... persist and handle verdict
```

### ADO-309: Retry & Review Workflow

**Verdict Derivation:**
```javascript
function deriveVerdict(issues) {
  const dominated by = issues.some(i =>
    i.severity === 'high' &&
    ['unsupported_scale', 'procedural_merits_implication'].includes(i.type)
  );
  if (highSeverity) return 'REJECT';
  if (issues.length > 0) return 'FLAG';
  return 'APPROVE';
}
```

**Retry Logic:**
```
if verdict === 'REJECT':
  if issues.some(i => i.fixable):
    → Retry Pass 2 once with fix_directives injected
    → If still REJECT → FLAG for manual
  else:
    → FLAG for manual (skip retry, not fixable)

Max retries: 1 (hard limit)
```

**Fix Directive Injection:**
```javascript
// Add to Pass 2 prompt when retrying
const fixBlock = `
QA ISSUES DETECTED - FIX THESE:
${issues.filter(i => i.fixable).map(i => `- ${i.fix_directive}`).join('\n')}

Do not repeat these mistakes in your output.
`;
```

**Human Review Workflow:**
- Flagged cases: `qa_status = 'flagged'`, `is_public = false`
- Review query: `SELECT * FROM scotus_cases WHERE qa_status = 'flagged'`
- After review: Set `qa_status = 'human_override'`, `qa_reviewed_at = NOW()`, `qa_review_note = '...'`
- Or: Fix issue and re-enrich

---

## Phase 2: Layer B (AI QA Agent) - DEFERRED

**Build only if Phase 1 miss rate >10%.**

### What Layer B Checks

| Check | What It Catches |
|-------|-----------------|
| Unsupported claims | Factual assertions not in grounding sources |
| Scope overreach | "facts say narrow; summary implies broad precedent" |
| Tone mismatch | Level 1 reads like Level 4 |
| Hallucination | Invented statistics, quotes, outcomes |

### Grounding Sources

```javascript
{
  holding: facts.holding,
  practical_effect: facts.practical_effect,
  disposition: facts.disposition,
  vote_split: scotusCase.vote_split,
  prevailing_party: facts.prevailing_party,
  evidence_quotes: facts.evidence_quotes || [],
  source_excerpt: extractSourceExcerpt(scotusCase, 2400),
  dissent_authors: scotusCase.dissent_authors || []
}
```

### Output Schema

```typescript
interface QAResult {
  verdict: 'APPROVE' | 'FLAG' | 'REJECT';

  unsupported_claims: Array<{
    sentence: string;
    why_unsupported: string;
    needed_support_from: 'holding' | 'practical_effect' | 'evidence_quotes' | 'source_excerpt';
  }>;

  scope_overreach: Array<{
    facts_say: string;
    summary_implies: string;
  }>;

  tone_mismatch: {
    expected: string;
    actual: string;
  } | null;

  fix_directives: string[];
  severity_score: number; // 0-100
  reasoning: string;
}
```

### Gold Set (15-20 Examples)

Categories to cover:
- Narrow defendant wins (Barrett-style) → Level 3
- Broad rights restrictions → Level 4-5
- Procedural dismissals → Level 2
- Genuine people-side wins → Level 0-1
- Hallucination examples
- Tone-level mismatches
- Scope overreach examples
- Procedural false positives (correctly framed)

### ADO Cards for Phase 2 (Create Later)

| Card | Title |
|------|-------|
| ADO-310 | Layer A: Safe Auto-Fix Micro-Loop |
| ADO-311 | Layer B: QA Agent Implementation |
| ADO-312 | Gold Set Curation |
| ADO-313 | QA Baseline Metrics & Calibration |

---

## Key Decisions

| Decision | Rule |
|----------|------|
| Retry logic | REJECT → retry once **if fixable** → else FLAG |
| Max retries | 1 (hard limit) |
| Review workflow | `qa_status` column, `is_public=false` when flagged |
| Feature flag | `ENABLE_QA_GATE=false` default (shadow mode) |
| Verdict rules | High-severity unsupported → REJECT, any issues → FLAG |
| Phase 2 trigger | Build Layer B only if Phase 1 miss rate >10% |

---

## Known Issues & Mitigations

| Issue | Mitigation |
|-------|------------|
| Regex false positives (merits language in background context) | Add context-aware filtering if needed |
| Source excerpt too short | Use first 1600 + last 800 chars |
| Pass 1 trust problem | Accept for Phase 1, track separately |
| QA agent could hallucinate (Phase 2) | Shadow mode first, calibrate on gold set |

---

## Build Order

```
1. ADO-307: Create scotus-qa-validators.js (code ready)
2. ADO-308: Migration + feature flag + pipeline integration
3. ADO-309: deriveVerdict() + retry logic
4. Shadow mode run (ENABLE_QA_GATE=false)
5. Evaluate results
6. Decide: Is Phase 2 needed?
```

---

## Implementation Code

### scotus-qa-validators.js

```javascript
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
```

---

## Metrics to Track

After each batch run:
```javascript
{
  total_cases: 50,
  approved: 42,
  flagged: 6,
  rejected: 2,

  top_issues: [
    { type: 'scope_overclaim_phrase', count: 8 },
    { type: 'procedural_missing_framing', count: 3 },
    { type: 'hyperbole', count: 2 }
  ],

  retries_attempted: 2,
  retries_succeeded: 1,

  // Track false positives
  false_rejects_overridden: 0
}
```

---

## Related Documents

- `/docs/features/scotus-qa/prd.md` - Product requirements (create if needed)
- `/scripts/enrichment/scotus-qa-validators.js` - Implementation
- `/migrations/XXX_add_qa_columns.sql` - Schema migration

---

**Last Updated:** 2026-01-27
