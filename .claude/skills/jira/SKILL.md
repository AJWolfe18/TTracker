# JIRA Integration Skill

## Description

Automatically use this skill when user wants to **interact** with JIRA.

**Trigger when user says things like:**
- "Review 376 for context" or "review TTRC-376" (query ticket for context)
- "Review 123" (any number = ticket ID, query it)
- "Create a card for [description]"
- "Create a ticket for [description]"
- "Create a bug for [issue]"
- "Create a story for [feature]"
- "What's the status of 376?"
- "Update the ticket to In Progress"
- "Transition to Done"
- "Add a comment to the ticket"
- "I'm done, update the ticket"
- "Close out the JIRA"

**Do NOT trigger when:**
- User just references a ticket in passing without asking to review/query it
- Discussing JIRA workflow concepts without needing actual queries

**Key patterns:**
- "review [number]" → Query that TTRC ticket for context
- "create a card/ticket" → Create new JIRA issue
- Any 3-digit number in context of work → Likely a ticket ID (TTRC-XXX)

---

## JIRA Instance Details (HARDCODED - use these directly)

```
Cloud ID:    f04decff-2283-43f1-8e60-008935b3d794
Project Key: TTRC
Project ID:  10035
Site URL:    https://ajwolfe37.atlassian.net
```

### Issue Type IDs (use these exact IDs when creating)

| Type | ID | When to Use |
|------|-----|-------------|
| **Story** | `10004` | DEFAULT - all dev work |
| **Bug** | `10046` | Something is broken |
| **Epic** | `10000` | Explicit request to group stories |
| Task | `10044` | NEVER USE |
| Sub-task | `10045` | NEVER USE |

### Status Workflow

`Backlog` → `In Progress` → `In Review` → `Ready for Test` → `Done`

---

## Purpose

Handle JIRA operations via subagent to isolate 20-30K token context cost. JIRA MCP tools return full ticket dumps - this skill processes internally and returns only summaries.

---

## Instructions

Launch a **Task tool (general-purpose subagent)** with the JIRA operation. The subagent will:

1. Execute the JIRA operation using MCP tools
2. Process the full response internally (absorbing the 20-30K tokens)
3. Return only a concise summary to main conversation

### Subagent Prompt Template

```
Execute JIRA operation: [DESCRIBE WHAT USER WANTS]

**USE THESE VALUES DIRECTLY (already known):**
- Cloud ID: f04decff-2283-43f1-8e60-008935b3d794
- Project Key: TTRC
- Story issue type ID: 10004
- Bug issue type ID: 10046
- Epic issue type ID: 10000

**MCP Tools:**
- mcp__atlassian__getJiraIssue(cloudId, issueIdOrKey) - Query ticket
- mcp__atlassian__transitionJiraIssue(cloudId, issueIdOrKey, transition) - Change status
- mcp__atlassian__addCommentToJiraIssue(cloudId, issueIdOrKey, commentBody) - Add comment
- mcp__atlassian__createJiraIssue(cloudId, projectKey, issueTypeName, summary, description) - Create issue
- mcp__atlassian__editJiraIssue(cloudId, issueIdOrKey, fields) - Update fields
- mcp__atlassian__searchJiraIssuesUsingJql(cloudId, jql) - Search

**Example - Query ticket:**
mcp__atlassian__getJiraIssue(cloudId="f04decff-2283-43f1-8e60-008935b3d794", issueIdOrKey="TTRC-376")

**Example - Create Story:**
mcp__atlassian__createJiraIssue(
  cloudId="f04decff-2283-43f1-8e60-008935b3d794",
  projectKey="TTRC",
  issueTypeName="Story",
  summary="Add feature X",
  description="Description here"
)

Return ONLY a summary in this format:
✅ TTRC-XXX: [Title]
Type: [Story/Bug/Epic] | Status: [Status]
Labels: [labels if any]
[Action taken or key finding]

Do NOT return full descriptions, comment history, or raw API responses.
```

---

## Issue Type Rules (STRICT)

When creating issues:

### Bug
Use ONLY when something existing is **broken**.
- Keywords: fix, broken, error, wrong, not working, crash, fail
- Example: "Duplicate articles appearing" → Bug

### Story (DEFAULT)
Use for **ALL other work**. When in doubt, use Story.
- Keywords: add, implement, create, build, enhance, improve, refactor, update
- Example: "Add entity-based dedup" → Story
- Example: "Improve clustering" → Story
- Example: "Update docs" → Story

### Epic
ONLY when user **explicitly** says "epic" or "initiative".
- Must be explicit request to group Stories
- Example: "Create an epic for Clustering V2" → Epic

### NEVER USE
- Task
- Sub-task

---

## Labels

Apply based on work area:
- `clustering` - Story clustering logic
- `rss` - RSS pipeline
- `ui` - Frontend/UI work
- `infra` - Infrastructure/DevOps
- `security` - Security hardening
- `docs` - Documentation

---

## Context Savings

Main conversation: ~100 tokens (summary only)
Subagent absorbs: 20-30K tokens (full JIRA response)
Savings: **99.5%**
