# 2026-01-25: ADO-302 SCOTUS Enrichment Improvements

**ADO-302** moved to Testing. Frontend changes live on test site, enrichment changes ready for next batch.

## Commits
```
81c756a feat(ado-302): SCOTUS enrichment improvements
ba10901 fix(ado-302): remove redundant ruling_impact_level assignments
```

## What Changed

### 1. Label is Source of Truth
- Added `LABEL_TO_LEVEL` mapping in `enrich-scotus.js`
- `ruling_impact_level` is now DERIVED from `ruling_label` after GPT enrichment
- Removed redundant level assignments in `scotus-fact-extraction.js`
- Prevents label/level mismatches (e.g., "Institutional Sabotage" showing different colors)

### 2. Expanded who_wins/who_loses Prompts
**Before:** "Explicit beneficiary - be specific"
**After:** "1-2 sentences. Who benefits from this ruling and HOW it specifically helps them."

This should produce longer, more detailed explanations instead of short phrases.

### 3. Modal Layout Reordered
**Before:** Who Wins → Who Loses → Summary → Why It Matters
**After:** Summary → Who Wins → Who Loses → Why It Matters

Also removed emojis from section headers for cleaner look.

## Files Modified
- `scripts/scotus/enrich-scotus.js` - LABEL_TO_LEVEL derivation
- `scripts/enrichment/scotus-gpt-prompt.js` - who_wins/who_loses prompts
- `scripts/enrichment/scotus-fact-extraction.js` - removed redundant level assignments
- `public/app.js` - modal layout reorder, emoji removal

## Testing Checklist
- [ ] Modal layout shows Summary first on test site
- [ ] Section headers have no emojis
- [ ] Run enrichment on 1-2 test cases to verify:
  - [ ] who_wins/who_loses are 1-2 sentences (not short phrases)
  - [ ] ruling_impact_level matches ruling_label

## Related Work
- **ADO-275** (Tone Variation) - These changes are compatible, planned for next wave of fixes
- **Rating Determination Framework** - `docs/architecture/rating-determination-framework.md` created this session

## Notes
- Existing enriched cases won't change until re-enriched
- The Barrett v. United States example in the framework doc shows the mismatch problem this fixes
