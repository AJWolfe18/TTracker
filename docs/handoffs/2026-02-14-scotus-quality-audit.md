# SCOTUS Enrichment Quality Audit — Feb 14

**State:** In Progress | **Branch:** test | **ADO:** 354 (Concrete Facts) + 82 (SCOTUS CSS)

## What happened this session

Deep quality audit of SCOTUS enrichment output. Found systemic issues, ran A/B/C tests, made code changes. NOT YET TESTED.

## Root causes identified

1. **Fixed 6 labels are broken** — "Rubber-stamping Tyranny" assigned to Riley (where Court HELPED immigrant). A/B test proved free-form labels are better.
2. **Pass 2 only sees syllabus (5K chars)** — dissent content is at char 12K+ in full opinion. GPT never sees it, so dissent_highlights is always hallucinated or null.
3. **Dissent metadata from DB overrides truth** — prompt said "No dissent (unanimous)" when dissent_authors=[] even if opinion text says "GORSUCH, J., filed a dissenting opinion."
4. **Bowe had corrupted DB data** — dissent_authors/vote_split were written by unknown source (NOT CourtListener, NOT enrichment script). Fixed: reset to []/null.
5. **GPT-4o does NOT fix the label problem** — Test A showed 4o got Riley WORSE (said DHS wins). It's the prompt/label design, not the model.

## Code changes made (UNCOMMITTED on test branch)

### `scripts/enrichment/scotus-gpt-prompt.js`:
1. **Free-form labels** — Pass 2 output format changed from "Label from scale above" to "Write a 2-4 word label SPECIFIC to this case"
2. **Full opinion text** — Pass 2 source text now uses `opinion_full_text || syllabus || opinion_excerpt` with 80K cap (30K first + 25K last windowing)
3. **Dissent from text** — When dissent_authors is empty, prompt says "DETERMINE FROM SOURCE TEXT" instead of "No dissent (unanimous)"
4. **Validator updated** — ruling_label check changed from fixed-6-enum to 2-50 char string check

### What was NOT changed:
- Pass 1 (fact extraction) — untouched, works fine
- `LABEL_TO_LEVEL` mapping in enrich-scotus.js — still exists but becomes no-op for free-form labels (lookup returns undefined, preserves GPT's level)
- `enforceEditorialConstraints` — label_policy allow/forbid lists won't match free-form labels, becomes no-op for label enforcement
- Frontend — `ruling_label` is displayed as-is, no enum dependency

## What to do next

### 1. Run the enrichment (immediate)
```bash
node scripts/scotus/enrich-scotus.js --case-ids=4,191,224,285
```
Cases 4 (Connelly), 191 (Zuch), 224 (Riley), 285 (Bowe) have enriched_at=null, ready to go.
Case 23 (Vidal) keeps failing Pass 0 (source too short, 4647 < 5000) — separate issue.

### 2. Check results
- **Riley (224)**: Does the label make sense? (Should NOT say tyranny/sabotage — Court helped Riley)
- **Bowe (285)**: Does dissent_highlights mention Gorsuch? (He dissented with Thomas, Alito, Barrett)
- **Connelly (4)**: Does why_it_matters have concrete facts? (Failed last time)
- **Zuch (191)**: Is who_wins/who_loses correct direction? (Was swapped before, fixed once already)

### 3. If results look good
- Delete test script: `scripts/scotus/test-pass2-variants.js`
- Commit changes
- Re-enrich ALL 22 public cases
- Update ADO-354

### 4. Barrett (286) — separate fix needed
- `is_public=true` but ALL enrichment fields null (empty card)
- Either enrich it or set `is_public=false`

### 5. Vidal (23) — Pass 0 gate issue
- Source text only 4647 chars, fails soft minimum (5000)
- But opinion_full_text may be available — the Pass 0 check uses `opinion_full_text || syllabus || opinion_excerpt` so if full text exists it should pass
- Check: does Vidal have opinion_full_text in scotus_opinions table?

## A/B/C Test Results (for reference)

| Case | Test A (4o) | Test B (mini, free labels) | Test C (mini, dissent from text) |
|------|-------------|---------------------------|----------------------------------|
| Riley | Level 3, DHS wins (WRONG) | Level 3, "Final Order Clarified" | Level 3, Riley wins |
| Bowe | Level 0, "Democracy Wins" | Level 1, "Federal Prisoners' Relief" | Level 1, no dissent |
| Zuch | Level 3, correct direction | Level 4, "Tax Court Authority Limited" | Level 4, correct |
| Connelly | Level 3, concrete facts good | Level 3, "Estate Tax Liability Clarified" | Level 3, similar |

**Test B (free-form labels) was the clear winner.** None detected Bowe's dissent — because source text was capped at 5K and dissent info wasn't in it.

## Files modified
- `scripts/enrichment/scotus-gpt-prompt.js` — 4 edits (labels, source text, dissent, validator)
- `scripts/scotus/test-pass2-variants.js` — NEW test script (delete after verification)
- `scripts/scotus/debug-bowe-opinions.js` — DELETED (was temporary)
