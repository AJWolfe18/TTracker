# /docs Folder Reorganization Plan

## CURRENT PROBLEM
50+ files in flat structure with:
- Handoffs mixed with reference docs
- Multiple duplicate guides (3-4 RSS deployment guides)
- Multiple versions of same file (ui-design v2.1, v2.2)
- Temporary files that should be deleted
- Completed TODO files
- No clear organization

**Result:** Hard to find things, cluttered, wastes context when loaded

---

## PROPOSED STRUCTURE

```
/docs/
├── README.md                           # Overview of documentation
├── PROJECT_INSTRUCTIONS.md             # Condensed for Claude project
├── STARTUP_PROMPT.md                   # Session start checklist
├── HANDOFF_PROMPT.md                   # Session end template
├── SESSION_PROTOCOL.md                 # Full workflow details
│
├── /handoffs/                          # All historical handoffs
│   ├── 2025-01-16-rss-p1-fixes.md
│   ├── 2025-09-22-rss-e2e.md
│   ├── 2025-09-23-rss-queue-progress.md
│   ├── 2025-09-28-final-rss-fixes.md
│   ├── 2025-09-29-story-view-ui.md
│   ├── 2025-09-30-story-view-ui.md
│   ├── 2025-10-01-qa-fixes-complete.md
│   └── 2025-10-02-context-crisis-resolution.md
│
├── /architecture/                      # System design & structure
│   ├── ARCHITECTURE.md
│   ├── dashboard-architecture.md
│   ├── business-logic-mapping.md
│   ├── category-system.md
│   └── rss-system.md
│
├── /database/                          # Database schemas & migrations
│   ├── database-schema.md
│   ├── executive-orders-schema.md
│   ├── political-entries-schema.md
│   ├── severity-system.md
│   └── id-strategy.md
│
├── /guides/                            # How-to guides & references
│   ├── deployment/
│   │   ├── production-deployment-checklist.md
│   │   ├── migration-018-deployment-guide.md
│   │   └── rss-production-deployment-guide.md
│   ├── development/
│   │   ├── environment-variables-setup.md
│   │   ├── supabase-cli-setup.md
│   │   └── BRANCH-STRUCTURE-SYNC.md
│   ├── features/
│   │   ├── admin-features-guide.md
│   │   ├── archive-functionality-guide.md
│   │   └── duplicate-detection-enhancement.md
│   └── testing/
│       ├── TESTING.md
│       ├── rss-schema-testing-guide.md
│       └── story-tab-integration-test-checklist-v2.md
│
├── /api/                               # API documentation
│   ├── API.md
│   └── daily-tracker-api.md
│
├── /reference/                         # Quick reference & troubleshooting
│   ├── TROUBLESHOOTING.md
│   ├── MCP-SERVER-STATUS.md
│   └── MIGRATION-COMPLETE.md
│
└── /archive/                           # Completed/superseded docs
    ├── story-tab-integration-test-checklist.md (v1)
    ├── ui-design-prompt.md (superseded)
    ├── ui-design-prompt-v2.1.md (superseded)
    └── RSS_FIX_TODO.md (completed)
```

---

## FILES TO DELETE (15+ temporary/duplicate files)

```bash
# Delete these - already integrated elsewhere or duplicates
rm Confluence-updates-Oct-1.md
rm JIRA-TTRC-145-update.md
rm qa-fixes-implementation-summary.md
rm rss-critical-fixes-applied.md
rm rss-e2e-test-summary.md
rm rss-fixes-verification.md
rm rss-implementation-session-summary.md
rm "RSS E2E Pipeline - Final Fix Plan.md"
rm RSS-PRODUCTION-DEPLOYMENT.md  # Duplicate
rm ttrc-140-deployment-checklist.md
rm ttrc-141-performance-monitoring-card.md
rm ui-design-prompt-v2.2.md
rm migration-clarification.md
rm implementation-action-plan.md
rm README.md.backup
rm CHANGELOG.md
rm CONTRIBUTING.md
rm DEPLOYMENT.md
rm database-documentation.md
```

---

## MIGRATION COMMANDS

### Step 1: Create New Folders
```bash
cd C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker\docs
mkdir handoffs architecture guides guides\deployment guides\development guides\features guides\testing api reference archive
```

### Step 2: Move Handoffs (8 files)
```bash
move project-handoff-2025-01-16-1430-rss-p1-fixes.md handoffs\2025-01-16-rss-p1-fixes.md
move project-handoff-2025-09-22-rss-e2e.md handoffs\2025-09-22-rss-e2e.md
move project-handoff-2025-09-23-2100-rss-queue-progress.md handoffs\2025-09-23-rss-queue-progress.md
move "Project_Handoff_2025-09-28_Final_RSS_Fixes.md" handoffs\2025-09-28-final-rss-fixes.md
move project-handoff-2025-09-29-story-view-ui.md handoffs\2025-09-29-story-view-ui.md
move project-handoff-2025-09-30-story-view-ui.md handoffs\2025-09-30-story-view-ui.md
move project-handoff-2025-10-01-qa-fixes-complete.md handoffs\2025-10-01-qa-fixes-complete.md
```

