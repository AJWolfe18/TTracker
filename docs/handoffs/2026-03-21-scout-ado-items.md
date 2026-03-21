# ADO Items to Create — SCOTUS Scout

Create these in https://dev.azure.com/AJWolfe92/TTracker

---

## Feature (parent)

- **Type:** Feature
- **Title:** SCOTUS Scout - Perplexity Fact Extraction Subsystem
- **State:** Active
- **Tags:** scotus; enrichment; perplexity
- **Description:**

Replace GPT Pass 1 fact extraction with a validated, source-tiered, confidence-aware Perplexity-backed Scout subsystem for SCOTUS case enrichment. Scout owns factual fields only; Pass 2 Writer remains the editorial layer.

Plan: docs/features/scotus-enrichment/scotus-scout-plan.md

---

## Story 1 (child of Feature)

- **Type:** User Story
- **Title:** Scout Dry Run - Build & Validate Against Gold Set
- **State:** Active
- **Tags:** scotus; enrichment; perplexity; scout
- **Description:**

Build the SCOTUS Scout subsystem and validate against the 25-case gold set with 0 DB writes.

Scope:
1. Refactor PerplexityClient into shared perplexity-client.js
2. Build scout-prompt.js (prompt builder with source-tier and confidence instructions)
3. Build scout-parser.js (JSON parse + field normalization)
4. Build scout-validator.js (deterministic validation: required fields, enums, consistency, source quality)
5. Build scotus-scout.js CLI entry point with dry-run mode
6. Run against 6 known-bad cases (Kirtz, Wullschleger, Horn, Bowe, Riley, Bondi)
7. Run against full 25-case gold set
8. Verify perplexity-research.js still works after client refactor

Acceptance Criteria:
- 100% correct disposition on 6 known-bad cases
- >=95% JSON parse success on 25-case batch
- 0 invalid enum writes
- 0 writes when status != ok
- 100% source capture on every response
- Dry-run cost < $0.15
- perplexity-research.js remains working

---

## Story 2 (child of Feature)

- **Type:** User Story
- **Title:** Scout Live Run - Field Comparison & Live Writes
- **State:** New
- **Tags:** scotus; enrichment; perplexity; scout
- **Description:**

Run Scout against all 145 SCOTUS cases, produce field-level comparison report, and enable live writes for Scout-owned fields only.

Scope:
1. Field-level comparison report: Scout vs current DB values for all 145 cases
2. Enable live write mode (Scout-owned fields only, status=ok only)
3. Rollback path: output includes previous values for every changed field
4. Uncertain cases surfaced in report with reasons, never silently written
5. Add metadata fields: fact_extractor_version, fact_sources, fact_extracted_at, fact_confidence, fact_review_status

Acceptance Criteria:
- Field-level comparison report across all 145 cases
- Live writes limited to Scout-owned fact fields only
- Rollback data exists for every write
- 0 uncertain cases silently written
- Pass 2 Writer fields untouched

---

## After Creating

Link both Stories as children of the Feature in ADO.
Then delete this file — it's a one-time reference.
