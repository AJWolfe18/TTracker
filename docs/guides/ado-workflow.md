# Azure DevOps Workflow Guide

**Project:** TTracker
**URL:** https://dev.azure.com/AJWolfe92/TTracker

---

## Work Item Types

| Type | Use When |
|------|----------|
| **Epic** | Major product area (e.g., SCOTUS Tracker, Pardons Tracker) |
| **User Story** | Any dev work that fits in 1 Claude Code session |
| **Bug** | Something is broken |
| **Task** | Sub-item of a story (optional) |

---

## Quick Command Reference

Use `/ado` command for all operations:

```
/ado 123 get status          # Query work item
/ado 123 set state Active    # Update state
/ado create story "Title"    # Create new story
/ado search "clustering"     # Search work items
```

Full syntax: `.claude/commands/ado.md`

---

## Epic > Feature > Story Hierarchy

**The 3-Tier Pattern:**
```
Epic: [Product Area]
├── Feature: [Functional Area 1]
│   ├── Story: DB schema + migrations
│   ├── Story: Edge function / API
│   ├── Story: UI cards + list view
│   └── Story: Detail modal
├── Feature: [Functional Area 2]
│   ├── Story: ...
│   └── Story: ...
└── Feature: [Functional Area 3]
    └── Story: ...
```

---

## Story Sizing: 1 Story = 1 Context Window

**Core Principle:** A Story must be completable in a single Claude Code session.
- Planning happens BEFORE (separate session → creates plan + Stories)
- Dev session: Code → Test → Deploy → Done
- No multi-session Stories - if it doesn't fit, split it

### Sizing Checklist

| Fits in 1 session? | Guideline |
|--------------------|-----------|
| ✅ Yes | Single focus, 1-3 files, clear acceptance criteria |
| ✅ Yes | DB migration + edge function OR UI component (not both) |
| ✅ Yes | Bug fix with known root cause |
| ❌ No, split it | Multiple unrelated changes |
| ❌ No, split it | Full stack (DB + API + UI) for new feature |
| ❌ No, split it | Requires research/exploration first |

---

## Planning vs Dev Sessions

| Session Type | Purpose | Output |
|--------------|---------|--------|
| Planning | Research, design, decompose Epic | Plan doc + Features + Stories in ADO |
| Dev | Execute 1 Story | Working code + tests + deploy + handoff |

---

## Before Creating a Story

Verify:
1. Acceptance criteria are explicit (not "make it work")
2. Dependencies are done (no blockers)
3. Technical approach is decided (no research needed)
4. Scope fits: Can you describe the changes in <5 sentences?

---

## Labels

Common labels for grouping: `clustering`, `security`, `ui`, `rss`, `infra`, `docs`

---

## Status Workflow

**Custom states for User Stories:**
```
New → Todo → Active → Review → Testing → Ready for Prod → Closed
```

| State | Meaning |
|-------|---------|
| **New** | Just created, not yet prioritized |
| **Todo** | Ready to work on, in backlog |
| **Active** | Currently being worked on |
| **Review** | Code complete, awaiting review |
| **Testing** | Deployed to TEST, being verified |
| **Ready for Prod** | Verified on TEST, awaiting PROD deployment |
| **Closed** | Done (deployed to PROD) |
| **Removed** | Cancelled/deleted |

**NOTE:** We don't use "Resolved" for User Stories - go straight to "Closed" after PROD deploy.

---

**Last Updated:** 2026-01-12