### Step 3: Move Architecture Docs (5 files)
```bash
move ARCHITECTURE.md architecture\
move dashboard-architecture.md architecture\
move business-logic-mapping.md architecture\
move category-system.md architecture\
move rss-system.md architecture\
```

### Step 4: Move Guides (15 files)
```bash
# Deployment
move production-deployment-checklist.md guides\deployment\
move migration-018-deployment-guide.md guides\deployment\
move rss-production-deployment-guide.md guides\deployment\

# Development
move environment-variables-setup.md guides\development\
move supabase-cli-setup.md guides\development\
move BRANCH-STRUCTURE-SYNC.md guides\development\

# Features
move admin-features-guide.md guides\features\
move archive-functionality-guide.md guides\features\
move duplicate-detection-enhancement.md guides\features\
move story-view-implementation-guide.md guides\features\

# Testing
move TESTING.md guides\testing\
move rss-schema-testing-guide.md guides\testing\
move story-tab-integration-test-checklist-v2.md guides\testing\
```

### Step 5: Move API Docs (2 files)
```bash
move API.md api\
move daily-tracker-api.md api\
```

### Step 6: Move Reference Docs (3 files)
```bash
move TROUBLESHOOTING.md reference\
move MCP-SERVER-STATUS.md reference\
move MIGRATION-COMPLETE.md reference\
```

### Step 7: Archive Superseded Docs (4 files)
```bash
move story-tab-integration-test-checklist.md archive\
move ui-design-prompt.md archive\
move ui-design-prompt-v2.1.md archive\
move RSS_FIX_TODO.md archive\
```

---

## NEW /docs/README.md CONTENT

```markdown
# TrumpyTracker Documentation

## Quick Start
- **New to project?** Read `/docs/architecture/ARCHITECTURE.md`
- **Starting work?** Read `/docs/STARTUP_PROMPT.md`
- **Need a handoff?** Use template in `/docs/HANDOFF_PROMPT.md`
- **Full protocol?** See `/docs/SESSION_PROTOCOL.md`

## Documentation Structure
- `/handoffs/` - Historical session summaries (not in project knowledge)
- `/architecture/` - System design and structure
- `/database/` - Schemas, migrations, data models
- `/guides/` - How-to guides organized by topic
- `/api/` - API documentation and specifications
- `/reference/` - Quick reference and troubleshooting
- `/archive/` - Superseded documents (for reference only)

## Key Documents
**For Claude:**
- `PROJECT_INSTRUCTIONS.md` - Condensed startup instructions
- `STARTUP_PROMPT.md` - Full session start checklist
- `HANDOFF_PROMPT.md` - Session end template
- `SESSION_PROTOCOL.md` - Complete workflow details

**For Development:**
- `architecture/ARCHITECTURE.md` - System overview
- `guides/deployment/production-deployment-checklist.md` - Deploy to prod
- `database/database-schema.md` - Database structure
- `reference/TROUBLESHOOTING.md` - Common issues

## Finding Documents
- **Architecture decisions?** → `/architecture/`
- **How to do X?** → `/guides/[category]/`
- **API reference?** → `/api/`
- **Past session?** → `/handoffs/YYYY-MM-DD-name.md`
- **Database schema?** → `/database/`
- **Something broken?** → `/reference/TROUBLESHOOTING.md`

_Last Updated: October 2, 2025_
```

---

## EXECUTION CHECKLIST

- [ ] Create new folder structure
- [ ] Move handoffs to `/handoffs/`
- [ ] Move architecture docs to `/architecture/`
- [ ] Move guides to `/guides/[category]/`
- [ ] Move API docs to `/api/`
- [ ] Move reference docs to `/reference/`
- [ ] Archive superseded versions
- [ ] Delete temporary files (15+)
- [ ] Create `/docs/README.md`
- [ ] Update project knowledge (remove handoffs, keep only active references)
- [ ] Commit all changes
- [ ] Verify nothing broke (links, references)

---

## BENEFITS

### Context Savings
- **Handoffs out of project knowledge** → Save 30K-50K tokens per chat
- **Clear categorization** → Easier to find and reference specific docs
- **Archive old versions** → Prevent confusion from duplicates

### Discoverability
- **Logical grouping** → Related docs together
- **Clear paths** → Know where to look for specific info
- **README navigation** → Quick links to most-used docs

### Maintenance
- **Easy cleanup** → Archive old docs, delete temp files
- **Version control** → Keep only latest version in main folders
- **Historical record** → Handoffs preserved in git but not loaded

---

_Created: October 2, 2025_
