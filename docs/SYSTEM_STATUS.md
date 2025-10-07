# TrumpyTracker System Status

## Current Production State (October 2025)

### ✅ Working Systems

#### Political Tracker (Old System)
- **Status:** Operational but being replaced
- **Schedule:** Daily at 9am & 10am EST
- **Cost:** ~$20-25/month
- **Issues:** Duplicates, AI hallucinations, cost inefficient
- **Table:** `political_entries`

#### Executive Orders Tracker  
- **Status:** Fully operational
- **Schedule:** Daily at 11am EST
- **Coverage:** 184 EOs since Jan 20, 2025
- **Source:** Federal Register API
- **Table:** `executive_orders`

#### Admin Panel
- **URL:** `/admin.html`
- **Features:** View, edit, delete, manual submission
- **Auth:** GitHub token required

#### Public Dashboard
- **URL:** `/` (index.html)
- **Features:** View entries, filter by category/severity
- **Data:** Reads from master-tracker-log.json

### 🚧 In Development (TEST Environment)

#### RSS Pipeline (NEW System)
- **Status:** 95% complete, pending TTRC-169 fix
- **Components:**
  - ✅ Feed fetcher with 304 support
  - ✅ Job queue with atomic operations
  - ✅ Story clustering algorithm
  - ✅ Database schema and migrations
  - ⚠️ Headline field mismatch (5-minute fix needed)
- **Performance:** 50% cost reduction, 40% dedup improvement

#### Story View UI
- **Status:** Design complete, implementation pending
- **JIRA:** TTRC-145, TTRC-149
- **Features:** 3-column cards, spicy summaries, category filters

### 📊 Database Schema

#### Production Tables
```sql
political_entries     -- Old article system
executive_orders     -- EO tracking
```

#### RSS System Tables (TEST only, pending PROD deployment)
```sql
articles            -- Individual news items
stories            -- Clustered story groups
story_articles     -- Mapping table
feed_registry      -- RSS feed configuration
job_queue         -- Async job processing
```

### 🎯 11-Category System

All political news categorized into:
1. `immigration_border` - Immigration & Border Security
2. `justice_legal` - Justice System & Legal Affairs
3. `government_ops` - Government Operations & Personnel
4. `corruption_scandals` - Corruption & Scandals
5. `voting_elections` - Voting Rights & Elections
6. `foreign_policy` - Foreign Policy & International
7. `economy_finance` - Economy & Financial Policy
8. `healthcare` - Healthcare Policy
9. `environment_climate` - Environment & Climate
10. `civil_rights` - Civil Rights & Social Issues
11. `other` - Uncategorized

### 📈 Metrics

#### Current Performance
- **Articles/day:** 100-200 from RSS feeds
- **Stories/day:** 20-40 after clustering
- **Deduplication:** 40% reduction
- **Cost:** $35/month (target <$50)

#### RSS Feeds Status
| Feed | Status | Success Rate |
|------|--------|--------------|
| NYT Politics | ✅ Working | 95% |
| WaPo Politics | ✅ Working | 92% |
| Politico | ✅ Working | 88% |
| Reuters | ❌ Needs User-Agent | 0% |
| AP News | ❌ DNS issues | 0% |

### 🔧 Configuration

#### Environment Detection
- TEST branch + TEST_BRANCH_MARKER.md → Test DB
- main branch → Production DB
- Manual override: `USE_TEST_DB=true`

#### API Keys Required
- OpenAI API (for summaries)
- Supabase service keys (TEST and PROD)
- GitHub token (for admin panel)

### 🚀 Migration Path

#### From Old to New System
1. **Current:** Daily tracker → political_entries
2. **Future:** RSS feeds → articles → stories
3. **Migration:** Run parallel for 1 week, then cutover
4. **Rollback:** Keep old system dormant for 30 days

#### Pending Production Deployment
- Apply migrations 001-017 to PROD
- Deploy RSS pipeline code
- Update Edge Functions
- Switch frontend to story view

### 📝 Active JIRA Tickets

#### Critical Path
- **TTRC-169:** Fix headline field (5 min) - BLOCKER
- **TTRC-145:** Story View Components
- **TTRC-149:** Category Filter Implementation

#### Ready for Production
- **TTRC-140:** RSS Feed Fetcher ✅
- **TTRC-137:** Job Queue ✅
- **TTRC-142:** Story Clustering ✅

### 🎨 UI Components Status

#### Completed
- Admin panel (React)
- Dashboard (React)
- Test health check page

#### In Progress
- Story view (designed, not built)
- Timeline view (planned)
- Search improvements

### 📅 Deployment Timeline

#### This Week
1. Fix TTRC-169 (headline issue)
2. Deploy RSS to production
3. Run parallel with old system

#### Next Week
1. Build story view UI
2. Implement category filters
3. Switch frontend to new system

#### Week 3
1. Deprecate old daily tracker
2. Monitor and optimize
3. Add missing features

### ⚠️ Known Issues

#### Production
- Some AI-generated headlines don't match articles
- Duplicate detection only 60% effective
- Manual article processor intermittent failures

#### RSS System (TEST)
- Reuters/AP feeds need User-Agent header
- Headline vs title field mismatch (TTRC-169)
- No UI yet for story view

### 📚 Key Documents

#### Must Read
- `/docs/STARTUP_INSTRUCTIONS.md` - How to begin
- `/docs/guides/features/rss-pipeline-operations.md` - RSS system guide
- `/docs/BREAK_GLASS_RSS_FIX.md` - Emergency procedures

#### Reference
- `/docs/Daily-Tracker-Business-Logic.md` - Old system logic
- `/docs/handoffs/` - Recent session summaries
- `/migrations/` - Database change history

### 🔗 Quick Links

#### Production
- Site: https://trumpytracker.com
- Admin: https://trumpytracker.com/admin.html

#### Test
- Site: https://test--taupe-capybara-0ff2ed.netlify.app/
- Health: https://test--taupe-capybara-0ff2ed.netlify.app/test-health-check.html

#### Infrastructure  
- GitHub: https://github.com/AJWolfe18/TTracker
- Supabase: https://app.supabase.com
- Netlify: https://app.netlify.com

---

*Status as of: October 2025*
*Next update due: After RSS production deployment*
