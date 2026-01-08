# Repository Cleanup & Audit Plan (Revised)

**Date:** 2026-01-08
**Context:** Post-PROD go-live cleanup - organizing, archiving, and removing legacy items
**Branch:** test
**Approach:** Disable → Verify → Delete (safe ordering)

---

## Executive Summary

### Key Principles (from advisor feedback)
1. **Disable first, delete second** - Separate commits for easy rollback
2. **Reference sweep before deletes** - Verify nothing depends on files
3. **git mv for moves** - Preserve history
4. **Update .gitignore** - Prevent re-accumulation
5. **Canonical docs map** - Prevent duplicate recreation

### Scope
| Category | Action | Count |
|----------|--------|-------|
| Root file organization | Move to proper folders | ~20 files |
| Empty directories | Delete | 4 dirs |
| Duplicate workflows | Delete | 3 files |
| Legacy workflows | Disable then delete | 2 files |
| Documentation | Deduplicate + archive | ~55 files |
| Scripts | Archive legacy | ~25 files |
| Test artifacts | Archive or delete | ~30 files |

---

## Workflow Status Clarification (Fixing Inconsistency)

### CURRENTLY ACTIVE (as of 2026-01-08)
| Workflow | Schedule | Status | Notes |
|----------|----------|--------|-------|
| `rss-tracker-prod.yml` | Every 2h | ✅ PRIMARY | RSS feed ingestion |
| `executive-orders-tracker.yml` | Daily 11AM | ✅ ACTIVE | Separate EO system (Federal Register API) |
| `ai-code-review.yml` | On PR | ✅ ACTIVE | Code review |
| `lint-prod-refs.yml` | On push | ✅ ACTIVE | Security check |
| `rss-health-check.yml` | Every 6h | ✅ ACTIVE | Monitoring |
| `rss-tracker-test.yml` | Manual only | ✅ ACTIVE | Schedule removed last session |
| `process-manual-article.yml` | Manual | ✅ ACTIVE | Break-glass feature |

### ALREADY DISABLED (Last Session - PR #34)
| Workflow | What was done | Verify on main? |
|----------|---------------|-----------------|
| `daily-tracker.yml` | Added `if: false`, removed schedule | ✅ Yes - confirm on main |

### TO DISABLE THIS SESSION
| Workflow | Current State | Why |
|----------|---------------|-----|
| `job-scheduler.yml` | Every 5 min | Creates orphaned jobs (job-queue-worker not deployed) |
| `test-daily-tracker.yml` | Manual | Tests disabled system |

**⚠️ IMPORTANT: Branch behavior**
- Scheduled workflows run from **the branch they're defined on** (usually main for PROD)
- Disabling on `test` branch does NOT affect PROD until merged to `main`
- **Plan:** Disable on test → Push → Create PR to main → Merge to stop PROD runs
- **Alternative:** If urgent, push `if: false` directly to main via PR first

### TO DELETE THIS SESSION (after disabling)
| Workflow | Why | Reference check needed |
|----------|-----|----------------------|
| `ai-code-review-v2.yml` | Exact duplicate | ✅ |
| `story-merge.yml` | Uses deprecated rss-enqueue | ✅ |
| `test-rss-real.yml` | Uses old schema | ✅ |

---

## Phase 0: Pre-Flight Reference Sweeps

**Run BEFORE any deletes to catch dependencies:**

```bash
# 1) Workflows -> scripts references
rg -n "scripts/|node scripts/|bun scripts/" .github/workflows

# 2) High-risk items being touched
rg -n "daily-tracker|job-scheduler|story-merge|rss-enqueue|trigger-rss\.sh|job-queue-worker-atomic|test-rss-real" .

# 3) Files planned for deletion mentioned in docs
rg -n "backfill-2-weeks\.bat|run-daily-tracker\.bat|APPLY_MIGRATION_0|rss-deployment" docs/ CLAUDE.md

# 4) Verify merge semantics not used elsewhere
rg -n "story\.merge|story-merge" scripts/ .github/
```

