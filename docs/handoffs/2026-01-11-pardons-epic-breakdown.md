# Handoff: Pardons Tracker Epic Breakdown

**Date:** 2026-01-11
**Session Type:** Planning + ADO Setup
**ADO Epic:** 109

---

## Summary

Broke down Epic 109 (Trump Pardons Tracker) into Features and User Stories with full technical specifications and acceptance criteria.

## Work Completed

### Planning
- Reviewed PRD at `docs/plans/pardons-tracker-prd.md`
- Explored codebase patterns (Stories, EOs, Edge Functions)
- Resolved all technical decisions through iterative review
- Created detailed plan at `C:\Users\Josh\.claude\plans\pardons-epic-breakdown.md`

### ADO Items Created

| ID | Type | Title |
|----|------|-------|
| **239** | Feature | Pardons Tracker MVP |
| **240** | Feature | Pardons AI Enrichment |
| 241 | Story | 1.1: Database Schema & Migrations |
| 242 | Story | 1.2: Backend Edge Functions (APIs) |
| 243 | Story | 1.3A: Frontend List + Cards + Basic Modal |
| 244 | Story | 1.3B: Receipts Timeline + What Happened Next |
| 245 | Story | 1.4: Filtering & Search |
| 246 | Story | 2.1: AI Enrichment Prompt & Job Type |
| 247 | Story | 2.2: Why It Matters & Pattern Analysis Display |
| 248 | Story | 2.3: Related Stories Linking |
| 249 | Story | 3.1: Social Sharing + OG Meta Endpoint |

### Key Technical Decisions

1. **Endpoints:** `pardons-active` (list+search) + `pardons-detail` + `pardons-stats`
2. **Junction table:** `pardon_story` with `ON DELETE CASCADE` for both FKs
3. **URL pattern:** `pardons.html?id=42` for users, `/pardon/{id}-{slug}` for bots/OG
4. **Mass pardon support:** `recipient_type` (person|group) + `recipient_count` + `recipient_criteria`
5. **RLS:** Read-only for anon, no write policies
6. **Enrichment safeguards:** Idempotency, 12h cooldown, budget cap, JSON validation, force mode

## Next Steps

**Implementation order:**
1. Story 241 (Database) - Foundation
2. Story 242 (APIs) - Backend ready
3. Story 243 (Basic UI) - Ship visible feature fast
4. Story 245 (Filtering) - Core UX complete
5. Story 244 (Timeline) - Enhanced modal
6. Stories 246-248 (Enrichment) - AI layer
7. Story 249 (Sharing) - Can parallel with enrichment

**To start Story 241:**
```
Read C:\Users\Josh\.claude\plans\pardons-epic-breakdown.md and implement Story 241 (ADO-241): Database Schema & Migrations
```

## Files Created/Modified

- `C:\Users\Josh\.claude\plans\pardons-epic-breakdown.md` (plan file)
- `docs/handoffs/2026-01-11-pardons-epic-breakdown.md` (this file)

## Open Items

None - all technical decisions resolved.

---

**Session ended:** 2026-01-11
