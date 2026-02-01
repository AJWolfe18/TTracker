# Start Work Command

Kickstart development on a task with built-in review and workflow setup.

## Usage

```
/start-work <paste your task prompt here>
```

## What This Does

When invoked, follow these steps in order:

### 1. Review the Task
Read and analyze the provided prompt:

```
$ARGUMENTS
```

- Identify referenced files/components
- Check for clarity and completeness
- Flag any ambiguities or missing info

### 2. Expert Review
As a senior dev and QA reviewer:
- Verify alignment with project patterns (check `/docs/code-patterns.md`)
- Check for potential issues or anti-patterns
- Ensure scope is clear and achievable in one session

### 3. If Issues Found
- List concerns clearly
- Ask clarifying questions via AskUserQuestion
- Wait for resolution before proceeding

### 4. If No Issues - Setup Workflow
Create a TodoList with full workflow:
- [ ] Implementation tasks (from the prompt)
- [ ] Run code review: `Task(feature-dev:code-reviewer)`
- [ ] Run QA tests: `npm run qa:smoke` or relevant suite
- [ ] Commit changes
- [ ] Update ADO (move to Active/Testing as appropriate)
- [ ] Create handoff doc

### 5. Update ADO
Use `/ado` command to move the relevant ticket to Active state.

### 6. Begin Development
Start executing the todolist items sequentially.

---

## Example

```
/start-work ADO-310: Add retry logic to RSS fetcher. See docs/features/rss-enrichment/retry-plan.md for the approach. Should handle 429 and 503 errors with exponential backoff.
```

This will review the task, check the plan file, create todos, update ADO-310 to Active, and begin implementation.
