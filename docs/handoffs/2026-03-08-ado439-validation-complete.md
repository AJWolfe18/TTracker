# ADO-438/439: Validation Complete, Fix Disposition Bug + Invariant

## Start here
ADO-438 (Active). Validation report: `docs/features/scotus-enrichment/ado-439-validation-report.md`. Repeatable test: `npm run qa:scotus-validate` (currently 126/145 = 86.9%).

## What to do

### Fix 1 (P0): Disposition bug in Pass 1
**File:** `scripts/enrichment/scotus-fact-extraction.js`
**Problem:** When SCOTUS affirms an appellate court that itself reversed a trial court, Pass 1 (GPT-4o-mini) outputs "reversed" instead of "affirmed." It reads the substantive outcome rather than SCOTUS's formal action on the court immediately below. Also conflates "vacated and remanded" with "reversed."
**Affected cases:** Kirtz (51), Wullschleger (64), Horn (137) = affirmed→reversed. Bowe (285), Riley (224), Bondi (131) = vacated→reversed.
**Fix options:**
1. Pass 1 prompt clarification: "Disposition is SCOTUS's action on the decision immediately below. If SCOTUS agrees with the appellate court, disposition is 'affirmed' even if the appellate court reversed the trial court. If SCOTUS vacates, disposition is 'vacated' not 'reversed'."
2. Post-processing: cross-reference disposition against syllabus text (the `[FALLBACK] Section-aware extraction` already extracts the raw text — validate against it).

### Fix 2 (P2): Bufkin invariant false positive
**File:** `scripts/scotus/enrich-scotus.js` (invariant checks, ~line 400-490)
**Problem:** "who_loses contains winning language" regex rejected "Veterans... lose a more rigorous review process" — the phrase "more rigorous" triggered a false positive because it looks like positive/winning language, but it's describing what was lost.
**Fix:** Tune the regex to allow "lose [access to/a/the/more] [positive thing]" patterns.

### Fix 3 (P1, optional): vote_split fallback
**Problem:** 6/25 cases have vote_split=null because SCOTUSblog name matching failed and there's no fallback.
**Fix:** Extract vote_split from opinion text ("delivered the opinion for a unanimous Court" → 9-0, or count dissent_authors for the split). Not a blocker but nice-to-have.

### After fixes
1. Re-run enrichment on the 7 affected cases: `SCOTUS_PASS2_TEMPERATURE=0 node scripts/scotus/enrich-scotus.js --case-ids=51,64,137,285,224,131,120 --force-gold`
2. Run `npm run qa:scotus-validate` — target 140+/145
3. If passing, ADO-438 → Testing, then proceed to ADO-440 (108 unenriched cases)
