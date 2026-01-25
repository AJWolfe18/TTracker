# 2026-01-25: ADO-275 Plan Updated & Reviewed

**ADO-275** at Active. Phase 3 plan complete, reviewed, and implementation-ready.

## What Happened
1. Reviewed ADO-300 validation (53.8% Sidestepping overall, 21% in recent validation)
2. Moved ADO-300 to Ready for Prod
3. Updated Phase 3 plan with ADO-300 integration, post-gen validation
4. Critical review found timing issues (ruling_impact_level unavailable pre-Pass2)
5. Fixed plan: pre-Pass2 hint system, inferIssueOverride fallback, 6 pools
6. Verified implementation points in enrich-scotus.js

## Key Plan Elements
- **Frame hint system:** clamp_reason → inferIssueOverride → estimateImpactLevel
- **6 pools:** procedural, alarmed, critical, grudging_credit, voting_rights_override, agency_power_override
- **issue_area is 100% NULL** - must use fallback detector
- **Clamped cases:** procedural frame, no reroll (mismatch fuse disabled)

## Commits
```
774f7eb docs(ado-275): update Phase 3 SCOTUS tone variation plan
9c58ed7 docs(ado-275): fix critical review issues in Phase 3 plan
```

## Next Session Prompt

```
Continue ADO-275: SCOTUS tone variation implementation.

Read the handoff: docs/handoffs/2026-01-25-ado-275-plan-updated.md
Read the plan: docs/features/labels-tones-alignment/tone-variation-fix-plan.md (Phase 3)
Reference impl: scripts/enrichment/stories-style-patterns.js

Implementation order:
1. Create scripts/enrichment/scotus-style-patterns.js using Stories as scaffold
2. Update scripts/enrichment/scotus-gpt-prompt.js (REQUIRED VARIATION block)
3. Update scripts/scotus/enrich-scotus.js (swap imports, wire selection, post-gen validation)
4. Run 25-case validation batch

Key implementation notes:
- clamp_reason available after line 404 in enrich-scotus.js
- Replace lines 417-420 with new frame hint system
- inferIssueOverride() needed (issue_area is 100% NULL)
- Clamped cases: no reroll, always procedural frame

DO NOT deploy to PROD. Test only.
```

## Files to Create/Modify
| File | Action |
|------|--------|
| `scripts/enrichment/scotus-style-patterns.js` | **NEW** |
| `scripts/enrichment/scotus-gpt-prompt.js` | Update |
| `scripts/scotus/enrich-scotus.js` | Update |
| `scripts/enrichment/scotus-variation-pools.js` | Deprecate |
