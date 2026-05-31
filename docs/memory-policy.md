# Memory Policy

Single source of truth for what goes in the Memory MCP knowledge graph. CLAUDE.md, `/start-work`, and `/end-work` point here instead of restating these rules.

## Three tiers

| Tier | File | Read when | Holds |
|---|---|---|---|
| **Global** | `~/.claude-memory/global/memory.jsonl` | always (small) | identity, preferences, cross-project gotchas |
| **Project HOT** | `~/.claude-memory/ttracker/memory.jsonl` | always (small) | active work, conventions, pointers, reusable gotchas |
| **Project DEEP** | `~/.claude-memory/ttracker-archive/memory.jsonl` | **search only** (`search_nodes`/`open_nodes`) | closed-work history, full record |

DEEP is **never bulk-loaded** (`read_graph`). Search it by keyword only when a task touches old work.

## The filter — store an observation ONLY if:

> "Would the next session waste 5+ minutes without this, AND is it not already in ADO / git / code / a doc?"

If it fails either test → don't store it; point to the doc instead.

## STORE
- Durable facts, decisions + **WHY**, hard-won gotchas, pointers (ADO#, doc path, commit hash).

## NEVER STORE
- Ticket/work **status** → ADO
- **Metrics/spend/counts** (story counts, $/month) → query Supabase / budgets table
- Session **narrative** → `docs/handoffs/`
- Code patterns / file lists → code & git
- Anything already in CLAUDE.md

## Conventions
- `entityType` IS the category — controlled vocab: `profile` | `convention` | `gotcha` | `pointer` | `feature`.
- Volatile observations start with `[YYYY-MM-DD]`; durable facts stay undated.
- Pointer/feature entities: observation `[0]` is a META line — `tier | updated | ado | docs`.
- `active-work` is the "where we left off" anchor — **update it**, never spawn a new session-blob entity.

## Per-entity observation cap
- ~6 observations per entity.
- **EXCEPTION:** `entityType: gotcha` collections (e.g. `claude-agent-patterns`) are exempt — they're curated reference lists, not session logs.

## HOT vs DEEP — the demotion rule
- Demote to DEEP when the **work** is closed/done and rarely needed.
- **Live production systems stay HOT even if the ADO ticket is closed** (e.g. `scotus-agent`, `eo-agent` — running daily, referenced often). Test: *still running / still referenced? → HOT. Done and rarely needed? → DEEP.*

## /end-work does BOTH every session
1. **APPEND** new observations that pass the filter.
2. **CURATE** (this is what stops bloat): update/delete stale observations; enforce the cap; demote closed-work entities to DEEP (extract any reusable gotcha to HOT first).

## Safety — memory has NO version history (files are gitignored)
- Before ANY destructive operation (delete/overwrite), back up all three `memory.jsonl` files to `~/.claude-memory/_backups/<date>/`.
- After curation, re-read HOT and confirm it matches intent before finishing.
- Never `delete_entities` by guessing names — read the graph first. (Lesson learned 2026-05-30.)
