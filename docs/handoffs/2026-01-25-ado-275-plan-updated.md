# 2026-01-25: ADO-275 Plan Updated

**ADO-275** moved to Active. Phase 3 of tone-variation-fix-plan.md updated with ADO-300 integration.

## What Happened
- Reviewed ADO-300 validation results (Sidestepping at 53.8% overall due to pre-fix cases)
- Moved ADO-300 to Ready for Prod (core clamp/retry fixes validated at 21%)
- Reviewed ADO-275 plan and identified gaps (missing ADO-300 integration, post-gen validation)
- Updated Phase 3 with comprehensive spec including procedural frame bucket

## Key Updates to Phase 3
- **ADO-300 integration:** Procedural frame bucket for clamped cases
- **Frame priority:** clamp_reason → issue_area → ruling_impact_level
- **Post-gen validation:** SCOTUS-specific banned patterns (regex-based)
- **15 SCOTUS-specific patterns:** Approach-only descriptions
- **Effort revised:** 0.5 → 1 session

## Commits
```
774f7eb docs(ado-275): update Phase 3 SCOTUS tone variation plan
```

## Next Session
1. Implement `scotus-style-patterns.js` using Stories as scaffold
2. Follow Phase 3 implementation order in plan
3. Run 25-case validation batch

## Reference
- Plan: `docs/features/labels-tones-alignment/tone-variation-fix-plan.md` (Phase 3)
- Reference impl: `scripts/enrichment/stories-style-patterns.js`
