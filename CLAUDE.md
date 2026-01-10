# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚀 TLDR (Read This First)

**Project**: TrumpyTracker - AI-powered political accountability tracker (RSS feeds → Stories → AI summaries)  
**Environment**: TEST branch (Supabase TEST DB) | PROD = main branch (protected, PR-only)  
**Budget**: <$50/month HARD LIMIT  
**Critical**: ALWAYS work on `test` branch | NEVER `git push origin main` (blocked)  
**Workflow**: Code → Test with subagent → Run QA → Commit → Push test → Check AI review → Auto-deploy  
**Tools Available**: Supabase MCP, Atlassian (JIRA) MCP, Filesystem MCP  
**Owner**: Josh (non-dev PM) - Wants business impact, single recommendations, cost clarity  

---

## 🔄 Session Workflow Checklist

### ✅ Start Every Session (5 min)
- [ ] Read latest handoff: `/docs/handoffs/[latest-date].md`
- [ ] Verify on `test` branch: `git branch --show-current`
- [ ] Query JIRA via subagent (if ticket-based work): `Task(general-purpose): "Query TTRC-XXX, return summary only"`
- [ ] Review existing plan OR create if complex: `/docs/plans/`
- [ ] Read `/docs/code-patterns.md` and `/docs/common-issues.md` before implementing
- [ ] Create TodoList with FULL workflow (code → validate → QA → commit → JIRA → handoff)

