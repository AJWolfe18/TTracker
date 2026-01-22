# ADO-281: SCOTUS Two-Pass Fixes - Session Summary

**Date:** 2026-01-22
**ADO:** [ADO-281](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/281)
**Branch:** test
**Status:** IN PROGRESS

---

## Completed This Session

### 1. Data Quality Fixes
- **Duplicate prevention**: Changed upsert from `courtlistener_cluster_id` to `docket_number`
- **Migration 068**: Added unique constraint on docket_number (USER RAN SQL)
- **Cleaned 5 duplicate cases** from database

### 2. Syllabus Extraction Fix
- **Root cause**: Regex stopped at justice names/disposition words appearing WITHIN syllabus
- **Fix**: Rewrote `extractSyllabus()` to look for actual opinion START markers
- **Limit increased**: 2000 → 5000 chars for syllabus

### 3. Opinion Excerpt Fallback
- **Problem**: Cases with NULL syllabus had only 500 char excerpt
- **Fix**: Increased `extractExcerpt()` to 15000 chars
- **Now always stores excerpt** as fallback (not just when syllabus NULL)

### 4. Drift Detection Fixes (from code review)
- Fixed "standing" false positives (word boundary regex)
- Added "stands" to cert stage check
- Fixed inversion detection word boundaries
- Added warnings for unknown fields in `sanitizeForDB()`

### 5. Quote Length Validation
- **Problem**: 25 word limit too strict for legal quotes
- **Fix**: Increased `MAX_QUOTE_WORDS` from 25 → 50

---

## Test Results

| Case | Before | After |
|------|--------|-------|
| FDA v. Alliance | Flagged (NULL syllabus) | ✅ HIGH confidence, auto-published |
| Vidal v. Elster | Flagged (consensus mismatch) | ✅ MEDIUM confidence, needs review |
| Truck Insurance | Flagged (quote too long) | ✅ MEDIUM confidence, needs review |
| Connelly | Flagged (truncated syllabus) | ✅ HIGH confidence, auto-published |
| Becerra | Flagged | ❌ Still flagged (consensus mismatch) |

**Success rate improved from 1/5 to 4/5**

---

## Files Modified

1. `scripts/scotus/fetch-cases.js`
   - `extractSyllabus()` - Fixed regex, increased to 5000 chars
   - `extractExcerpt()` - Increased to 15000 chars, always stores
   - Upsert now on `docket_number` instead of `courtlistener_cluster_id`
   - Normalize docket_number (remove "No. " prefix)

2. `scripts/enrichment/scotus-fact-extraction.js`
   - `MAX_QUOTE_WORDS` - 25 → 50
   - `sanitizeForDB()` - Warns on dropped unknown fields
   - Prompt updated for 50-word quotes

3. `scripts/enrichment/scotus-drift-validation.js`
   - Word boundary regex for "standing" check
   - Added "stands" to cert stage check
   - Word boundary regex for inversion pairs

4. `migrations/068_scotus_docket_unique.sql` (NEW)
   - Normalizes docket_number, adds unique constraint

---

## Remaining Work (ADO-281)

### Must Do
1. **Commit and push** all changes to test branch
2. **Becerra consensus issue** - GPT confused about prevailing_party
   - May need prompt clarification for tribal sovereignty cases

### Nice to Have (P3)
3. Number validation over-strict (soft issue detection)
4. Pass 2 disposition lock in system prompt

### Future Consideration
5. Fetch more cases from 2025 term for broader testing
6. Review cases in `needs_manual_review=true` queue

---

## CourtListener Token

Token was provided inline: `c9c7c709e6307c0a5b04476644beb57ad2c3a894`

To fetch more cases:
```bash
COURTLISTENER_API_TOKEN=c9c7c709e6307c0a5b04476644beb57ad2c3a894 node scripts/scotus/fetch-cases.js --since=2024-10-01 --limit=20
```

---

## Cost

This session: ~$0.02 (enrichment tests)
Per-case cost: ~$0.001-0.002

---

**Token usage this session:** ~80K input, ~15K output
