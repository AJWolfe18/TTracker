# ADO-280: Two-Pass SCOTUS Enrichment - Implementation Complete

**Date:** 2026-01-22
**ADO:** [ADO-280](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/280) (CLOSED)
**Branch:** test
**Status:** ✅ COMPLETE

---

## Summary

Implemented the two-pass enrichment architecture for SCOTUS cases to prevent GPT hallucinations on insufficient source data.

## Changes Made

### Files Created
1. **`migrations/067_scotus_two_pass.sql`** - Schema additions:
   - `enrichment_status` lifecycle field (pending/enriched/flagged/failed)
   - Pass 1 fact fields: disposition, merits_reached, case_type, holding, prevailing_party, practical_effect
   - Confidence tracking: fact_extraction_confidence, low_confidence_reason
   - Source quality: source_char_count, contains_anchor_terms
   - Drift detection: drift_detected, drift_reason, last_error
   - Manual review: needs_manual_review, manual_reviewed_at, manual_review_note
   - evidence_quotes (JSONB), dissent_exists (boolean)

2. **`scripts/enrichment/scotus-fact-extraction.js`** - Pass 0 + Pass 1:
   - `checkSourceQuality()` - Pre-GPT source validation (min chars, anchor phrases)
   - `extractFactsWithConsensus()` - Runs Pass 1 twice for self-consistency
   - `validatePass1()` - Enforces grounding requirements
   - `deriveCaseType()` - Computes case_type from disposition/merits_reached
   - `flagAndSkip()`, `markFailed()`, `writeEnrichment()` - DB helpers
   - Field constants: FACT_FIELDS, EDITORIAL_FIELDS, CLEAR_DEFAULTS

3. **`scripts/enrichment/scotus-drift-validation.js`** - Pass 2 drift checker:
   - `validateNoDrift()` - Detects contradictions between facts and editorial
   - Hard drift (clear editorial) vs soft drift (keep draft for review)
   - `buildPass2Prompt()` - Adds constraints for procedural/cert/shadow docket cases

### Files Modified
4. **`scripts/enrichment/scotus-gpt-prompt.js`**:
   - Added `PASS2_SYSTEM_PROMPT` - Editorial prompt with locked facts
   - Added `buildPass2UserPrompt()` and `buildPass2Messages()`

5. **`scripts/scotus/enrich-scotus.js`** - Complete rewrite:
   - Three-stage pipeline: Pass 0 → Pass 1 → Pass 2
   - Confidence-based publishing (high→public, medium→review)
   - Cost tracking, retry logic, CLI flags

6. **`docs/features/scotus-tracker/ado-85-plan.md`** - Updated status to IMPLEMENTED

### Bug Fixes
- **validatePass1 cap logic**: Moved confidence cap AFTER validation failures check. Previously, the cap was pushing to the issues array which caused immediate downgrade to 'low'. Now caps to 'medium' correctly.

## Test Results

| Case | Pass 0 | Pass 1 | Pass 2 | Result |
|------|--------|--------|--------|--------|
| FDA v. Alliance (id=11) | ❌ 481 chars, no anchors | - | - | Correctly flagged |
| Starbucks v. McKinney (id=12) | ✅ 1158 chars | ✅ medium | ✅ no drift | Enriched, needs review |
| Connelly (id=4) | ❌ truncated (592 chars) | - | - | Correctly flagged |

**Starbucks enrichment quality:**
- Disposition: affirmed ✓
- Holding: "District Court granted preliminary injunction... Sixth Circuit affirmed" ✓
- Practical effect: "Starbucks required to reinstate employees" ✓
- Summary includes "affirmed" disposition word ✓

## Architecture

```
Pass 0: Source Quality Gate (pre-GPT check)
   ↓ (skip if low)
Pass 1: Fact Extraction (neutral, temp=0, consensus check)
   ↓ (skip if low confidence)
Pass 2: Editorial Framing (temp=0.7, facts locked)
   ↓ (drift validation)
Write to DB (confidence-based publishing)
```

## Migration Applied

Migration `067_scotus_two_pass.sql` was applied to TEST database by user. Verified:
- `enrichment_status` column exists and backfilled correctly
- New fact extraction fields exist
- Indexes created

## Next Steps

1. **Source data quality** - Many cases have truncated syllabi from CourtListener. Consider:
   - Fetching full opinion text for cases with short syllabi
   - Creating new ADO for syllabus extraction improvement

2. **Bulk enrichment** - Can now safely run on remaining cases:
   ```bash
   node scripts/scotus/enrich-scotus.js --limit=20
   ```

3. **Manual review queue** - Cases with `needs_manual_review=true` need human review before publishing

## Cost

Test run: $0.0007 for Starbucks case (3266 tokens)
Estimated per-case: ~$0.0008 (2x original due to consensus check)

---

**Token usage this session:** ~45K input, ~12K output
