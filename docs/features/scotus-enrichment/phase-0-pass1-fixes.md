# SCOTUS Enrichment: Phase 0 - Pass 1 Fixes

**ADO Ticket:** ADO-303
**Status:** Active
**Created:** 2026-01-25
**Updated:** 2026-01-25

## Problem Statement

ADO-275 validation batch revealed Pass 1 is the root cause of downstream issues:
- 5 of 6 low-confidence cases failed on "too many quotes" - all from gpt-5-mini
- Vague who_wins/loses ("respondent") can't be fixed in Pass 2
- ~50% of summaries start with "In a..." due to thin Pass 1 facts
- No QA gate before publishing

## Guiding Principle

Fix the foundation (Pass 1) with strict contracts and simple rule-based gates.
Do NOT add LLM complexity. Do NOT refactor variation engine yet.

---

## Phase 0: Stop the Bleeding (Must-Haves)

### 0.1 Pass 1 Model: gpt-4o-mini Only

**Rationale:** All 5 "too many quotes" failures came from gpt-5-mini succeeding, not failing.

**Changes:**
- Primary model: `gpt-4o-mini` (configurable via env)
- Disable fallback chain by default for Phase 0
- Empty responses → retry up to 2 times (same model, smaller context window)

**Implementation:**
```javascript
// enrich-scotus.js
const FACTS_MODEL_FALLBACKS = (process.env.SCOTUS_FACTS_MODEL_FALLBACKS || 'gpt-4o-mini')
  .split(',').map(s => s.trim()).filter(Boolean);
```

---

### 0.2 Evidence Quotes: Anchor Snippets (Not Verbatim)

**Keep** `evidence_quotes` but constrain them:

| Rule | Value |
|------|-------|
| Max items | 2 |
| Max words per item | 25 words (~150 chars) |
| Purpose | Anchor detection, NOT verbatim paragraph copying |

**Note:** Initial limit of 12 words caused 64% failure rate. Adjusted to 25 words based on GPT-4o-mini output patterns.

**Anchor detection:** Run against Pass 0 source window (opinion/syllabus/excerpt), NOT against evidence_quotes.

**Quote lint:** Detect long quoted spans (>12 words) anywhere in Pass 1 output → fail gate.

---

### 0.3 Pass 1 Contract (Strict Schema)

Use existing schema fields. Key rules:

| Field | Rules |
|-------|-------|
| `disposition` | Required for merits cases. If unclear → null + needs_review |
| `merits_reached` | true/false/null. Don't guess. |
| `case_type` | Derived via `deriveCaseType()` (existing logic) |
| `prevailing_party` | Keep as-is for Pass 1 internal use |
| `evidence_quotes` | 0-2 items, ≤12 words each |
| `fact_extraction_confidence` | high/medium/low |

**Pass 1 behavioral rules:**
- If uncertain → set fields to `null` and `needs_review=true`
- Do NOT invent or guess
- Do NOT use merits language for procedural orders

---

### 0.4 Rule-Based Publish Gate

Fast, deterministic checks. NO LLM calls.

```
GATE CHECKS (all must pass):
├── 1. Valid JSON + non-empty outputs
├── 2. Quote lint passes:
│   ├── evidence_quotes.length <= 2
│   ├── each quote <= 12 words
│   └── no long quoted spans in output
├── 3. If merits decision:
│   ├── disposition is present
│   └── disposition mentioned early in summary_spicy
└── 4. who_wins/who_loses are SPECIFIC (see 0.5)

FAIL → trigger retry path (0.6)
```

---

### 0.5 Party Name Lint (No Parsing, No Full Resolution)

**DO NOT** parse case_name on "v." (edge cases, false precision)
**DO NOT** attempt full name resolution from opinion text (scope creep)

**Instead: BAN standalone generic labels in public fields**

Banned values for `who_wins` / `who_loses`:
- `"petitioner"`, `"the petitioner"`
- `"respondent"`, `"the respondent"`
- `"plaintiff"`, `"the plaintiff"`
- `"defendant"`, `"the defendant"`

**Must include EITHER:**
- A proper noun (e.g., "Texas", "Smith", "EPA"), OR
- A meaningful descriptor (e.g., "the federal government", "state election officials", "parents challenging...", "voters", "prosecutors", "prison officials", "corporate defendants")

