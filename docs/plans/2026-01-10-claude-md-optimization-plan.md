# CLAUDE.md Optimization Plan

**Date:** 2026-01-10
**Status:** COMPLETE

---

## Goal

Update CLAUDE.md for JIRA→ADO migration + add dev process improvements.

**This is VALUE optimization, not size reduction.**

---

## Deliverables

| File | Action |
|------|--------|
| `CLAUDE.md` | Update 18 JIRA→ADO refs, add 4 sections, condense schema |
| `docs/guides/ado-workflow.md` | CREATE - migrate workflow content |
| `docs/templates/plan-template.md` | CREATE |
| `docs/templates/handoff-template.md` | CREATE |

---

## Phase 1: CLAUDE.md Updates

### 1.1 JIRA → ADO (18 refs)
- Find/replace: "JIRA" → "ADO", "Atlassian (JIRA) MCP" → "Azure DevOps MCP"
- Replace ticket format: `TTRC-XXX` → `ADO #XXX`
- Update Rule 4 to reference `/ado` command
- Rename "JIRA Workflow" section → brief ADO summary + link to workflow guide

### 1.2 Add Sections
1. **Quick Reference** (after TLDR) - First 3 commands, key docs list
2. **Working with Plans** (after workflow checklist) - Decision tree, EXECUTION MODE rules
3. **Promotion to PROD** (after git rules) - PR checklist, test-only tracking
4. **Python Anti-Pattern** (in anti-patterns) - "NO PYTHON IN THIS REPO"

### 1.3 Condense Schema
- Replace 50-line schema section with 15-line summary
- Link to `/docs/database/database-schema.md`

---

## Phase 2: Create ADO Workflow Guide

**File:** `docs/guides/ado-workflow.md`

**Content:**
- Work item types (Epic, Feature, Story, Bug)
- Epic → Feature → Story hierarchy
- Story sizing ("1 Story = 1 context window")
- Status workflow
- Reference to `/ado` command

---

## Phase 3: Create Templates

**Files:** `docs/templates/plan-template.md`, `docs/templates/handoff-template.md`

**Key elements:**
- EXECUTION MODE header (prevents re-planning)
- STATUS field for phase tracking
- Checklist format

---

## Verification

```bash
grep -i jira CLAUDE.md        # → 0 results
grep -i ado CLAUDE.md         # → finds refs
ls docs/templates/            # → 2 files
ls docs/guides/ado-workflow.md # → exists
```

---

## Design Decisions

1. VALUE over SIZE - adding useful content
2. EXECUTION MODE markers - prevents re-planning loops
3. Dedicated workflow guide - keeps CLAUDE.md focused
4. Keep jira.md command for now - user cleanup later

---

**Last Updated:** 2026-01-10
