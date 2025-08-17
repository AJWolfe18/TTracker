# TrumpyTracker Technical Architecture

## Overview

TrumpyTracker is a serverless, event-driven political accountability tracking system built on modern cloud infrastructure with AI-powered content analysis.

## System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         GitHub Actions                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │Daily Tracker │  │  EO Tracker  │  │Manual Article│      │
│  │   (9am EST)  │  │  (10am EST)  │  │  (On Demand) │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          ▼                  ▼                  ▼
    ┌─────────────────────────────────────────────────┐
    │              OpenAI API (GPT-4)                  │
    │         Content Discovery & Analysis             │
    └─────────────────────────────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────┐
    │            Supabase (PostgreSQL)                 │
    │  ┌──────────────┐  ┌──────────────────────┐    │
    │  │Political     │  │Executive Orders      │    │
    │  │Entries Table │  │Table                 │    │
    │  └──────────────┘  └──────────────────────┘    │
    └─────────────────────────────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────┐
    │             Netlify Static Hosting               │
    │  ┌──────────────┐  ┌──────────────────────┐    │
    │  │  Production  │  │  Test Environment    │    │
    │  │   (main)     │  │     (test)           │    │
    │  └──────────────┘  └──────────────────────┘    │
    └─────────────────────────────────────────────────┘
                           │
                           ▼
    ┌─────────────────────────────────────────────────┐
    │              Frontend (Browser)                  │
    │  ┌──────────────┐  ┌──────────────────────┐    │
    │  │  Dashboard   │  │   Admin Panel        │    │
    │  │  (Public)    │  │   (Protected)        │    │
    │  └──────────────┘  └──────────────────────┘    │
    └─────────────────────────────────────────────────┘
```

## Core Components

### 1. Data Collection Layer (GitHub Actions)

**Daily Tracker (`daily-tracker-supabase.js`)**
- Runs daily at 9:00 AM EST
- Searches for political news across multiple categories
- Uses OpenAI to analyze and structure findings
- Stores results directly in Supabase

**Executive Orders Tracker (`executive-orders-tracker-supabase.js`)**
- Runs daily at 10:00 AM EST
- Monitors Federal Register and news for executive orders
- Tracks implementation and impacts
- Updates executive_orders table

**Manual Article Processor (`manual-article-processor.js`)**
- Triggered via GitHub API or web interface
- Processes single article URLs
- Extracts metadata and analyzes content
- Adds to pending queue or directly to database

### 2. AI Processing Layer (OpenAI)

**Content Discovery**
- GPT-4 powered search for relevant political developments
- Multi-category tracking with smart filtering
- Source credibility assessment

**Content Analysis**
- Automatic categorization (7 main categories)
- Severity assessment (low/medium/high)
- Actor identification
- Verification status determination

**Data Structuring**
- Converts unstructured news into structured JSON
- Maintains consistent data schema
- Generates concise summaries

### 3. Database Layer (Supabase)

**Tables Structure**

```sql
political_entries
├── id (SERIAL PRIMARY KEY)
├── date (DATE)
├── actor (TEXT)
├── category (TEXT)
├── title (TEXT)
├── description (TEXT)
├── source (TEXT)
├── source_url (TEXT)
├── verified (BOOLEAN)
├── severity (TEXT)
├── archived (BOOLEAN)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)

executive_orders
├── id (SERIAL PRIMARY KEY)
├── date (DATE)
├── order_number (TEXT UNIQUE)
├── title (TEXT)
├── description (TEXT)
├── federal_register_url (TEXT)
├── severity (TEXT)
├── category (TEXT)
├── archived (BOOLEAN)
├── created_at (TIMESTAMP)
└── updated_at (TIMESTAMP)

