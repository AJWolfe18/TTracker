# 2026-01-30: ADO-310 Layer B LLM QA Module

## Summary

ADO-310 complete: Implemented Layer B LLM-based QA agent for SCOTUS enrichment. This adds LLM validation that catches nuanced issues Layer A (deterministic) misses: accuracy vs holding, hallucinations, scope overreach, tone mismatches. Code pushed to test branch. **Migration 075 requires manual application via Supabase SQL Editor.**

## What Was Done

1. **Created shared issue type constants** (`scripts/enrichment/qa-issue-types.js`)
   - LAYER_A_ISSUE_TYPES, LAYER_B_ISSUE_TYPES, INTERNAL_ISSUE_TYPES
   - SAFETY_ISSUE_TYPES for priority ordering in combined directives
   - ISSUE_TYPE_SEVERITY mapping for deterministic severity normalization

2. **Created Layer B QA module** (`scripts/enrichment/scotus-qa-layer-b.js`)
   - `validateGrounding()` - determines which checks are possible
   - `buildCheckInstructions()` - tells LLM which checks to skip
   - `callWithTransportRetry()` - 2 attempts with jitter for API failures
   - `runLLMQAValidation()` - main LLM call with OpenAI structured outputs
   - `normalizeIssueSeverity()` - forces severity based on issue type
   - `validateAffectedSentence()` - exact substring check with normalization
   - `validateLLMResponse()` - validates LLM output contract
   - `deriveLayerBVerdict()` - returns null | APPROVE | FLAG | REJECT
   - `computeFinalVerdict()` - merges Layer A + B with null handling
   - `computeSeverityScore()` - ignores NO_DECISION artifacts
   - `buildCombinedFixDirectives()` - merges Layer A + B fix directives

3. **Created comprehensive unit tests** (`scripts/enrichment/scotus-qa-layer-b.test.js`)
   - 68 tests covering all acceptance criteria
   - Response validation, verdict computation, severity scoring
   - Null handling edge cases, capabilities enforcement

4. **Created idempotent migration** (`migrations/075_scotus_qa_layer_b.sql`)
   - qa_layer_b_verdict, qa_layer_b_issues, qa_layer_b_confidence
   - qa_layer_b_severity_score, qa_layer_b_prompt_version, qa_layer_b_model
   - qa_layer_b_ran_at, qa_layer_b_error, qa_layer_b_latency_ms
   - layer_b_retry_count

5. **Updated existing validators to use shared constants**
   - scotus-qa-validators.js now imports from qa-issue-types.js
   - scotus-fact-extraction.js DB_COLUMNS includes Layer B columns

## Key Design Decisions

- **LLM returns issues only** - verdict computed deterministically from severity
- **null = NO_DECISION** - Layer B couldn't run, defer to Layer A
- **affected_sentence exact substring** - validated with quote/whitespace normalization
- **Severity normalized by type** - LLM can't game the system
- **Transport vs content retry** - separate retry strategies

## Migration Required

Apply migration 075 to TEST database:
1. Go to Supabase TEST dashboard → SQL Editor
2. Paste contents of `migrations/075_scotus_qa_layer_b.sql`
3. Run SQL
4. Verify columns exist

## Next Steps

1. Apply migration 075 to TEST
2. Integrate Layer B into enrich-scotus.js (ADO-316)
3. Run shadow mode testing to calibrate thresholds
4. Create gold set for validation (ADO-317)

## Commits

- `fc2f174` feat(ado-310): add Layer B LLM QA module for SCOTUS enrichment
