# Session Handoff: MCP Context Optimization (Jira/ADO)

**Date:** 2026-07-25
**Ticket:** None (tooling/infra session, no ADO ticket)
**Branch:** test

## What This Session Did

Josh asked how to cut the context cost of Jira MCP at work. We researched current
community patterns, then set up and tested the equivalent optimizations here.

### Machine-level setup (not in repo)
- `~/.claude/settings.json`: added `MAX_MCP_OUTPUT_TOKENS=15000` env var —
  truncates oversized MCP results. Takes effect on session restart. If a bulk
  ADO query ever comes back clipped, raise or remove this.
- `~/.claude/commands/jira.md`: NEW global Jira wrapper command (works in any
  project on this machine) with summary mode + detail mode + agent-reuse note.
- Handoff file for Josh's work machine delivered via chat:
  prompt + findings + reference jira.md for work Claude to adapt.

### Repo changes (.claude/skills/ado/SKILL.md)
Routing by operation type, cheapest first:
1. **Reads** → direct REST + jq (no subagent, ~0.5–2K tokens; full card incl.
   description). PAT helper `ado_pat()` tries all candidate token locations and
   uses the first that authenticates (dead ADO PATs return **203** + sign-in
   page, NOT 401 — they fail silently).
2. **Writes** → subagent, spawned once per session as `name: "ado-agent"`,
   reused via `SendMessage` (avoids ~45K startup per op).
3. Detail mode added: full cleaned card content (~1–2K tokens) instead of
   100-token summary when implementing from a ticket.

## Measured Results (ADO-537 test)
| Route | Main-window cost |
|---|---|
| Subagent summary | ~90 tokens (subagent absorbed ~45K in throwaway context) |
| Direct REST + jq full card | ~450 tokens |
| Direct MCP call | ~1,400 tokens (20–30K for big tickets) |

## Key Concepts (for future sessions)
- Main-window context and total token spend are DIFFERENT budgets. Subagents
  spend the cheap cached throwaway budget; direct MCP calls spend the scarce one.
- ~90% of a Jira/ADO MCP response is JSON scaffolding, not card content.
- Community state of the art: Anthropic "code execution with MCP" (98.7%
  reduction), Cloudflare Code Mode, Atlassian mcp-compressor proxy, Claude Code
  Tool Search (deferred schemas — already active on this machine).

## Gotchas Discovered
- `~/.claude.json` has TWO TTracker project entries: backslash-path key (stale
  PAT `2KgMu6...`) and forward-slash key. Never extract the PAT by recursive
  first-match; the SKILL.md `ado_pat()` helper handles this by testing each
  candidate. Cleanup candidate: delete the backslash entry while Claude Code is
  fully closed.
- Dead ADO PATs return HTTP 203 (sign-in page), not 401 — looks like "work item
  not found" if unchecked.
- TWO Claude sessions were active on this repo tonight; the other session
  (Opus 5) committed the first round of SKILL.md edits (27ae8b2) and improved
  the PAT helper. If both sessions run /end-work, check `git log` before
  committing to avoid duplicate work.

## Verification Steps for Josh
1. Restart Claude Code → `MAX_MCP_OUTPUT_TOKENS` becomes active.
2. Fresh session → `/context` baseline → `/ado 537 get status` → `/context`
   again; delta should be a few hundred tokens.
3. At work: paste the delivered handoff file to work Claude, have it report
   measured before/after numbers.

## Not Done / Next Session
- No ADO ticket was created for this work (tooling only — create one if you
  want it tracked).
- Optional cleanup: stale backslash TTracker entry in `~/.claude.json`.