**If any hit shows up**, that file is not "delete" until the reference is removed/updated in the same commit.

---

## Phase 1: Root Directory Organization

### Current State - Loose Files at Root
```
ROOT/
├── *.log files (8) → should be in logs/ or deleted
├── *.csv files (5) → should be in exports/ or test-data/
├── *.bat files (3) → should be deleted (Windows-only)
├── commit_message.txt → delete (stale)
├── search-filter-prototype*.html (2) → move to public/prototypes/ or delete
└── rss-trigger-log.txt → already in .gitignore, just git rm
```

### 1A. Move Log Files (use `git mv` for history)
```bash
# Move to logs/ directory (preserves history)
git mv monitoring-ttrc260.log logs/
git mv new-feeds-test.log logs/
git mv worker-filtering-test.log logs/
git mv worker-filtering-test-v2.log logs/
git mv worker-final-test.log logs/
git mv worker-ttrc253-resume.log logs/
git mv worker-ttrc254-monitoring.log logs/
git mv worker-ttrc260.log logs/
```

### 1B. Move CSV Test Data
```bash
# Move to exports/ (test data artifacts)
git mv merge-candidates.csv exports/
git mv merge-candidates-to-label.csv exports/
git mv merge-ground-truth.csv exports/
git mv merge-ground-truth-smoke.csv exports/
git mv merge-test-ground-truth.csv exports/
```

### 1C. Delete Obsolete Root Files
```bash
# Windows batch files (not cross-platform)
git rm backfill-2-weeks.bat
git rm rerun-first-50-eos.bat
git rm run-daily-tracker.bat

# Stale files
git rm commit_message.txt
git rm search-filter-prototype-hifi.html  # keep main prototype for reference
git rm rss-trigger-log.txt  # already in .gitignore
```

### 1D. Delete Empty Directories (use git rm if tracked)
```bash
# Check if tracked (if tracked, use git rm)
git ls-files data/ database-migration/ test-scripts/ tmp/
# If tracked:
git rm -r data/ database-migration/ test-scripts/ tmp/
# If untracked (git doesn't track empty dirs - just delete):
rm -rf data/ database-migration/ test-scripts/ tmp/
```

### 1E. Handle workflows/ Directory at Root
```bash
# Reference sweep first - make sure nothing uses it
rg -n "workflows/test-rss\.yml|/workflows/|workflows/" .

# If no references found, delete (use git rm if tracked)
git ls-files workflows/
# If tracked:
git rm -r workflows/
# If untracked:
rm -rf workflows/
```

**Phase 1 Commit:** `chore(cleanup): organize root directory files`

---

## Phase 2: Workflow Cleanup

### 2A. Verify daily-tracker.yml is Disabled on Main
```bash
# Check that PR #34 changes are on main
gh api repos/AJWolfe18/TTracker/contents/.github/workflows/daily-tracker.yml?ref=main | jq -r '.content' | base64 -d | grep -A5 "jobs:"
# Should show: if: false
```

### 2B. Disable job-scheduler.yml (Commit A)
Edit `.github/workflows/job-scheduler.yml`:
```yaml
# Change jobs to have if: false
jobs:
  schedule-rss:
    if: false  # DISABLED 2026-01-08 - creates orphaned jobs, rss-tracker-prod.yml is primary
    ...
  schedule-lifecycle:
    if: false  # DISABLED 2026-01-08
    ...
```

### 2C. Disable test-daily-tracker.yml (Commit A)
Edit `.github/workflows/test-daily-tracker.yml`:
```yaml
jobs:
  test:
    if: false  # DISABLED 2026-01-08 - daily-tracker.yml is disabled
```

### 2D. Reference Sweep Before Deletes (System Contract Sweep)
```bash
# Comprehensive sweep for ALL workflows being touched
rg -n "ai-code-review-v2|story-merge\.yml|test-rss-real\.yml|job-scheduler\.yml|test-daily-tracker\.yml" .
```

