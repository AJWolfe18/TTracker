# MCP PAT Troubleshooting — Read This First Before Debugging Anything

**If you see ANY of these symptoms, this is your doc. Stop debugging. Read this.**

## Symptoms (grep bait — search for ANY of these)

- "Access Denied: The Personal Access Token used has expired"
- PAT expired but I just rotated it
- ADO MCP says expired, curl works
- ADO MCP says expired, curl returns 200
- Azure DevOps MCP not working
- `@azure-devops/mcp` not working
- `ADO_MCP_AUTH_TOKEN` not updating
- `mcp__azure-devops__wit_get_work_item` error
- `mcp__azure-devops__wit_my_work_items` expired
- wit_get_work_item access denied
- getBearerHandler error
- MCP env cache
- Claude Code caches MCP env vars at startup
- Claude Code MCP token not updating after restart
- `/mcp` reconnect doesn't apply new token
- /mcp reconnect does not work
- MCP stale token
- Updated settings.json PAT, still expired
- Updated `.claude/settings.local.json`, still expired
- Updated ADO PAT, still expired
- Rotated PAT, MCP still fails
- 401 Azure DevOps MCP
- Closed Claude Code, reopened, MCP still broken
- Full restart didn't fix MCP
- `ChGKER` / `2KgMu6` token prefixes (example old/new PAT fragments)
- Bearer auth vs Basic auth PAT
- AccessCheckException Azure DevOps
- AccessCheckException personal access token
- JIRA MCP token (same file, same fix pattern)
- ADO skill not working
- `/ado` command fails PAT expired

## Root Cause (TL;DR)

**Claude Code on Windows reads MCP server configs from `~/.claude.json` — NOT from `~/.claude/settings.json` and NOT from `.claude/settings.local.json`.**

Those settings files have an `mcpServers` key. **Claude Code ignores it.** The `mcpServers` block that actually runs lives here:

```
~/.claude.json
  → projects
    → "C:/Users/Josh/OneDrive/Desktop/GitHub/TTracker"   ← project path as key (FORWARD slashes)
      → mcpServers
        → azure-devops
          → env
            → ADO_MCP_AUTH_TOKEN   ← THIS is the token the MCP actually uses
```

If you rotate the PAT and only update `settings.json` / `settings.local.json`, the MCP keeps booting with the old token from `~/.claude.json`. No amount of `/mcp reconnect` or full restart will fix it because the stale token is what Claude Code hands to the spawned MCP process.

## The 30-Second Diagnostic (run this FIRST — before anything else)

From bash, in the project repo root:

```bash
node -e "
const d = require('C:/Users/Josh/.claude.json');
const key = Object.keys(d.projects).find(k => k.toLowerCase().replace(/[\\\\/]/g,'/').endsWith('github/ttracker'));
const tok = d.projects[key].mcpServers['azure-devops'].env.ADO_MCP_AUTH_TOKEN;
console.log('Token in ~/.claude.json (first 20):', tok.slice(0,20));
"
```

Compare to the PAT you *think* is active (the one in `settings.local.json`, or the one you just generated in the ADO portal).

- **Match?** PAT itself is the problem — generate a new one.
- **No match?** This is the bug. Fix below.

## The Fix (one command, then restart)

From the project repo root:

```bash
node -e "
const fs = require('fs');
const path = 'C:/Users/Josh/.claude.json';
const NEW_PAT = 'PASTE_NEW_PAT_HERE';
const d = JSON.parse(fs.readFileSync(path,'utf8'));
const key = Object.keys(d.projects).find(k => k.toLowerCase().replace(/[\\\\/]/g,'/').endsWith('github/ttracker'));
// backup first
fs.copyFileSync(path, path + '.bak-' + Date.now());
d.projects[key].mcpServers['azure-devops'].env.ADO_MCP_AUTH_TOKEN = NEW_PAT;
fs.writeFileSync(path, JSON.stringify(d, null, 2));
console.log('Updated. New token first 20:', NEW_PAT.slice(0,20));
"
```

