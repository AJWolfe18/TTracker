# Handoff — Memory 3-tier + docs-as-code restructure (2026-05-30)

## What this session did
Restructured the Memory MCP from an append-only journal into a curated **3-tier**
system, and stood up a **docs-as-code** layer. No application code changed — this
is workflow/infra/docs only.

## Memory: before → after
- **Before:** project memory = 23 sprawling entities, ~65KB, bulk-read every session (~16K stale tokens/session).
- **After:**
  - **Global** (`~/.claude-memory/global/`) — 4 entities, always read.
  - **Project HOT** (`ttracker/`) — ~10 curated entities (pointers/gotchas/features), always read. ~8KB.
  - **Project DEEP** (`ttracker-archive/`) — all 23 originals preserved, **search-only**, never bulk-loaded.
  - Always-loaded dropped **~75KB → ~14KB (81%)**.
- Nothing was lost: HOT entities are *synthesized summaries*; DEEP holds the full raw history.

## Key files created
- `docs/memory-policy.md` — single home for memory rules (3 tiers, filter, conventions, safety, "DEEP is append-and-correct, never tidy-trim").
- `docs/ARCHITECTURE.md` — high-level map + Mermaid pipeline.
- `docs/decisions/0001-claude-agents-over-gpt-pipelines.md` — first ADR.
- `docs/how-to/supabase-update.md`, `docs/README.md` (doc map), `llms.txt` (agent doc map).
- `docs/2026-05-30-memory-docs-redesign-proposal.md` — the full design/decision record.

## Workflow files updated (all consistent now)
- `.claude/commands/start-work.md` — tiered read (Global+HOT only; DEEP search-on-demand).
- `.claude/commands/end-work.md` — append **+** curate, backup-first safety, conditional living-docs step.
- `CLAUDE.md` — 3-tier memory section + TLDR/checklist; fixed stale tech-stack (Vanilla JS → Vite/React/TS); removed hardcoded metrics; added DISCORD_WEBHOOK_URL + COURTLISTENER_API_TOKEN to secrets table.
- `.claude/settings.json` — added `mcp__memory-deep__*` permissions; updated post-commit hook reminder.
- `.mcp.json` — added `memory-deep` server (gitignored; machine-local).

## Gotchas / lessons (this session)
- **Edits can silently fail** — two `Edit`/`Write` calls this session no-opped (wrong match / unread file). Always verify after writing. This is now baked into `/end-work`.
- **Memory files are gitignored → no version history.** Always back up to `~/.claude-memory/_backups/<date>/` before destructive ops. (A near-wipe early this session was caught only because a snapshot happened to exist.)
- The off-the-shelf `@modelcontextprotocol/server-memory` has a fixed schema (name/entityType/observations) — structure is by convention, not columns.

## ⚠️ Next session MUST do first
1. **Fully quit + reopen Claude Code** — `memory-deep` only connects at startup (`/mcp reconnect` won't load a new server).
2. Confirm 3 memory servers connected; `search_nodes` memory-deep to verify the archive is queryable.
3. Confirm the **DEEP reconstruction** (parallel session: tag all 23 entities `tier:archived`, add-only) completed.

## Open threads (also in `active-work` HOT entity)
- Pardons agent (ADO-516) — next = S1/ADO-518 migration 094; PR #94 must merge before S5.
- social-share blocker — Netlify PROD env vars still on TEST values (ADO #515).
- Worth a ticket: PROD Supabase storage 570MB > 500MB limit; 47 unused indexes.
- Deferred: relabel existing `guides/`/`database/`/`architecture/` into `how-to/`/`reference/`/`explanation/`; dedicated CLAUDE.md trim pass.
- `.agents/` — stale Codex-generated TTracker skills duplicate, untracked; left alone intentionally.

## Backups for rollback
`~/.claude-memory/_backups/2026-05-30/` and `2026-05-30-endwork/` (global 6219b, ttracker, archive 67786b). Safe to delete once next session confirms everything's healthy.