### 2E. Delete Duplicate/Broken Workflows (Commit B)
```bash
git rm .github/workflows/ai-code-review-v2.yml
git rm .github/workflows/story-merge.yml
git rm .github/workflows/test-rss-real.yml
```

### 2F. Verify After Workflow Changes
```bash
gh workflow list
gh workflow run "RSS Tracker - TEST" --ref test
gh run watch
```

**Phase 2 Commits:**
- Commit A: `chore(ci): disable legacy job-scheduler and test-daily-tracker workflows`
- Commit B: `chore(ci): delete duplicate and broken workflows`

---

## Phase 3: Documentation Cleanup

### 3A. Create Canonical Docs Map
Create `/docs/README.md` (or update if exists):
```markdown
# Documentation Index

## Canonical Locations (do not duplicate elsewhere)
- **Architecture docs**: `/docs/architecture/`
- **API docs**: `/docs/api/`
- **Database docs**: `/docs/database/`
- **Guides**: `/docs/guides/`
- **Archive (not maintained)**: `/docs/archive/`
- **Handoffs (session summaries)**: `/docs/handoffs/`
- **Plans (implementation plans)**: `/docs/plans/`

## Do NOT create docs in /docs/ root
All documentation should be in appropriate subdirectories above.
```

### 3B. Delete Root-Level Duplicates (git rm)
| Delete (root) | Canonical location |
|---------------|-------------------|
| `/docs/API.md` | `/docs/api/API.md` |
| `/docs/ARCHITECTURE.md` | `/docs/architecture/ARCHITECTURE.md` |
| `/docs/database-schema.md` | `/docs/database/database-schema.md` |
| `/docs/database-documentation.md` | `/docs/database/` |
| `/docs/environment-variables-setup.md` | `/docs/guides/development/` |
| `/docs/daily-tracker-api.md` | `/docs/api/` |
| `/docs/category-system.md` | `/docs/architecture/` |
| `/docs/dashboard-architecture.md` | `/docs/architecture/` |
| `/docs/duplicate-detection-enhancement.md` | `/docs/guides/features/` |
| `/docs/BRANCH-STRUCTURE-SYNC.md` | `/docs/guides/development/` |

### 3C. Archive Legacy Docs (git mv)
```bash
mkdir -p docs/archive/legacy-schemas
git mv docs/database/political-entries-schema.md docs/archive/legacy-schemas/
git mv docs/database/executive-orders-schema.md docs/archive/legacy-schemas/

mkdir -p docs/archive/legacy-api
git mv docs/api/daily-tracker-api.md docs/archive/legacy-api/
```

### 3C.1 Add Archive Banner (prevents people "fixing" archived docs)
Create `docs/archive/README.md`:
```markdown
# Archive

**Content under `/docs/archive/` is retained for historical reference only.**

- It is NOT maintained
- It may NOT reflect current production behavior
- Do NOT update these files - create new docs in the appropriate canonical location instead

See `/docs/README.md` for canonical documentation locations.
```

### 3D. Archive /docs/rss-deployment/ Folder
```bash
git mv docs/rss-deployment docs/archive/rss-deployment-historical
```

### 3E. Delete Obsolete Migration Docs
```bash
git rm migrations/APPLY_021A_NOW.md
git rm migrations/APPLY_MIGRATION_021.md
git rm migrations/APPLY_MIGRATION_022.md
git rm migrations/APPLY_MIGRATION_023.md
git rm migrations/TTRC-145-pending-prod-migrations.md
# Keep one canonical MIGRATION_029 doc, delete duplicates
```

**Phase 3 Commit:** `docs(cleanup): deduplicate and organize documentation`

---

## Phase 4: Script Cleanup

### 4A. Reference Sweep Before Script Removal
```bash
# Check if scripts are referenced anywhere
rg -n "job-queue-worker-atomic|daily-tracker-supabase|trigger-rss\.sh" .github/ scripts/
```

