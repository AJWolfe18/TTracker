# Handoff: Documentation Overhaul & Cleanup

**Date:** 2026-01-12
**Tickets:** ADO-64 (TTRC-371) - Closed
**Status:** Complete

---

## Summary

Major documentation cleanup session. Established feature folder pattern, archived ~65 stale docs, audited core docs, and created clean structure for future work.

---

## What Was Done

### 1. PR #47 Merged to Prod
Doc cleanup from previous session deployed to main:
- CLAUDE.md updates (job queue removal, MCP tool fix)
- Consolidated pr-workflow.md
- Rewrote database-schema.md
- Added tmpclaude-* to .gitignore

### 2. Feature Folder Structure Created
New pattern for organizing feature docs:
```
docs/features/
├── pardons-tracker/
│   └── prd.md
└── rss-enrichment/
    └── spicy-prompts-guide.md
```
CLAUDE.md updated to reference this pattern.

### 3. Root Docs Cleaned (19 → 9)
**Deleted (2):**
- GETTING-STARTED.md (refs deleted files)
- SYSTEM_STATUS.md (Oct 2025, very stale)

**Archived (10):**
- admin-features-guide.md, archive-functionality-guide.md
- CHANGELOG.md, COMMANDS.md, database-standards.md
- TrumpyTracker_Content_Enrichment_Options.md
- CLAUDE_CODE_STARTUP.md, plan.md
- project-handoff-2025-09-22-rss-e2e.md, rss-e2e-test-summary.md

### 4. Plans Archived (51 → 4)
Moved 47 completed plans to `docs/archive/plans-completed/`:
- All dated 2025-* plans
- All ttrc-* / TTRC-* plans

**Kept only 4 active/future plans:**
- courtlistener-field-mapping.md (future)
- prod-deployment-runbook.md (runbook)
- rss-expansion-ad-fontes-plan.md (future)
- scotus-tracking-v1.md (future)

### 5. Architecture Cleaned (9 → 8)
**Archived:**
- ARCHITECTURE.md (stale - talked about migration "in progress")

**Kept (7 current docs):**
- rss-system.md, article-scraping.md, clustering-scoring.md
- business-logic-mapping.md, dashboard-architecture.md
- scraping-vs-rss.md, category-system.md

### 6. Guides Cleaned (22 → 15)
**Archived:**
- deployment/ folder (4 historical deployment guides)
- BRANCH-STRUCTURE-SYNC.md (historical)
- rss-schema-testing-guide.md (historical)

**Deleted (duplicates):**
- guides/features/admin-features-guide.md
- guides/features/archive-functionality-guide.md

### 7. Core Docs Audited
**code-patterns.md:**
- Fixed table name: story_articles → article_story
- Updated file structure to reflect vanilla JS (not React)
- Added notes that React/TS sections are reference patterns
- Updated date and references

**common-issues.md:**
- Fixed table name: story_articles → article_story
- Marked Job Queue RPC issue as HISTORICAL
- Fixed MCP tool references
- Updated date

**PROJECT_INSTRUCTIONS.md:**
- Complete rewrite - removed JIRA refs, deleted file refs
- Simplified to 60 lines

**database-schema.md:**
- Added Naming Conventions section (merged from database-standards.md)

---

## Files Changed

### Created
| File | Purpose |
|------|---------|
| `docs/features/pardons-tracker/prd.md` | Moved from plans/ |
| `docs/features/rss-enrichment/spicy-prompts-guide.md` | Moved from root |
| `docs/archive/plans-completed/` | 47 archived plans |

### Modified
| File | Change |
|------|--------|
| `CLAUDE.md` | Feature folder pattern, updated refs |
| `docs/PROJECT_INSTRUCTIONS.md` | Complete rewrite |
| `docs/code-patterns.md` | Fixed stale refs |
| `docs/common-issues.md` | Fixed stale refs |
| `docs/database/database-schema.md` | Added naming conventions |

### Archived (65+ files)
All moved to `docs/archive/legacy-2026-01/` or `docs/archive/plans-completed/`

---

## Final Doc Structure

```
docs/
├── features/              # Per-feature docs (NEW)
│   ├── pardons-tracker/
│   └── rss-enrichment/
├── plans/                 # 4 active/future plans only
├── architecture/          # 8 current architecture docs
├── database/              # Schema reference
├── guides/                # 15 cleaned guides
│   ├── development/       # 2 setup guides
│   ├── features/          # 3 feature guides
│   └── testing/           # 2 test guides
├── handoffs/              # Session handoffs
├── templates/             # Handoff/plan templates
├── archive/               # All archived content
│   ├── legacy-2026-01/    # 20+ legacy docs
│   └── plans-completed/   # 47 completed plans
├── security/              # Security audit
└── [9 root docs]          # Core reference docs
```

---

## Commits

| Commit | Description |
|--------|-------------|
| `4d9d716` | Quick cleanup - delete duplicates, archive stale |
| `8f20b28` | Major cleanup + feature folder structure |
| `9655940` | Audit code-patterns.md - fix stale references |
| `8a77637` | Audit common-issues.md - fix stale references |
| `3e47cff` | Archive completed plans + clean guides/architecture |

---

## ADO Updates

- **ADO-64 (TTRC-371):** Moved to Closed

---

## Next Session Tasks

### Optional Cleanup
1. **Cherry-pick doc fixes to main** - code-patterns.md and common-issues.md fixes are on test only
2. **Review remaining guides** - `docs/guides/` still has some potentially stale content
3. **Create architecture overview** - Since we archived ARCHITECTURE.md, may want a new simplified overview

### Feature Work Ready
- Pardons tracker has PRD in `docs/features/pardons-tracker/`
- SCOTUS tracker plan exists in `docs/plans/scotus-tracking-v1.md`

---

## Key Patterns Established

### Feature Folder Pattern
For new features, create:
```
docs/features/[feature-name]/
├── prd.md          # Product requirements
├── plan.md         # Implementation plan (if complex)
└── notes.md        # Dev notes (optional)
```

### Doc Update Checklist
Added to CLAUDE.md session checklist:
```
- [ ] If schema/architecture/patterns changed → Update relevant doc in `/docs/`
```

---

## Notes

- All archived content preserved in `docs/archive/` - nothing deleted permanently
- Feature folders replace the old `/docs/plans/` approach for new work
- Old plans kept in archive for historical reference if needed

---

**Session Duration:** ~2 hours
**Net Result:** ~65 files archived, clean doc structure established
