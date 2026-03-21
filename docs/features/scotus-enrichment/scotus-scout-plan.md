# SCOTUS Scout Plan (Revised)

## Overview

Replace GPT Pass 1 fact extraction with a **Perplexity-backed Scout** — a validated, source-tiered, confidence-aware extraction subsystem. Scout owns factual fields only; Pass 2 Writer remains the editorial layer.

## Architecture

```
Case (name + docket)
    ↓
[1] Scout Retrieval — Perplexity query, capture raw answer + cited URLs
    ↓
[2] Scout Normalization — Parse JSON, normalize names/disposition/vote format
    ↓
[3] Scout Validation — Deterministic validator → ok / uncertain / failed
    ↓
[4] Comparison Layer — Scout vs DB vs gold truth, field-level diffs
    ↓
[5] Writer Handoff — Only validated fact sheets go to Pass 2
```

## Source-Tier Policy

Perplexity is a retrieval/synthesis layer, not ground truth. Scout must track which tiers its answers came from.

| Tier | Source | Trust Level |
|------|--------|-------------|
| 1 | Official SCOTUS opinion / slip opinion | Authoritative |
| 2 | SCOTUSblog / Oyez | High |
| 3 | Wikipedia / other | Supplementary |

**Rules:**
- If Tier 1 is missing and Tier 2 sources disagree → `needs_review = true`, no DB write
- Wikipedia-only evidence → cannot write directly to DB (must have Tier 1 or Tier 2 corroboration)
- Scout must return `source_tiers_used` array so we can enforce these rules deterministically

## Output Contract

### Scout Status

Every Scout response must include a top-level status:

| Status | Meaning | DB Write? |
|--------|---------|-----------|
| `ok` | All required fields present, validated, sufficient sources | Yes |
| `uncertain` | Parseable but failed validation or source quality | No — log raw response, sources, review reason |
| `failed` | Unparseable or Perplexity returned nothing useful | No — log error |

### Scout Fields (Pass 1 — fact extraction only)

```json
{
  "status": "ok | uncertain | failed",
  "formal_disposition": "affirmed | reversed | vacated | remanded | reversed_and_remanded | vacated_and_remanded | dismissed | GVR",
  "formal_disposition_detail": "Free text for mixed/complex dispositions",
  "opinion_type": "majority | plurality | per_curiam | unsigned_per_curiam | DIG",
  "vote_split": "9-0 | 7-2 | 6-3 | 5-4 | ...",
  "majority_author": "Last name or null (null for per curiam/unsigned)",
  "dissent_authors": ["Last1", "Last2"],
  "substantive_winner": "Who actually benefited from the ruling",
  "practical_effect": "One sentence: what changes in the real world",
  "holding": "What the court held",
  "issue_area": "constitutional_rights | criminal_procedure | ...",
  "case_citation": "e.g. 603 U.S. ___ (2024) if known",
  "fact_confidence": {
    "formal_disposition": "high | medium | low",
    "vote_split": "high | medium | low",
    "majority_author": "high | medium | low",
    "dissent_authors": "high | medium | low",
    "substantive_winner": "high | medium | low"
  },
  "source_tiers_used": [1, 2],
  "source_urls": ["https://..."],
  "needs_review": false,
  "review_reason": null
}
```

**Field decisions:**
- `prevailing_party` → renamed to `substantive_winner` (avoids confusion with formal disposition)
- `vote_split` — must be score format only (e.g. "7-2"), never mixed with "per curiam" text
- `opinion_type` enum expanded: `plurality`, `DIG`, `GVR`, `unsigned_per_curiam`
- `issue_area` — kept because Pass 2 depends on it for editorial generation
- `holding` — kept because Pass 2 depends on it for summary writing

## Deterministic Validator

After JSON parse, a validator checks:

### Required Fields
- `formal_disposition`, `vote_split`, `majority_author`, `substantive_winner`, `status`

