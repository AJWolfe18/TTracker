# Plan: Corruption Scoring Overhaul (ADO-264)

**Status:** IN PROGRESS - Phase 1
**Created:** 2026-01-16
**ADO:** Bug 264 (linked to Epic 109)
**Branch:** test

## Problem Statement

The current corruption level scoring produces too many "Broken Clock" (level 1) results for clearly corrupt pardons. The prompt scores based on "did I find a Trump connection" rather than "why did Trump pardon this person."

**Examples of bad scoring:**
- Jan 6 defendants → Level 1 ("no personal ties") - WRONG
- Drug traffickers → Level 1 - WRONG
- Rich unknowns with "weaponized DOJ" excuse → Level 1 - WRONG

## Solution: New Scoring Logic

### New Corruption Level Labels

| Level | Old Name | New Name | Definition |
|-------|----------|----------|------------|
| 5 | Paid-to-Play | **Paid-to-Play** | Documented $$$, donations, business deals |
| 4 | Friends & Family | **Loyalty Reward** | Did something FOR Trump (Jan 6, fake electors, Rudy, refused to flip) |
| 3 | Swamp Creature | **Swamp Royalty** | Benefited from swamp, rich unknowns, "weaponized DOJ" excuses |
| 2 | Celebrity Request | **Celebrity Request** | Famous person advocated (unchanged) |
| 1 | Broken Clock | **Broken Clock** | Actually legitimate (RARE - bipartisan support, reform case) |

### New Connection Type

Add `wealthy_unknown` to the enum:
- Rich person with no documented Trump connection
- Got pardoned anyway (swamp access)
- Default to Level 3

### Key Principle Changes

1. **Jan 6 / fake electors = Level 4 minimum** (crimes FOR Trump)
2. **Rich unknown = Level 3** (not Level 1)
3. **"Weaponized DOJ" framing ≠ Level 1** (that's swamp excuse)
4. **Default should be Level 3** if no clear reason found
5. **Research must answer:** WHY did Trump pardon this person?

---

## Implementation Phases

### Phase 1: Update Prompt & Labels (This Session)

**Files to modify:**

1. **`scripts/enrichment/perplexity-research.js`**
   - Lines 44-49: Add `wealthy_unknown` to CONNECTION_TYPES array
   - Lines 167-179: Rewrite CORRUPTION LEVEL GUIDE with new labels and logic
   - Add scoring examples (Jan 6 = 4, rich unknown = 3)

2. **`scripts/enrichment/pardons-gpt-prompt.js`**
   - Lines 16-22: Update CORRUPTION_LABELS constant
   - Update neutral labels too

3. **`docs/architecture/business-logic-mapping.md`**
   - Lines 407-415: Update CORRUPTION_LABELS_SPICY
   - Lines 419-426: Update CORRUPTION_LABELS_NEUTRAL
   - Lines 440-496: Update determination rules
   - Lines 498-513: Add wealthy_unknown to CONNECTION_TYPES

4. **`public/pardons-app.js`**
   - Lines 19-30: Add wealthy_unknown to CONNECTION_TYPES display

5. **Database migration** (new file)
   - `migrations/062_add_wealthy_unknown_connection.sql`
   - Update CHECK constraint on primary_connection_type

**Acceptance criteria:**
- [ ] New labels in all 4 files match
- [ ] wealthy_unknown added to enum
- [ ] Migration created and tested
- [ ] Commit to test branch

### Phase 2: PROD Data Refresh (After Phase 1)

1. **Clear PROD pardons** (or truncate keeping manual fixes)
2. **Run DOJ scraper** on PROD: `npm run ingest:pardons`
3. **Run research pipeline** on PROD: `gh workflow run "Research Pardons (Perplexity)" --ref main -f limit=100 -f force=true`
4. **Run enrichment pipeline** on PROD: `gh workflow run "Enrich Pardons (GPT)" --ref main -f limit=100 -f force=true`
5. **Verify PROD site** displays correctly

**Estimated cost:** ~$0.80 (Perplexity + GPT for ~100 pardons)

### Phase 3: Validation

- [ ] Spot-check 10 pardons for correct scoring
- [ ] Jan 6 mass pardon = Level 4+
- [ ] Rich unknowns = Level 3
- [ ] Legitimate cases = Level 1 (should be rare)
- [ ] Update handoff document

---

## Files Reference

| File | Lines | What Changes |
|------|-------|--------------|
| `perplexity-research.js` | 44-49, 167-190 | CONNECTION_TYPES, CORRUPTION LEVEL GUIDE |
| `pardons-gpt-prompt.js` | 16-22 | CORRUPTION_LABELS constant |
| `business-logic-mapping.md` | 407-513 | Full business logic docs |
| `pardons-app.js` | 19-30 | Frontend CONNECTION_TYPES |
| `migrations/062_*.sql` | new | CHECK constraint update |

---

## Rollback Plan

If scoring is still wrong after re-run:
1. Manual fixes via SQL (like we did for 6 records in TEST)
2. Revert prompt changes
3. Re-run with old prompts

---

## Notes

- Prompt version will bump from 1.3 → 1.4
- All pardons will be re-researched with `--force` flag
- Cost is acceptable (~$0.80 total)
