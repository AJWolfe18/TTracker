# TrumpyTracker Docs Map

Entry point for the documentation. Organized loosely by [Diátaxis](https://diataxis.fr/) type (how-to / reference / explanation — no tutorials; this is an internal project).

## Start here
- **Architecture (high-level)** → [ARCHITECTURE.md](ARCHITECTURE.md)
- **Why decisions were made** (ADRs) → [decisions/](decisions/)
- **Project rules / branching / workflow** → [../CLAUDE.md](../CLAUDE.md)

## By need
| I want to… | Go to |
|---|---|
| Do a repeatable task (RSS trigger, Supabase update, PROD deploy) | [how-to/](how-to/) — *and* `guides/` until relabeled |
| Look up a fact (schema, enums, env/secrets) | [reference/](reference/) *(being populated)* — *and* `database/` meanwhile |
| Understand how a subsystem works | `architecture/` *(will become* `explanation/`*)* |
| Read session history | [handoffs/](handoffs/) |
| See active feature plans/PRDs | [features/](features/) |

## Other key docs
- Product vision & voice → [PRODUCT_VISION.md](PRODUCT_VISION.md)
- Working agreements / communication → [PROJECT_INSTRUCTIONS.md](PROJECT_INSTRUCTIONS.md)
- Memory MCP rules → [memory-policy.md](memory-policy.md)
- Tone system (single source of truth) → `../public/shared/tone-system.json`

> **Note (2026-05-30):** `how-to/`, `reference/`, `explanation/` are being adopted going forward. Existing docs in `guides/`, `database/`, `architecture/` stay valid until a later relabeling pass. Do NOT create docs in the `/docs/` root — use a subdirectory.