### Enum Validity
- `formal_disposition` must be one of the defined enum values
- `opinion_type` must be one of the defined enum values
- `vote_split` must match pattern `\d+-\d+`

### Consistency Rules
- Unanimous vote (9-0, 8-0) → `dissent_authors` must be empty array
- `opinion_type = unsigned_per_curiam` → `majority_author` must be null
- `formal_disposition = vacated` must not normalize into `reversed`
- Mixed dispositions must remain in `formal_disposition_detail` without collapsing to wrong base enum
- If `dissent_authors` has entries, vote split must show a split (not unanimous)
- Vote split numbers must sum to <= 9

### Source Quality
- At least one Tier 1 or Tier 2 source required for `status: "ok"`
- If only Tier 3 → downgrade to `uncertain`

**Any validation failure → status downgraded to `uncertain` with `review_reason` populated.**

## Field Ownership

Scout owns Pass 1 fact fields **only**. Pass 2 Writer must never mutate Scout-owned fields.

### Scout-Owned Fields (written by Scout)
- `formal_disposition`, `formal_disposition_detail`, `opinion_type`
- `vote_split`, `majority_author`, `dissent_authors`
- `substantive_winner`, `practical_effect`, `holding`, `issue_area`
- `case_citation`

### Metadata Fields (written alongside Scout facts)
- `fact_extractor_version` — e.g. "scout-v1"
- `fact_sources` — array of URLs from Perplexity
- `fact_extracted_at` — timestamp
- `fact_confidence` — per-field confidence object
- `fact_review_status` — "ok" | "needs_review" | "failed"

### Pass 2 Writer-Owned Fields (untouched by Scout)
- `ruling_impact_level`, `ruling_label`, `who_wins`, `who_loses`
- `summary_spicy`, `why_it_matters`, `dissent_highlights`, `evidence_anchors`

### Audit
- Log before/after diffs for any changed fields on live writes

## DB Write Rules

1. **Only write when `status === "ok"`** — uncertain/failed never write
2. **Overwrite only Scout-owned fields** — never touch Pass 2 fields
3. **Idempotent** — reruns produce the same result; safe to run multiple times
4. **Record why fields changed** — diff log in output
5. **Rollback path** — store previous values before overwriting (in output JSON, not separate DB table for v1)

## File Structure

```
scripts/enrichment/
├── perplexity-client.js       # Shared client (refactored from perplexity-research.js)
├── scotus-scout.js            # Main CLI entry point + worker loop

scripts/scotus/
├── scout-prompt.js            # Prompt builder
├── scout-parser.js            # JSON parse + normalization
├── scout-validator.js         # Deterministic validation rules
├── scout-gold-truth.json      # Gold set (symlink or copy from tests/)
```

## Validation Batch

### Story 1: Dry Run (6 known-bad + expanded)
The 6 known-bad cases are the minimum bar. Expanded batch adds coverage for failure classes:

| Category | Count | Purpose |
|----------|-------|---------|
| Known-bad disposition (Kirtz, Wullschleger, Horn, Bowe, Riley, Bondi) | 6 | Must get 100% correct |
| Already in gold set (remaining 19 from gold-truth.json) | 19 | Regression coverage |

**Total: 25 cases** (the full existing gold set). This gives us disposition variety without needing to manually fact-check new cases.

### Story 2: Full Run
- Field-level comparison across all 145 cases
- Any case where Scout returns `uncertain` gets surfaced in report

**Note on further expansion:** The feedback asks for 5 affirmed-after-reversal, 5 vacated/GVR, 3 per curiam, 3 mixed-disposition, 3 tricky author/dissent. Rather than fact-checking 22 *new* cases up front, we run the full 145 in Story 2 and any mismatches become new gold entries. This is more practical than pre-building a larger gold set.

## CLI

