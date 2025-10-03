# TrumpyTracker - Political Accountability Monitoring System

[![Live Site](https://img.shields.io/badge/Live%20Site-trumpytracker.com-blue)](http://trumpytracker.com)
[![Test Environment](https://img.shields.io/badge/Test%20Environment-Netlify-orange)](https://test--taupe-capybara-0ff2ed.netlify.app/)
[![GitHub Actions](https://img.shields.io/badge/Automation-GitHub%20Actions-green)](https://github.com/AJWolfe18/TTracker/actions)

An automated AI-powered system that aggregates political news from RSS feeds, clusters related articles into coherent stories, and provides AI-enhanced summaries for transparency and accountability.

## 🚀 Current Status

**TEST Environment:** RSS + Story Clustering system active (86 stories, 180 articles from 6 feeds)  
**PROD Environment:** Legacy article system (717 entries) - migration pending  
**Migration:** Backend complete, frontend QA in progress ([TTRC-145](https://ajwolfe37.atlassian.net/browse/TTRC-145))

---

## 🔧 Development Tools

### MCP Servers Active
This project has Model Context Protocol (MCP) servers configured for enhanced development:
- **Filesystem Access**: Direct file operations in project directory
- **Supabase TEST Database**: Full query access for development
- **Supabase PROD Database**: Read-only access for verification
- **Atlassian Integration**: Direct JIRA/Confluence updates

See `/docs/MCP-SERVER-STATUS.md` for details on using these capabilities during development sessions.

---

## 🎯 Purpose

TrumpyTracker automatically monitors and documents:
- **Political Figures**: Donald Trump and other key political actors
- **Federal Agencies**: DOJ, FBI, ICE, DHS, Department of Education actions
- **Civil Liberties**: Surveillance programs, court rulings, privacy issues
- **Corporate Accountability**: Financial conflicts, lobbying, ethical violations
- **Election Integrity**: Campaign finance, voting rights, election interference
- **Legal Proceedings**: Court cases, investigations, regulatory actions
- **Executive Orders**: Presidential executive orders and their impacts

---

## 🏗️ Architecture

### System Overview

TrumpyTracker uses an RSS ingestion pipeline with automated story clustering and AI enrichment:

```
GitHub Actions (Scheduler)
    ↓ Triggers every 1-2 hours
Supabase Edge Functions (rss-enqueue)
    ↓ Creates jobs
Job Queue (PostgreSQL)
    ↓ Polls for work
RSS Worker (Node.js)
    ├── Fetch RSS feeds (Tiered: T1/T2/T3)
    ├── Parse articles
    ├── Cluster into stories
    └── Enrich with OpenAI
        ↓ Writes to database
Stories + Articles Tables
    ↓ API calls
Frontend (Netlify)
    └── Story-based dashboard
```

### Tech Stack

**Infrastructure:**
- **Database**: Supabase (PostgreSQL) - Free tier
- **Hosting**: Netlify (static site + branch deploys) - Free tier
- **Triggers**: GitHub Actions (scheduled jobs) - Free tier
- **API**: Supabase Edge Functions (serverless)

**Processing:**
- **Worker**: Node.js RSS processor with job queue
- **AI**: OpenAI GPT-4 for enrichment (~$20/month)
- **Feeds**: Tiered RSS ingestion (6 active feeds)
- **Clustering**: Similarity-based story grouping

**Frontend:**
- **Framework**: Vanilla JavaScript, HTML5, CSS3
- **Styling**: Tailwind CSS
- **Rendering**: Client-side with lazy loading

### Project Structure

```
TTracker/
├── .github/workflows/      # GitHub Actions (RSS scheduler, legacy trackers)
├── public/                 # Frontend files
│   ├── index.html         # Main dashboard
│   ├── admin-supabase.html # Admin panel
│   └── story-view/        # Story detail components (TEST)
├── supabase/
│   └── functions/         # Edge Functions (rss-enqueue, stories-*)
├── scripts/
│   └── workers/           # RSS worker (job queue processor)
├── config/                # Supabase configuration files
├── sql/                   # Database schemas and migrations
├── docs/                  # Comprehensive documentation
└── test/                  # Test-specific files (test branch)
```

---

## 🚀 Features

### TEST Environment (RSS System)

#### Story Dashboard
- **Story Aggregation**: Related articles grouped into coherent stories
- **Multiple Sources**: Each story shows all covering sources
- **AI Summaries**: Neutral and "spicy" summaries for each story
- **Smart Clustering**: Automatic deduplication and grouping
- **Real-time Updates**: Stories update as new articles arrive

#### Feed Management
- **Tiered Processing**: High-priority feeds processed first
- **HTTP Caching**: ETag/Last-Modified for efficient fetching
- **Failure Tracking**: Automatic feed disabling after 5 failures
- **Opinion Flagging**: Separate opinion content from news

#### Admin Features
- **Manual Submission**: Add articles via URL
- **Queue Monitoring**: View job processing status
- **Cost Tracking**: Daily OpenAI budget monitoring
- **Feed Management**: Add/disable RSS feeds

### PROD Environment (Legacy System)

#### Public Dashboard
- **Individual Entries**: View latest political accountability entries
- **Filtering & Search**: Filter by category, actor, severity, date
- **Executive Orders**: Dedicated EO tracking section
- **Archive Management**: Archive old entries for performance

#### Admin Panel
- **Manual Entry Creation**: Add entries through web interface
- **Data Verification**: Mark entries as verified/unverified
- **Duplicate Detection**: Automatic duplicate detection

---

## 📊 Data Model

### RSS System (TEST)

**Story Structure:**
```json
{
  "id": 42,
  "primary_headline": "DOJ Announces New Surveillance Program",
  "primary_actor": "Department of Justice",
  "status": "active",
  "severity": "severe",
  "category": "Civil Liberties",
  "source_count": 4,
  "summary_neutral": "The DOJ has announced expansion of digital monitoring...",
  "summary_spicy": "Yet another overreach into Americans' privacy...",
  "first_seen_at": "2025-10-02T14:00:00Z",
  "last_updated_at": "2025-10-02T18:30:00Z"
}
```

**Article Structure:**
```json
{
  "id": "art-abc123",
  "url": "https://example.com/article",
  "title": "DOJ Expands Digital Surveillance Capabilities",
  "source_name": "Reuters",
  "source_domain": "reuters.com",
  "published_at": "2025-10-02T14:00:00Z",
  "story_id": 42
}
```

### Legacy System (PROD)

**Entry Structure:**
```json
{
  "id": "entry-xyz789",
  "date": "2025-10-02",
  "actor": "Department of Justice",
  "category": "Civil Liberties",
  "title": "New surveillance program announced",
  "description": "DOJ announces expanded monitoring...",
  "source": "Reuters",
  "source_url": "https://example.com/article",
  "severity": "high",
  "verified": true,
  "archived": false
}
```

---

## 🔧 Setup & Installation

### Prerequisites

- Node.js 18+
- Supabase account (free tier sufficient)
- OpenAI API key (for AI enrichment)
- GitHub account (for Actions)
- Netlify account (for hosting)

### Local Development Setup

1. **Clone the repository**
```bash
git clone https://github.com/AJWolfe18/TTracker.git
cd TTracker
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment variables**

Create `.env` file:
```env
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key

# OpenAI
OPENAI_API_KEY=your_openai_key

# Edge Functions (optional for local testing)
EDGE_CRON_TOKEN=your_cron_token
```

4. **Start local development**
```bash
# Frontend
npm run server

# RSS Worker (in separate terminal)
cd scripts/workers
npm install
npm start
```

### Database Setup

1. Create new Supabase project
2. Run schema migrations from `/sql/migrations/`
3. Configure RLS policies:
   ```sql
   -- Enable RLS for public read access
   ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
   ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
   
   -- Allow public read of active stories
   CREATE POLICY "Public read active stories"
   ON stories FOR SELECT
   USING (status = 'active');
   ```
4. Update config files with your credentials

### Deploy Edge Functions

```bash
# Install Supabase CLI
npm install -g supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Deploy functions
supabase functions deploy rss-enqueue
supabase functions deploy stories-active
supabase functions deploy stories-detail
```

---

## 🧪 Test Environment

### Branch-Based Testing

**TEST Branch** (`test`):
- RSS + Story Clustering system
- Separate Supabase TEST database
- Auto-deploys to: https://test--taupe-capybara-0ff2ed.netlify.app/
- Latest features and fixes

**PROD Branch** (`main`):
- Legacy article system
- Production Supabase database
- Auto-deploys to: https://trumpytracker.com
- Stable, tested features only

### Testing Workflow

1. Checkout `test` branch
2. Make changes and commit
3. Push triggers auto-deploy to TEST
4. Verify functionality on test site
5. **Cherry-pick** tested commits to `main` (never merge)
6. Deploy to production

### Environment Detection

System automatically detects environment via:
- `TEST_BRANCH_MARKER.md` file presence
- Uses appropriate Supabase config
- Enables/disables features accordingly

---

## 📋 RSS System Components

### GitHub Actions Scheduler

**Job Scheduler** (`.github/workflows/rss-scheduler.yml`):
- Runs every 1-2 hours
- Triggers Edge Function to enqueue RSS jobs
- Minimal compute time (< 1 minute)

**Legacy Trackers** (PROD only):
- Daily Tracker: 9:00 AM EST
- EO Tracker: 10:00 AM EST
- To be deprecated after migration

### Edge Functions

**rss-enqueue** - Create RSS fetch jobs
```typescript
POST /functions/v1/rss-enqueue
Authorization: Bearer EDGE_CRON_TOKEN

Response: { jobs_created: 6, status: "success" }
```

**stories-active** - Get active stories
```typescript
GET /functions/v1/stories-active?limit=20&offset=0
Authorization: Bearer ANON_KEY

Response: { stories: [...], count: 86 }
```

**stories-detail** - Get story with all sources
```typescript
GET /functions/v1/stories-detail?story_id=42
Authorization: Bearer ANON_KEY

Response: { story: {...}, articles: [...] }
```

### RSS Worker

**Responsibilities:**
- Poll job queue for pending jobs
- Fetch and parse RSS feeds
- Create/update stories and articles
- Call OpenAI for enrichment
- Handle errors and retries

**Job Types:**
- `rss_fetch_feed` - Fetch RSS feed
- `story_enrich` - Enrich with AI
- `story_cluster` - Update clustering
- `story_archive` - Archive old stories

**Running the Worker:**
```bash
cd scripts/workers
npm start

# Output:
# [Worker] Polling for jobs...
# [Worker] Processing job: rss_fetch_feed (feed: reuters)
# [Worker] Fetched 15 articles, created 3 stories
# [Worker] Job completed in 8.2s
```

---

## 🛠️ Maintenance

### Daily Tasks (Automated)
- RSS feeds fetched every 1-2 hours
- Stories auto-enriched with AI
- Job queue processed continuously
- Budget tracking updated

### Weekly Tasks (Manual)
- Review failed jobs in job_queue
- Check feed_registry for disabled feeds
- Monitor cost in budgets table
- Archive closed stories

### Monthly Tasks (Manual)
- Analyze story clustering effectiveness
- Review and adjust feed tiers
- Archive old entries (PROD)
- Update documentation

### Performance Optimization

**Database:**
- Indexes on frequently queried columns
- Automatic story lifecycle management
- Job queue cleanup (delete after 7 days)
- Cursor-based pagination (no OFFSET)

**Frontend:**
- Client-side caching with localStorage
- Lazy loading with "Load More" button
- Debounced search/filter inputs
- Minimal API calls

**RSS Processing:**
- HTTP caching (ETag/Last-Modified)
- Tiered feed processing (T1 → T2 → T3)
- Idempotent job processing
- Error retry with backoff

---

## 📈 Monitoring & Analytics

### Health Checks

**TEST Environment:**
- `/queue-stats` - Job queue metrics (via Edge Function)
- `/stories-active` - Story count and status
- Worker logs - Processing status

**PROD Environment:**
- `/check-counts.html` - Database statistics
- `/test-health-check.html` - Environment verification
- GitHub Actions logs - Automation status

### Key Metrics

**RSS System:**
- Stories created per day
- Articles ingested per feed
- Job processing time
- OpenAI API costs
- Feed failure rates

**Legacy System:**
- Daily entry count
- Category distribution
- Verification rate
- Archive rate

### Database Queries

```sql
-- Check job queue health (TEST)
SELECT status, COUNT(*) 
FROM job_queue 
GROUP BY status;

-- Monitor daily costs (TEST)
SELECT day, spent_usd, openai_calls 
FROM budgets 
ORDER BY day DESC;

-- Active stories (TEST)
SELECT COUNT(*) 
FROM stories 
WHERE status = 'active';

-- Recent entries (PROD)
SELECT COUNT(*) 
FROM political_entries 
WHERE archived = false;
```

---

## 🔒 Security & Privacy

### Data Protection
- **No PII Collection**: System doesn't collect personal information
- **Public Data Only**: All data from public RSS feeds
- **RLS Policies**: Database-level security
- **HTTPS Everywhere**: Netlify, Supabase, all APIs

### Authentication
- **Public Access**: Read-only via Supabase anon key
- **Admin Access**: Service role key for write operations
- **Edge Functions**: Protected by cron token
- **Worker**: Uses service role for database writes

### Rate Limiting
- **OpenAI API**: Built-in rate limiting
- **Supabase**: Free tier quotas enforced
- **GitHub Actions**: 2000 minutes/month limit
- **Budget Caps**: Daily spending limit enforced

---

## 💰 Cost Management

### Current Costs: ~$20/month

**Breakdown:**
- **Supabase**: $0 (Free tier - 500MB database, 2GB bandwidth)
- **Netlify**: $0 (Free tier - 100GB bandwidth)
- **GitHub Actions**: $0 (Free tier - 2000 minutes/month)
- **OpenAI API**: ~$20/month (story enrichment)

### Cost Optimization

**Techniques:**
- Story clustering reduces duplicate processing by 40%
- HTTP caching reduces RSS fetches by 30%
- Tiered processing prioritizes authoritative sources
- Budget table enforces daily caps ($50/day max)

**Scaling Costs:**
- +1000 stories/month ≈ +$10 OpenAI
- Supabase Pro ($25/mo) needed at ~8GB database
- Netlify Pro ($19/mo) needed at ~400GB bandwidth

---

## 🤝 Contributing

### How to Contribute

1. Fork the repository
2. Create feature branch from `test`
3. Make changes with clear commit messages
4. Test thoroughly on TEST environment
5. Submit pull request to `test` branch
6. After review, changes cherry-picked to `main`

### Contribution Guidelines

- Follow existing code style (ESLint config provided)
- Add comments for complex logic
- Update documentation for new features
- Include source attribution for all data
- Test on multiple devices/browsers
- Ensure cost implications are considered

### Development Process

```bash
# Create feature branch
git checkout test
git pull origin test
git checkout -b feature/new-feature

# Make changes, commit
git add .
git commit -m "feat: add new feature"

# Push and create PR
git push origin feature/new-feature
# Then create PR to 'test' branch on GitHub
```

---

## 📋 Content Categories

### News Categories
- **Policy**: Government policy changes and proposals
- **Legal**: Court cases, investigations, legal proceedings
- **Financial**: Business dealings, conflicts of interest
- **Civil Liberties**: Privacy, surveillance, constitutional rights
- **Election**: Campaign finance, voting rights, election integrity
- **International**: Foreign policy, international relations
- **Administration**: Executive actions, personnel changes

### Severity Levels

**RSS System (TEST):**
- **Critical**: Democracy/constitutional threats
- **Severe**: Major impact on rights or institutions
- **Moderate**: Significant but localized impact
- **Minor**: Noteworthy but minimal immediate impact

**Legacy System (PROD):**
- 🔴 **Critical**: Major legal, financial, or civil liberties implications
- 🟠 **High**: Significant policy or institutional impact
- 🟡 **Medium**: Notable but localized effects
- 🟢 **Low**: Minimal immediate impact

---

## 📚 Documentation

Comprehensive documentation available in `/docs/`:

**Core Protocols:**
- `PROJECT_INSTRUCTIONS.md` - Quick reference for Claude
- `STARTUP_PROMPT.md` - Session start checklist
- `SESSION_PROTOCOL.md` - Complete workflow

**Architecture:**
- `architecture/ARCHITECTURE.md` - System overview
- `architecture/rss-system.md` - RSS pipeline details
- `database/database-schema.md` - Database structure

**Guides:**
- `guides/deployment/` - Deployment checklists
- `guides/development/` - Setup and configuration
- `guides/features/` - Feature implementation
- `guides/testing/` - QA procedures

---

## 📞 Contact & Support

- **Email**: contact.trumpytracker@gmail.com
- **GitHub Issues**: [Report bugs or request features](https://github.com/AJWolfe18/TTracker/issues)
- **Jira Board**: [Internal project management](https://ajwolfe37.atlassian.net/jira/software/c/projects/TTRC/boards/35)
- **Confluence**: [Technical documentation](https://ajwolfe37.atlassian.net/wiki/spaces/~712020ab2eb46ba50d43f5b6f37e5018e0ff88/overview)

---

## 📜 License

This project is dedicated to the public domain. Data collected is from public RSS feeds and organized for public benefit.

---

## ⚠️ Disclaimer

This tracker aggregates information from public RSS feeds for transparency and accountability purposes. Users should verify important information independently. The automated nature means some entries may require human review for context and accuracy. AI-generated summaries are provided for convenience and should not be considered definitive analysis.

---

**Last Updated:** October 2, 2025  
**Version:** 3.0 (RSS + Story Clustering)  
**Status:** TEST environment active, PROD migration pending ([TTRC-145](https://ajwolfe37.atlassian.net/browse/TTRC-145))
