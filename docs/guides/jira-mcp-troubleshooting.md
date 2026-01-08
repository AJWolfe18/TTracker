# Jira MCP Integration Troubleshooting Guide

**Last Updated:** 2025-11-13
**Status:** Active - Using mcp-remote proxy workaround

---

## Current Configuration

**Working Setup (as of 2025-11-13):**
```json
{
  "atlassian": {
    "type": "stdio",
    "command": "npx",
    "args": [
      "-y",
      "mcp-remote@0.1.13",
      "https://mcp.atlassian.com/v1/sse",
      "--auth-timeout",
      "60"
    ],
    "env": {}
  }
}
```

**Location:** `C:\Users\Josh\.claude.json` (project-specific config for TTracker)

---

## Problem Background

### Why Direct SSE Connection Fails

**Root Cause:** SSE (Server-Sent Events) protocol was **deprecated from MCP standard** in 2025. Claude Code v2.0.10+ native builds no longer support SSE transport.

**Symptoms of Broken SSE Connection:**
- `claude mcp list` shows "✓ Connected"
- Tools appear available but **timeout during actual use**
- Error: "Authentication successful, but server reconnection failed"
- SSE streams disconnect after ~5 minutes
- Timeout configuration (`MCP_TIMEOUT`, `MCP_TOOL_TIMEOUT`) gets **ignored** for SSE

**Your Version:** Claude Code v2.0.37 (confirmed affected by SSE deprecation)

---

## The Fix: mcp-remote Proxy

### What It Does
The `mcp-remote` package acts as a protocol bridge:
- **Accepts:** SSE from Atlassian's server (https://mcp.atlassian.com/v1/sse)
- **Translates:** SSE → STDIO protocol
- **Outputs:** STDIO for Claude Code to consume

This allows Claude Code to work with Atlassian's legacy SSE endpoint without native SSE support.

### Configuration Parameters

**`--auth-timeout 60`**
- **What it controls:** OAuth callback window timeout (browser authentication flow)
- **Default:** 30 seconds
- **Our setting:** 60 seconds (2x default for reliability)
- **What it does NOT control:** Session lifetime or token expiration

**Token/Session Lifetime:**
- OAuth tokens are cached by `mcp-remote` and refreshed automatically
- Token lifetime is controlled by Atlassian's OAuth server (typically hours/days)
- The 60-second timeout only affects the **initial login** or **re-authentication** flow

**Version Pinning:**
- Using `mcp-remote@0.1.13` (specific version)
- Prevents breaking changes from auto-updating
- Update only after testing newer versions

---

## How to Apply This Fix

### Initial Setup (Already Done)
```bash
# Remove broken SSE config
claude mcp remove atlassian -s local

# Add via mcp-remote proxy
claude mcp add atlassian -- npx -y mcp-remote@0.1.13 https://mcp.atlassian.com/v1/sse --auth-timeout 60
```

### Verify It's Working
```bash
# Check connection status
claude mcp list

# Should show:
# atlassian: npx -y mcp-remote@0.1.13 https://mcp.atlassian.com/v1/sse --auth-timeout 60 - ✓ Connected

# Test actual functionality (in Claude Code session)
# Try using any Jira MCP tool, e.g.:
# "Show me my recent Jira tickets"
```

---

## Troubleshooting Common Issues

### Issue 1: Authentication Times Out During Login

**Symptom:** Browser OAuth window expires before you complete login

**Solution:**
```bash
# Increase auth timeout to 120 seconds (2 minutes)
claude mcp remove atlassian -s local
claude mcp add atlassian -- npx -y mcp-remote@0.1.13 https://mcp.atlassian.com/v1/sse --auth-timeout 120
```

### Issue 2: Tools Still Timing Out After Setup

**Symptom:** Tools fail with timeout errors even with mcp-remote

**Diagnostics:**
```bash
# Enable debug logging
claude mcp remove atlassian -s local
claude mcp add atlassian -- npx -y mcp-remote@0.1.13 https://mcp.atlassian.com/v1/sse --auth-timeout 60 --debug

# Check debug output in terminal for:
# - Token refresh issues
# - Network connectivity problems
# - Atlassian API rate limiting
```

**Common Causes:**
- Network firewall blocking SSE connections
- Corporate proxy interfering
- Atlassian API rate limits (1000 req/hour on Standard plans)

**Solutions:**
1. Check proxy settings: `mcp-remote` supports `HTTPS_PROXY` and `NO_PROXY` env vars
2. Add `--enable-proxy` flag if behind corporate proxy
3. Wait if rate limited (check Atlassian plan limits)

