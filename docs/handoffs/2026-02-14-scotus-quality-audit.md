# SCOTUS Enrichment Quality Audit — Feb 14-15

**State:** Ready for Prod | **Branch:** test | **Commit:** 0cdfb0e | **ADO:** 354 + 82

## What shipped

Three pipeline fixes that dramatically improved SCOTUS enrichment quality:

1. **Full opinion text for Pass 2** (80K cap, 30K/25K windowing) — dissent content lives at char 12K+ in opinions, was invisible at old 5K syllabus cap. Now detected on 17/21 cases (was mostly null).
2. **Syllabus-only for Pass 1** — full opinion text (100K+) overwhelmed GPT-4o-mini on classification. Bowe got `case_type: unclear` with full text, `merits` with syllabus.
3. **Dissent-from-text** — prompt no longer asserts "No dissent (unanimous)" when `dissent_authors=[]`. GPT determines from source text instead.

Also: concrete fact validators softened to warnings (not blockers), `getCasesToEnrichByIds` now JOINs `scotus_opinions` for full text, test script deleted.

## Results

21/22 public cases enriched. Campos-Chaves (#27) failed Pass 1 (missing_evidence, 3 retries). Thompson (#126) correctly reclassified as procedural → hidden. Barrett (#286) finally enriched (was empty card).

## Known issues (not blocking prod)
- **Campos-Chaves (#27)**: Pass 1 can't extract evidence after 3 retries
- **Vidal (#23)**: Pass 0 gate (source too short, 4647 < 5000)
- **Opener variety**: GPT-4o-mini keeps using same abstract openers — known cross-project issue
- **Label skew**: 12/21 cases get "Rubber-stamping Tyranny" (Level 4) — severity system working as designed but heavily weighted

## Next
- PR to main (ADO-354 + ADO-82 together)
- Investigate Campos-Chaves Pass 1 failure separately