Then **fully close the Claude Code window** and reopen. ADO MCP now works.

(Replace `github/ttracker` with the project slug if using this pattern on another repo.)

## Alternative Fix (Anthropic's official way)

Same result, uses the `claude` CLI. Run from the project repo root:

```bash
claude mcp add-json --scope local azure-devops '{"type":"stdio","command":"cmd","args":["/c","npx","-y","@azure-devops/mcp","AJWolfe92","--authentication","envvar"],"env":{"ADO_MCP_AUTH_TOKEN":"NEW_PAT_HERE"}}'
```

Then full close + reopen.

## Verify the Fix Worked

After reopening Claude Code, test:

```bash
# In bash inside Claude Code
node -e "console.log('ok')"
```

Then invoke any ADO MCP tool (e.g., `/ado get 466`). If it returns data, you're done. If it still says PAT expired, the token in `~/.claude.json` didn't actually change — re-run the diagnostic above.

## Why Previous Advice Was Wrong (for posterity)

Earlier memory notes said the fix is "update `settings.json` + `settings.local.json`, then fully close and reopen Claude Code." **That advice is wrong for MCP.** The settings files are read for permissions, model, env, and plugins — but the `mcpServers` key inside them is a red herring. MCP config only comes from `~/.claude.json`.

The "full restart" half of that advice was correct, but without also updating `~/.claude.json` it does nothing.

## Additional Red Herrings (stop chasing these)

- **`@azure-devops/mcp` package bug?** No. Both Basic and Bearer auth work with a valid PAT. The MCP uses `getBearerHandler()` and that's fine.
- **Env var cache in spawned process?** No. The env block passed to the MCP is read fresh from `~/.claude.json` every time the MCP process spawns.
- **Windows Credential Manager cache?** No. Nothing relevant stored there.
- **`npx` cache at `~/.npm/_npx/` or `~/AppData/Local/npm-cache/_npx/`?** No. These cache the *package*, not the token.
- **Claude Desktop config at `~/AppData/Roaming/Claude/claude_desktop_config.json`?** No. Claude Code (CLI) doesn't read it for MCP.

## Same Pattern for Other MCPs

If **any** MCP on Windows reports stale credentials after a rotation, check `~/.claude.json` first:

```bash
# List all MCP servers Claude Code actually knows about for this project
node -e "
const d = require('C:/Users/Josh/.claude.json');
const key = Object.keys(d.projects).find(k => k.toLowerCase().replace(/[\\\\/]/g,'/').endsWith('github/ttracker'));
console.log(Object.keys(d.projects[key].mcpServers || {}));
"
```

## File Reference

| File | What it's for | MCP config? |
|------|---------------|-------------|
| `~/.claude.json` | Per-project MCP servers, tool permissions, session data | **YES — the only one that matters** |
| `~/.claude/settings.json` | Global permissions, model, env vars, plugins | Has `mcpServers` key but **IGNORED** for project MCP |
| `~/.claude/projects/[path]/.mcp.json` | Legacy local project MCP | Sometimes read, unreliable, ignore |
| `.mcp.json` (project root) | Shared team MCP committed to git | Project-scope only (no secrets) |
| `.claude/settings.local.json` | Local permissions overrides | No — **IGNORED** for MCP despite having `mcpServers` |

## Related Docs

- `../../WhiskeyPal/docs/mcp-windows-setup.md` — original writeup, full context on how MCP config works on Windows
- Memory MCP entity: `claude-code-mcp-env-caching` — has the correction + correct rotation procedure

## History

- 2026-04-12: Burned ~90 minutes chasing this a second time. Root cause was identified in WhiskeyPal/docs/mcp-windows-setup.md months earlier but missed because the memory entity (`claude-code-mcp-env-caching`) had incorrect advice about settings.json files. Memory corrected in same session. This doc written so it's grep-findable from any related term.
