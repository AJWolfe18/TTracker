# Entity ID Normalization - Complete

**Date:** 2025-12-09
**Branch:** test
**Commit:** ed78f9f

---

## What Was Done

### Entity Normalization Fix (COMPLETE)

Fixed entity ID splits causing incorrect counts (e.g., story 924 had `ORG-US: 1` and `ORG-USA: 1` instead of `LOC-USA: 2`).

**Changes:**
1. Added ID variant aliases (`ORG-US`, `ORG-USA`, `LOC-US` → `LOC-USA`, etc.)
2. Added period variant aliases (`LOC-D.C.` → `LOC-DC`, `ORG-U.N.` → `ORG-UN`)
3. Added `isValidEntityId()` for format-only validation
4. Updated `normalizeEntityId()` to return null for invalid IDs
5. Fixed `normalizeTopEntities()` and `normalizeEntities()` to filter nulls
6. Improved extraction prompt with explicit canonical ID rules
7. Created `scripts/normalize-article-entities.js` migration script
8. Added `--reset` flag to aggregation script

**Migration Results:**
- 57/1837 articles normalized
- 875 stories rebuilt
- No `ORG-US`, `ORG-USA`, `LOC-US`, `US-SENATE`, `US-CONGRESS` remain

**Files Modified:**
- `scripts/lib/entity-normalization.js`
- `scripts/enrichment/extract-article-entities-inline.js`
- `scripts/aggregate-story-entities.js`
- `scripts/normalize-article-entities.js` (NEW)

---

## Entity Audit - Remaining Issues

### Bad Entities Still in Database (14 total)

| Entity | Count | Issue |
|--------|-------|-------|
| `US-FUNDING` | 11 | Semantic garbage - not a person |
| `IL-PRESIDENT` | 4 | Generic, should be specific person |
| `US-GOV` | 1 | Not a person |
| `US-POLICY` | 1 | Not a person |
| `US-CITIZENS` | 1 | Not a person |
| `US-PRESIDENT` | 1 | Generic |
| `US-JUSTICE` | 1 | Should be `ORG-DOJ` |
| `US-FCC` | 1 | Should be `ORG-FCC` |
| `US-REPUBLICAN-LEADER` | 1 | Generic |
| `US-SUPREME` | 1 | Should be `ORG-SUPREME-COURT` |
| `US-ARMY` | 1 | Should be `ORG-ARMY` |
| `US-DEMOCRATIC-CAUCUS` | 1 | Should be `ORG-*` |
| `US-HAMAS` | 1 | Should be `ORG-HAMAS` |
| `US-REFORM` | 1 | Not an entity |

**Decision:** Format-only validation + prompt improvements. These will be cleaned up over time as new articles replace old ones with better extraction.

---

## NEW TICKET NEEDED: Primary Actor Display + Positive Severity

### Problem 1: Primary Actor Shows Raw IDs

Users see raw entity IDs instead of human-readable names:
- `US-SUPREME-COURT` → should show "Supreme Court"
- `ORG-DOJ` → should show "Department of Justice"
- `US-TRUMP` → should show "Donald Trump"

### Problem 2: No Positive Severity Level

Currently only negative severities exist:
- critical (red)
- severe (orange)
- moderate (yellow)
- minor (green - but still negative framing)

Need a true "positive" severity for good news (green badge, positive framing).

### Suggested Solution

1. **Entity display name mapping** - Create reverse lookup from ID → human name
   - Could reuse `ENTITY_ALIASES` from entity-normalization.js
   - Or create separate `ENTITY_DISPLAY_NAMES` map

2. **Add positive severity**
   - Add `positive` to severity enum
   - Add green badge with positive label (e.g., "Good News" or "Win")
   - Update enrichment prompt

### Files to Modify

- `public/story-card.js` - Display name helper, green severity badge
- `scripts/lib/entity-normalization.js` - Add `getEntityDisplayName()` function
- Enrichment prompts - Add positive severity option

---

## AI Code Review

Status: Was running when session ended. Check:
```bash
gh run list --workflow="ai-code-review.yml" --limit 1
```

---

## Next Steps

1. Create JIRA ticket for primary actor display + positive severity
2. Check AI code review results
3. Decide on approach for remaining bad entities (aliases vs blocklist vs leave for prompt improvements)
