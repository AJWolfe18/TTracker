# ADO-85: SCOTUS Enrichment Script Plan

**Created:** 2026-01-20
**Updated:** 2026-01-21
**Status:** ⚠️ BLOCKED - Quality Issues Discovered
**ADO:** [ADO-85](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/85)

---

## 🚨 Current Status

### Completed ✅
- `enrich-scotus.js` script created with full safety guards
- PROD safety: `--prod` flag required, 3-second abort window
- Budget tracking, retry logic, batch limits (MAX_SAFE_LIMIT=100)
- Column alignment: `docket_number`, `opinion_excerpt` (matching DB schema)
- Validation: short `dissent_highlights` treated as null-equivalent
- 3 test cases enriched in TEST DB

### Blocking Issue ❌
**GPT hallucination when source material is insufficient:**

| Case | Source Quality | GPT Said | Reality |
|------|----------------|----------|---------|
| FDA v. Alliance | 481 chars (header only) | "Pharma wins, loophole opened" | Standing dismissal - no merits ruling |
| Starbucks v. McKinney | Full syllabus | "Workers win temporarily" | Made injunctions *harder* for NLRB |
| Connelly v. United States | Truncated syllabus | "Corps vs small business" | Estate tax valuation case |

**Root cause:** Single-pass enrichment conflates fact extraction with editorial framing. GPT hallucinates facts while trying to be "spicy."

### Next Steps
1. **[ADO-280](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/280)** - Two-pass architecture for factual accuracy
2. **Better source data** - Improve syllabus extraction from CourtListener
3. **DO NOT run bulk enrichment until ADO-280 is complete**

---

## Overview

Create `enrich-scotus.js` script that calls GPT to generate editorial analysis for SCOTUS cases fetched by `fetch-cases.js`.

---

## What We're Analyzing

### Input: The Syllabus

SCOTUS opinions have a standardized structure. The **syllabus** is a ~500-3000 character summary prepared by the Court Reporter that includes:

- The legal question presented
- How the case reached SCOTUS
- The holding (what they decided)
- Key reasoning from the majority

**Example from database (Kaiser Gypsum case):**
```
Petitioner Truck Insurance Exchange is the primary insurer for companies
that manufactured and sold products containing asbestos... Truck sought
to oppose the Plan under §1109(b) of the Bankruptcy Code... The District
Court confirmed the Plan. It concluded, among other things, that Truck
had limited standing...
```

### Why Syllabus (Not Full Opinion)

| Option | Size | Cost | Quality |
|--------|------|------|---------|
| Full opinion | 20K-100K chars | $0.10-0.50/case | Overkill, mostly procedural |
| **Syllabus** | 500-3000 chars | ~$0.01/case | Perfect - has the key holding |
| Opinion excerpt | 500 chars | ~$0.005/case | Too little context |

The syllabus is the sweet spot: enough context for GPT to understand the ruling, small enough to be cheap.

### Additional Context Sent to GPT

Beyond syllabus, we also send:
- `case_name` - Who vs Who
- `term` - Which SCOTUS term (e.g., "2024")
- `decided_at` - When decided
- `vote_split` - "6-3", "9-0", etc. (if available)
- `majority_author` - Who wrote it
- `dissent_authors[]` - Who dissented
- `issue_area` - voting_rights, agency_power, etc. (if classified)

---

## Clarification: The "500 char quote" Reference

The original ADO-85 description mentioned "Max quote length: 500 chars" - this was for a **claims[] validation system** that was never implemented:

```javascript
// Original vision (NOT IMPLEMENTED):
claims: [
  {
    claim: "Court gutted Chevron deference",
    quote_span: "agencies no longer entitled to...",  // max 500 chars
    confidence: 8
  }
]
```

**We are NOT implementing this.** Instead, we use simpler `evidence_anchors[]`:

```javascript
// What we actually use:
evidence_anchors: ["syllabus", "majority §II.A", "dissent, Sotomayor J."]
```

This tells the reader WHERE the analysis comes from without requiring machine-checkable quote validation.

---

## Output Fields

GPT generates these fields for each case:

