# 2026-08-18 — /doctor Config Cleanup Session

**Type:** Tooling/config maintenance (no ADO ticket, no product code touched)
**Scan basis:** 23 session transcripts, Jul 19 – Aug 18, 2026

## What was done

### Committed to git (this commit)
- **CLAUDE.md slimmed** 26,334 → ~23,900 chars (~650 est. resident tokens/session saved):
  - Removed stale `mcp__filesystem__edit_file` / str_replace guidance (built-in Edit tool used 349× in 30 days with zero failures; filesystem MCP used once)
  - Removed derivable `npm run` command block (lives in package.json scripts)
  - Migrated three always-loaded reference sections out, pointers left behind:
    - GitHub Secrets table → `docs/guides/prod-deployment-checklist.md` (SERVICE_KEY→SERVICE_ROLE_KEY gotcha kept inline)
    - Cost-per-operation + spend-check SQL → `docs/guides/budget-enforcement.md` (NEW file; hard limits kept inline)
    - RSS compliance-rules SQL + mechanics → `docs/database/database-schema.md` §feed_compliance_rules
  - Added note that scotus skills may be disabled locally (see below)

### NOT in git — settings changes on Josh's machine
| Change | File | Undo |
|--------|------|------|
| Disabled 5 duplicate/unused plugins (security-guidance@official, feature-dev@claude-code-plugins, code-review ×2, context7) | `~/.claude/settings.json` enabledPlugins | `/plugin` or flip to `true` |
| Disabled autofix-bot | `.claude/settings.local.json` enabledPlugins | flip to `true` (project settings still enable it by default) |
| Disabled scotus-fetch + scotus-review skills (paused until SCOTUS work resumes) | `.claude/settings.local.json` skillOverrides | delete the two entries |
| Disabled filesystem MCP server (this project) | `~/.claude.json` disabledMcpServers | `/mcp enable filesystem` |
| Removed bare `Bash` allow rule (pre-approved ALL shell commands everywhere) | `~/.claude/settings.json` permissions.allow | re-add if truly wanted |
| Pruned dead `mcp__atlassian__*` (11) + `mcp__filesystem__*` (~9, incl. write rules) allow rules | user + local settings | re-add individual rules |
| Transcript retention 30→60 days (`cleanupPeriodDays: 60`) | `~/.claude/settings.json` | remove key |
| Uninstalled leftover npm-global claude-code (running native install) | npm global | `npm -g i @anthropic-ai/claude-code` (not recommended) |

Kept deliberately: superpowers (68 uses), feature-dev@official (referenced by two-pass review workflow), security-guidance@claude-code-plugins (2,289 hook runs), supabase-prod MCP (PROD deploys), `mcp__azure-devops__*` allow wildcard (core /ado workflow), all memory MCPs.

## Review performed
Self-review pass at Josh's request found + fixed two consistency gaps: orphaned `mcp__filesystem__*` allow rules after disabling that server, and CLAUDE.md pointing at the disabled scotus-fetch skill with no explanation. Two-pass code review and qa:smoke skipped — config + verbatim doc moves only, no code paths exercised.

## Verification / gotchas for next session
- Plugin/skill/MCP disables take effect on the NEXT session start.
- `autoUpdates: false` in `~/.claude.json` does NOT stop updates — the native updater ran mid-session (2.1.234 → 2.1.235 observed). Not a problem, just don't "fix" staleness by touching that flag.
- Settings-file backups from before all edits: session scratchpad `…/scratchpad/backups/` (session-scoped — copy out if long-term rollback wanted).
- Memory: `repo-map` secrets pointer updated to the new doc location; one `[2026-08-18]` convention observation added; HOT backup at `~/.claude-memory/_backups/2026-08-18/`.

## Next session picks up
Whatever was already queued — this session changed no product state. Per `active-work`: ADO-543 Fronts Wave 1 (Josh UX pass on rap-sheet timeline on TEST, then W1.2 / ADO-545).
