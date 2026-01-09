---
description: Interact with JIRA tickets via subagent (prevents 20K+ context bloat)
---

# JIRA Operations Command

Launch a Task tool (general-purpose) subagent to handle JIRA operations. This isolates the 20-30K tokens that JIRA MCP tools return, keeping the main conversation clean.

## Request

Process the following JIRA operation via subagent: $ARGUMENTS

## Subagent Instructions

You have access to Atlassian MCP tools. Execute the requested JIRA operation and return a **concise summary only** (not the full ticket dump).

**Available Operations:**
- **Query**: Get ticket details, status, assignee
- **Transition**: Change ticket status (e.g., "Backlog" → "In Progress" → "Done")
- **Comment**: Add comments to tickets
- **Create**: Create new tickets (see Issue Type Rules below)
- **Search**: Search tickets via JQL

---

## Issue Type Rules (STRICT)

When creating issues, you MUST follow these rules:

### Bug
Use ONLY when something existing is broken.
- **Keywords:** fix, broken, error, wrong, not working, crash, fail, issue
- Example: "Fix duplicate articles appearing" → Bug

### Story (DEFAULT)
Use for ALL other work. This is the default type.
- **Keywords:** add, implement, create, build, enhance, improve, refactor, update, migrate
- Any development work, improvements, chores, documentation
- Example: "Add entity-based dedup" → Story
- Example: "Improve clustering performance" → Story
- Example: "Update documentation" → Story

### Epic
ONLY when user explicitly requests grouping multiple Stories.
- **Keywords:** epic, initiative (must be explicit)
- User must say "create an epic" or "new initiative"
- Example: "Create epic for Clustering V2" → Epic

### NEVER USE
- Task - DO NOT create Tasks
- Sub-task - DO NOT create Sub-tasks

### Labels
Add labels based on the work area:
- `clustering` - Story clustering logic
- `security` - Security hardening
- `ui` - Frontend/UI work
- `rss` - RSS pipeline
- `infra` - Infrastructure/DevOps
- `docs` - Documentation

---

## Response Format

**Important:**
1. Use appropriate MCP tools (getJiraIssue, transitionJiraIssue, addCommentToJiraIssue, createJiraIssue, etc.)
2. When creating: Select type per rules above, add relevant labels
3. Process the full JIRA response internally (20-30K tokens)
4. Return **summary only** (~100 tokens):
   - Ticket ID and title
   - Issue type (Story/Bug/Epic)
   - Current status
   - Labels applied
   - Key changes made
   - Any blockers or important notes
5. Do NOT return full descriptions, comment history, or metadata dumps

**Example Summary Format:**
```
✅ TTRC-400: Add entity-based dedup
Type: Story | Labels: clustering
Status: Backlog
Created successfully
```

## Usage Examples

```
/jira TTRC-268 get status
/jira TTRC-268 transition to Done
/jira TTRC-268 add comment "Fixed the RSS bug, tested with duplicates"
/jira create "Add story reopening logic" with label rss
/jira create bug "Duplicate articles appearing in feed"
/jira create epic "Clustering V2 Improvements"
/jira TTRC-268 add label security
/jira search "project = TTRC AND status = 'In Progress'"
```

**Context Savings:** 20-30K tokens → ~100 tokens (99.5% reduction)

---

## Reference
See `/docs/guides/jira-workflow.md` for full workflow documentation.