| Field | Description | Validation |
|-------|-------------|------------|
| `ruling_impact_level` | 0-5 scale | Required, 0-5 |
| `ruling_label` | "Constitutional Crisis", etc. | Must match predefined labels |
| `who_wins` | Specific beneficiary | Min 5 chars |
| `who_loses` | Specific victim | Min 5 chars |
| `summary_spicy` | 3-4 sentence editorial | 100-1500 chars |
| `why_it_matters` | Systemic implications | 50-600 chars |
| `dissent_highlights` | Key dissent warning | 30-500 chars or null |
| `evidence_anchors` | Citation references | Non-empty array |

---

## Implementation Steps

### 1. Query Unenriched Cases

```javascript
const { data: cases } = await supabase
  .from('scotus_cases')
  .select('*')
  .is('enriched_at', null)
  .not('syllabus', 'is', null)  // Must have content to analyze
  .order('decided_at', { ascending: false })
  .limit(batchSize);
```

### 2. Build Prompt with Variation

```javascript
import { SYSTEM_PROMPT, buildUserPrompt, validateEnrichmentResponse } from './scotus-gpt-prompt.js';
import { getPoolType, selectVariation, buildVariationInjection } from './scotus-variation-pools.js';

// Select variation based on estimated impact level
const poolType = getPoolType(estimatedLevel, scotusCase.issue_area);
const variation = selectVariation(poolType, recentlyUsedIds);
const variationInjection = buildVariationInjection(variation, recentOpenings);

// Build user prompt
const userPrompt = buildUserPrompt(scotusCase, variationInjection);
```

### 3. Call GPT-4o-mini

```javascript
const response = await openai.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ],
  response_format: { type: 'json_object' },
  temperature: 0.7,
  max_tokens: 1500
});
```

### 4. Validate Response

```javascript
const enrichment = JSON.parse(response.choices[0].message.content);
const { valid, errors } = validateEnrichmentResponse(enrichment);

if (!valid) {
  console.error(`Validation failed for case ${scotusCase.id}:`, errors);
  // Log error, maybe retry once
  continue;
}
```

### 5. Write to Database

```javascript
const { error } = await supabase
  .from('scotus_cases')
  .update({
    ruling_impact_level: enrichment.ruling_impact_level,
    ruling_label: enrichment.ruling_label,
    who_wins: enrichment.who_wins,
    who_loses: enrichment.who_loses,
    summary_spicy: enrichment.summary_spicy,
    why_it_matters: enrichment.why_it_matters,
    dissent_highlights: enrichment.dissent_highlights,
    evidence_anchors: enrichment.evidence_anchors,
    enriched_at: new Date().toISOString(),
    prompt_version: 'v1-ado85',
    is_public: true  // Make visible after enrichment
  })
  .eq('id', scotusCase.id);
```

### 6. Track Cost

```javascript
// Estimate: ~1500 input tokens (syllabus + metadata + prompt)
//           ~500 output tokens
// GPT-4o-mini: $0.15/1M input, $0.60/1M output
// Cost per case: ~$0.0005 input + ~$0.0003 output = ~$0.0008
// Round up to ~$0.01 for safety margin

await trackCost('scotus_enrichment', 0.01);
```

---

## File Structure

```
scripts/scotus/
├── fetch-cases.js          # ✅ Exists - fetches from CourtListener
├── enrich-scotus.js        # 🔲 To create - GPT enrichment
└── README.md               # ✅ Exists - usage docs

scripts/enrichment/
├── scotus-gpt-prompt.js    # ✅ Exists - system prompt, validation
└── scotus-variation-pools.js # ✅ Exists - opening patterns
```

---

## Usage

```bash
# Enrich all unenriched cases (with syllabus)
node scripts/scotus/enrich-scotus.js

# Enrich specific number
node scripts/scotus/enrich-scotus.js --limit=10

# Dry run (no DB writes)
node scripts/scotus/enrich-scotus.js --limit=5 --dry-run
```

---

## Cost Estimate

| Cases | Input Tokens | Output Tokens | Estimated Cost |
|-------|--------------|---------------|----------------|
| 1 | ~1,500 | ~500 | ~$0.01 |
| 10 | ~15,000 | ~5,000 | ~$0.10 |
| 50 | ~75,000 | ~25,000 | ~$0.50 |

