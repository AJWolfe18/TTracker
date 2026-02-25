# SCOTUS Quality Assessment — Session Handoff (Feb 24)

**ADO:** 390 (open), 323 (Testing), 307/308/309 (Ready for Prod) — no state changes this session.

## Assessment

Full audit of TEST DB (141 cases) and ADO backlog (36 non-closed SCOTUS cards). PROD has 51 public cases, TEST has 20 — same quality issues on both. Key findings:

**Quality problems (affects all live cards):**
- Severity calibration broken — nearly all cards get "Rubber-stamping Tyranny" (level 4), including narrow tax technicalities
- Tone uniformly aggressive with no range — every summary reads identically
- `issue_area` is null on every card (Pass 1 not setting it)
- Evidence anchors are generic section labels (`"syllabus"`, `"majority §III"`), not real quotes
- Some factual mismatches — ruling labels contradict the actual outcome
- Dissent highlights has string `"null"` instead of actual null on some cards

**Inventory (TEST):** 20 public | 21 enriched-not-public (7 merits, 4 procedural, 7 unclear, 1 cert, 2 other) | 99 flagged/never-enriched | 1 untouched (Campos-Chaves #27)

## Recommendation (agreed direction)

Fix prompt quality (ADO-323) BEFORE expanding quantity (ADO-390). Pushing 40 more cards through a broken prompt makes the problem bigger. Order: **prompt rework → re-enrich existing → then expand quantity**.

## Next Session

1. Review ADO-323 prompt changes (currently in Testing state)
2. Assess what prompt fixes are needed for severity calibration, tone range, issue_area, and evidence anchors
3. Re-enrich a small batch to validate quality before bulk run
4. Then execute ADO-390 phases with the improved prompt
