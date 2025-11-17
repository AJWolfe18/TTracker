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
- **Transition**: Change ticket status (e.g., "To Do" → "In Progress" → "Done")
- **Comment**: Add comments to tickets
- **Create**: Create new tickets
- **Search**: Search tickets via JQL

**Important:**
1. Use appropriate MCP tools (getJiraIssue, transitionJiraIssue, addCommentToJiraIssue, etc.)
2. Process the full JIRA response internally (20-30K tokens)
3. Return **summary only** (~100 tokens):
   - Ticket ID and title
   - Current status
   - Key changes made
   - Any blockers or important notes
4. Do NOT return full descriptions, comment history, or metadata dumps

**Example Summary Format:**
```
✅ TTRC-268: Fix RSS duplicate articles
Status: In Progress → Done
Comment added: "Fixed url_hash composite key bug"
Notes: Had 3 linked tickets, all updated
```

## Usage Examples

```
/jira TTRC-268 get status
/jira TTRC-268 transition to Done
/jira TTRC-268 add comment "Fixed the RSS bug, tested with duplicates"
/jira create story "Add story reopening logic" in project TTRC
/jira search "project = TTRC AND status = 'In Progress'"
```

**Context Savings:** 20-30K tokens → ~100 tokens (99.5% reduction)
