# Handoff: JIRA Workflow Simplification

**Date:** 2025-12-20
**Ticket:** N/A (process improvement)
**Branch:** test
**Commit:** `6b2e545`

## What Was Done

### 1. Reviewed Existing JIRA Setup
- Explored current documentation (scattered across CLAUDE.md, commands, guides)
- Queried JIRA project to discover available issue types
- Found: Epic, Story, Feature, Task, Bug, Sub-task all available
- Problem: Tasks being overused for dev work, no clear workflow defined

### 2. Simplified Issue Type Strategy

**New rules (3 types only):**
| Type | When to Use |
|------|-------------|
| **Story** | DEFAULT for ALL dev work |
| **Bug** | Something is broken |
| **Epic** | Groups Stories (explicit only) |

**NOT USED:** Task, Sub-task, Feature

**Labels for grouping:** `clustering`, `security`, `ui`, `rss`, `infra`, `docs`

### 3. Updated Documentation

| File | Change |
|------|--------|
| `docs/guides/jira-workflow.md` | NEW - Complete workflow guide |
| `.claude/commands/jira.md` | Added strict issue type rules for subagent |
| `CLAUDE.md` | Added JIRA Workflow section |
| `.claude/commands/validate.md` | Added type compliance check |

### 4. Migrated Existing Tasks → Stories

11 tickets converted:
- TTRC-323, 324, 325 → Story + `clustering`
- TTRC-315, 316 → Story + `security`
- TTRC-260, 214 → Story + `rss`
- TTRC-213, 215, 222 → Story + `ui`
- TTRC-161 → Story + `infra`

### 5. Decided Against `/start` Command

Discussed creating a session startup command but concluded:
- Current conversational workflow is more flexible
- Command would be too rigid (fetches everything even when not needed)
- Token waste when only partial context needed
- Flexibility of conversation > automation

## Available Commands

| Command | Purpose |
|---------|---------|
| `/jira` | JIRA operations via subagent (auto-selects issue type) |
| `/validate` | Pre-commit validation checklist |

## Key Decisions

1. **Story is the default** - Use for all dev work, not just user-facing features
2. **No hierarchy simulation** - Labels are simple grouping, not parent-child
3. **Subagent enforces rules** - Auto-selects Story unless keywords indicate Bug/Epic
4. **No session startup command** - Keep conversational flexibility

## What's Next

- Continue using new workflow going forward
- Old Tasks in backlog will remain as-is (only migrated active/recent ones)
- Monitor if subagent correctly auto-selects types

## Files Changed

```
.claude/commands/jira.md        (modified - added strict rules)
.claude/commands/validate.md    (modified - added type check)
CLAUDE.md                       (modified - added JIRA section)
docs/guides/jira-workflow.md    (new - workflow guide)
```

## No Blockers

Process improvement complete. Ready for normal development work.
