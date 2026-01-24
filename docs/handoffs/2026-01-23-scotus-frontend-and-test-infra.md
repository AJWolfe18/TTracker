# Handoff: SCOTUS Frontend Complete + Test Infrastructure Tracking

**Date:** 2026-01-23
**Branch:** test
**Status:** SCOTUS frontend done, need to create ADO for test infra fixes

---

## Completed This Session

### SCOTUS Frontend (ADO-83, ADO-82) - DONE
- Created `ScotusCard`, `ScotusDetailModal`, `ScotusFeed` components
- Added impact badge CSS (levels 0-5, green to red)
- Fixed impact filter type mismatch bug (code review catch)
- Fixed text normalization (`affirmed` → `Affirmed`)
- Added code review step to CLAUDE.md workflow

**Commits:**
- `6d2db99` - feat(ado-83,ado-82): add SCOTUS frontend page
- `7bb0133` - fix(scotus): fix impact filter type mismatch bug
- `bc541be` - fix(scotus): normalize lowercase DB values for display
- `ddddbf7` - docs: add code review step to workflow

**ADO Status:** #83 and #82 → Testing

---

## Key Findings

### SCOTUS Enrichment Pipeline Status
- **ADO-280** (Two-pass architecture) = **CLOSED** (done 2026-01-22)
- **ADO-85** (Enrichment script) = **Active but functionally complete**
  - Script works, two-pass architecture functional
  - Blocker is source data, not code (some cases have no opinion text)

**SCOTUS Cases in DB:**
| Status | Count | Notes |
|--------|-------|-------|
| Enriched | 5 | Working, 2 public |
| Pending | 3 | No source text available |
| Flagged | 2 | Low confidence / too short |

### ADO-85 vs ADO-275
- **#85** = Core enrichment script (pipeline) - functionally done
- **#275** = Tone variation refactor (frame buckets) - separate work

---

## Untracked Work: Test Infrastructure Fixes

**NEED TO CREATE ADO ITEM** for these blockers (system reminder feedback):

### Title: "Spicy prompts test infrastructure fixes"

**Description:**
Blockers preventing reliable testing of tone variation system (ADO-273, 274):

1. **Job queue gate too broad** - narrow to `story_enrich/story_cluster` jobs only, check `run_at <= now()`
2. **Test cohort nondeterministic** - cooldown produces 0 enrichments; add `--force` flag or select cooldown-eligible stories
3. **EO order_number quoting** - VARCHAR needs quoted strings in PostgREST queries
4. **MCP RLS verification** - add sanity check before verification step

**Related items:**
- Blocks: #273 (EO tone), #274 (Stories tone) testing validation
- Related: #282 (prompt_version tracking bug - PROD blocker)

---

## Execution Order (Before PROD)

1. **Create ADO item** for test infra fixes (above)
2. **Fix test infrastructure** - enables reliable testing of #273/#274
3. **Fix #282** - prompt_version tracking (PROD blocker)
4. **Validate #273, #274** - with fixed test infra
5. **Update #85** to Ready for Prod - enrichment script works
6. **SCOTUS: Fetch new cases** - `node scripts/scotus/fetch-cases.js --since=2024-06-01 --limit=5`

---

## Files Reference

**SCOTUS Frontend:**
- `public/app.js` - ScotusCard, ScotusDetailModal, ScotusFeed components
- `public/themes.css` - Impact badge CSS (lines 717-930)

**SCOTUS Enrichment:**
- `scripts/scotus/enrich-scotus.js` - Main enrichment (two-pass)
- `scripts/scotus/fetch-cases.js` - CourtListener fetcher
- `scripts/scotus/backfill-opinions.js` - Get opinion text
- `scripts/enrichment/scotus-*.js` - Prompts, variation pools, fact extraction

**Test Infrastructure (to fix):**
- `scripts/enrichment/test-spicy-prompts.js` - Needs cohort fix

---

## Quick Commands

```bash
# Fetch new SCOTUS cases
node scripts/scotus/fetch-cases.js --since=2024-06-01 --limit=5

# Backfill opinion text
node scripts/scotus/backfill-opinions.js --limit=10

# Enrich (dry run)
node scripts/scotus/enrich-scotus.js --dry-run --limit=5

# Enrich (real)
node scripts/scotus/enrich-scotus.js --limit=5
```

---

## Next Session Start

1. Create ADO item for test infra fixes (was interrupted)
2. Execute fixes in order above
3. OR continue with SCOTUS case fetching if prioritized differently