### Issue 3: Session Expired / Re-Authentication Required

**Symptom:** Works initially, then requires re-login after hours/days

**Expected Behavior:** OAuth tokens expire based on Atlassian's policy (not controlled by mcp-remote)

**Solution:**
```bash
# Simply re-run the mcp-remote command to re-authenticate
# Your config persists, just need to refresh OAuth token
claude mcp get atlassian
# Then follow authentication prompts
```

### Issue 4: Connection Shows "✓ Connected" But Tools Not Available

**Symptom:** `claude mcp list` shows connected, but tools don't appear in conversation

**Diagnostics:**
1. Check if server is actually responding:
   ```bash
   # In Claude Code session, try:
   /mcp
   # Look for Atlassian tools in the list
   ```

2. Restart Claude Code session:
   ```bash
   # Exit current session (Ctrl+C)
   # Start new session
   claude
   ```

3. Check for competing processes:
   ```bash
   # Windows:
   tasklist | findstr node
   # Look for multiple node processes from old mcp-remote instances

   # Kill if needed (replace PID):
   taskkill /F /PID <process_id>
   ```

---

## When to Update This Configuration

### Safe to Stay As-Is
- Current setup is stable and working
- No action needed unless issues arise

### Update Scenarios

**Scenario 1: Atlassian Upgrades to HTTP/STDIO**
- Monitor: https://github.com/atlassian/atlassian-mcp-server/issues/8
- When resolved: Switch to direct connection (no proxy needed)
- New config will be:
  ```bash
  claude mcp add --transport http atlassian https://mcp.atlassian.com/v1
  ```

**Scenario 2: mcp-remote Updates with Bug Fixes**
- Check releases: https://github.com/mcp-remote/mcp-remote/releases
- Test new version before upgrading:
  ```bash
  # Try newer version with test suffix
  claude mcp add atlassian-test -- npx -y mcp-remote@latest https://mcp.atlassian.com/v1/sse --auth-timeout 60
  ```
- If stable, replace old config

**Scenario 3: Claude Code Restores SSE Support**
- Monitor: https://github.com/anthropics/claude-code/issues
- Would allow direct SSE connection again (unlikely)

---

## Configuration File Locations

**Project-Specific (TTracker):**
- `C:\Users\Josh\.claude.json` - Contains MCP server configs for this project
- Auto-created by `claude mcp add` commands with `-s local` scope

**User-Level (Global):**
- Would be in `~/.claude.json` if using `-s user` scope
- Not currently used for Atlassian MCP

**Team-Shared (Not Used):**
- `.mcp.json` in project root for team collaboration
- Not recommended for Atlassian due to OAuth tokens

---

## Reference Links

**Official Documentation:**
- Atlassian MCP Server: https://support.atlassian.com/atlassian-rovo-mcp-server/
- Claude Code MCP Docs: https://docs.claude.com/en/docs/claude-code/mcp
- MCP Protocol Spec: https://modelcontextprotocol.io/

**Known Issues:**
- SSE Deprecation: https://github.com/anthropics/claude-code/issues/9133
- Atlassian SSE Port: https://github.com/atlassian/atlassian-mcp-server/issues/8
- Timeout Configs Ignored: https://github.com/anthropics/claude-code/issues/3033

---

## Cost Impact

**Current Solution:** $0/month
- `mcp-remote` is free, open-source
- No additional service costs
- Uses existing Claude Code + Atlassian subscriptions

---

## Quick Reference Commands

```bash
# Check MCP server status
claude mcp list

# View detailed Atlassian config
claude mcp get atlassian

# Remove and reconfigure (if needed)
claude mcp remove atlassian -s local
claude mcp add atlassian -- npx -y mcp-remote@0.1.13 https://mcp.atlassian.com/v1/sse --auth-timeout 60

# Enable debug mode
claude mcp add atlassian -- npx -y mcp-remote@0.1.13 https://mcp.atlassian.com/v1/sse --auth-timeout 60 --debug

# Test in session
# Start claude, then ask:
# "What are my recent Jira tickets?"
# Or: "Show me open issues in TTRC project"
```

---

## Maintenance Schedule

**Check Quarterly:**
- Atlassian MCP server upgrade status
- New Claude Code releases with SSE changes
- mcp-remote updates

**Next Review:** 2025-02-13 (3 months)

---

## Support Contacts

**Issues with This Setup:**
- GitHub: https://github.com/anthropics/claude-code/issues
- Atlassian Community: https://community.atlassian.com/

**Internal Questions:**
- See: `/docs/PROJECT_INSTRUCTIONS.md`
- Contact: Josh (project owner)
