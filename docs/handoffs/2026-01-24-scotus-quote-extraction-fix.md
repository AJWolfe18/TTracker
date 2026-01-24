# Handoff: SCOTUS Quote Extraction Bug Fixes

**Date:** 2026-01-24
**Branch:** test
**Status:** Fixed - 3 previously failing cases now enriched and published

---

## Completed This Session

### Bug 1: GPT Quotes Missing Anchor Tokens (Cases 27, 59)

**Problem:** GPT returned `high` confidence but its extracted quotes lacked anchor tokens (affirmed/reversed/held/etc.). Validation downgraded to `low` even though source text HAD anchor terms.

**Fix:** Added `extractAnchorQuoteFromSource()` fallback function that:
1. Scans source text with regex patterns for common disposition phrases
2. Extracts the first matching quote (e.g., "The judgment is affirmed.")
3. Auto-adds to `evidence_quotes` if GPT's quotes failed anchor check

**Patterns Added:**
- `"judgment...is affirmed/reversed/vacated"`
- `"We hold that..."`
- `"Held: ..."`
- `"[citation], reversed and remanded."` (SCOTUS syllabus format)

### Bug 2: Consensus Mismatch on Compound Dispositions (Case 50)

**Problem:** Two GPT passes returned "reversed and remanded" vs "reversed" - strict string comparison failed consensus check.

**Fix:** Added `normalizeDisposition()` function that:
1. Normalizes compound dispositions: "reversed and remanded" → "reversed"
2. Maps "affirmed in part, reversed in part" → "other"
3. Returns DB-safe values (constraint: affirmed/reversed/vacated/remanded/dismissed/granted/denied/other)
4. Used in both `consensusMerge()` (comparison) and `writeEnrichment()` (DB write)

---

## Results

| Case | Before | After |
|------|--------|-------|
| Campos-Chaves v. Garland | flagged (no anchor quote) | enriched, high, public ✅ |
| McElrath v. Georgia | flagged (no anchor quote) | enriched, high, public ✅ |
| Murray v. UBS Securities | flagged (consensus mismatch) | enriched, high, public ✅ |

**Overall SCOTUS Status (20 cases):**
- Enriched + Public: 8 (high confidence merits cases)
- Enriched + Private: 3 (medium confidence, needs review)
- Flagged: 9 (cert stage, no source text, expected failures)

---

## Code Changes

**File:** `scripts/enrichment/scotus-fact-extraction.js`

| Function | Change |
|----------|--------|
| `extractAnchorQuoteFromSource()` | NEW - fallback anchor quote extraction |
| `normalizeDisposition()` | NEW - compound disposition normalization |
| `validatePass1()` | Now accepts sourceText, tries fallback if GPT quotes fail |
| `consensusMerge()` | Normalizes dispositions before comparing |
| `extractFactsWithConsensus()` | Passes sourceText to validatePass1 |
| `writeEnrichment()` | Normalizes disposition before DB write |

**Commit:** `8ce4530` - fix(scotus): quote extraction and disposition normalization bugs

---

## Next Session Tasks

### Priority 1: Fetch 2025 SCOTUS Cases
We only have 2024 cases. Need current term:
```bash
node scripts/scotus/fetch-cases.js --since=2025-01-01 --limit=20
```

### Priority 2: Review Flagged Cases
9 cases still flagged. Breakdown:
- **Cert stage (4):** Drift detection caught "who wins" claims on cases where no merits decided
- **No source text (3):** 2020 term cases lacking opinion text on CourtListener
- **Other (2):** May be rescuable with manual review

Consider implementing cert-stage skip: After Pass 1, if `case_type: cert_stage`, skip Pass 2.

### Priority 3: Publish Connelly (Case 4)
Has high confidence but `is_public = false` (pre-dates auto-publish):
```sql
UPDATE scotus_cases SET is_public = true WHERE id = 4;
```

---

## Quick Commands

```bash
# Fetch more SCOTUS cases
node scripts/scotus/fetch-cases.js --since=2025-01-01 --limit=20

# Enrich pending/failed cases
node scripts/scotus/enrich-scotus.js --limit=10

# Check case status via MCP
GET /scotus_cases?select=id,case_name,enrichment_status,is_public&order=decided_at.desc
```

---

## Files Changed

| File | Lines Changed |
|------|---------------|
| `scripts/enrichment/scotus-fact-extraction.js` | +115 / -9 |
