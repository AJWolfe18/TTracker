# Azure DevOps Workflow Guide

**Project:** TTracker
**URL:** https://dev.azure.com/AJWolfe92/TTracker

---

## ADO is the Source of Truth

- **Status lives in ADO** - not in plan docs, not in handoffs
- **Issues/blockers go in ADO** - add as comments or update description
- **Plan links go in ADO** - add `/docs/features/[feature]/plan.md` link to description
- Plans are for implementation details, ADO is for tracking

---

## Work Item Types

| Type | Use When |
|------|----------|
| **Epic** | Major product area (e.g., SCOTUS Tracker, Pardons Tracker) |
| **Feature** | Functional area within an Epic (grouping concept) |
| **User Story** | Any dev work that fits in 1 Claude Code session |
| **Bug** | Something is broken |
| **Task** | Sub-item of a story (optional, rarely used) |

---

## Status Workflow (Simplified)

```
New → Todo → Active → Testing → Ready for Prod → Closed
```

| State | Meaning | Move here when... |
|-------|---------|-------------------|
| **New** | Just created, not prioritized | Initial creation |
| **Todo** | Ready to work on, in backlog | Prioritized for upcoming work |
| **Active** | Currently being worked on | Starting a session on this item |
| **Testing** | On test branch, ready for verification | See "Definition of Testing" below |
| **Ready for Prod** | Verified on test, awaiting deploy | Manual verification passed on test site |
| **Closed** | Done - deployed to PROD | PR merged to main, feature flag flipped (if applicable) |

**Removed:** Review (rarely used), Done sub-columns (not used)

---

## Definition of "Testing" State

Move a story to **Testing** when ALL of these are true:

- [ ] Code committed and pushed to `test` branch
- [ ] Acceptance criteria pass (you verified the feature works)
- [ ] Code review completed (`Task(feature-dev:code-reviewer)`) - unless trivial change
- [ ] Lint PROD References passes (automatic on push)
- [ ] Deployed to test site (automatic via Netlify)

**Testing ≠ "I'm testing"** - it means "code is done, deployed, ready for someone to verify"

---

## Quick Command Reference

Use `/ado` command for all operations:

```
/ado 123 get status          # Query work item
/ado 123 set state Active    # Update state
/ado 123 set state Testing   # Mark ready for test
/ado create story "Title"    # Create new story
/ado search "clustering"     # Search work items
```

Full syntax: `.claude/commands/ado.md`

---

## Epic > Feature > Story Hierarchy

```
Epic: SCOTUS Tracker
├── Feature: Case Data Pipeline
│   ├── Story: Fetch cases from CourtListener API
│   ├── Story: Enrich cases with GPT analysis
│   └── Story: Schedule automated sync
├── Feature: Frontend Display
│   ├── Story: Case list page
│   └── Story: Case detail modal
└── Feature: Impact Scoring
    └── Story: Calculate and display impact scores
```

---

## Story Sizing: 1 Story = 1 Session

**Core Principle:** A Story must be completable in a single Claude Code session.

| Fits in 1 session? | Guideline |
|--------------------|-----------|
| ✅ Yes | Single focus, 1-3 files, clear acceptance criteria |
| ✅ Yes | DB migration + edge function OR UI component (not both) |
| ✅ Yes | Bug fix with known root cause |
| ❌ No, split it | Multiple unrelated changes |
| ❌ No, split it | Full stack (DB + API + UI) for new feature |
| ❌ No, split it | Requires research/exploration first |

---

## Before Creating a Story

Verify:
1. Acceptance criteria are explicit (not "make it work")
2. Dependencies are done (no blockers)
3. Technical approach is decided (no research needed)
4. Scope fits: Can you describe the changes in <5 sentences?

---

## Recording Issues/Blockers

When you hit a blocker or find an issue:

1. **Add comment to ADO ticket** - not in plan doc or handoff
2. **Update description** if scope changed
3. **Create child Bug** if it's a separate issue to fix
4. **Flag user** if decision needed

---

## Labels

Common labels: `clustering`, `security`, `ui`, `rss`, `infra`, `docs`, `scotus`, `pardons`

---

**Last Updated:** 2026-01-24
