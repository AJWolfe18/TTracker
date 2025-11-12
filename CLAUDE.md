# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## ⚠️ CRITICAL BRANCH RULES ⚠️

### 🔒 MAIN BRANCH IS PROTECTED
- **Main branch requires PRs** - Direct pushes are BLOCKED by GitHub
- **ALWAYS WORK ON `test` BRANCH**
- **NEVER `git push origin main`** - It will fail (protected)
- **Use PR workflow for PROD deployments** (see below)

### ✅ Correct workflow:

**For TEST (normal work):**
1. Always work on `test` branch
2. Commit to `test` branch
3. Push to `test` branch (`git push origin test`)
4. Auto-deploys to Netlify TEST site

**For PROD (deployments only):**
1. Create deployment branch from `main`
2. Cherry-pick tested commits from `test`
3. Push deployment branch
4. Create PR to `main` via `gh pr create`
5. Merge PR (auto-deploys to trumpytracker.com)

### ❌ What will break:
- `git push origin main` → ❌ BLOCKED (protected branch)
- `git merge test` into main → ❌ WRONG (use cherry-pick)
- Editing files on main → ❌ BLOCKED (must use PR)

---

## Project Context

**TrumpyTracker** is an AI-powered political accountability tracker that aggregates news from RSS feeds, clusters related articles into stories, and enriches them with AI summaries.

