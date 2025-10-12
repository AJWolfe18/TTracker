# Documentation Cleanup Audit - October 5, 2025

## Documents to DELETE (Redundant)

### 1. **STARTUP_PROMPT.md**
**Why:** Replaced by `CLAUDE_DESKTOP_STARTUP.md`  
**Action:** Delete  
**Reason:** Old version, all content migrated to new startup docs

### 2. **SESSION_PROTOCOL.md**
**Why:** Content now in `CLAUDE_DESKTOP_STARTUP.md` and `CLAUDE_CODE_STARTUP.md`  
**Action:** Delete  
**Reason:** Redundant - startup prompts have everything

### 3. **HANDOFF_PROMPT.md**
**Why:** Templates now in `CLAUDE_DESKTOP_HANDOFF.md`  
**Action:** Delete  
**Reason:** Handoff template moved to Desktop handoff doc

### 4. **CLAUDE_CODE_HANDOFF.md**
**Why:** Code creates PR descriptions instead  
**Action:** Delete  
**Reason:** Code doesn't create separate handoffs anymore - PRs + Desktop handoffs cover everything

### 5. **migration-clarification.md**
**Why:** Historical context from specific bug  
**Action:** Move to `/docs/archive/` or delete  
**Reason:** One-time issue, not ongoing reference

### 6. **DOCS_REORGANIZATION_PLAN.md**
**Why:** Planning document that's been completed  
**Action:** Move to `/docs/archive/`  
**Reason:** Historical planning doc, not active reference

### 7. **TTRC-148-implementation-guide.md**
**Why:** Ticket-specific guide  
**Action:** Move to `/docs/archive/` or `/docs/guides/features/`  
**Reason:** Should be in specific location, not root docs folder

### 8. **_temp_to_delete/ folder**
**Why:** Already marked for deletion  
**Action:** Delete entire folder  
**Reason:** Temporary holding area, contents outdated

---

## Documents to KEEP (Active)

### Core Workflow
- ✅ **GETTING-STARTED.md** - New guide for Josh
- ✅ **CLAUDE_DESKTOP_STARTUP.md** - Desktop session guide
- ✅ **CLAUDE_CODE_STARTUP.md** - Code session guide
- ✅ **CLAUDE_DESKTOP_HANDOFF.md** - End-of-feature template
- ✅ **CLAUDE-CODE-PR-WORKFLOW.md** - GitHub Actions + PR setup
- ✅ **PROJECT_INSTRUCTIONS.md** - Main project instructions in Claude

### Schema & Standards
- ✅ **database-standards.md** - Schema rules (NEW)
- ✅ **database-schema.md** - Current schema (NEW, Code maintains)

### Code Quality
- ✅ **code-patterns.md** - Reusable patterns (NEW, Code maintains)
- ✅ **common-issues.md** - Bug solutions (NEW, Code maintains)

### General
- ✅ **README.md** - Project overview
- ✅ **/docs/handoffs/** - Historical handoffs (keep all)
- ✅ **/docs/plans/** - Implementation plans (if exists)
- ✅ **/docs/guides/** - Feature guides (keep organized)

---

## Recommended Actions

### Immediate (Delete These)
```bash
# In /docs/
rm STARTUP_PROMPT.md
rm SESSION_PROTOCOL.md
rm HANDOFF_PROMPT.md
rm CLAUDE_CODE_HANDOFF.md
rm -rf _temp_to_delete/
```

### Archive (Move to /docs/archive/)
```bash
# Create archive if it doesn't exist
mkdir -p /docs/archive

# Move historical docs
mv migration-clarification.md /docs/archive/
mv DOCS_REORGANIZATION_PLAN.md /docs/archive/
mv TTRC-148-implementation-guide.md /docs/archive/
```

---

## New Documentation Structure

After cleanup, `/docs/` root should contain:

```
/docs/
├── GETTING-STARTED.md              # Start here
├── CLAUDE_DESKTOP_STARTUP.md       # Desktop session guide
├── CLAUDE_CODE_STARTUP.md          # Code session guide
├── CLAUDE_DESKTOP_HANDOFF.md       # Handoff template
├── CLAUDE-CODE-PR-WORKFLOW.md      # PR + GitHub setup
├── PROJECT_INSTRUCTIONS.md         # Main Claude instructions
├── README.md                       # Project overview
│
├── database-standards.md           # Schema rules
├── database-schema.md              # Current schema
├── code-patterns.md                # Reusable patterns
├── common-issues.md                # Bug solutions
│
├── /handoffs/                      # Historical handoffs
├── /plans/                         # Implementation plans
├── /guides/                        # Feature guides
├── /archive/                       # Old/historical docs
├── /api/                           # API docs
├── /architecture/                  # Architecture docs
├── /database/                      # Database docs
└── /reference/                     # Reference materials
```

---

## Benefits of Cleanup

**Before:** 18+ files in root `/docs/` folder  
**After:** 11 active files in root, rest organized in subfolders

**Confusion Removed:**
- ❌ Multiple startup prompts (old vs new)
- ❌ Multiple session protocols
- ❌ Multiple handoff templates
- ❌ Unclear which doc to use

**Clarity Gained:**
- ✅ One getting started guide
- ✅ One startup prompt per tool
- ✅ One handoff template (Desktop only)
- ✅ Clear doc hierarchy

---

## Migration Notes

### References to Update
After deleting these files, check if any docs reference them:
- `STARTUP_PROMPT.md` → Update to `CLAUDE_DESKTOP_STARTUP.md`
- `SESSION_PROTOCOL.md` → Update to `GETTING-STARTED.md` or startup docs
- `HANDOFF_PROMPT.md` → Update to `CLAUDE_DESKTOP_HANDOFF.md`

### Search for References
```bash
# Search all .md files for references to deleted docs
grep -r "STARTUP_PROMPT.md" /docs/*.md
grep -r "SESSION_PROTOCOL.md" /docs/*.md
grep -r "HANDOFF_PROMPT.md" /docs/*.md
```

---

## Execution Plan

**Step 1: Backup (Optional)**
```bash
# If Josh wants to keep copies
cp -r /docs /docs-backup-2025-10-05
```

**Step 2: Delete Redundant Files**
```bash
cd /docs
rm STARTUP_PROMPT.md
rm SESSION_PROTOCOL.md
rm HANDOFF_PROMPT.md
rm CLAUDE_CODE_HANDOFF.md
```

**Step 3: Archive Historical**
```bash
mv migration-clarification.md archive/
mv DOCS_REORGANIZATION_PLAN.md archive/
mv TTRC-148-implementation-guide.md archive/
```

**Step 4: Delete Temp Folder**
```bash
rm -rf _temp_to_delete/
```

**Step 5: Update PROJECT_INSTRUCTIONS.md**
Remove any references to deleted files.

---

## Verification Checklist

After cleanup, verify:
- [ ] GETTING-STARTED.md exists and is complete
- [ ] CLAUDE_DESKTOP_STARTUP.md and CLAUDE_CODE_STARTUP.md exist
- [ ] All 4 new docs exist (database-standards, database-schema, code-patterns, common-issues)
- [ ] No references to deleted files in active docs
- [ ] Archive folder contains historical docs
- [ ] _temp_to_delete folder is gone

---

_Created: October 5, 2025_  
_Execute cleanup after Josh approves_
