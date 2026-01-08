# Entity ID Normalization Issue

**Date:** 2025-12-08
**Status:** New issue discovered during TTRC-298 verification
**Priority:** High - affects entity data quality

---

## JIRA Ticket to Create

**Summary:** Entity ID normalization gaps causing split counts

---

## Problem

Entity extraction is producing inconsistent IDs for the same real-world entity, causing entity counts to be split across variants.

### Example Found

Story 924 "Aircraft Carrier Moves Into the Caribbean as U.S. Confronts Venezuela":

| Article | Entity Extracted |
|---------|------------------|
| Article 1 | `ORG-US` (United States) |
| Article 2 | `ORG-USA` (United States) |

**Result in story entity_counter:**
```json
{
  "ORG-US": 1,
  "ORG-USA": 1,
  "LOC-CARIBBEAN": 2,
  "LOC-VENEZUELA": 2
}
```

United States should have count 2, but it's split across two variant IDs.

---

## Root Cause Analysis

### 1. Alias map only covers names, not ID variants

`scripts/lib/entity-normalization.js` has:
```javascript
'United States': 'LOC-USA',
'U.S.': 'LOC-USA',
'US': 'LOC-USA',
```

But GPT returns `ORG-US` and `ORG-USA` as **IDs** - these aren't in the alias map.

The normalization function checks `entity.id` against ENTITY_ALIASES, but:
- `ORG-US` → not found → passed through unchanged
- `ORG-USA` → not found → passed through unchanged

### 2. Type ambiguity in extraction

"United States" can reasonably be:
- `LOC-USA` (the physical location/country)
- `ORG-USA` or `ORG-US` (the government as an actor)

The prompt says `LOC-<NAME>` for locations, but GPT treats "United States" as an organization when it's acting as a political entity.

### 3. Non-entities being extracted

Story 290 has entity `US-FUNDING` - "funding bill" is a topic, not an entity. This suggests the extraction prompt is too loose.

---

## Files Involved

| File | Role |
|------|------|
| `scripts/lib/entity-normalization.js` | ENTITY_ALIASES map - needs ID variants |
| `scripts/enrichment/extract-article-entities-inline.js` | Extraction prompt - may need improvement |

---

## Recommended Fix

### Phase 1: Immediate (this ticket)

1. **Expand ENTITY_ALIASES** with known ID variants:
```javascript
// ID variants that GPT generates incorrectly
'ORG-US': 'LOC-USA',
'ORG-USA': 'LOC-USA',
'US-SENATE': 'ORG-SENATE',
'US-CONGRESS': 'ORG-CONGRESS',
'US-FUNDING': null,  // or remove - not a valid entity
// Add more as discovered
```

2. **Write migration script** to normalize existing `article.entities` in DB

3. **Re-run story aggregation** (`node scripts/aggregate-story-entities.js`)

### Phase 2: Follow-up ticket

- Improve extraction prompt with explicit canonical ID examples
- Consider entity registry for long-term (fuzzy match to canonical)

---

## Impact

- Entity frequency signals weakened (counts split across variants)
- Top entity rankings affected
- Future entity-based filtering/search compromised
- ~88% of stories have entities, but quality is uncertain

---

## Acceptance Criteria

- [ ] ENTITY_ALIASES expanded with known ID variants
- [ ] Migration script normalizes existing article.entities
- [ ] Story entity_counter/top_entities re-aggregated
- [ ] Verification: `ORG-US` and `ORG-USA` no longer both appear in same story
- [ ] Sample check of 10 stories shows consistent entity IDs

---

## Verification Queries

```sql
-- Find stories with split entity IDs
SELECT id, primary_headline, entity_counter
FROM stories
WHERE entity_counter::text LIKE '%ORG-US%'
  AND entity_counter::text LIKE '%ORG-USA%';

-- Check for common variant patterns
SELECT DISTINCT jsonb_object_keys(entity_counter) as entity_id
FROM stories
WHERE entity_counter IS NOT NULL
ORDER BY entity_id;
```

---

## Related

- TTRC-298: Article-level entity extraction (parent feature)
- `scripts/aggregate-story-entities.js`: Story aggregation script (created this session)