**Current State:** Migration from legacy article system (PROD) to RSS story clustering system (TEST) - frontend QA phase ([TTRC-145](https://ajwolfe37.atlassian.net/browse/TTRC-145))

**Active Work:** TTRC-192 - Auto-trigger story enrichment on create/reopen

**Owner:** Josh (Product Manager, non-developer) - Prefers business impact explanations and single recommendations with cost implications stated clearly.

**Budget:** <$50/month hard limit (current: ~$20/month for OpenAI)

## Environment Architecture

### TEST Environment (test branch)
- **Database:** Supabase TEST (RSS + Story Clustering schema)
- **Deploy:** Auto-deploy to Netlify test site
- **Status:** Active development, 86 stories, 180 articles from 6 feeds
- **Marker File:** `TEST_BRANCH_MARKER.md` presence indicates TEST environment

### PROD Environment (main branch)
- **Database:** Supabase PROD (Legacy article schema)
- **Deploy:** Auto-deploy to trumpytracker.com
- **Status:** Stable legacy system, 717 entries
- **Migration:** Pending frontend completion

**NEVER merge test→main. Always cherry-pick tested commits.**

## Development Commands

### Local Development
```bash
# Frontend local server
npm run server

# Job queue worker (processes RSS jobs)
node scripts/job-queue-worker.js

# Run QA smoke tests
npm run qa:smoke
```

### Individual QA Tests
```bash
npm run qa:boundaries      # Clustering boundary conditions
npm run qa:integration     # Attach-or-create integration
npm run qa:idempotency     # Job queue idempotency
npm run qa:concurrency     # Clustering concurrency
```

### Supabase Edge Functions
```bash
# Deploy all functions
supabase functions deploy rss-enqueue
supabase functions deploy stories-active
supabase functions deploy stories-detail
supabase functions deploy stories-search
supabase functions deploy articles-manual
supabase functions deploy queue-stats
```

### Database Migrations
```bash
# Apply migrations in order from /migrations/
node scripts/apply-migrations.js
```

## Core Architecture

### RSS Ingestion Pipeline

```
GitHub Actions (every 2 hours)
    ↓ Triggers
Supabase Edge Function (rss-enqueue)
    ↓ Creates jobs in job_queue
Job Queue Worker (Node.js - scripts/job-queue-worker.js)
    ├── fetch_feed → Fetches RSS, creates articles
    ├── story.cluster → Groups related articles into stories
    └── story.enrich → Generates AI summaries
        ↓ Writes to
Stories + Articles Tables
    ↓ Queries via
Edge Functions (stories-active, stories-detail)
    ↓ Serves
Frontend (public/index.html, public/story-view/)
```

### Key Job Types
- `fetch_feed` - Fetch individual RSS feed
- `fetch_all_feeds` - Batch fetch all active feeds
- `story.cluster` - Cluster single article into story
- `story.cluster.batch` - Batch clustering
- `story.enrich` - OpenAI enrichment (summaries, categories, severity)
- `process_article` - Article processing tasks

### Database Schema (TEST)

**stories** - Story aggregation
- Primary key: `id` (BIGINT)
- Unique: `story_hash` (hash of primary_headline)
- Status: `active` (0-72h) | `closed` (72h+) | `archived` (90d+)
- AI fields: `summary_neutral`, `summary_spicy`, `primary_actor`, `severity`, `category`
- Full-text search: `search_vector` (tsvector, generated)

**articles** - Individual RSS articles
- Primary key: `id` (TEXT, format: 'art-{uuid}')
- Deduplication: UNIQUE constraint on `(url_hash, published_date)`
- Foreign key: Links to stories via `article_story` junction table

**article_story** - Many-to-many junction
- Primary key: `article_id`
- Foreign keys: `article_id` → articles, `story_id` → stories
- Metadata: `is_primary_source`, `similarity_score`, `matched_at`

**feed_registry** - RSS feed management
- Primary key: `id`
- HTTP caching: `etag`, `last_modified` (for 304 Not Modified)
- Failure tracking: `failure_count` (auto-disable at 5), `is_active`

**job_queue** - Async job processing
- Primary key: `id`
- Job claiming: Atomic RPC `claim_runnable_job()` prevents race conditions
- Status: `pending` | `claimed` | `completed` | `failed`
- Cleanup: Auto-delete after 7 days

**budgets** - Daily cost tracking
- Primary key: `day` (DATE)
- Tracks: `spent_usd`, `openai_calls`
- Enforces: Daily cap ($50/day max)

### Critical Functions & RPCs

**Database Helpers (migrations/019_story_enrichment_helpers.sql):**
- `get_stories_needing_enrichment(limit)` - Finds stories without AI summaries
- `mark_story_enriched(story_id, enrichment_data)` - Updates story with AI results
- Used by: Story enrichment backfill scripts, job queue worker

**Job Queue (migrations/009_atomic_job_claiming.sql):**
- `claim_runnable_job()` - Atomically claims next available job
- `get_runnable_count()` - Returns count of pending jobs
- Prevents: Race conditions in concurrent worker scenarios

**Article Upsert (migrations/003_atomic_article_upsert.sql):**
- `attach_or_create_article(...)` - Idempotent article insertion
- Handles: Deduplication, story assignment, primary source selection
- Critical for: RSS ingestion reliability

## Important Patterns

### Pagination
**ALWAYS use cursor-based pagination. NEVER use OFFSET.**
```javascript
// Good
const { data } = await supabase
  .from('stories')
  .select('*')
  .lt('id', cursor)
  .order('id', { ascending: false })
  .limit(20);

// Bad - DO NOT USE
const { data } = await supabase
  .from('stories')
  .select('*')
  .range(0, 20); // OFFSET-based, slow at scale
```

### Timestamps
**All timestamps are UTC. Use TIMESTAMPTZ type.**
```sql
-- Good
published_at TIMESTAMPTZ DEFAULT NOW()

-- Bad
published_at TIMESTAMP
```

### Story Lifecycle
- **Active:** Display prominently (0-72 hours since last_updated_at)
- **Closed:** Archived from main view (72+ hours)
- **Archived:** Cold storage (90+ days, future feature)

### Deduplication Strategy
**Articles:** Composite unique on `(url_hash, published_date)`
- Same URL on different days = allowed
- Same URL same day = duplicate, upserted

**Stories:** Unique on `story_hash` (hash of primary_headline)
- Prevents duplicate story creation
- Allows story reopening if new articles match

### Category Mapping
UI labels → Database enum values (defined in job-queue-worker.js):
- 'Corruption & Scandals' → 'corruption_scandals'
- 'Democracy & Elections' → 'democracy_elections'
- 'Policy & Legislation' → 'policy_legislation'
- 'Justice & Legal' → 'justice_legal'
- 'Executive Actions' → 'executive_actions'
- 'Foreign Policy' → 'foreign_policy'
- 'Corporate & Financial' → 'corporate_financial'
- 'Civil Liberties' → 'civil_liberties'
- 'Media & Disinformation' → 'media_disinformation'
- 'Epstein & Associates' → 'epstein_associates'
- 'Other' → 'other'

### RSS Feed Compliance Rules
**IMPORTANT:** All RSS feeds MUST have compliance rules configured in the database.

**Current Standard:**
- Content limit: 5000 chars (matches article scraping limit from TTRC-258/260)
- Full text: `allow_full_text = false` (excerpts only for fair use)
- Enforcement: Automatic via RSS fetcher (`scripts/rss/fetch_feed.js`)

**When Adding New Feeds:**
```sql
-- Add compliance rule (REQUIRED)
INSERT INTO feed_compliance_rules (feed_id, max_chars, allow_full_text, source_name, notes)
VALUES (
  <feed_id>,
  5000,
  false,
  '<Source Name>',
  '5K char limit for RSS content - matches article scraping limit'
);
```

**How It Works:**
1. RSS fetcher queries `feed_compliance_rules` at fetch start
2. Extracts content from RSS fields: `content:encoded` OR `description` OR `summary`
3. Truncates to `max_chars` limit (5000) before database insert
4. Falls back to 5000 if no rule exists

**RSS Content Fields Priority:**
- `content:encoded` - Full article HTML (~2K-10K chars) - **checked first**
- `description` - Standard summary (~200-500 chars) - **fallback**
- `summary` - Atom feed summary - **fallback for Atom feeds**

**Note:** Even with 5K RSS limit, we also scrape full articles (TTRC-258/260) for better AI summaries.

## MCP Tools Available

**Supabase TEST Database:** Full query access via `mcp__supabase-test__query`
- Use for: Data exploration, verification, ad-hoc queries
- Example: `SELECT COUNT(*) FROM stories WHERE status = 'active'`

**Atlassian Integration:** Direct JIRA/Confluence updates
- **ALWAYS update JIRA/Confluence directly using tools** - never say "needs update"
- Use for: Ticket updates, documentation, handoff creation

**Filesystem Access:** Direct file operations in project directory
- **ALWAYS use `mcp__filesystem__edit_file` for edits** - NEVER use str_replace (it fails)

## Critical Rules

1. **Work on TEST branch unless explicitly told otherwise**
2. **Check available MCP tools FIRST** - Never claim "I can't" without verifying
3. **Update JIRA/Confluence immediately** - Don't say "needs update", just do it
4. **Auto-QA always** - Check edge cases, regressions, cost after every change
5. **Handoffs to /docs/handoffs/** - Never add to project knowledge base
6. **State cost implications** - Always mention $ impact for new features
7. **Follow PR workflow** - See `/docs/CLAUDE-CODE-PR-WORKFLOW.md` and `/docs/AI-CODE-REVIEW-GUIDE.md` for full PR process
8. **Test before marking complete** - Use Task tool with general-purpose agent to validate code changes before marking todos complete or creating PRs
9. **Use TodoWrite for workflow tracking** - Include full workflow items (code + validation + JIRA + handoff) in todos
10. **Report token usage** - End every response with usage stats

## Session Workflow

### Start Every Session
1. Ask: "Any handoffs to review?" (read from `/docs/handoffs/`)
2. Ask: "What's our goal?"
3. State: "Working on TEST environment" (or PROD if applicable)
4. Reference: `/docs/STARTUP_PROMPT.md` for full checklist

### Definition of Done
- ✅ Business outcome clearly stated
- ✅ Feature working
- ✅ Edge cases handled
- ✅ No regressions
- ✅ Cost <$50/month
- ✅ JIRA/Confluence updated (via tools)
- ✅ Handoff in `/docs/handoffs/YYYY-MM-DD-name.md`

### End Session
1. Update JIRA (use tools)
2. Update Confluence (use tools)
3. Create handoff artifact (template in `/docs/HANDOFF_PROMPT.md`)
4. Save to `/docs/handoffs/YYYY-MM-DD-name.md`

## Communication Style

- **Directive:** Pick best option, explain why
- **Business-focused:** Impact over technical details
- **Cost-aware:** State $ implications upfront
- **Explicit:** Environment, risk level, breaking changes
- **Concise:** Brief unless complexity requires detail
- **Context reporting:** Always end with token usage

## Documentation Structure

**Core Protocols:**
- `/docs/PROJECT_INSTRUCTIONS.md` - Quick reference
- `/docs/STARTUP_PROMPT.md` - Session start checklist
- `/docs/SESSION_PROTOCOL.md` - Complete workflow
- `/docs/HANDOFF_PROMPT.md` - Handoff template

**Architecture:**
- `/docs/architecture/ARCHITECTURE.md` - System overview
- `/docs/architecture/rss-system.md` - RSS pipeline details
- `/docs/database/database-schema.md` - Schema documentation

**Migration History:**
- `/migrations/*.sql` - Database migrations (apply in order)
- Migration 019 added story enrichment helpers (most recent)

## Tech Stack

- **Backend:** Supabase (PostgreSQL + Edge Functions)
- **Frontend:** Vanilla JS, HTML5, CSS3, Tailwind CSS
- **Worker:** Node.js (job-queue-worker.js)
- **AI:** OpenAI GPT-4o-mini for enrichment
- **RSS Parsing:** rss-parser npm package
- **Deployment:** Netlify (static site + branch deploys)
- **Automation:** GitHub Actions (scheduled jobs)

## Common Tasks

### Adding RSS Feeds
```sql
INSERT INTO feed_registry (url, source_name, topics, tier, is_active)
VALUES (
  'https://example.com/feed.xml',
  'Example News',
  ARRAY['politics', 'congress'],
  2,  -- Tier 2: Important
  true
);
```

### Manual Article Submission
```bash
curl -X POST "$SUPABASE_URL/functions/v1/articles-manual" \
  -H "Authorization: Bearer $ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
```

### Trigger RSS Fetch
```bash
curl -X POST "$SUPABASE_URL/functions/v1/rss-enqueue" \
  -H "Authorization: Bearer $EDGE_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_all_feeds"}'
```

### Monitor Job Queue
```sql
SELECT job_type, status, COUNT(*)
FROM job_queue
GROUP BY job_type, status
ORDER BY job_type, status;
```

## Troubleshooting

### Feed Not Processing
1. Check `SELECT * FROM feed_registry WHERE is_active = true`
2. Verify `failure_count < 5`
3. Check `SELECT * FROM job_queue WHERE job_type = 'fetch_feed' ORDER BY created_at DESC`

### Duplicate Articles
1. Verify `url_hash` generation
2. Check composite unique constraint: `(url_hash, published_date)`
3. Review `attach_or_create_article` RPC logic

### Missing AI Enrichment
1. Check OpenAI API key in environment
2. Verify daily budget not exceeded: `SELECT * FROM budgets ORDER BY day DESC`
3. Review job_queue errors: `SELECT * FROM job_queue WHERE status = 'failed' AND job_type = 'story.enrich'`

### Worker Not Processing Jobs
1. Check worker is running: `node scripts/job-queue-worker.js`
2. Verify jobs exist: `SELECT get_runnable_count()`
3. Check for stuck jobs: `SELECT * FROM job_queue WHERE status = 'claimed' AND claimed_at < NOW() - INTERVAL '10 minutes'`

---

**Last Updated:** 2025-10-04
**Maintained by:** Josh + Claude Code
**For Support:** See `/docs/PROJECT_INSTRUCTIONS.md`