### 4B. Archive Legacy Scripts (git mv)
```bash
mkdir -p scripts/archive/legacy-trackers
git mv scripts/daily-tracker-supabase.js scripts/archive/legacy-trackers/

mkdir -p scripts/archive/superseded
git mv scripts/job-queue-worker-atomic.js scripts/archive/superseded/
git mv scripts/executive-orders-tracker.js scripts/archive/superseded/  # old non-supabase version
```

### 4C. Delete Truly Obsolete Scripts
```bash
git rm scripts/create-merge-test-data.js
git rm scripts/delete-test-stories.js
git rm scripts/finalize-code-update.js
git rm scripts/inspect-extractions.js
git rm scripts/monitoring/trigger-rss.sh  # creates orphaned jobs per CLAUDE.md
```

### 4D. Clean archive/ Directory
```bash
git rm archive/daily-tracker.js
git rm archive/test-tracker.js
git rm archive/update-tracker.js
git rm archive/manual-article-processor-duplicate.js
```

### 4E. Archive Backfill Scripts
```bash
mkdir -p scripts/archive/backfill
git mv scripts/backfill-*.js scripts/archive/backfill/
```

**Phase 4 Commit:** `chore(scripts): archive legacy and remove obsolete scripts`

---

## Phase 5: Temp/Test Artifacts Cleanup

### 5A. Clean temp/ Directory
```bash
# These are all superseded by Migration 029+
git rm -r temp/
```

### 5B. Archive logs/ JSON Files
```bash
mkdir -p docs/archive/data-snapshots
git mv logs/*.json docs/archive/data-snapshots/
```

### 5C. Clean Public Test Files
```bash
# Remove old September 2025 test files
git rm public/test-line-clamp.html
git rm public/test-line-clamp-fixed.html
git rm public/test-refactored.html
git rm public/test-refactored-dashboard.html
git rm public/test-tab-position.html
git rm public/test-tabs-moved.html
git rm public/dashboard-backup-before-final-refactor.js
git rm public/dashboard-backup-phase3-before.js
git rm public/dashboard-test-refactored.js
```

### 5D. Update .gitignore to Prevent Re-accumulation
Add to `.gitignore`:
```
# Prevent re-accumulation of cleanup targets
logs/*.log
logs/*.json
test-runs/*.csv
temp/temp_*.sql
*.bat
```

**Policy Decision: exports/ directory**
- **Intent:** `exports/` is for scratch/ad-hoc analysis outputs, NOT canonical test datasets
- **Action:** Do NOT ignore `exports/*.csv` - existing moved files stay tracked
- **Canonical test data:** Goes to `docs/archive/test-data/` (which is tracked)
- **Future scratch CSVs:** Will be tracked unless explicitly added to .gitignore per-file

**Phase 5 Commit:** `chore(cleanup): remove temp artifacts and update gitignore`

---

## Phase 6: Edge Function & CLAUDE.md Updates

### 6A. Mark rss-enqueue as Deprecated
Add to `supabase/functions/rss-enqueue/index.ts`:
```typescript
/**
 * @deprecated DEPRECATED as of 2026-01-08.
 * RSS ingestion now uses inline automation via rss-tracker-supabase.js
 * triggered by GitHub Actions (rss-tracker-prod.yml).
 *
 * DO NOT USE - Creates orphaned jobs in job_queue table.
 * See: CLAUDE.md "Legacy System (DEPRECATED)"
 */
```

### 6B. Add Job Queue Cleanup Note
Create `docs/operations/orphaned-jobs-cleanup.md`:

```markdown
# Orphaned Jobs Cleanup

The legacy `job-scheduler.yml` and `rss-enqueue` created jobs that were never processed.
The `job-queue-worker.js` was never deployed, so jobs accumulated indefinitely.

## Step 1: Inspect (ALWAYS do this first)

```sql
SELECT job_type, status, COUNT(*) AS cnt,
       MIN(created_at) AS oldest,
       MAX(created_at) AS newest