```bash
# Basic dry run (no DB writes)
node scripts/enrichment/scotus-scout.js --dry-run --ids=51,64,137,285,224,131

# Full dry run against gold set
node scripts/enrichment/scotus-scout.js --dry-run --gold-set

# Limit to N cases
node scripts/enrichment/scotus-scout.js --dry-run --limit=20

# Live write (Scout-owned fields only, status=ok only)
node scripts/enrichment/scotus-scout.js --ids=51,64

# All enriched cases
node scripts/enrichment/scotus-scout.js --all --dry-run

# Control outputs
node scripts/enrichment/scotus-scout.js --dry-run --output-json=results.json
node scripts/enrichment/scotus-scout.js --dry-run --show-sources
node scripts/enrichment/scotus-scout.js --dry-run --fail-on-uncertain

# Restrict which fields get written (live mode)
node scripts/enrichment/scotus-scout.js --write-fields=formal_disposition,vote_split,majority_author

# Only overwrite if Scout result is higher confidence
node scripts/enrichment/scotus-scout.js --only-if-better
```

## Prompt Design

Key prompt rules:
1. Disposition = formal SCOTUS action on the lower court judgment
2. Prefer official opinion or SCOTUSblog case page language for disposition
3. Do not infer missing fields from likely patterns — return `null` with low confidence instead
4. Must return `status`, `fact_confidence`, `source_tiers_used`, `case_citation`
5. `vote_split` is always numeric format (e.g. "7-2"), never mixed with procedural text
6. `substantive_winner` describes who benefits, not formal party alignment

## Implementation Stories

### Story 1: Scout Dry Run
**Scope:** Build Scout, validate against 25-case gold set, no DB writes

1. Refactor `PerplexityClient` from `perplexity-research.js` into shared `perplexity-client.js`
2. Build `scout-prompt.js` — prompt builder with source-tier and confidence instructions
3. Build `scout-parser.js` — JSON parse + field normalization (disposition, names, vote format)
4. Build `scout-validator.js` — deterministic checks (required fields, enums, consistency, source quality)
5. Build `scotus-scout.js` — CLI entry point with dry-run mode
6. Run against 6 known-bad cases → must get 100% correct disposition
7. Run against full 25-case gold set → >=95% JSON parse success, 0 invalid enums
8. Verify `perplexity-research.js` still works after client refactor

**Acceptance criteria:**
- 100% correct disposition on 6 known-bad cases
- >=95% JSON parse success on 25-case batch
- 0 invalid enum values
- 0 writes when `status != "ok"` (dry-run enforced anyway)
- 100% source capture on every response
- Dry-run cost < $0.15 (25 × $0.005)
- `perplexity-research.js` remains working

### Story 2: Scout Live + Comparison Report
**Scope:** Run against all 145 cases, enable live writes for Scout-owned fields

1. Field-level comparison report: Scout vs current DB values for all 145 cases
2. Enable live write mode — Scout-owned fields only, `status === "ok"` only
3. Rollback path: output includes previous values for every changed field
4. Uncertain cases surfaced in report with reasons — never silently written
5. Add `fact_extractor_version`, `fact_sources`, `fact_extracted_at`, `fact_confidence`, `fact_review_status` to write payload

**Acceptance criteria:**
- Field-level comparison report across all 145 cases
- Live writes limited to Scout-owned fact fields only
- Rollback data exists for every write
- 0 uncertain cases silently written
- Pass 2 Writer fields untouched

## Cost

| Scenario | Cost |
|----------|------|
| Story 1 dry run (25 cases) | ~$0.13 |
| Story 2 full run (145 cases) | ~$0.73 |
| Per-case ongoing | ~$0.005 |

All well within the $5/day budget cap.

## What This Plan Does NOT Change

- Pass 2 Writer stays exactly as-is
- SCOTUSblog scraper stays as-is
- `computeSeverityBounds()` stays as-is
- Gold truth JSON structure stays compatible
- No new database migrations needed for Story 1 (metadata fields can be added in Story 2 migration)

---

**Last Updated:** 2026-03-21