Well within $50/month budget.

---

## Acceptance Criteria

- [x] Script queries unenriched cases with syllabus OR excerpt
- [x] Calls GPT with existing prompt infrastructure
- [x] Validates responses before writing
- [x] Sets `enriched_at` and `is_public = true`
- [x] Tracks cost in budgets table
- [x] Handles errors gracefully (logs, continues)
- [x] CLI flags: `--limit`, `--dry-run`, `--prod`
- [ ] **Factual accuracy** - GPT output matches actual case holdings ⚠️ BLOCKED

---

## Test Plan

1. **Dry run with 3 cases** - ✅ Verified prompt construction
2. **Enrich 3 cases** - ✅ DB writes working
3. **Check validation** - ✅ Validation catches malformed responses
4. **Check RLS** - ✅ Enriched cases have `is_public = true`
5. **Review output quality** - ❌ FAILED - GPT hallucinated facts on all 3 cases

### Test Results (2026-01-21)

| Case ID | Case Name | Validation | DB Write | Factual Accuracy |
|---------|-----------|------------|----------|------------------|
| 11 | FDA v. Alliance | ✅ | ✅ | ❌ Wrong (standing case, not pharma win) |
| 12 | Starbucks v. McKinney | ✅ | ✅ | ❌ Wrong (bad for workers, not good) |
| 4 | Connelly v. United States | ✅ | ✅ | ❌ Wrong (tax case, not corps vs small biz) |

**Conclusion:** Script works mechanically, but output is factually unreliable. Need two-pass architecture.

---

## 🔧 Proposed Fix: Two-Pass Architecture ([ADO-280](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/280))

### Problem
Single-pass enrichment asks GPT to simultaneously:
1. Extract facts from legal text
2. Determine who won/lost
3. Apply editorial tone

When source material is insufficient or complex, GPT conflates these tasks and hallucinates facts to fit the requested tone.

### Solution: Separate Concerns

**Pass 1: Fact Extraction** (no editorial tone)
```
Input: Syllabus/excerpt text
Output: {
  "holding": "Court ruled X",
  "prevailing_party": "Petitioner/Respondent",
  "practical_effect": "This means Y for Z",
  "dissent_exists": true/false,
  "confidence": "high/medium/low"
}
```

**Pass 2: Editorial Framing** (facts provided, just add tone)
```
Input: Pass 1 output + variation injection
Output: {
  "ruling_impact_level": 3,
  "who_wins": "...",
  "who_loses": "...",
  "summary_spicy": "...",
  ...
}
```

### Why This Works
- Pass 1 can't hallucinate to match a tone (no tone requested)
- Pass 2 can't hallucinate facts (facts provided as input)
- If Pass 1 returns `confidence: "low"`, flag for manual review

### Cost Impact
- Current: ~$0.0004/case (1 pass)
- Two-pass: ~$0.0008/case (2 passes)
- Still well under budget

### Should All Content Types Use This?

| Type | Source Redundancy | Hallucination Risk | Two-Pass? |
|------|-------------------|-------------------|-----------|
| Stories | Multiple articles | Lower | Maybe not |
| Pardons | Structured DOJ data | Lower | No |
| SCOTUS | Single legal doc | **High** | **Yes** |

SCOTUS is highest risk: single source, legal nuance, no redundancy.

### Implementation Plan
1. Create `extractFactsFromCase()` function (Pass 1)
2. Modify `enrichCase()` to use two-pass flow
3. Add `fact_extraction_confidence` field to schema
4. Flag low-confidence cases for manual review
5. Update validation to check Pass 1 → Pass 2 consistency

---

## Future Enhancement: ADO-275

After MVP, ADO-275 will add:
- Frame bucket architecture (deterministic variation selection)
- Mismatch fuse (GPT can override frame if wrong)
- Style pattern system (replaces current variation pools)

This is an enhancement, not a blocker for MVP.

---

## References

- Existing prompt: `scripts/enrichment/scotus-gpt-prompt.js`
- Existing pools: `scripts/enrichment/scotus-variation-pools.js`
- Schema: `migrations/066_scotus_cases.sql`
- Similar script: `scripts/enrichment/enrich-executive-orders.js`
