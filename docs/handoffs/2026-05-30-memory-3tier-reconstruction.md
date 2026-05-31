# Handoff — Memory 3-Tier DEEP Reconstruction + Backup-Policy Refinement

**Date:** 2026-05-30
**Session type:** Memory-infrastructure maintenance (no code, no ADO ticket)
**Branch:** test

## What this session did

### 1. Reconstructed the DEEP archive (`~/.claude-memory/ttracker-archive/`)
The archive held a raw verbatim copy of 23 old entities with no tier tags. Cleaned into a proper archive:
- **All 23 entities** now carry a `META | tier:archived | updated:2026-05-30 | <ado#/doc/commit>` line at observation `[0]`, so `search_nodes` hits self-identify as archive and point back to ADO/docs/HOT.
- **5 entities with a HOT counterpart** flagged `superseded-by HOT <entity>`: `scotus-claude-agent`→scotus-agent, `ADO-476-eo-claude-agent`→eo-agent, `pardons-claude-agent-epic`→pardons-agent, `tone-system`→tone-system, `TTracker-Rules`→conventions.
- **`TTracker-Rules`** (the one genuine full-duplicate of HOT `conventions`) trimmed to a 2-line stub — rule text lives verbatim in HOT, so no history lost.
- Light dating: `[YYYY-MM-DD]` added only where derivable from real data (repo-cleanup ×3 = 2026-04-13; prod-ui-deployment ×2 = 2026-05-21). No fabricated dates.
- **Verified:** 23 entities, 0 original observations lost (diffed vs backup), valid JSON, +23 obs (one META each). Confirmed live via MCP `search_nodes`.

> **Premise correction:** the original ask assumed "9 HOT entities duplicated verbatim in DEEP → 9 dupes + 14 archived-only." The real data was **5 with-counterpart / 18 archived-only** — HOT entities are *new curated summaries under different names*, not verbatim copies. Surfaced and approved before writing.

### 2. Fixed 3 HOT inconsistencies (`~/.claude-memory/ttracker/`)
- `scotus-agent` + `eo-agent` were tagged `tier:warm` (no such tier exists; policy §43 names them as the canonical "live-prod stays HOT" examples) → corrected to `tier:hot`.
- `pardons-agent` META line was at obs `[1]` → moved to `[0]` per convention.
- `active-work`'s last obs was stale ("memory-deep needs a RESTART"; "reconstruction finalized in a parallel session — confirm it completed") → rewritten to record reconstruction **COMPLETE + verified**.

### 3. Refined the backup policy (was overkill)
Backing up all three memory files every session — even on appends — was wasteful. Tightened in `docs/memory-policy.md` (§Safety) and `.claude/commands/end-work.md` (§1):
- **Appends need no backup** (can't lose data).
- **Destructive ops back up only the one file being mutated**, not all three (curate HOT → `ttracker` only; demote → `ttracker-archive` only).

## State / verification
- HOT: 9 entities / 9 relations, all `tier:hot` META at `[0]`, zero `tier:warm`.
- DEEP: 23 entities, all `tier:archived` META at `[0]`, 0 obs lost.
- Backups (this session's destructive ops): `~/.claude-memory/_backups/2026-05-30/`.
- `/start-work` + `/end-work` skills reviewed — both already consistent with the 3-tier model; only the backup-policy line changed.

## Next session
- Nothing pending from this work. The `active-work` anchor accurately shows the reconstruction as complete — do **not** re-run it.
- Concurrent session handled Supabase security hardening (migrations 095/096, PRs #96/#98) — see its own handoff `2026-05-30-supabase-security-hardening-095-096.md`.
- Watch for HOT fat-obs creep at future `/end-work` (a few obs are 300–600 chars; compress to pointers when their work closes).
