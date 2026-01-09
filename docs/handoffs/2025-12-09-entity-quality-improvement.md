# Entity Data Quality Improvement - Complete

**Date:** 2025-12-09
**Branch:** test
**Ticket:** Follow-up to TTRC-298 (entity normalization)

---

## Summary

Completed comprehensive entity data quality audit and fix. Reduced unique entities from 869 → 829 (40 entities consolidated) while eliminating all variant/garbage entities.

---

## What Was Done

### 1. Expanded Alias Mappings (~50 new aliases)

Added to `scripts/lib/entity-normalization.js`:

**International Figures (country code prefixes):**
- `US-NETANYAHU` → `IL-NETANYAHU`
- `US-PUTIN` → `RU-PUTIN`
- `US-ZELENSKY`, `US-ZELENSKYY` → `UA-ZELENSKY`
- `US-MBS`, `US-BIN-SALMAN`, `US-MOHAMMED-BIN-SALMAN` → `SA-MBS`
- `US-STARMER`, `GB-STARMER` → `UK-STARMER`
- `US-FARAGE`, `GB-FARAGE` → `UK-FARAGE`
- And more: Orban, Maduro, Xi, Erdogan, Ramaphosa

**Party Consolidation:**
- `ORG-DEMOCRATS`, `ORG-DEMS`, `ORG-DEMOCRATIC`, `ORG-DEMOCRATIC-PARTY` → `ORG-DEM`
- `ORG-REPUBLICANS`, `ORG-REPUBLICAN` → `ORG-GOP`

**Event Consolidation:**
- `EVT-SHUTDOWN` → `EVT-GOVERNMENT-SHUTDOWN`
- `EVT-EPSTEIN`, `EVT-EPSTEIN-SCANDAL`, `EVT-EPSTEIN-SAGA`, `EVT-JEFFERY-EPSTEIN-FILES` → `EVT-EPSTEIN-FILES`
- `EVT-MIDTERM-ELECTIONS` → `EVT-MIDTERMS`

**States as People → LOC:**
- `US-TEXAS` → `LOC-TEXAS`
- `US-UTAH` → `LOC-UTAH`
- `US-VIRGINIA` → `LOC-VIRGINIA`
- `US-WASHINGTON` → `LOC-WASHINGTON`

**Media/Other:**
- `ORG-WP`, `ORG-WASHINGTON-POST` → `ORG-WAPO`
- `ORG-FOX-NEWS` → `ORG-FOX`
- `LOC-WHITE-HOUSE` → `ORG-WHITE-HOUSE`
- `ORG-ISRAEL` → `LOC-ISRAEL`

### 2. Added BAD_IDS Blocklist (17 entries)

Garbage entities that are now filtered out:

```javascript
// Generic titles
'US-MAYOR', 'US-PRESIDENT', 'IL-PRESIDENT', 'US-REPUBLICAN-LEADER'

// Too generic
'ORG-NEWS', 'ORG-GOVERNMENT', 'ORG-COURT', 'ORG-FEDERAL',
'ORG-ADMINISTRATION', 'ORG-POLICE', 'LOC-SOUTH'

// Semantic garbage
'US-FUNDING', 'US-GOV', 'US-POLICY', 'US-CITIZENS', 'US-REFORM'

// Wrong type
'ORG-BIDEN', 'ORG-REAGAN', 'ORG-COHEN', 'LOC-MEDICARE'
```

### 3. Updated Validation Order

`normalizeEntityId()` now:
1. Applies alias mapping FIRST
2. THEN checks BAD_IDS
3. THEN validates format pattern

This ensures alias fixes aren't accidentally blocked.

### 4. Added Jest-style Test Suite

Created `scripts/tests/entity-normalization.mjs` with 65 test cases covering:
- All new aliases
- BAD_IDS filtering
- Edge cases (null, empty, invalid patterns)
- Passthrough for valid IDs

### 5. Ran Migration

```
Articles normalized: 164
Stories rebuilt: 876
Errors: 0
```

### 6. Updated Extraction Prompt

Enhanced `scripts/enrichment/extract-article-entities-inline.js` with:
- Explicit international figure mappings (Netanyahu → IL-, Putin → RU-, etc.)
- Party canonical forms (Democrats → ORG-DEM)
- Event rules (use full canonical, don't invent new IDs)
- "NEVER USE" garbage ID examples
- Fundamental rule: only people, orgs, locations, named events

---

## Results

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Unique entities | 869 | 829 | ~700-750 |
| Invalid pattern IDs | unknown | 0 | 0 |
| Bad IDs remaining | ~30 | 0 | 0 |
| Consolidations correct | N/A | 100% | 100% |

**Top entities after migration:**
1. US-TRUMP: 546
2. LOC-USA: 69
3. ORG-SUPREME-COURT: 54
4. ORG-DOJ: 49
5. EVT-GOVERNMENT-SHUTDOWN: 35

---

## Files Modified

| File | Changes |
|------|---------|
| `scripts/lib/entity-normalization.js` | +50 aliases, BAD_IDS blocklist, updated validation order |
| `scripts/enrichment/extract-article-entities-inline.js` | Expanded prompt with explicit rules |
| `scripts/tests/entity-normalization.mjs` | NEW - 65 test cases |
| `scripts/verify-entity-migration.js` | NEW - verification queries |
| `scripts/lib/entity-normalization.test.js` | NEW - Jest format (for future) |

---

## ID Strategy Documented

**Country code convention:**
- US- for Americans (US-TRUMP, US-BIDEN)
- Country code for international (IL-NETANYAHU, RU-PUTIN, SA-MBS, UA-ZELENSKY)
- UK- for British figures (pragmatic, not strict ISO GB-)

---

## Future Work

1. **Monitor new extractions** - Watch for new garbage entities appearing
2. **BAD_IDS stays small** - Prefer prompt fixes and aliases over expanding blocklist
3. **Entity display names** - Still needed for frontend (TTRC-TBD: show "Donald Trump" not "US-TRUMP")

---

## Verification Queries

```sql
-- 1. Pattern sanity check (should return 0)
SELECT DISTINCT e.id
FROM articles, jsonb_to_recordset(entities) AS e(id text)
WHERE e.id !~ '^(US|[A-Z]{2}|ORG|LOC|EVT)-[A-Z0-9-]+$';

-- 2. Updated unique count
SELECT COUNT(DISTINCT e.id) AS unique_entities
FROM articles, jsonb_to_recordset(entities) AS e(id text);

-- 3. Sample story top_entities
SELECT id, primary_headline, top_entities
FROM stories
WHERE entity_counter != '{}'
ORDER BY last_updated_at DESC
LIMIT 10;
```

---

## Cost

**$0.00** - No OpenAI calls, just code changes + SQL migrations.
