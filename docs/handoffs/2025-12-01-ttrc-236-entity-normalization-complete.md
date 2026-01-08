# TTRC-236 Entity Normalization - Complete

**Date:** 2025-12-01
**Ticket:** TTRC-236
**Status:** Phase 0 Complete - Entity normalization blocker FIXED

---

## Summary

Fixed the entity ID inconsistency that was blocking merge detection. OpenAI was returning raw names like `"Donald Trump"` instead of canonical IDs like `"US-TRUMP"`, causing stories about the same topic to have 0 shared entities.

**Solution:** Client-side normalization + backfill (no OpenAI costs)

---

## What Was Done

### 1. Entity Audit
- Queried all 104 stories with top_entities
- Identified 169 entity IDs needing normalization
- Top offenders: `"Donald Trump"` (66x), `"House of Representatives"` (6x)

### 2. Created Normalization Module
**File:** `scripts/lib/entity-normalization.js`
- 200+ alias mappings covering:
  - People: US-TRUMP, US-BIDEN, US-MUSK, etc.
  - Organizations: ORG-DOJ, ORG-FBI, ORG-CIA, etc.
  - Locations: LOC-USA, LOC-UKRAINE, etc.
  - Events: EVT-JAN6, EVT-SNAP, EVT-ACA

### 3. Integrated into Pipeline
**Modified:**
- `scripts/enrichment/enrich-stories-inline.js` - Added normalization after OpenAI response
- `scripts/job-queue-worker.js` - Added same normalization step

### 4. Backfill Executed
**Script:** `scripts/backfill-entity-normalization.js`
- Dry-run first to preview changes
- Live run: 104 stories updated, 169 entities normalized, 0 errors

### 5. Verification
Stories 1853 and 1959 now share `US-TRUMP` entity (was 0 shared before)

---

## Files Changed

| File | Change |
|------|--------|
| `scripts/lib/entity-normalization.js` | **NEW** - Core normalization module |
| `scripts/enrichment/enrich-stories-inline.js` | **MODIFIED** - Added normalization step |
| `scripts/job-queue-worker.js` | **MODIFIED** - Added normalization step |
| `scripts/backfill-entity-normalization.js` | **NEW** - Backfill script |

---

## Commit

```
4fca59c fix(TTRC-236): add entity ID normalization for merge detection

- Create entity-normalization.js with 200+ alias mappings
- Add normalization to enrich-stories-inline.js and job-queue-worker.js
- Create backfill script for existing stories
- Backfill complete: 104 stories, 169 entities normalized
```

**AI Code Review:** Passed with suggestions (sanitization, null guards - non-blocking)

---

## Next Steps

**Resume TTRC-236 Phase 1 Merge Validation:**

1. **Generate Test Dataset (~100 pairs)**
   - Bucket A: Existing merges (precision validation)
   - Bucket B: High similarity pairs (recall gaps)
   - Bucket C: 1-entity overlap (stress test strict lane)
   - Bucket D: Same topic, different events (false positive prevention)

2. **Run Validation Framework**
   - Execute `validate-merge-quality.js` with ground truth
   - Report P/R/F1 metrics
   - Grid search threshold configs if needed

---

## Manual Actions Required

**JIRA Update (MCP auth expired):**
Add this comment to TTRC-236:
> Entity ID normalization blocker FIXED. Created scripts/lib/entity-normalization.js with 200+ alias mappings. Backfill completed: 104 stories updated, 169 entity IDs normalized, 0 errors. Stories 1853 and 1959 now share US-TRUMP entity. Commit 4fca59c pushed to test. Ready for Phase 1 merge validation.

---

## Cost Impact

- **Implementation:** $0 (no OpenAI calls)
- **Backfill:** $0 (SQL updates only)
- **Future:** All new stories auto-normalized at extraction time

---

## Session Stats

- **Tokens used:** ~50K (across context compaction)
- **Files created:** 2 new, 2 modified
- **Stories fixed:** 104
- **Entities normalized:** 169
