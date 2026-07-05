# Cloud-Agent Runbook

Canonical cross-agent mechanics for the Claude cloud agents (SCOTUS / EO / Pardons / Stories).

**Read this when BUILDING or DEBUGGING a cloud agent.** The compact one-liner gotchas stay in
the `claude-agent-patterns` memory entity (always loaded); this doc holds the deeper reference
material that only matters during active cloud-agent work, so it's read on demand, not every session.

---

## 1. RemoteTrigger API request shape

Verified against actual SCOTUS build history (`docs/handoffs/2026-04-03-ado-469-gold-set-validation.md`).

**Top-level `prompt` / `repositories` / `max_turns` / `ref` are REJECTED.** The real nesting:

| What | Where it goes |
|---|---|
| prompt | `job_config.ccr.events[].data.message.content` |
| model | `job_config.ccr.session_context.model` |
| repo | `job_config.ccr.session_context.sources[].git_repository.url` |

- Set everything on `create` — no separate update call needed for a fresh trigger.
- Use a **short bootstrap prompt** (`git fetch origin <branch> && git reset --hard origin/<branch>`,
  then read `prompt-vN.md` from the repo) rather than embedding the full prompt inline — message
  content has practical size limits, and the workspace is cached so the reset MUST run every single
  run, both TEST and PROD (no exception for "main is default").
- `action=update` needs the **FULL nested `job_config.ccr` object resent** (`environment_id`,
  `events`, `session_context` all together) to change even one field like `model` — partial/shallow
  merge on nested objects is not guaranteed.
- `persist_session:false` triggers are **stateless per `action=run`**: firing twice creates two
  independent full runs, not a continuation.
- The trigger object's own `created_at` / `updated_at` belong to the **trigger config**, NOT any
  individual run — don't use them to infer when a specific run fired.

## 2. Concurrency & monitoring patterns

**Preventing concurrent-run double-writes** (for entity tables with no analog to EO's
`prevent_enriched_at_update` trigger): use **optimistic PATCH filtering** instead of adding a new DB
trigger — filter on the exact timestamp/state value read at query time (e.g.
`last_enriched_at=eq.<value>` or `=is.null`). A losing race returns an empty PATCH response, which
reuses the same "empty response = write failed" handling every agent prompt already has.

**Heartbeat rows for high-frequency agents:** for log tables on sub-daily agents (e.g. Stories runs
12x/day), make the per-entity FK column nullable and write a **NULL-entity heartbeat row on
0-candidate runs** — otherwise monitoring queries that check "last completed row" false-alert on
legitimate empty cycles.

## 3. Read-only PROD verification (no SQL / MCP access)

Extract the PROD anon key from `public/supabase-browser-config.js` (intentionally public,
browser-facing) and hit PostgREST directly.

- **Distinguish "table missing" vs "table exists but anon has no grant":**
  - Genuinely missing table → PostgREST `could not find table in schema cache`.
  - Existing RLS-locked table (e.g. a fresh log table with no anon GRANT) → Postgres error
    **42501 `permission denied for table X`** — that 42501 IS proof the table exists.
- **Checking an agent's TRUE backlog/candidate count from outside its prompt:** replicate the
  **exact Step 2 query shape**, including any INNER JOIN filters (e.g.
  `article_story!inner(article_id)`). A simplified proxy (just `last_enriched_at IS NULL`)
  overcounts by including rows the agent correctly skips (e.g. orphan stories with no linked
  articles), producing a false "run stalled / backlog not draining" signal when the agent is fine.

## 4. Misc troubleshooting

- **Parsing a JSON log line extracted via `grep -o '"type":"X".*'`** (match starts mid-object, no
  opening brace, but DOES include the real closing brace): prepend only `"{"` before `JSON.parse` —
  do NOT also append `"}"`, or you get a double-closing-brace parse error ("Unexpected
  non-whitespace character after JSON").
