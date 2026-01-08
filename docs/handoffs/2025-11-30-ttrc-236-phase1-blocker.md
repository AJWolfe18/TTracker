# Handoff: TTRC-236 Phase 1 - BLOCKER FOUND

**Date:** 2025-11-30
**Status:** BLOCKED - Entity Normalization Required First

---

## Critical Finding: Entity ID Inconsistency

**The merge logic is NOT hardcoded to disable.** But it can't work because entity IDs aren't normalized.

### Example (Same Topic, Zero Shared Entities)

| Story ID | Headline | top_entities |
|----------|----------|--------------|
| 1959 | "Trump designates Muslim Brotherhood..." | `["US-TRUMP","ORG-WHITE-HOUSE","LOC-MIDDLE-EAST"]` |
| 1853 | "Trump begins process of designating Muslim Brotherhood..." | `["Donald Trump","Muslim Brotherhood","Marco Rubio",...]` |

**Result:** 0 shared entities because `"US-TRUMP" ≠ "Donald Trump"`

This makes `MIN_SHARED: 2` impossible to pass for stories that SHOULD merge.

---

## Why This Blocks TTRC-236

The merge validation plan requires:
1. Finding story pairs with entity overlap
2. Testing if `shouldMerge()` correctly identifies them

**Without normalized entities:**
- Stories about same event have 0 shared entities
- Ground truth labeling is meaningless
- Threshold tuning can't fix a data quality issue

---

## Infrastructure Summary (Completed)

| Metric | Value |
|--------|-------|
| Total stories | 1,363 |
| With embeddings | 239 (17.5%) |
| With non-empty entities | 974 (71.5%) |
| Real merged stories | 4 (all duplicate URL ingestions) |
| Stories with both embedding + entities | 236 |

---

## Merge Logic Files (Confirmed Working)

| File | Status |
|------|--------|
| `scripts/lib/merge-thresholds.js` | Config only, no disable flag |
| `scripts/lib/merge-logic.js` | `shouldMerge()` implemented correctly |
| `scripts/rss/periodic-merge.js` | Executes merges, no hardcoded disable |

---

## Next Session: Fix Entity Normalization FIRST

### Option A: Normalize at Extraction Time
Update entity extraction to use consistent ID format:
- Always use `US-TRUMP` not `"Donald Trump"`
- Standardize org/location prefixes

### Option B: Create Entity Mapping Table
Map variants to canonical IDs:
```sql
CREATE TABLE entity_aliases (
  alias TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL
);
-- "Donald Trump" -> "US-TRUMP"
-- "President Trump" -> "US-TRUMP"
```

### Option C: Backfill + Fix Forward
1. Identify all variant patterns
2. Update existing stories with normalized IDs
3. Fix extraction pipeline for new stories

---

## Files Created This Session

| File | Purpose |
|------|---------|
| `docs/handoffs/2025-11-30-ttrc-236-phase1-blocker.md` | This file |

---

## Resume Command

```
Fix entity normalization (TTRC-236 blocker) per docs/handoffs/2025-11-30-ttrc-236-phase1-blocker.md
```

---

## Key Insight

The merge logic works. The data doesn't. Fix entity normalization, then resume TTRC-236 Phase 1.

---

**Token Usage:** ~80K this session
