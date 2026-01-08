# TrumpyTracker Quickstart (5 min)

Get up to speed on the TrumpyTracker codebase in 5 minutes.

## 1. Verify Environment (30 sec)

```bash
# Verify you're on test branch (should show 'test')
git branch --show-current

# Verify TEST environment marker exists
test -f TEST_BRANCH_MARKER.md && echo "✅ TEST env" || echo "❌ PROD env"

# Check git status
git status
```

**Expected**: On `test` branch, TEST marker exists, clean working directory

---

## 2. Read Latest Context (2 min)

**Latest handoff:**
```bash
# View most recent handoff
ls -t docs/handoffs/ | head -1

# Read it
cat "docs/handoffs/$(ls -t docs/handoffs/ | head -1)"
```

**Essential docs to scan:**
- `/docs/code-patterns.md` - Common patterns (pagination, timestamps, error handling)
- `/docs/common-issues.md` - Recent bugs and solutions (check last 5 entries)
- `/CLAUDE.md` - Full project context (start with TLDR section)

---

## 3. Essential Patterns (2 min)

### Database Patterns
- **Pagination**: ALWAYS cursor-based (NEVER OFFSET)
  ```javascript
  .lt('id', cursor)
  .order('id', { ascending: false })
  .limit(20)
  ```

- **Timestamps**: Always `timestamptz` (never `timestamp`)
- **Migrations**: Always include `IF NOT EXISTS`
- **Foreign keys**: Always specify `ON DELETE` behavior

### Error Handling
```javascript
try {
  // async operation
} catch (error) {
  console.error('[Context]:', error);
  return { error: 'User-friendly message' };
}
```

### RSS Pipeline
```
GitHub Actions (every 2h)
  ↓
Edge Function (rss-enqueue)
  ↓
Job Queue (job_queue table)
  ↓
Worker (job-queue-worker.js)
  ├─ fetch_feed → Articles
  ├─ story.cluster → Group articles
  └─ story.enrich → AI summaries
```

---

## 4. Critical Constraints (30 sec)

### ❌ NEVER
- Push to main branch (`git push origin main` is BLOCKED)
- Use `str_replace` for file edits (use `mcp__filesystem__edit_file`)
- Skip AI code review check after push
- Use OFFSET pagination
- Skip validation testing before commit

### ✅ ALWAYS
- Work on `test` branch
- Validate changes via Task tool (general-purpose agent) before commit
- Run QA tests before push (`npm run qa:smoke`)
- Update JIRA via MCP tools immediately
- State cost implications for new features
- Check AI code review after push (`bash scripts/check-code-review.sh`)

---

## 5. Common Commands (Reference)

### Development
```bash
# Local frontend server
npm run server

# Job queue worker
node scripts/job-queue-worker.js

# Run QA tests
npm run qa:smoke
npm run qa:boundaries
npm run qa:integration
```

### Database
```bash
# Apply migrations
node scripts/apply-migrations.js

# Query via Supabase MCP tools (in Claude)
# SELECT * FROM stories WHERE status = 'active' LIMIT 10;
```

### Deployment
```bash
# Deploy edge functions
supabase functions deploy rss-enqueue
supabase functions deploy stories-active

# Check AI code review
bash scripts/check-code-review.sh
```

---

## 6. Workflow Checklist

```
[ ] Read latest handoff
[ ] Verify on test branch
[ ] Scan code-patterns.md and common-issues.md
[ ] Implement changes
[ ] Validate with Task tool (general-purpose agent)
[ ] Run QA tests (npm run qa:smoke)
[ ] Commit & push to test
[ ] Check AI code review (bash scripts/check-code-review.sh)
[ ] Update JIRA via MCP tools
[ ] Create handoff in /docs/handoffs/YYYY-MM-DD-name.md
```

---

## 7. Key Files

### Core Architecture
- `/scripts/job-queue-worker.js` - Job processor (fetch, cluster, enrich)
- `/supabase/functions/rss-enqueue/` - RSS job creation
- `/migrations/` - Database schema evolution

### Frontend
- `/public/index.html` - Main stories list
- `/public/story-view/` - Individual story detail page

### Configuration
- `/docs/code-patterns.md` - Implementation patterns
- `/docs/common-issues.md` - Known issues and solutions
- `/CLAUDE.md` - Complete project context

---

## 8. Emergency Contacts

**Break Glass Scenarios:**
- RSS pipeline frozen → Check `/docs/troubleshooting/BREAK_GLASS_RSS_FIX.md`
- Budget exceeded → See Budget Enforcement section in CLAUDE.md
- Database issues → Check job_queue for stuck jobs

**Next Steps:** Read full `/CLAUDE.md` for complete context and architecture details.

---

**Last Updated:** 2025-11-16  
**Maintained by:** Josh + Claude Code
