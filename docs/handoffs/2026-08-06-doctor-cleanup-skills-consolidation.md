# 2026-08-06 — Claude Code doctor cleanup + skills consolidation

**Session type:** Tooling/config maintenance (no ADO ticket — no product code touched)

## What was done

### 1. Claude Code health check (/doctor)
- Installation healthy: single native install, v2.1.223 (latest), all config files parse, auto mode already default.
- **Disabled 6 unused plugins** (user settings): hookify (13,395 no-op hook runs, zero rules configured — was adding ~0.4s latency to every tool call), commit-commands, claude-md-management, skill-creator, code-simplifier, frontend-design@claude-plugins-official. Kept: superpowers, feature-dev, security-guidance, code-review, context7, autofix-bot, and the marketplace duplicates (Josh's call).
- **Disabled atlassian MCP server** for this project (`disabledMcpServers` in `~/.claude.json`) — Jira→ADO migration complete, 0 calls in scan window.
- **Archived stale user-scope commands** `~/.claude/commands/{jira,scotus-review}.md` → `~/.claude/commands.bak/` (divergent old copies that loaded in every project).

### 2. CLAUDE.md trim (~29.1k → ~26.4k chars)
- Cut derivable-only blocks: category-mapping list (source: `enrich-stories-inline.js`), pagination/timestamp code examples (rules kept), qa-script list (source: `package.json`), repeated deploy lines, RSS field priority (source: `fetch_feed.js`), feed-insert/curl examples.
- Moved to lazy loading: SCOTUS fetch → new `.claude/skills/scotus-fetch/SKILL.md`; Troubleshooting → `docs/common-issues.md` §"RSS Pipeline Quick Checks". Pointers left in place.
- No rules, gotchas, secrets tables, or branch/budget policies touched.

### 3. Slash commands → skills consolidation
`.claude/commands/` is retired; everything now lives in `.claude/skills/<name>/SKILL.md` with `name` + trigger-rich `description` frontmatter (fixes skill auto-triggering — the old files' descriptions fell back to bare H1 titles):
- **ado** — kept the skill body (newer, has 2026-verified PAT/Bug-state gotchas), merged in `/ado` slash syntax from the command.
- **validate** — rebuilt from the *command* version (current, ADO-era); the old skill body still said "update JIRA" and was the copy that actually loaded. Real stale-shadowing bug fixed.
- **start-work / end-work / scotus-review** — converted as-is with new frontmatter.
- **jira** — deleted everywhere (command, skill, `.agents` mirror).
- `.agents/skills/` (Codex-format mirror, untracked) synced to all 6 skills.

### 4. QA pass (expert review of the changes)
Fixed: dangling refs in `docs/guides/ado-workflow.md`, `.claude/test-only-paths.md`, `docs/features/scotus-claude-agent/prod-deployment-plan.md`; dead JIRA-skill reference inside the ado skill; incomplete qa-script enumeration; `docs/common-issues.md` footer position; stale Last-Updated dates.

## Verification
- Live skill listing re-registered all 6 skills with full descriptions (confirmed in-session).
- `grep -r ".claude/commands"` across live docs/config: clean (only historical handoffs/archive mention it, intentionally untouched).
- Memory graph verified intact — active-work anchor still points at ADO-539 (execute approved plan), then ADO-531.

## Gotchas for next session
- Plugin/MCP disables live in `~/.claude/settings.json` and `~/.claude.json` (backups: `*.bak-doctor-20260806*` alongside each). Reversible one-liners.
- `skillOverrides: {"jira": "off"}` in `.claude/settings.local.json` was removed after this commit (redundant once jira files are deleted in git).
- If PROD cherry-pick of these commits is ever wanted: this is all test-branch tooling/docs; nothing here is PROD-blocking, but the skills consolidation should go over eventually so cloud agents/routines see the same skill set.

## Where we left off (unchanged by this session)
**NEXT: ADO-539** — plan approved at `docs/features/clustering-judge/calibration-v1.1-plan.md`, execute don't re-plan; then ADO-531 backfill.
