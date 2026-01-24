# AGENTS.md - Codex Review Guidelines

This file configures OpenAI Codex code review for TrumpyTracker.

## Review guidelines

### Project Context
- **Project:** TrumpyTracker - AI-powered political accountability tracker
- **Stack:** Node.js (ESM), Supabase (PostgreSQL), vanilla JS frontend, Netlify static hosting
- **Budget:** <$50/month - flag any changes that increase API costs

### P0 (Blockers - Must Fix)
- Security vulnerabilities (SQL injection, XSS, exposed secrets)
- Hardcoded API keys or credentials
- Missing error handling on async operations
- Breaking changes to existing functionality
- Hardcoded PROD Supabase URLs in test code (except for detection purposes)

### P1 (Should Fix)
- Missing input validation
- OFFSET-based pagination (must use cursor-based)
- Timestamps without timezone (`timestamp` instead of `timestamptz`)
- Missing CORS headers in Edge Functions
- Missing `IF NOT EXISTS` in migrations
- Missing `ON DELETE` behavior on foreign keys
- Console.log statements in production code
- Unhandled promise rejections

### P2 (Nice to Have)
- Code style inconsistencies
- Missing comments on complex logic
- Opportunities for refactoring
- Performance optimizations

### Patterns to Enforce
- Pagination: Always cursor-based, NEVER use OFFSET
- Timestamps: Always `timestamptz`, never `timestamp`
- Migrations: Must include `IF NOT EXISTS` for idempotency
- Edge Functions: Must include CORS headers
- Async: Must use try-catch for error handling
- SQL: Must be parameterized (no string concatenation)

### What NOT to Flag
- Test files (files with `test` in the name)
- Documentation files (*.md)
- Handoff files in `/docs/handoffs/`
- Backup files (*-backup*)

### Cost Awareness
Flag any changes that:
- Add new OpenAI API calls (state estimated cost impact)
- Fetch large amounts of data from Supabase (embeddings, content fields)
- Add new scheduled jobs or workflows