### 🔨 During Work
- [ ] Follow plan/todos linearly (don't jump around)
- [ ] Validate with subagent BEFORE marking todos complete
- [ ] Check MCP tools before claiming "I can't"

### ✅ End Every Session (10 min)
- [ ] Run QA tests: `npm run qa:smoke` or relevant suite
- [ ] Commit & push to test branch
- [ ] **MANDATORY**: Check AI code review: `bash scripts/check-code-review.sh`
  - ⏱️ **AI reviews take 5-10 minutes** - Don't burn tokens polling repeatedly
  - After push, inform user: "AI code review triggered, check back in ~5 min"
  - User will ask you to check status when ready
- [ ] Update JIRA via MCP (DO IT, don't just say "needs update")
- [ ] Create handoff: `/docs/handoffs/YYYY-MM-DD-ttrc-XXX-topic.md`
- [ ] Report token usage

**Skip plan.md for:** Simple bugs, 1-2 file changes, well-understood patterns  
**Always create plan.md for:** New features, architecture changes, multiple approaches, cost analysis

---

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
4. **🚨 MANDATORY: Check AI code review** (`bash scripts/check-code-review.sh`)
5. Auto-deploys to Netlify TEST site

**For PROD (deployments only):**
1. Create deployment branch from `main`
2. **Check `.claude/test-only-paths.md`** - skip commits for test-only files
3. Cherry-pick tested commits from `test`
4. Push deployment branch
5. Create PR to `main` via `gh pr create`
6. Merge PR (auto-deploys to trumpytracker.com)

### ❌ What will break:
- `git push origin main` → ❌ BLOCKED (protected branch)
- `git merge test` into main → ❌ WRONG (use cherry-pick)
- Editing files on main → ❌ BLOCKED (must use PR)

---

## 📜 Critical Rules

1. 🧪 **MANDATORY TESTING: Use Task tool (general-purpose agent) to validate ALL code changes before commit/PR**
   - After ANY code changes to scripts/, supabase/functions/, migrations/
   - Before marking todos complete
   - Before creating PRs
   - Test edge cases, regressions, and integration points
   - Example: `Task(general-purpose): "Validate RSS fix - test duplicate URLs, check DB constraints, verify no errors"`
   - **Before pushing:** Run relevant QA tests (`npm run qa:smoke` or specific test suite)

2. **Work on TEST branch unless explicitly told otherwise**

3. **Check available MCP tools FIRST** - Never claim "I can't" without verifying

4. **JIRA Operations via Subagent** - Use Task tool (general-purpose) for JIRA queries to isolate 20K+ context cost
   - JIRA MCP tools return full ticket dumps (descriptions, comments, history, attachments)
   - Single ticket query = 20-30K tokens in main conversation
   - Use subagent pattern: `Task(general-purpose): "Query JIRA ticket [ID], perform [ACTION], return summary only (not full ticket dump)"`
   - Subagent processes JIRA internally, returns ~100 token summary
   - Alternative: Use `/jira` command (see `/docs/COMMANDS.md`)
   - **Context savings: 99.5% (20K → 100 tokens)**

5. **Auto-QA always** - Check edge cases, regressions, cost after every change

6. **Handoffs to /docs/handoffs/** - Never add to project knowledge base

7. **State cost implications** - Always mention $ impact for new features

8. **Follow PR workflow** - See `/docs/CLAUDE-CODE-PR-WORKFLOW.md` and `/docs/AI-CODE-REVIEW-GUIDE.md` for full PR process

9. **Use TodoWrite for workflow tracking** - Include full workflow items (code + validation + JIRA + handoff) in todos

10. **🚨 MANDATORY: Check AI code review after EVERY push** - Run `bash scripts/check-code-review.sh` or `gh run list --workflow="ai-code-review.yml" --limit 1` - Never skip this step

11. **Report token usage** - End every response with usage stats

12. **🚨 DATABASE EGRESS: Minimize data transfer from Supabase**
   - Supabase free tier = 5GB/month egress. Overages cost $0.09/GB
   - **MCP queries:** Always use `select=id,field1,field2` not `select=*`
   - **Always use `limit`:** Default to `limit=10` for exploration
   - **NEVER fetch `embedding` or `content` fields** unless absolutely required (embeddings = 6KB each, content = 5KB+ each)
   - **Re-cluster/backfill scripts are EXPENSIVE:** Fetching 1800 articles with embeddings = ~5-7GB egress
   - **Before running bulk scripts:** Warn about egress cost, consider if necessary

**For session workflow, communication style, and documentation structure, see `/docs/PROJECT_INSTRUCTIONS.md`**

---

## ❌ Anti-Patterns (What NOT to Do)

### Git/Deployment
- ❌ `git push origin main` - BLOCKED by branch protection (use PRs)
- ❌ `git merge test` into main - WRONG (use cherry-pick from test to deployment branch)
- ❌ Skip AI code review check - MANDATORY after every push
- ❌ Direct edits on main branch - BLOCKED (must use PR workflow)

### Database
- ❌ OFFSET pagination - Slow at scale (use cursor-based with `lt('id', cursor)`)
- ❌ `timestamp` without timezone - Always use `timestamptz`
- ❌ Missing `IF NOT EXISTS` in migrations - Breaks idempotency
- ❌ Hardcoded IDs in queries - Use parameterized queries
- ❌ Missing `ON DELETE` behavior - Always specify CASCADE/SET NULL/RESTRICT

### Database Egress (Critical - costs real money!)
- ❌ `select=*` in MCP queries - Use `select=id,field1,field2` (only fields needed)
- ❌ Queries without `limit` - Always add `limit=10` for exploration
- ❌ Fetching `embedding` field - 6KB per row, use only when computing similarity
- ❌ Fetching `content` field from articles - 5KB+ per row, use only when needed
- ❌ Running re-cluster/backfill without warning - 1800 articles with embeddings = 5-7GB egress
- ❌ Multiple Claude sessions doing heavy exploration - Egress accumulates across sessions

### Code
- ❌ `str_replace` for file edits - FAILS (use `mcp__filesystem__edit_file` tool)
- ❌ Object references in `useEffect` dependencies - Causes infinite loops
- ❌ Missing CORS headers in Edge Functions - Breaks frontend calls
- ❌ `console.log` in production - Remove before commit
- ❌ Unhandled promise rejections - Always use try-catch for async

### Workflow
- ❌ Say "needs JIRA update" - DO IT immediately via MCP tools
- ❌ Skip validation testing - Use Task tool (general-purpose agent) first
- ❌ Assume "I can't" - Check available MCP tools first
- ❌ Create new files without reading existing - ALWAYS prefer editing existing files
- ❌ Skip QA tests before push - Run `npm run qa:smoke` or relevant suite

### Cost/Budget
- ❌ Propose features without stating cost - Always mention $ impact
- ❌ Ignore daily budget limits - Check `budgets` table before OpenAI calls
- ❌ Use expensive models unnecessarily - GPT-4o-mini is sufficient for enrichment

---

## Project Context

**TrumpyTracker** is an AI-powered political accountability tracker that aggregates news from RSS feeds, clusters related articles into stories, and enriches them with AI summaries.

**Owner:** Josh (Product Manager, non-developer) - Prefers business impact explanations and single recommendations with cost implications stated clearly.

**Budget:** <$50/month hard limit

---

## 💰 Budget Enforcement

**Hard Limits:**
- Total: $50/month across all services
- Daily pipeline cap: $5/day for story enrichment
- Supabase egress: 5GB/month free tier (overages: $0.09/GB)
- Current spend: ~$20/month (OpenAI only)

**Cost per Operation:**
- Story enrichment: ~$0.003/story (GPT-4o-mini)
- AI code review: $0.30-$1.00/PR (GPT-4o)
- Article scraping: Free (no API costs)
- Database queries: Free (within Supabase free tier)
- **Re-cluster job (1800 articles):** ~5-7GB egress ($0.18-0.63 overage)
- **MCP query (articles with content):** ~5KB per row
- **MCP query (articles with embeddings):** ~6KB per row

**Before Making OpenAI Calls:**
```sql
-- Check today's spend via Supabase MCP
SELECT spent_usd, openai_calls 
FROM budgets 
WHERE day = CURRENT_DATE;

-- If spent_usd > $5.00, HALT enrichment
-- Log warning and skip enrichment job
```

**Budget Monitoring:**
- Daily budget tracked in `budgets` table
- Auto-enforced in job-queue-worker.js
- Manual check: Query budgets table before proposing new AI features

**CRITICAL RULE: Always state cost implications before proposing new features or suggesting additional AI calls.**

---

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
# Project References (IMPORTANT - use correct ref for environment):
# TEST:  --project-ref wnrjrywpcadwutfykflu  (TrumpyTracker-Test)
# PROD:  --project-ref osjbulmltfpcoldydexg  (TrumpyTracker)

# Deploy functions to TEST (default for development)
supabase functions deploy stories-active --project-ref wnrjrywpcadwutfykflu
supabase functions deploy stories-detail --project-ref wnrjrywpcadwutfykflu
supabase functions deploy stories-search --project-ref wnrjrywpcadwutfykflu
supabase functions deploy articles-manual --project-ref wnrjrywpcadwutfykflu
supabase functions deploy queue-stats --project-ref wnrjrywpcadwutfykflu
supabase functions deploy rss-enqueue --project-ref wnrjrywpcadwutfykflu
```

### Database Migrations
```bash
# Apply migrations in order from /migrations/
node scripts/apply-migrations.js
```

## Core Architecture

### RSS Ingestion Pipeline

**Current System (TTRC-266 - Inline Automation):**
```
GitHub Actions (every 2 hours on main, manual on test)
    ↓ Runs
rss-tracker-supabase.js (inline script)
    ├── Fetches all active feeds directly
    ├── Clusters articles into stories
    └── Enriches stories with AI summaries
        ↓ Writes to
Stories + Articles Tables
    ↓ Queries via
Edge Functions (stories-active, stories-detail)
    ↓ Serves
Frontend (public/index.html, public/story-view/)
```

**Trigger Methods:**
- **TEST:** `gh workflow run "RSS Tracker - TEST" --ref test`
- **PROD:** Auto-runs every 2 hours via `rss-tracker-prod.yml`

**Legacy System (DEPRECATED - do not use):**
```
rss-enqueue Edge Function → job_queue table → job-queue-worker.js
(Creates jobs but no worker processes them)
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
- See JIRA Workflow below for issue type rules

**Filesystem Access:** Direct file operations in project directory
- **ALWAYS use `mcp__filesystem__edit_file` for edits** - NEVER use str_replace (it fails)

## Tech Stack

- **Backend:** Supabase (PostgreSQL + Edge Functions)
- **Frontend:** Vanilla JS, HTML5, CSS3, Tailwind CSS
- **Worker:** Node.js (job-queue-worker.js)
- **AI:** OpenAI GPT-4o-mini for enrichment
- **RSS Parsing:** rss-parser npm package
- **Deployment:** Netlify (static site + branch deploys)
- **Automation:** GitHub Actions (scheduled jobs)

## JIRA Workflow

**Issue Types (4 total):**
- **Epic** = Major product area (e.g., SCOTUS Tracker, Pardons Tracker)
- **Feature** = Distinct functional area within an Epic
- **Story** = 1 context window of dev work (code → test → deploy)
- **Bug** = Something is broken

**NOT USED:** Task, Sub-task

**Labels for grouping:** `clustering`, `security`, `ui`, `rss`, `infra`, `docs`

**Quick Rules:**
| If the work is... | Create a... |
|-------------------|-------------|
| New product section/tracker | Epic |
| Functional area within Epic | Feature |
| Any dev work (1 session) | Story |
| Something broken | Bug |

**Status Workflow:** Backlog → In Progress → In Review → Ready for Test → Done

**Use `/jira` command** for all JIRA operations. See `/docs/guides/jira-workflow.md` for full details.

### Epic → Feature → Story Hierarchy

**The 3-Tier Pattern:**
```
Epic: [Product Area]
├── Feature: [Functional Area 1]
│   ├── Story: DB schema + migrations
│   ├── Story: Edge function / API
│   ├── Story: UI cards + list view
│   └── Story: Detail modal
├── Feature: [Functional Area 2]
│   ├── Story: ...
│   └── Story: ...
└── Feature: [Functional Area 3]
    └── Story: ...
```

**Real Example - SCOTUS Tracker:**
```
Epic: SCOTUS Tracker
├── Feature: Rulings & Opinions
│   ├── Story: DB schema (rulings, justices, votes)
│   ├── Story: Edge function (rulings-list, ruling-detail)
│   ├── Story: UI cards + filters
│   └── Story: Detail modal with vote breakdown
├── Feature: Schedule & Oral Arguments
│   ├── Story: DB schema (cases, arguments, calendar)
│   ├── Story: Calendar UI component
│   └── Story: Case detail view
└── Feature: Emergency/Shadow Docket
    ├── Story: DB schema (emergency orders)
    ├── Story: Shadow docket list + alerts
    └── Story: Emergency order detail view
```

### Story Sizing: 1 Story = 1 Context Window

**Core Principle:** A Story must be completable in a single Claude Code session.
- Planning happens BEFORE (separate session → creates plan + Stories)
- Dev session: Code → Test → Deploy → Done
- No multi-session Stories - if it doesn't fit, split it

**Story Sizing Checklist:**
| Fits in 1 session? | Guideline |
|--------------------|-----------|
| ✅ Yes | Single focus, 1-3 files, clear acceptance criteria |
| ✅ Yes | DB migration + edge function OR UI component (not both) |
| ✅ Yes | Bug fix with known root cause |
| ❌ No, split it | Multiple unrelated changes |
| ❌ No, split it | Full stack (DB + API + UI) for new feature |
| ❌ No, split it | Requires research/exploration first |

**Planning vs Dev Sessions:**
| Session Type | Purpose | Output |
|--------------|---------|--------|
| Planning | Research, design, decompose Epic | Plan doc + Features + Stories in ADO |
| Dev | Execute 1 Story | Working code + tests + deploy + handoff |

**Before Creating a Story, Verify:**
1. Acceptance criteria are explicit (not "make it work")
2. Dependencies are done (no blockers)
3. Technical approach is decided (no research needed)
4. Scope fits: Can you describe the changes in <5 sentences?

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

### Trigger RSS Fetch (TEST Environment)
**IMPORTANT:** Use the GitHub Actions workflow, NOT the legacy `rss-enqueue` endpoint.
See: `docs/guides/triggering-rss-tracker-test.md` for full details.

```bash
# Correct method - triggers the inline RSS tracker workflow
gh workflow run "RSS Tracker - TEST" --ref test

# Monitor the run
gh run watch

# Or view at: https://github.com/AJWolfe18/TTracker/actions/workflows/rss-tracker-test.yml
```

**DO NOT USE** (creates orphaned jobs):
- `bash scripts/monitoring/trigger-rss.sh`
- `curl .../rss-enqueue`

### Monitor Job Queue
```sql
SELECT job_type, status, COUNT(*)
FROM job_queue
GROUP BY job_type, status
ORDER BY job_type, status;
```

## Feature-Dev Plugin Usage

When starting work on:
- New frontend components or pages
- Database schema additions
- Multi-file architectural changes
- Features spanning 3+ files

Use `/feature-dev` for structured development workflow with specialist agents:
- `code-explorer` - Analyzes codebase patterns
- `code-architect` - Designs feature architecture
- `code-reviewer` - Validates code quality

**Skip for:** bug fixes, single-file changes, JIRA updates, RSS feed additions.

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

**Last Updated:** 2025-12-03
**Maintained by:** Josh + Claude Code
**For Support:** See `/docs/PROJECT_INSTRUCTIONS.md`
