# TrumpyTracker Startup Instructions

## Quick Start for New Session

### 1. Check Handoffs
```bash
# Look for recent handoffs
ls -la docs/handoffs/*.md | tail -5

# Read most recent if exists
cat docs/handoffs/[latest-date].md
```

### 2. Identify Current Branch & Goal
- **Ask:** "What's our goal today?"
- **Check branch:** Look at GitHub Desktop or `git branch`
- **Environment:** Default to TEST branch unless fixing production bug

### 3. Reference Key Documents  
- `/docs/SYSTEM_STATUS.md` - Current system state
- `/docs/HANDOFF_TEMPLATE.md` - End of session template
- `/docs/guides/features/rss-pipeline-operations.md` - RSS procedures

## Project Overview

### Production
- **URL:** https://trumpytracker.com
- **Branch:** main
- **Database:** Supabase osjbulmltfpcoldydexg
- **Auto-deploys:** On push to main via Netlify

### Test Environment  
- **URL:** https://test--taupe-capybara-0ff2ed.netlify.app/
- **Branch:** test
- **Database:** Supabase wnrjrywpcadwutfykflu
- **Visual:** Red "🧪 TEST" badge on site
- **Auto-deploys:** On push to test via Netlify

### Architecture
- **Frontend:** React via CDN, Netlify hosting
- **Backend:** Supabase (Postgres + Edge Functions)
- **Automation:** GitHub Actions + OpenAI API
- **Cost Target:** <$50/month (currently ~$35)

## File Access & Structure

### Direct Access
- **Repo:** `C:\Users\Josh\OneDrive\Desktop\GitHub\TTracker`
- **You have:** Full read/write access to all files
- **Method:** Direct file system operations (no need to paste code)

### Key Directories
```
TTracker/
├── public/               # Frontend files
│   ├── index.html       # Main dashboard
│   ├── dashboard.js     # React components
│   └── admin.html       # Admin panel
├── scripts/             # Backend scripts
│   ├── daily-tracker-supabase.js
│   ├── job-queue-worker-atomic.js
│   └── rss/            # RSS pipeline
├── migrations/          # Database migrations
├── docs/               # Documentation
│   └── handoffs/       # Session handoffs
└── .github/workflows/   # GitHub Actions
```

### Test-Only Files (Never Cherry-Pick)
- `TEST_BRANCH_MARKER.md`
- `supabase-config-test.js`
- `test-*.js` files
- Any file with "test" in name

## Development Workflow

### 1. Always Start on Test Branch
```bash
# In GitHub Desktop
1. Switch to 'test' branch
2. Pull latest changes
3. Verify TEST badge appears on site
```

### 2. Make Changes
- Edit files directly in repo
- No need to copy/paste code
- Changes auto-save

### 3. Commit via GitHub Desktop
```bash
# Simple, descriptive messages
"fix: RSS pipeline stuck jobs (TTRC-172)"
"feat: add story view UI components"
"docs: update handoff documentation"
```

### 4. Test Changes
- Push to test branch
- Wait ~2 minutes for Netlify deployment
- Visit test URL to verify
- Check `/test-health-check.html` for environment

### 5. Cherry-Pick to Production
```bash
# After testing succeeds
1. In GitHub Desktop → History
2. Find commit on test branch
3. Right-click → Cherry-pick
4. Switch to main branch  
5. Push to origin
```

## Database Access

### Via Supabase Dashboard
- **URL:** https://app.supabase.com
- **Projects:** Two separate (TEST and PROD)
- **Access:** Table editor, SQL editor, logs

### Via Scripts
```javascript
// Auto-detects environment
import { supabase } from './config/supabase-config.js';

// Force specific environment
process.env.USE_TEST_DB = 'true'; // For test
```

### Direct SQL Access
```sql
-- Check which database
SELECT current_database();

-- Common tables
SELECT * FROM political_entries ORDER BY created_at DESC LIMIT 10;
SELECT * FROM executive_orders ORDER BY date DESC LIMIT 10;
SELECT * FROM stories WHERE status = 'active';
SELECT * FROM job_queue WHERE processed_at IS NULL;
```

