# JIRA Workflow Guide

TrumpyTracker uses a simplified JIRA workflow with just 3 issue types and labels for grouping.

## Issue Types

| Type | When to Use | Default? |
|------|-------------|----------|
| **Story** | ALL development work | YES |
| **Bug** | Something is broken | No |
| **Epic** | Groups related Stories | No (explicit only) |

**NOT USED:** Task, Sub-task

### Story (Default)

Use Story for everything unless it's a bug or epic:
- New features
- Improvements
- Refactoring
- Chores
- Documentation
- Any development work

**Keywords that indicate Story:** add, implement, create, build, enhance, improve, refactor, update, migrate

### Bug

Use Bug only when something existing is broken:
- Errors in production
- Unexpected behavior
- Crashes
- Data issues

**Keywords that indicate Bug:** fix, broken, error, wrong, not working, crash, fail, issue

### Epic

Use Epic to group related Stories into a feature initiative:
- Must be explicitly requested
- Contains multiple Stories
- Represents a major feature or goal

**Keywords that indicate Epic:** epic, initiative, feature (as a container)

---

## Labels

Use simple labels to group related Stories:

| Label | Purpose |
|-------|---------|
| `clustering` | Story clustering logic |
| `security` | Security hardening |
| `ui` | Frontend/UI work |
| `rss` | RSS pipeline |
| `infra` | Infrastructure/DevOps |
| `docs` | Documentation |

Labels are ad-hoc. Create new ones as needed using simple single words.

---

## Status Workflow

```
Backlog --> In Progress --> In Review --> Ready for Test --> Done
```

| Status | Meaning |
|--------|---------|
| **Backlog** | Not started, prioritized |
| **In Progress** | Actively being worked on |
| **In Review** | Code complete, AI review pending |
| **Ready for Test** | Deployed to test environment |
| **Done** | Verified, can deploy to prod |

---

## Examples

### Creating a Story (default)
```
/jira create "Add entity-based dedup to clustering" with label clustering
```
Result: Story in Backlog with `clustering` label

### Creating a Bug
```
/jira create bug "Duplicate articles appearing in feed"
```
Result: Bug in Backlog

### Creating an Epic
```
/jira create epic "Clustering V2 Improvements"
```
Result: Epic containing future Stories

### Adding Labels
```
/jira TTRC-XXX add label security
```

---

## Decision Tree

```
Is something broken?
├── YES → Bug
└── NO → Is this grouping multiple Stories?
    ├── YES → Epic
    └── NO → Story (default)
```

---

## Quick Reference

- **Story** = default for ALL work
- **Bug** = something broken
- **Epic** = explicit group only
- **Labels** = simple words (clustering, security, ui, rss, infra)
- **No Task/Sub-task** = don't use these

---

Last Updated: 2025-12-20
