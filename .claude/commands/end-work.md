# End Work Command

Wrap up a development session: save state to memory, review code, commit, push, and update ADO.

## Usage

```
/end-work
```

## What This Does

When invoked, follow these steps in order:

### 1. Update Memory (append + curate — per `docs/memory-policy.md`)

**SAFETY FIRST (memory files are gitignored — no version history):**
Before deleting or overwriting any observation, back up all memory.jsonl files to
`C:\Users\Josh\.claude-memory\_backups\<YYYY-MM-DD>\` (global, ttracker, ttracker-archive).
Never `delete_entities` by guessing names — read the graph first.

**The filter — store an observation ONLY if:**
> "Would the next session waste 5+ minutes without this, AND is it not already in ADO / git / code / a doc?"
> If it fails either test → don't store it; point to the doc instead.

Do BOTH every session:

**APPEND** (Global + Project HOT):
- New decisions made this session and **WHY** (highest value)
- New durable conventions or gotchas discovered
- Update the `active-work` anchor: what's live + next step (NOT status — that's ADO)
- Update `memory-global` only for new user preferences / cross-project learnings

**CURATE** (mandatory — this is what stops bloat):
- Delete/update observations this session made stale
- Cap each entity at ~6 observations (entityType `gotcha` collections exempt); if a feature
  log is growing, trim it to a pointer
- If WORK CLOSED this session: extract any reusable gotcha to HOT, then move the entity to
  `memory-deep` (archive). **Live production systems stay HOT even if the ticket is closed.**
- Never duplicate across Global / HOT / DEEP

**Conventions:** entityType = category (`profile|convention|gotcha|pointer|feature`);
`[YYYY-MM-DD]` prefix on volatile observations; pointer/feature entities lead with a
META line (`tier | updated | ado | docs`).

**Hard limits:** max 3-5 new observations per session; one sentence each.

### 1a. Update living docs (ONLY if system shape changed)
If this session changed schema, a pipeline, an API/contract, or system structure:
- Update `docs/ARCHITECTURE.md` (and the Mermaid flow if data flow changed)
- Update the affected `docs/explanation/` or `docs/reference/` (or `docs/architecture/`, `docs/database/`) file
- If a real architecture DECISION was made, add an ADR to `docs/decisions/`
Skip entirely for bugfixes, UI tweaks, copy changes, or config edits.

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
