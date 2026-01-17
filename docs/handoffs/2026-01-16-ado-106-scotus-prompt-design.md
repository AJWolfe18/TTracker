# Handoff: SCOTUS Rulings & Opinions - Prompt Design Complete

**Date:** 2026-01-16
**ADO:** 106 (Epic: Rulings & Opinions Phase 1 MVP)
**Branch:** test
**Commit:** 9d7fd96

---

## What Was Done

### 1. Designed Ruling Impact Scale (0-5)
Collaborated on severity labels matching TrumpyTracker voice:

| Level | Color | Label | Profanity |
|-------|-------|-------|-----------|
| 5 | 🔴 | Constitutional Crisis | Yes |
| 4 | 🟠 | Rubber-stamping Tyranny | Yes |
| 3 | 🟡 | Institutional Sabotage | No |
| 2 | 🔵 | Judicial Sidestepping | No |
| 1 | ⚪ | Crumbs from the Bench | No |
| 0 | 🟢 | Democracy Wins | No |

### 2. Created Prompt Files
- `scripts/enrichment/scotus-gpt-prompt.js` - System prompt with:
  - Ruling impact levels + tone calibration
  - Gemini's rules: Follow the Money, Human Cost, No Legalese, No Both-Sides
  - Evidence anchoring requirements
  - Output validation
- `scripts/enrichment/scotus-variation-pools.js` - Anti-repetition pools (8-10 options per level)

### 3. Organized Feature Folder
```
docs/features/scotus-tracker/
├── prd.md           ← New comprehensive PRD
└── field-mapping.md ← Moved from docs/plans/
```

### 4. Updated ADO-106
- Added file paths, ruling scale, tone rules, blockers

### 5. Cleanup
- Removed root-level ADMIN_IMPROVEMENTS.md and CRITICAL_FINDING.md
- Deleted old docs/plans/scotus-tracking-v1.md (replaced by new PRD)

---

## Files Changed

**New:**
- `docs/features/scotus-tracker/prd.md`
- `scripts/enrichment/scotus-gpt-prompt.js`
- `scripts/enrichment/scotus-variation-pools.js`

**Moved:**
- `docs/plans/courtlistener-field-mapping.md` → `docs/features/scotus-tracker/field-mapping.md`

**Deleted:**
- `ADMIN_IMPROVEMENTS.md` (root)
- `CRITICAL_FINDING.md` (root)
- `docs/plans/scotus-tracking-v1.md`

---

## Blockers for Next Session

1. **CourtListener API token** - Register at https://www.courtlistener.com/register/
2. **Live field verification** - Run verification script with token
3. **Migration 050** - Create schema based on verified fields

---

## Next Steps

1. Get CourtListener token (user action)
2. Verify field mapping with live API
3. Create migration 050 (scotus_cases table)
4. Build fetch worker (scotus.fetch job type)
5. Build enrichment worker (scotus.enrich job type)

---

## Key Decisions Made

- **Ruling impact based on WHO WINS/LOSES**, not vote split
- **Reuse existing job_queue** for fetch/enrich jobs
- **Pro-people, anti-fascist editorial voice** - no both-sides
- **Evidence anchoring required** - cite [syllabus], [majority], [dissent]
- **Profanity only at levels 4-5**

---

## Token Usage This Session
~30K input, ~15K output (heavy design iteration)
