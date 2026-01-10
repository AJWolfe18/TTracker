# Azure DevOps Integration Skill

## Description

Automatically use this skill when user wants to **interact** with Azure DevOps (ADO).

**Trigger when user says things like:**
- "Check ADO item 123" or "look at work item 123"
- "Create a work item for [description]"
- "Create a story in ADO for [feature]"
- "Create a bug in ADO for [issue]"
- "What's the status of ADO 123?"
- "Update the ADO item to Active"
- "Search ADO for [query]"
- "Export ADO backlog"
- "How many items in ADO?"

**Do NOT trigger when:**
- User just references an ADO item in passing without asking to query it
- Discussing ADO workflow concepts without needing actual queries
- Working with JIRA (use JIRA skill instead)

**Key patterns:**
- "ADO [number]" or "work item [number]" → Query that ADO work item
- "create in ADO" or "add to ADO" → Create new work item
- "search ADO" → Search work items
- "export ADO" → Export backlog to file

---

## ADO Instance Details (HARDCODED - use these directly)

```
Project:      TTracker
Organization: (inferred from MCP connection)
```

### Work Item Type Mappings

| JIRA Type | ADO Type | When to Use |
|-----------|----------|-------------|
| **Epic** | `Epic` | Grouping stories |
| **Story** | `User Story` | DEFAULT - all dev work |
| **Bug** | `Bug` | Something is broken |
| **Task** | `Task` | Sub-work items (rare) |

### State Mappings (JIRA → ADO)

| JIRA Status | ADO State |
|-------------|-----------|
| Backlog | New |
| To Do | New |
| In Progress | Active |
| In Review | Active |
| Ready for Test | Active |
| Done | Closed |

---

## Purpose

Handle ADO operations via subagent to isolate 20-30K token context cost. ADO MCP tools return full work item details - this skill processes internally and returns only summaries.

---

## Instructions

Launch a **Task tool (general-purpose subagent)** with the ADO operation. The subagent will:

1. Execute the ADO operation using MCP tools
2. Process the full response internally (absorbing the 20-30K tokens)
3. Return only a concise summary to main conversation

### Subagent Prompt Template

```
Execute ADO operation: [DESCRIBE WHAT USER WANTS]

**USE THESE VALUES DIRECTLY (already known):**
- Project: TTracker

**MCP Tools:**
- mcp__azure-devops__wit_get_work_item(project, id) - Get single work item
- mcp__azure-devops__wit_get_work_items_batch_by_ids(project, ids) - Get multiple items
- mcp__azure-devops__wit_create_work_item(project, workItemType, fields) - Create item
- mcp__azure-devops__wit_update_work_item(id, updates) - Update item
- mcp__azure-devops__search_workitem(searchText, project) - Search items
- mcp__azure-devops__wit_my_work_items(project) - Get my items
- mcp__azure-devops__wit_work_items_link(project, updates) - Link items

**Example - Query work item:**
mcp__azure-devops__wit_get_work_item(project="TTracker", id=123)

**Example - Create User Story:**
mcp__azure-devops__wit_create_work_item(
  project="TTracker",
  workItemType="User Story",
  fields=[
    {"name": "System.Title", "value": "Feature title here"},
    {"name": "System.Description", "value": "Description here"},
    {"name": "System.Tags", "value": "jira:TTRC-XXX"}
  ]
)

**Example - Update work item:**
mcp__azure-devops__wit_update_work_item(
  id=123,
  updates=[
    {"path": "/fields/System.Description", "value": "New description"}
  ]
)

**Example - Search:**
mcp__azure-devops__search_workitem(searchText="clustering", project=["TTracker"])

Return ONLY a summary in this format:
[ADO #ID]: [Title]
Type: [Epic/User Story/Bug/Task] | State: [New/Active/Closed]
Tags: [tags if any]
[Action taken or key finding]

Do NOT return full descriptions, field dumps, or raw API responses.
```

---

## Work Item Type Rules (STRICT)

When creating work items:

### Bug
Use ONLY when something existing is **broken**.
- Keywords: fix, broken, error, wrong, not working, crash, fail
- Example: "Duplicate articles appearing" → Bug

### User Story (DEFAULT)
Use for **ALL other work**. When in doubt, use User Story.
- Keywords: add, implement, create, build, enhance, improve, refactor, update
- Example: "Add entity-based dedup" → User Story
- Example: "Improve clustering" → User Story

### Epic
ONLY when user **explicitly** says "epic" or "initiative".
- Must be explicit request to group Stories
- Example: "Create an epic for Clustering V2" → Epic

### Task
Rare - only for sub-items of stories.
- Example: Specific implementation tasks within a story

---

## Common Field Paths

| Field | Path |
|-------|------|
| Title | `/fields/System.Title` |
| Description | `/fields/System.Description` |
| State | `/fields/System.State` |
| Tags | `/fields/System.Tags` |
| Area Path | `/fields/System.AreaPath` |
| Iteration Path | `/fields/System.IterationPath` |
| Parent | `/relations/-` (link type) |

---

## Bulk Operations

For operations involving many items (export, batch create, batch update):

1. Launch subagent with clear batch instructions
2. Have subagent write results to file (e.g., `scripts/ado-export.json`)
3. Return only count/summary to main conversation

Example bulk export prompt:
```
Export ALL work items from TTracker project to scripts/ado-export.json.

For each item extract:
- id, title, type, state, tags, description (first 200 chars), parentId

Use mcp__azure-devops__search_workitem with project=["TTracker"] and top=1000.
Save results to file using mcp__filesystem__write_file.
Return only: "Exported X items to scripts/ado-export.json"
```

---

## Context Savings

Main conversation: ~100 tokens (summary only)
Subagent absorbs: 20-30K tokens (full ADO response)
Savings: **99.5%**
