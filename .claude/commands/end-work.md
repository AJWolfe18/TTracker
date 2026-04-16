# End Work Command

Wrap up a development session: save state to memory, review code, commit, push, and update ADO.

## Usage

```
/end-work
```

## What This Does

When invoked, follow these steps in order:

### 1. Save Session State to Memory
Save the current session state to `memory-project` (project-specific memory). Create or update entities and observations for:
- **What was worked on** — ticket numbers, feature names, files changed
- **Where we left off** — current state of the work, what's done vs remaining
- **Decisions made** — any architecture, design, or approach decisions and WHY
- **What's next** — the immediate next steps for the next session
- **Blockers or issues** — anything unresolved

Also update `memory-global` if any new user preferences, feedback, or cross-project learnings were discovered during the session.

**The filter — only save what passes this test:**
> "Would the next session waste 5+ minutes without this info?"
> If yes → save it. If no → skip it.

**SAVE (not captured elsewhere):**
- Where we left off and what's next (ADO state alone doesn't tell the full story)
- WHY a decision was made (the code shows WHAT, not WHY)
- Non-obvious gotchas hit during the session
- User feedback or preference changes

**DON'T SAVE (derivable from other sources):**
- What files were changed (git log shows this)
- Code patterns or architecture (read the code)
- Step-by-step task details (ephemeral, use todos)
- Anything already in CLAUDE.md or ADO ticket description
- Exact code snippets (they go stale immediately)

**Keep it tight:**
- Max 3-5 observations per session save
- One sentence per observation, not paragraphs
- Update existing entities, don't create new ones for the same thing
- Delete observations that are no longer true
- Check for duplicates before writing

### 2. Code Review (Two-Pass)
Run BOTH code reviews on all changes made this session:
1. `Task(feature-dev:code-reviewer)` — pattern compliance, bugs, security
2. `Agent(superpowers:code-reviewer)` — production readiness, architecture, requirements alignment
- Fix any Critical/Important findings before proceeding
- Skip BOTH only for: typo fixes, single-line changes, config tweaks

### 3. QA Tests
Run relevant test suite:
- `npm run qa:smoke` for general changes
- Specific test suite if applicable

### 4. AC Verification (if ADO ticket involved)
Before any state change:
- Fetch acceptance criteria via `/ado`
- Verify EVERY AC bullet as MET/NOT MET
- Do NOT advance with unmet AC

### 5. Commit and Push
- Stage relevant files
- Commit with clear message
- Push to test branch

### 6. Update ADO
- Move ticket to appropriate state (only after AC verification)
- Add comment if needed

### 7. Confirm Completion
Summarize what was saved to memory and what the next session should pick up.