**Implementation:**
```javascript
const GENERIC_PARTY_PATTERNS = [
  /^the\s+(petitioner|respondent|plaintiff|defendant)s?$/i,
  /^(petitioner|respondent|plaintiff|defendant)s?$/i,
];

function isGenericParty(text) {
  return GENERIC_PARTY_PATTERNS.some(p => p.test(text?.trim()));
}
```

**Enforcement:**
- Post-pass lint → if generic → one rewrite retry
- Still generic → quarantine (`needs_review=true`, `is_public=false`)

---

### 0.6 Retry Path

```
Pass 1 fails gate
    ↓
Retry ONCE with:
  - Stricter prompt (explicit constraints)
  - Smaller context window if applicable
    ↓
Still fails?
    ↓
Set needs_review = true
Set is_public = false
Set low_confidence_reason = "<failure reason>"
STOP (don't burn more tokens)
```

---

## Phase 0.5: Cheap Style Guard (Optional, Low Effort)

**"In a..." opener detection:**
- If `summary_spicy` starts with "In a/an/the/this ..." AND recent opener also used that structure
- → One rewrite retry
- If rewrite fails → accept (don't block correctness), but log metric

**Implementation:** Can be added after core Phase 0 is stable.

---

## Phase 1: Evaluate After Stabilization (Metrics-Driven)

Run 50-case batch with Phase 0 changes. Measure:

| Metric | Target | Action If Not Met |
|--------|--------|-------------------|
| "In a..." opener rate | < 20% | Add opener anti-repeat gate |
| Generic who_wins/loses in published | 0% | Tighten lint |
| Merits summaries missing disposition | 0% | Tighten gate |
| Quote lint failure rate after retry | < 2% | Adjust thresholds |

**Decide:**
- Whether consensus dual-run is needed (likely not with temp=0)
- Whether pattern engine is worth further investment

**Do NOT start Phase 1 until Phase 0 is deployed and validated.**

---

## Phase 2: Polish (Only If Needed)

| Enhancement | Trigger Condition |
|-------------|-------------------|
| LLM QA reviewer | Only for quarantined cases or small sampling |
| Variation engine refactor | Only if cheap guards don't meet Phase 1 targets |

---

## Implementation Tasks

### Task 1: Model Config Change
- [ ] Change default `SCOTUS_FACTS_MODEL_FALLBACKS` to `'gpt-4o-mini'`
- [ ] Add retry-on-empty logic (up to 2 retries, same model)

### Task 2: Quote Lint
- [ ] Add `MAX_QUOTE_COUNT = 2` and `MAX_QUOTE_WORDS = 12` constants
- [ ] Add `lintQuotes()` function to detect violations
- [ ] Integrate into validation pipeline

### Task 3: Generic Party Lint
- [ ] Add `isGenericParty()` function
- [ ] Add post-Pass-2 lint for `who_wins`/`who_loses`
- [ ] Add retry-on-generic logic

### Task 4: Gate Integration
- [ ] Create `runPublishGate()` function combining all checks
- [ ] Wire gate into `enrichCase()` flow
- [ ] Add retry-then-quarantine logic

### Task 5: Validation Batch
- [ ] Run 25-case batch
- [ ] Verify 0 "too many quotes" failures
- [ ] Verify 0 generic party names in published cases

---

## Acceptance Criteria

Phase 0 complete when:
- [ ] Pass 1 uses gpt-4o-mini only (no fallback chain)
- [ ] Quote lint enforced (≤2 quotes, ≤12 words each)
- [ ] Generic party lint enforced (who_wins/loses must be specific)
- [ ] Rule-based publish gate implemented
- [ ] Retry path implemented (one retry, then quarantine)
- [ ] 25-case validation batch: 0 "too many quotes" failures
- [ ] 25-case validation batch: 0 generic who_wins/who_loses in published cases

---

## Files to Modify

| File | Changes |
|------|---------|
| `scripts/scotus/enrich-scotus.js` | Model config, gate integration, retry logic |
| `scripts/enrichment/scotus-fact-extraction.js` | Quote lint, validation updates |
| `scripts/enrichment/scotus-gpt-prompt.js` | Generic party lint for Pass 2 output |

No database migrations required.
