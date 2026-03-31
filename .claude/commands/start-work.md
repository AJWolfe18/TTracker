# Start Work Command

Kickstart development on a task with built-in review and workflow setup.

## Usage

```
/start-work <paste your task prompt here>
```

## What This Does

When invoked, follow these steps in order:

### 1. Read Memories
Before anything else, read from both memory MCP servers:
- `memory-global` — user profile, preferences, cross-project context
- `memory-project` — where we left off, active tickets, recent decisions

Use this context to understand the current state before reviewing the task.

### 2. Review the Task
Read and analyze the provided prompt:

```
$ARGUMENTS
```

- Identify referenced files/components
- Check for clarity and completeness
- Flag any ambiguities or missing info

### 3. Expert Review
As a senior dev and QA reviewer:
- Verify alignment with project patterns (check `/docs/code-patterns.md`)
- Check for potential issues or anti-patterns
- Ensure scope is clear and achievable in one session

### 4. If Issues Found
- List concerns clearly
- Ask clarifying questions via AskUserQuestion
- Wait for resolution before proceeding

### 5. If No Issues - Setup Workflow
Create a TodoList with full workflow:
- [ ] Implementation tasks (from the prompt)
- [ ] Run code review: `Task(feature-dev:code-reviewer)`
- [ ] Run QA tests: `npm run qa:smoke` or relevant suite
- [ ] Commit changes
- [ ] **AC verification before ANY state change**: Before moving the ADO ticket to ANY new state (Active→Testing, Testing→Ready for Prod, etc.), fetch the story's acceptance criteria via `/ado`. Verify EVERY AC bullet as MET/NOT MET against the actual code/output. Do NOT advance any story with unmet AC — either fix the gap or document it on the card. This is a HARD GATE — no exceptions.
- [ ] Update ADO (move to appropriate state only after AC verification passes)
- [ ] Run `/end-work` to save session state, commit, and push

### 6. Update ADO
Use `/ado` command to move the relevant ticket to Active state.

### 7. Begin Development
Start executing the todolist items sequentially.

---

## Example

```
/start-work ADO-310: Add retry logic to RSS fetcher. See docs/features/rss-enrichment/retry-plan.md for the approach. Should handle 429 and 503 errors with exponential backoff.
```

This will review the task, check the plan file, create todos, update ADO-310 to Active, and begin implementation.
