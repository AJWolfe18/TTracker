# MCP Server Configuration Documentation

## Overview
This project has Supabase MCP (Model Context Protocol) servers configured for direct database access during development sessions with Claude.

## Available MCP Servers

### 1. Filesystem Server
- **Status**: ✅ Active
- **Access**: Project files at `C:/Users/Josh/OneDrive/Desktop/GitHub/TTracker`
- **Purpose**: Read/write project files directly

### 2. Supabase TEST Database
- **Status**: ✅ Active  
- **Project Ref**: wnrjrywpcadwutfykflu
- **Access Mode**: Read-only
- **Purpose**: Safe development and testing

### 3. Supabase PRODUCTION Database
- **Status**: ✅ Active
- **Project Ref**: osjbulmltfpcoldydexg
- **Access Mode**: Read-only
- **Purpose**: Production data verification (use with caution)

## What This Enables

Claude can directly:
- Query database tables: `"Show me the last 10 articles in TEST"`
- Check data integrity: `"Count duplicate entries from today"`
- Verify migrations: `"List all tables and their row counts"`
- Debug issues: `"Check job_queue status for stuck jobs"`
- Analyze data: `"Show distribution of entry categories"`

## Usage Examples

```
You: "Check if there are any stuck jobs in the RSS pipeline"
Claude: [Queries job_queue table directly and shows results]

You: "How many executive orders were added this month?"
Claude: [Runs query and provides exact count]

You: "Show me the schema of the articles table"
Claude: [Displays complete table structure]
```

## Important Notes

- **Read-only access**: Cannot modify data (safer for development)
- **TEST preferred**: Always use TEST for development work
- **No SQL needed**: Use natural language for all database queries
- **Cost-free**: Uses Supabase connection, no external API costs

## Configuration Status

✅ Filesystem MCP: Access to project files
✅ Supabase TEST MCP: Direct database access (read-only)
✅ Supabase PROD MCP: Direct database access (read-only)

Last verified: September 28, 2025
