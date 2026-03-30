# ======================================================
# INFRASTRUCTURE: Memory MCP Knowledge Graph Setup
# This is NOT a normal ticket handoff -- this documents
# a foundational change to how Claude sessions work.
# Reference this whenever memory behavior seems off.
# ======================================================

## What Changed (Mar 28, 2026)

Replaced Claude's built-in auto-memory (MEMORY.md + file-based) with a **Knowledge Graph MCP** (`@modelcontextprotocol/server-memory`) using two separate servers for global vs project-scoped memory.

## Architecture

```
memory-global  (user-level ~/.claude/.mcp.json)
  -> C:\Users\Josh\.claude-memory\global\memory.jsonl
  -> Shared across ALL projects
  -> Stores: user profile, preferences, feedback, cross-project patterns

memory-project (project-level .mcp.json)
  -> C:\Users\Josh\.claude-memory\ttracker\memory.jsonl   (TTracker)
  -> C:\Users\Josh\.claude-memory\whiskeypal\memory.jsonl  (WhiskeyPal)
  -> Isolated per project
  -> Stores: where we left off, decisions + WHY, gotchas, next steps
```

## What Was Created/Modified

| File | What |
|------|------|
| `~/.claude/.mcp.json` | NEW — global memory MCP server config |
| `TTracker/.mcp.json` | NEW — project memory MCP server config |
| `WhiskeyPal .mcp.json` | UPDATED — added project memory MCP |
| `.claude/commands/start-work.md` | UPDATED — step 1 is now "read memories" |
| `.claude/commands/end-work.md` | NEW — saves memory, reviews, commits, pushes, updates ADO |
| `.claude/settings.json` | UPDATED — disabled auto-memory, added post-commit hook |
| `CLAUDE.md` | UPDATED — memory MCP instructions, updated workflow |
| `.gitignore` | UPDATED — added `.mcp.json` (machine-specific paths) |
| `C:\Users\Josh\.claude-memory\` | NEW — memory storage directories |

## How Sessions Work Now

**Start:** `/start-work` reads `memory-global` + `memory-project` before anything else
**During:** Say "remember X" for mid-session saves
**End:** `/end-work` saves state (max 3-5 observations), reviews code, commits, pushes, updates ADO
**Safety net:** Post-commit hook reminds Claude to save state on every `git commit`

## Key Rules (in CLAUDE.md + end-work.md)

- Save only what the next session would waste 5+ minutes rediscovering
- Don't save what's in git log, code, CLAUDE.md, or ADO
- Max 3-5 observations per session save
- Update existing entities, don't duplicate
- Delete stale observations
- Built-in auto-memory is OFF — only use MCP knowledge graph

## Also Done This Session

- CLAUDE.md audit via `/claude-md-improver` — scored 80/100 (B), fixed 6 stale handoff references, updated to 87/100 (B+)
- Deleted unused `.claude/hooks/post-commit-memory.sh` (hook is inline in settings.json)
- Added `.mcp.json` to `.gitignore` (contains machine-specific Windows paths)
- Old auto-memory files (`~/.claude/projects/.../memory/`) left in place as fallback — can delete later

## If Memory Seems Broken

1. Check MCP servers loaded: look for `memory-global` and `memory-project` in tool list
2. Check files exist: `C:\Users\Josh\.claude-memory\ttracker\memory.jsonl`
3. Verify settings: `autoMemoryEnabled: false` in `.claude/settings.json`
4. Restart Claude Code (MCP servers load at startup)

## Adding a New Project

1. Create dir: `C:\Users\Josh\.claude-memory\<project-name>\`
2. Add to project's `.mcp.json`:
```json
{
  "mcpServers": {
    "memory-project": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-memory"],
      "env": {
        "MEMORY_FILE_PATH": "C:\\Users\\Josh\\.claude-memory\\<project-name>\\memory.jsonl"
      }
    }
  }
}
```
3. `memory-global` is already available (user-level config)
