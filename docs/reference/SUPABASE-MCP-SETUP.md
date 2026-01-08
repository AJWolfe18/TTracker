# Supabase MCP Server Setup (Windows)

**CLAUDE CODE: READ THIS EVERY TIME BEFORE TRYING TO SET UP SUPABASE MCP**

## The Problem
The Supabase MCP server keeps getting misconfigured because:
1. Windows requires `cmd /c` wrapper
2. The server requires **flags**, not positional arguments
3. The auth token goes in **environment variables**, not arguments

## The Solution

Run this exact command:

```bash
claude mcp add-json supabase-test "{\"command\":\"cmd\",\"args\":[\"/c\",\"npx\",\"-y\",\"@supabase/mcp-server-postgrest\",\"--apiUrl\",\"https://wnrjrywpcadwutfykflu.supabase.co/rest/v1\",\"--schema\",\"public\"],\"env\":{\"SUPABASE_ACCESS_TOKEN\":\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTIyMDczNywiZXhwIjoyMDcwNzk2NzM3fQ.V3dJTwxr7XcoOXk-9P8qrY0McaQ1HfG-yjCdLx-fEuo\"}}"
```

## What This Creates

This adds to `C:\Users\Josh\.claude.json` (in the project scope):

```json
"supabase-test": {
  "command": "cmd",
  "args": [
    "/c",
    "npx",
    "-y",
    "@supabase/mcp-server-postgrest",
    "--apiUrl",
    "https://wnrjrywpcadwutfykflu.supabase.co/rest/v1",
    "--schema",
    "public"
  ],
  "env": {
    "SUPABASE_ACCESS_TOKEN": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InducmpyeXdwY2Fkd3V0ZnlrZmx1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NTIyMDczNywiZXhwIjoyMDcwNzk2NzM3fQ.V3dJTwxr7XcoOXk-9P8qrY0McaQ1HfG-yjCdLx-fEuo"
  }
}
```

## Critical Details

### Windows Requirement
- **MUST** use `cmd /c` as command wrapper
- **MUST** escape quotes in JSON string

### Required Flags
- `--apiUrl` - The PostgREST endpoint URL
- `--schema` - Database schema (usually "public")

### Authentication
- `SUPABASE_ACCESS_TOKEN` - Service role key from `.env`
- **NEVER** pass as command arg, always in `env` object

## Common Mistakes

❌ **DON'T DO THIS:**
```bash
# Missing cmd /c wrapper
claude mcp add supabase-test npx @supabase/mcp-server-postgrest https://...

# URL as positional arg (won't work)
claude mcp add supabase-test npx @supabase/mcp-server-postgrest https://wnrj...

# Missing --schema flag
npx @supabase/mcp-server-postgrest --apiUrl https://...
```

✅ **DO THIS:**
```bash
# Use the exact command above with add-json
claude mcp add-json supabase-test "{...full config...}"
```

## Verification

After adding, verify connection:

```bash
claude mcp list
```

Should show:
```
supabase-test: cmd /c npx -y @supabase/mcp-server-postgrest --apiUrl https://wnrjrywpcadwutfykflu.supabase.co/rest/v1 --schema public - ✓ Connected
```

## If It Fails

1. Check the error: `claude mcp list` shows connection status
2. Remove: `claude mcp remove supabase-test`
3. Re-add with exact command above
4. **Restart Claude Code** (quit and relaunch)

## Environment Variables

From `.env` file:
- `SUPABASE_TEST_URL` = https://wnrjrywpcadwutfykflu.supabase.co
- `SUPABASE_TEST_SERVICE_KEY` = eyJhbGc... (use this as SUPABASE_ACCESS_TOKEN)

## Tools Available After Setup

Once connected, Claude Code has access to:
- `mcp__supabase-test__postgrestRequest` - Full read/write access to TEST database via PostgREST API

**Capabilities:**
- GET (read)
- POST (create)
- PUT/PATCH (update)
- DELETE (delete)

**IMPORTANT: Write Operations Require Approval**
- READ operations: Execute freely for data exploration
- WRITE operations (POST/PUT/PATCH/DELETE): Present plan first, execute only after Josh approves

Example read operation:
```javascript
mcp__supabase-test__postgrestRequest({
  method: "GET",
  path: "/stories?status=eq.active&select=id,primary_headline&limit=5"
})
```

## What Went Wrong (2025-10-05 Sessions)

### First Issue: Missing "type": "stdio" (1 hour wasted)

❌ **BROKEN:**
```json
"supabase-test": {
  "command": "cmd",  // MISSING "type": "stdio"
  "args": [...],
  "env": {...}
}
```

✅ **FIXED:**
```json
"supabase-test": {
  "type": "stdio",  // REQUIRED for local MCP servers
  "command": "cmd",
  "args": [...],
  "env": {...}
}
```

### Second Issue: Auth in WRONG PLACE (5+ hours wasted)

The `@supabase/mcp-server-postgrest` package **DOES NOT USE ENV VARS** for auth.

❌ **WRONG - Using env var:**
```bash
claude mcp add-json supabase-test "{
  \"env\": {
    \"SUPABASE_ACCESS_TOKEN\": \"key...\"  # IGNORED BY PACKAGE
  }
}"
```

✅ **CORRECT - Using --apiKey FLAG:**
```bash
claude mcp add-json supabase-test "{
  \"type\":\"stdio\",
  \"command\":\"cmd\",
  \"args\":[
    \"/c\",
    \"npx\",
    \"-y\",
    \"@supabase/mcp-server-postgrest\",
    \"--apiUrl\",\"https://wnrjrywpcadwutfykflu.supabase.co/rest/v1\",
    \"--schema\",\"public\",
    \"--apiKey\",\"eyJhbGc...YOUR_SERVICE_ROLE_KEY\"
  ]
}"
```

### Why This Was Confusing

1. The setup doc SAID to use `SUPABASE_ACCESS_TOKEN` env var
2. The package source code ACTUALLY expects `--apiKey` command line flag
3. The package **silently ignores** env vars and fails with "No API key found"
4. MCP server shows "✓ Connected" but tool calls fail

### The Real Fix

**Use --apiKey as a command line argument in the args array**, NOT as an environment variable.

---

**Last Updated:** 2025-10-05 (Fixed env var vs flag auth bug)
**Tested On:** Windows 11, Claude Code 2.0.8
**Key Lesson:** Check package source code for ACTUAL auth method, don't trust docs