pending_submissions (queue management)
├── id (UUID PRIMARY KEY)
├── article_url (TEXT)
├── submitted_by (TEXT)
├── status (TEXT)
├── error_message (TEXT)
├── created_at (TIMESTAMP)
└── processed_at (TIMESTAMP)
```

**Indexes**
- date_actor_idx (date, actor)
- category_severity_idx (category, severity)
- archived_date_idx (archived, date DESC)
- created_at_idx (created_at DESC)

**RLS Policies**
- Public read access for non-archived entries
- Service role required for write operations
- Automatic timestamp updates via triggers

### 4. Frontend Layer

**Public Dashboard (`/index.html`)**
- Real-time data display from Supabase
- Client-side filtering and search
- Responsive design with mobile support
- Category-based color coding
- Statistics visualization

**Admin Panel (`/admin-supabase.html`)**
- Manual article submission
- Queue management interface
- Data verification tools
- Archive management
- Duplicate detection

**Supporting Pages**
- `/test-health-check.html` - Environment verification
- `/replicate-to-test.html` - Test data sync
- `/check-counts.html` - Database statistics

### 5. Configuration Management

**Environment Detection**
- Branch-based configuration (`TEST_BRANCH_MARKER.md`)
- Automatic environment switching
- Separate test/production databases

**Configuration Files**
- `config/supabase-config.js` - Production database
- `config/supabase-config-test.js` - Test database
- `config/supabase-config-wrapper.js` - Environment router

## Data Flow

### Automated Daily Collection
1. GitHub Action triggers at scheduled time
2. Script calls OpenAI API with search prompts
3. OpenAI searches and analyzes recent news
4. Results structured into JSON format
5. Data validated and deduplicated
6. Entries inserted into Supabase
7. Frontend automatically reflects updates

### Manual Article Submission
1. User submits URL via admin panel
2. Article added to pending_submissions queue
3. GitHub Action triggered via API
4. Article content fetched and analyzed
5. Entry created in political_entries
6. Queue updated with success/failure status

## Security Architecture

### Authentication & Authorization
- **Public Access**: Read-only via Supabase anon key
- **Admin Access**: Service role key for write operations
- **API Keys**: Stored in GitHub Secrets
- **No User Auth**: System designed for public transparency

### Data Protection
- RLS policies enforce read/write permissions
- No PII collection or storage
- All data from public sources
- HTTPS everywhere (Netlify, Supabase)

### Rate Limiting
- OpenAI API: Built-in rate limiting
- Supabase: Free tier limits (500MB, 2GB transfer)
- GitHub Actions: 2000 minutes/month
- Client-side caching to reduce API calls

## Performance Optimizations

### Database
- Indexed columns for common queries
- Archive old entries (>60 days)
- Materialized views for statistics
- Connection pooling via Supabase

### Frontend
- Client-side caching (`tt_cache_` prefix)
- Lazy loading for large datasets
- Debounced search inputs
- Minimal JavaScript bundle

### Automation
- Parallel processing where possible
- Retry logic for failed operations
- Error recovery and logging
- Efficient batch operations

## Deployment Architecture

### Production Environment
- **Branch**: `main`
- **URL**: https://trumpytracker.com
- **Database**: Production Supabase instance
- **Deploy**: Automatic on push to main

### Test Environment  
- **Branch**: `test`
- **URL**: https://test--taupe-capybara-0ff2ed.netlify.app/
- **Database**: Test Supabase instance
- **Deploy**: Automatic on push to test

### CI/CD Pipeline
1. Code pushed to GitHub
2. Netlify detects branch update
3. Static files built and deployed
4. GitHub Actions run on schedule
5. Database updated independently

## Monitoring & Observability

### Health Checks
- Database connection status
- Environment configuration verification
- Entry count monitoring
- Queue processing status

### Logging
- GitHub Actions logs for automation
- Browser console for frontend errors
- Supabase logs for database operations
- Netlify logs for deployment

### Metrics Tracked
- Daily entry count
- Category distribution
- Processing success rate
- API usage and costs
- Performance metrics

## Scalability Considerations

### Current Limits
- ~1000 entries before performance impact
- 500MB database (free tier)
- 100GB bandwidth/month (Netlify free)
- 2000 GitHub Actions minutes/month

### Scaling Strategies
- Archive old data to maintain performance
- Implement pagination for large datasets
- Upgrade Supabase tier if needed
- Consider CDN for static assets
- Add Redis cache layer if necessary

## Technology Decisions

### Why Serverless?
- No server maintenance required
- Cost-effective for current scale
- Auto-scaling capabilities
- High availability built-in

### Why Supabase?
- Generous free tier
- Real-time capabilities
- Built-in auth (future option)
- PostgreSQL reliability
- Good developer experience

### Why GitHub Actions?
- Free tier sufficient
- Native GitHub integration
- Simple scheduling
- Good ecosystem support
- Easy secret management

### Why Netlify?
- Excellent static hosting
- Branch deployments
- Free SSL certificates
- Good performance
- Simple configuration

## Future Architecture Considerations

### Potential Enhancements
- Add user authentication for personalized features
- Implement real-time updates via WebSockets
- Add ElasticSearch for advanced search
- Create mobile apps (React Native)
- Add data export APIs
- Implement ML for better categorization

### Scaling Path
1. **Phase 1** (Current): Static site + serverless
2. **Phase 2**: Add caching layer (Redis)
3. **Phase 3**: Dedicated API server
4. **Phase 4**: Microservices architecture
5. **Phase 5**: Multi-region deployment

## Disaster Recovery

### Backup Strategy
- Daily database backups (automated)
- GitHub stores all code history
- Local backups of critical data
- Export functionality for data preservation

### Recovery Procedures
1. Database corruption: Restore from backup
2. Service outage: Failover to backup services
3. Data loss: Recover from Git history
4. API failure: Fallback to manual processing

---

*Last Updated: August 17, 2025*
*Version: 2.0*