## Common Operations

### Run Daily Tracker Manually
```bash
cd scripts
node daily-tracker-supabase.js

# With options
node daily-tracker-supabase.js --days=7  # Look back 7 days
```

### Start RSS Pipeline
```bash
# Preflight check first
node scripts/preflight-check.js

# Seed jobs if needed
node scripts/seed-fetch-jobs.js

# Start worker
node scripts/job-queue-worker-atomic.js
```

### Process Manual Article
```bash
node scripts/manual-article-processor.js --url "https://example.com/article"
```

### Replicate Production to Test
1. Visit `/replicate-to-test.html` on test site
2. Click "Start Replication"
3. Wait ~30 seconds
4. Verify with test data

## GitHub Actions Workflows

### Daily Automation (9am EST)
- `daily-tracker.yml` - Political news tracker
- `executive-orders-tracker.yml` - EO tracker

### Manual Triggers
- All workflows have `workflow_dispatch` for manual run
- Go to Actions tab → Select workflow → Run workflow

### Test Workflows
- `test-daily-tracker.yml`
- `test-executive-orders.yml`
- `rss-e2e-test.yml`

## Environment Variables

### Required Secrets (GitHub)
```
GITHUB_TOKEN        # Auto-provided
OPENAI_API_KEY     # For AI summaries
SUPABASE_URL       # Production database
SUPABASE_SERVICE_KEY  # Production service key
SUPABASE_URL_TEST  # Test database
SUPABASE_SERVICE_KEY_TEST  # Test service key
```

### Local Development
```bash
# .env file (git ignored)
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://...
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
```

## Cost Management

### Current Monthly Costs
- OpenAI API: ~$30-35
- Supabase: Free tier (both TEST and PROD)
- Netlify: Free tier
- GitHub Actions: Free tier
- **Total:** ~$35/month (under $50 target)

### Cost Monitoring
- Check OpenAI usage dashboard
- Monitor Supabase bandwidth
- Review GitHub Actions minutes

## Josh's Preferences

### Communication Style
- **Business impact first** - Explain why before how
- **Simple language** - PM, not developer
- **Single recommendations** - Don't provide multiple options without recommendation
- **Cost awareness** - Always mention if changes affect monthly costs

### Workflow Preferences  
- **Propose → Confirm → Implement** - Get agreement before major changes
- **Test everything** - Never say "should work"
- **Auto-QA** - Check edge cases and regressions
- **Update immediately** - Use Atlassian tools to update JIRA/Confluence

## Quality Checklist

Before Saying "Done":
- [ ] Feature actually works (tested, not theoretical)
- [ ] Edge cases handled
- [ ] No regressions introduced
- [ ] Cost impact assessed
- [ ] JIRA updated via tools
- [ ] Confluence updated if needed
- [ ] Handoff document created

## Emergency Procedures

### Production Down
1. Check GitHub Actions for failures
2. Review Supabase logs
3. Check `/docs/BREAK_GLASS_RSS_FIX.md`
4. Rollback if needed via GitHub

### Test Environment Issues
1. Verify TEST_BRANCH_MARKER.md exists
2. Check supabase-config-test.js present
3. Run test-environment-check.js
4. Force refresh with hard reload

### Database Issues
1. Check connection in Supabase dashboard
2. Verify API keys haven't rotated
3. Check rate limits
4. Review error logs

## Session End Checklist

1. **Update JIRA** - Use Atlassian tools
2. **Update Confluence** - Implementation plans, status
3. **Create handoff** - Save to `/docs/handoffs/YYYY-MM-DD-description.md`
4. **Report context** - "Used: 50K/190K (26%)"

## Contact Information

- **Email:** contact.trumpytracker@gmail.com
- **Supabase:** https://app.supabase.com
- **Netlify:** https://app.netlify.com
- **GitHub:** AJWolfe18/TTracker

---

*Last Updated: October 2025*
*Version: 2.0 - RSS Implementation Complete*