FROM public.job_queue
WHERE status IN ('pending', 'claimed')
GROUP BY job_type, status
ORDER BY cnt DESC;
```

## Step 2: Cleanup (only if Step 1 confirms orphaned jobs)

```sql
-- Safe deletion: only pending, older than 14 days, chunked to avoid locks
WITH doomed AS (
  SELECT id
  FROM public.job_queue
  WHERE status = 'pending'
    AND created_at < NOW() - INTERVAL '14 days'
  LIMIT 5000
)
DELETE FROM public.job_queue q
USING doomed d
WHERE q.id = d.id;
```

Run multiple times if more than 5000 rows need cleanup.
```

### 6C. Update CLAUDE.md
- Fix workflow status section to match reality
- Clarify RSS Tracker is primary system
- Update "Last Updated" date

**Phase 6 Commit:** `docs(claude): update workflow status and add deprecation notices`

---

## Session Scope

### THIS SESSION (Phases 1-3)
- ✅ Phase 1: Root directory organization
- ✅ Phase 2: Workflow cleanup
- ✅ Phase 3: Documentation cleanup
- **Time estimate:** ~45 min

### JIRA CARDS (Phases 4-7 for future sessions)
**To be created after plan approval:**

| Card | Phase | Summary | Priority |
|------|-------|---------|----------|
| TTRC-??? | 4 | Archive legacy scripts and cleanup archive/ dir | Medium |
| TTRC-??? | 5 | Clean temp/ and public test artifacts | Medium |
| TTRC-??? | 6 | Update CLAUDE.md and add deprecation notices | Medium |
| TTRC-??? | 7 | Clean up orphaned jobs in job_queue table | Low |

**Note:** JIRA cards will be created immediately after plan approval.

---

## Verification Checklist

### After Each Phase
- [ ] `npm run qa:smoke` passes
- [ ] `gh workflow list` shows correct status
- [ ] `npm run server` - frontend works

### After All Phases
- [ ] `gh workflow run "RSS Tracker - TEST" --ref test` succeeds
- [ ] Verify no regressions in RSS pipeline
- [ ] Commit and push to test
- [ ] Check AI code review (~5 min wait)

---

## Decision: Historical vs Bloat

### KEEP for History (in archive/)
- Legacy scripts (daily-tracker-supabase.js, etc.) - may need for reference
- Legacy docs (political-entries-schema.md) - documents PROD schema
- Backfill scripts - may need to re-run
- Data snapshots (JSON backups) - debugging reference

### DELETE Permanently
- Empty directories
- Duplicate workflows
- Temp SQL files (superseded)
- Old test HTML files (no value)
- Windows batch files (not cross-platform)
- Stale commit_message.txt

### Rationale
Archive approach adds ~500KB but preserves ability to reference old code.
Permanent deletes save ~2MB of truly useless files.

---

## Commit Sequence - THIS SESSION (Phases 1-3 only)

```
1. chore(cleanup): organize root directory files (Phase 1)
2. chore(ci): disable legacy job-scheduler and test-daily-tracker workflows (Phase 2A)
3. chore(ci): delete duplicate and broken workflows (Phase 2B)
4. docs(cleanup): deduplicate and organize documentation (Phase 3)
```

Each commit is independently revertable.

## Future Session Commits (from JIRA cards)

```
5. chore(scripts): archive legacy and remove obsolete scripts (Phase 4)
6. chore(cleanup): remove temp artifacts and update gitignore (Phase 5)
7. docs(claude): update workflow status and add deprecation notices (Phase 6)
```

---

## Files Changed Summary

### Moved (with history via git mv)
- 8 log files: root → logs/
- 5 CSV files: root → exports/
- Legacy docs → docs/archive/
- Legacy scripts → scripts/archive/

### Deleted
- 3 duplicate workflows
- 3 Windows batch files
- ~10 obsolete scripts
- ~10 old test files
- temp/ directory contents
- Empty directories (4)

### Modified
- .gitignore (prevent re-accumulation)
- CLAUDE.md (workflow status update)
- rss-enqueue/index.ts (deprecation notice)

### Created
- docs/README.md (canonical map)
- docs/operations/orphaned-jobs-cleanup.md
