# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 🚀 TLDR (Read This First)

**Project**: TrumpyTracker - AI-powered political accountability tracker (RSS feeds → Stories → AI summaries)
**Environment**: TEST branch (Supabase TEST DB) | PROD = main branch (protected, PR-only)
**Budget**: <$50/month HARD LIMIT
**Critical**: ALWAYS work on `test` branch | NEVER `git push origin main` (blocked)
**Workflow**: Code → Code Review → QA → Commit → Update ADO → Push test → Handoff
**Source of Truth**: ADO for status, plans for implementation details only
**Tools Available**: Supabase MCP, Azure DevOps MCP, Filesystem MCP
**Owner**: Josh (non-dev PM) - Wants business impact, single recommendations, cost clarity

---

## 📁 Quick Reference

**First 3 commands every session:**
1. `git branch --show-current` → Must be `test`
2. Read `/docs/handoffs/[latest].md`
3. Check if handoff references a plan → EXECUTE it (don't re-plan)

**Key docs:**
- `/docs/features/[feature]/` - PRD, plans, notes for active features
- `/docs/handoffs/` - Session handoffs
- `/docs/guides/ado-workflow.md` - ADO states and work item types
- `/docs/guides/prod-deployment-checklist.md` - PROD deployment requirements
- `/docs/guides/feature-flags.md` - Feature flag system for safe deployments
- `/docs/database/database-schema.md` - Full schema reference

**Feature folders:** Each major feature gets its own folder in `/docs/features/`:
```
docs/features/
├── pardons-tracker/     # Active feature
│   ├── prd.md
│   └── plan.md
└── rss-enrichment/      # System feature
    └── spicy-prompts-guide.md
```

---

## 🔄 Session Workflow Checklist

### ✅ Start Every Session (5 min)
- [ ] Read latest handoff: `/docs/handoffs/[latest-date].md`
- [ ] Verify on `test` branch: `git branch --show-current`
- [ ] Query ADO via `/ado` command (if ticket-based work)
- [ ] Review existing plan in `/docs/features/[feature]/` OR create if complex
- [ ] Read `/docs/code-patterns.md` and `/docs/common-issues.md` before implementing
- [ ] Create TodoList with FULL workflow (code → validate → QA → commit → ADO → handoff)

### 🔨 During Work
- [ ] Follow plan/todos linearly (don't jump around)
- [ ] Validate with subagent BEFORE marking todos complete
- [ ] Check MCP tools before claiming "I can't"
- [ ] **Run code review** on any non-trivial change: `Task(feature-dev:code-reviewer)`
  - Skip only for: typo fixes, single-line changes, config tweaks
  - Run for: logic changes, new functions, bug fixes, refactoring

### ✅ End Every Session (10 min)
- [ ] Run code review: `Task(feature-dev:code-reviewer)` - unless trivial change
- [ ] Run QA tests: `npm run qa:smoke` or relevant suite
- [ ] Commit & push to test branch → Auto-deploys to test site
- [ ] **Update ADO** via `/ado` command - move to appropriate state (Active → Testing if done)
- [ ] If schema/architecture/patterns changed → Update relevant doc in `/docs/`
- [ ] Create brief handoff: `/docs/handoffs/YYYY-MM-DD-ado-XXX-topic.md`
  - 1 paragraph max: ADO ticket, state change, what to do next
  - Example: "ADO-123 moved to Testing. SCOTUS frontend complete. Next: verify on test site, then Ready for Prod."

**Skip plan for:** Simple bugs, 1-2 file changes, well-understood patterns
**Create feature folder for:** New features, architecture changes, cost analysis needed

---

## 📋 Working with Plans

### Plans vs ADO

| What | Where | Purpose |
|------|-------|---------|
| **Status** | ADO ticket | Current state, blockers, progress |
| **Implementation details** | Plan doc | Technical steps, code patterns |
| **Issues/blockers** | ADO comments | Problems encountered |
| **What happened** | Handoff (brief) | Context for next session |

**Plans are ephemeral** - they hold implementation details during active development.
**ADO is persistent** - it tracks status across sessions.

### Decision Tree: Plan or Execute?

| Situation | Action |
|-----------|--------|
| Handoff references existing plan | **EXECUTE** that plan (don't create new) |
| Complex feature (3+ files, multi-phase) | **CREATE** plan in `/docs/features/[feature]/` |
| Simple task (1-2 files, clear scope) | **JUST DO IT** (no plan needed) |
| Bug fix with known cause | **JUST DO IT** |

### When Plan Exists:
1. Open plan file at specified location
2. Check ADO ticket for current status
3. Execute tasks from plan sequentially
4. Update ADO when milestones complete
5. Create brief handoff at session end

### DON'T DO THIS:
- ❌ Track STATUS in plan docs (use ADO)
- ❌ Create new plan when one already exists
- ❌ Write detailed handoffs (1 paragraph max)
- ❌ Duplicate ADO info in multiple places

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
4. Auto-deploys to Netlify TEST site
5. **Note:** No AI code review on direct pushes (review only runs on PRs)

**For PROD (deployments only):**
1. Create deployment branch from `main`
2. **Check `.claude/test-only-paths.md`** - skip commits for test-only files
3. Cherry-pick tested commits from `test`
4. Push deployment branch
5. Create PR to `main` via `gh pr create`
6. **AI code review runs automatically on PR** - check with `gh pr view`
7. Merge PR (auto-deploys to trumpytracker.com)

### ❌ What will break:
- `git push origin main` → ❌ BLOCKED (protected branch)
- `git merge test` into main → ❌ WRONG (use cherry-pick)
- Editing files on main → ❌ BLOCKED (must use PR)

---

## 🚀 Promotion to PROD

### Before Creating PR to Main:
- [ ] Changes tested on TEST environment
- [ ] `npm run qa:smoke` passes
- [ ] AI code review passed
- [ ] Security quick-check: `/docs/guides/security-checklist.md`
- [ ] **PROD deployment checklist:** `/docs/guides/prod-deployment-checklist.md`
  - Migrations, edge functions, workflows, secrets all accounted for
- [ ] Check `.claude/test-only-paths.md` - skip test-only files

### Test-Only Tracking:
**File:** `.claude/test-only-paths.md`

**Add to this file when:**
- Creating one-time scripts (migration helpers, data fixes)
- Adding debug/monitoring tools not needed in prod
- Temporary config changes for testing

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

4. **ADO Operations via `/ado` command** - Isolates 20K+ context cost
   - ADO MCP tools return full work item dumps
   - Use `/ado` command to query/update work items
   - See `.claude/commands/ado.md` for syntax
   - **Context savings: 99.5% (20K → 100 tokens)**

5. **Auto-QA always** - Check edge cases, regressions, cost after every change

6. **Handoffs to /docs/handoffs/** - Never add to project knowledge base

7. **State cost implications** - Always mention $ impact for new features

8. **Follow PR workflow** - See `/docs/guides/pr-workflow.md` for full PR process
   - **PR code review:** Comment `@codex review` on the PR (uses OpenAI Codex, included in ChatGPT Plus)
   - Codex follows guidelines in `AGENTS.md`

9. **Use TodoWrite for workflow tracking** - Include full workflow items (code + validation + ADO + handoff) in todos

10. **AI code review only runs on PRs** - Direct pushes to test don't trigger review. When creating PRs for PROD, check review status with `gh pr view` or `bash scripts/check-code-review.sh`

11. **🚨 DATABASE EGRESS: Minimize data transfer from Supabase**
   - Supabase free tier = 5GB/month egress. Overages cost $0.09/GB
   - **MCP queries:** Always use `select=id,field1,field2` not `select=*`
   - **Always use `limit`:** Default to `limit=10` for exploration
   - **NEVER fetch `embedding` or `content` fields** unless absolutely required (embeddings = 6KB each, content = 5KB+ each)
   - **Re-cluster/backfill scripts are EXPENSIVE:** Fetching 1800 articles with embeddings = ~5-7GB egress
   - **Before running bulk scripts:** Warn about egress cost, consider if necessary

12. **🚩 FEATURE FLAGS: Use for new features deploying to PROD**
   - New features deploy with flag OFF in `public/shared/flags-prod.json`
   - Test on PROD with URL override: `?ff_featurename=true`
   - Flip flag ON only after verification
   - See `/docs/guides/feature-flags.md` for full guide
   - **v1→v2 migrations:** Plan compatibility upfront (database, backend, frontend layers)

**For session workflow, communication style, and documentation structure, see `/docs/PROJECT_INSTRUCTIONS.md`**

---

## ❌ Anti-Patterns (What NOT to Do)

### Git/Deployment
- ❌ `git push origin main` - BLOCKED by branch protection (use PRs)
- ❌ `git merge test` into main - WRONG (use cherry-pick from test to deployment branch)
- ❌ Direct edits on main branch - BLOCKED (must use PR workflow)
- ❌ Expecting AI review on test pushes - Review only runs on PRs (not direct pushes)

### CI Workflows
- ❌ Ignoring "Lint PROD References" failures - This workflow prevents hardcoded PROD URLs in test code
  - If it fails: A script has a hardcoded PROD Supabase reference not in the allowlist
  - To fix: Either remove the hardcoded ref OR add to allowlist in `.github/workflows/lint-prod-refs.yml`
  - Allowlist is for legitimate uses (e.g., PROD detection for safety prompts, not actual connections)
  - **Never ignore red badges** - they mean something is wrong

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
- ❌ Say "needs ADO update" - DO IT immediately via `/ado` command
- ❌ Skip validation testing - Use Task tool (general-purpose agent) first
- ❌ Assume "I can't" - Check available MCP tools first
- ❌ Create new files without reading existing - ALWAYS prefer editing existing files
- ❌ Skip QA tests before push - Run `npm run qa:smoke` or relevant suite

### Cost/Budget
- ❌ Propose features without stating cost - Always mention $ impact
- ❌ Ignore daily budget limits - Check `budgets` table before OpenAI calls
- ❌ Use expensive models unnecessarily - GPT-4o-mini is sufficient for enrichment

### Language/Runtime
- ❌ **Using Python in this project** - NO PYTHON IN THIS REPO
  - This is a Node.js/JavaScript project
  - Never run `python3`, `pip`, or Python scripts
  - For data processing: Use `node -e "..."` or SQL via MCP

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
- Auto-enforced in `rss-tracker-supabase.js`
- Manual check: Query budgets table before proposing new AI features

**CRITICAL RULE: Always state cost implications before proposing new features or suggesting additional AI calls.**

---

## Environment Architecture

### TEST Environment (test branch)
- **Database:** Supabase TEST (RSS + Story Clustering schema)
- **Deploy:** Auto-deploy to Netlify test site
- **Status:** Active development (~2700 stories, ~3100 articles, 18 feeds)
- **Marker File:** `TEST_BRANCH_MARKER.md` presence indicates TEST environment

### PROD Environment (main branch)
- **Database:** Supabase PROD (RSS v2 - same schema as TEST)
- **Deploy:** Auto-deploy to trumpytracker.com
- **Status:** Production RSS v2 system

**NEVER merge test→main. Always cherry-pick tested commits.**

### GitHub Secrets (EXACT names)
| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | PROD Supabase URL |
| `SUPABASE_SERVICE_KEY` | PROD service role key |
| `SUPABASE_ANON_KEY` | PROD anon key |
| `SUPABASE_TEST_URL` | TEST Supabase URL |
| `SUPABASE_TEST_SERVICE_KEY` | TEST service role key |
| `SUPABASE_TEST_ANON_KEY` | TEST anon key |
| `OPENAI_API_KEY` | OpenAI (shared) |
| `PERPLEXITY_API_KEY` | Perplexity (shared) |
| `EDGE_CRON_TOKEN` | Edge function auth (TEST) |
| `EDGE_CRON_TOKEN_PROD` | Edge function auth (PROD) |

**Important:** Workflows inject secrets into `SUPABASE_SERVICE_ROLE_KEY`. The secret NAME is `SUPABASE_SERVICE_KEY` but scripts read `SUPABASE_SERVICE_ROLE_KEY`.

## Development Commands

### Local Development
```bash
# Frontend local server
npm run server

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
Frontend (public/index.html)
```

**Trigger Methods:**
- **TEST:** `gh workflow run "RSS Tracker - TEST" --ref test`
- **PROD:** Auto-runs every 2 hours via `rss-tracker-prod.yml`

### Database Schema (Summary)

**Core tables:** `stories`, `articles`, `article_story`, `feed_registry`, `budgets`

**Key constraints:**
- Articles: UNIQUE(url_hash, published_date)
- Stories: UNIQUE(story_hash), status: 'active' | 'closed' | 'archived'

**Critical RPCs:**
- `attach_or_create_article()` - Idempotent article insertion
- `get_stories_needing_enrichment()` - Find unenriched stories

**Full schema:** `/docs/database/database-schema.md`

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
UI labels → Database enum values (defined in `scripts/enrichment/enrich-stories-inline.js`):
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

**Supabase TEST Database:** Full query access via `mcp__supabase-test__postgrestRequest`
- Use for: Data exploration, verification, ad-hoc queries
- Example: `GET /stories?select=count` or use `sqlToRest` for SQL conversion

**Azure DevOps Integration:** Direct work item operations
- **Use `/ado` command** for all work item operations
- See `/docs/guides/ado-workflow.md` for states, types, and workflow

**Filesystem Access:** Direct file operations in project directory
- **ALWAYS use `mcp__filesystem__edit_file` for edits** - NEVER use str_replace (it fails)

## Tech Stack

- **Backend:** Supabase (PostgreSQL + Edge Functions)
- **Frontend:** Vanilla JS, HTML5, CSS3, Tailwind CSS
- **AI:** OpenAI GPT-4o-mini for enrichment
- **RSS Parsing:** rss-parser npm package
- **Deployment:** Netlify (static site + branch deploys)
- **Automation:** GitHub Actions (scheduled jobs)

## ADO Workflow

**ADO is the source of truth for status.** Update it every session.

**Project:** TTracker (`https://dev.azure.com/AJWolfe92/TTracker`)

**States:** `New → Todo → Active → Testing → Ready for Prod → Closed`

**Quick Rules:**
| If the work is... | Create a... |
|-------------------|-------------|
| Major product area | Epic |
| Any dev work (1 session) | User Story |
| Something broken | Bug |

**Use `/ado` command** for all operations. See `/docs/guides/ado-workflow.md` for full workflow details.

**Story Sizing:** 1 Story = 1 Claude Code session (code → review → test → deploy → done)

**Where things go:**
- Status/progress → ADO ticket state
- Blockers/issues → ADO ticket comments
- Plan link → ADO ticket description
- Implementation details → Plan doc (if exists)

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

**DO NOT USE** (legacy endpoints - creates orphaned jobs):
- `curl .../rss-enqueue`

### Fetch SCOTUS Cases (CourtListener API)
**Script:** `scripts/scotus/fetch-cases.js`
**Requires:** `COURTLISTENER_API_TOKEN` environment variable

```bash
# Fetch recent cases (2024+) - limit to 20 for testing
COURTLISTENER_API_TOKEN=<token> node scripts/scotus/fetch-cases.js --since=2024-01-01 --limit=20

# Dry run (no database writes)
COURTLISTENER_API_TOKEN=<token> node scripts/scotus/fetch-cases.js --since=2024-01-01 --limit=5 --dry-run

# Resume from last sync state (for incremental fetches)
COURTLISTENER_API_TOKEN=<token> node scripts/scotus/fetch-cases.js --resume

# Check cases in database
SELECT id, case_name, term, decided_at, majority_author FROM scotus_cases ORDER BY decided_at DESC LIMIT 10;
```

**Notes:**
- Cases start with `is_public = false` (need enrichment/review before publishing)
- Sync state tracked in `scotus_sync_state` table (singleton)
- API rate limit: 5000 requests/hour with exponential backoff on 429

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

**Skip for:** bug fixes, single-file changes, ADO updates, RSS feed additions.

## Troubleshooting

### Feed Not Processing
1. Check `SELECT * FROM feed_registry WHERE is_active = true`
2. Verify `failure_count < 5`
3. Check GitHub Actions run logs: `gh run list --workflow="rss-tracker-test.yml" --limit 5`

### Duplicate Articles
1. Verify `url_hash` generation
2. Check composite unique constraint: `(url_hash, published_date)`
3. Review `attach_or_create_article` RPC logic

### Missing AI Enrichment
1. Check OpenAI API key in environment
2. Verify daily budget not exceeded: `SELECT * FROM budgets ORDER BY day DESC`
3. Check GitHub Actions logs for enrichment errors

---

**Last Updated:** 2026-01-20
**Maintained by:** Josh + Claude Code
**For Support:** See `/docs/PROJECT_INSTRUCTIONS.md`
