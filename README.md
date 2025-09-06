# TrumpyTracker - Political Accountability Monitoring System

[![Live Site](https://img.shields.io/badge/Live%20Site-trumpytracker.com-blue)](http://trumpytracker.com)
[![Test Environment](https://img.shields.io/badge/Test%20Environment-Netlify-orange)](https://test--taupe-capybara-0ff2ed.netlify.app/)
[![GitHub Actions](https://img.shields.io/badge/Automation-GitHub%20Actions-green)](https://github.com/AJWolfe18/TTracker/actions)

An automated AI-powered system that tracks and documents political developments, government actions, and accountability issues with daily monitoring and public transparency.

## 🎯 Purpose

TrumpyTracker monitors and documents:
- **Political Figures**: Donald Trump and other key political actors
- **Federal Agencies**: DOJ, FBI, ICE, DHS, Department of Education actions
- **Civil Liberties**: Surveillance programs, court rulings, privacy issues
- **Corporate Accountability**: Financial conflicts, lobbying, ethical violations
- **Election Integrity**: Campaign finance, voting rights, election interference
- **Legal Proceedings**: Court cases, investigations, regulatory actions
- **Executive Orders**: Presidential executive orders and their impacts

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Supabase (PostgreSQL)
- **Automation**: GitHub Actions + OpenAI API
- **Hosting**: Netlify (static site + branch deploys)
- **AI Processing**: OpenAI GPT-5 models for content analysis and spicy summaries

### Project Structure
```
TTracker/
├── .github/workflows/      # GitHub Actions automation
├── public/                 # Frontend files (dashboard, admin)
├── scripts/               # Operational scripts
│   ├── batch/            # Windows batch files
│   └── processors/       # Data processing scripts
├── config/               # Configuration files
├── sql/                  # Database schemas and migrations
├── data/                 # Historical JSON data archives
├── backups/              # Database backups
├── test/                 # Test-specific files (test branch only)
└── archive/              # Deprecated code
```

## 🚀 Features

### Public Dashboard
- **Real-time Data Display**: View latest political accountability entries
- **Filtering & Search**: Filter by category, actor, severity, and date range
- **Executive Orders Tracking**: Dedicated section for presidential orders
- **Statistics Dashboard**: Visual representation of trends and patterns
- **Mobile Responsive**: Fully responsive design for all devices

### Admin Panel
- **Manual Article Submission**: Add entries through web interface
- **Queue Management**: View and manage pending/failed submissions
- **Data Verification**: Mark entries as verified/unverified
- **Archive Management**: Archive old entries to maintain performance
- **Duplicate Detection**: Automatic detection of duplicate entries

### Daily Automation
- **Scheduled Runs**: Automatic daily tracking at 9:00 AM EST
- **AI Analysis**: GPT-4 powered content discovery and analysis
- **Source Attribution**: All entries linked to original sources
- **Severity Assessment**: Automatic categorization by impact level
- **Error Recovery**: Robust error handling and retry logic

## 📊 Data Structure

Each entry contains:
```json
{
  "date": "2025-08-17",
  "actor": "Department of Justice",
  "category": "Civil Liberties",
  "title": "New surveillance program announced",
  "description": "DOJ announces expanded digital monitoring capabilities...",
  "source": "Reuters",
  "source_url": "https://example.com/article",
  "verified": true,
  "severity": "high",
  "archived": false,
  "created_at": "2025-08-17T14:00:00Z"
}
```

## 🔧 Setup & Installation

### Prerequisites
- Node.js 16+ 
- Supabase account (free tier sufficient)
- OpenAI API key (for automation)
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
Create `.env` file with:
```env
OPENAI_API_KEY=your_openai_key
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key
```

4. **Start local server**
```bash
npm run server
```

### Database Setup

1. Create a new Supabase project
2. Run the schema creation script from `/sql/complete-schema-fix.sql`
3. Configure RLS policies as needed
4. Update config files with your Supabase credentials

## 🧪 Test Environment

### Branch-Based Testing
- **Test Branch**: All new features developed on `test` branch
- **Test Site**: Auto-deploys to Netlify test URL
- **Test Database**: Separate Supabase instance with production data copy
- **Environment Detection**: Automatic via `TEST_BRANCH_MARKER.md`

### Testing Workflow
1. Checkout `test` branch
2. Make changes and commit
3. Push to trigger auto-deploy
4. Verify at test URL
5. Cherry-pick successful commits to `main`
6. Never merge entire test branch to main

### Refreshing Test Data
Visit `/replicate-to-test.html` on test site to copy production data

## 📋 API Endpoints

### GitHub Actions Workflows

#### Daily Tracker
- **Trigger**: Daily at 9:00 AM EST or manual
- **File**: `.github/workflows/daily-tracker.yml`
- **Output**: New entries in database

#### Executive Orders Tracker  
- **Trigger**: Daily at 10:00 AM EST or manual
- **File**: `.github/workflows/executive-orders-tracker.yml`
- **Output**: Updated executive orders

#### Manual Article Processor
- **Trigger**: On demand via API
- **File**: `.github/workflows/process-manual-article.yml`
- **Input**: Article URL and metadata

## 🛠️ Maintenance

### Regular Tasks
- **Daily**: Automated trackers run automatically
- **Weekly**: Review queue for failed submissions
- **Monthly**: Archive old entries (>60 days)
- **As Needed**: Update tracking keywords and sources

### Performance Optimization
- Database indexes on key fields
- Client-side caching with `tt_cache_` prefix
- Pagination for large datasets
- Archive old data to maintain speed

## 📈 Monitoring & Analytics

### Key Metrics
- Daily entry count
- Category distribution
- Severity trends
- Source diversity
- Verification rate

### Health Checks
- `/test-health-check.html` - Environment verification
- `/check-counts.html` - Database statistics
- GitHub Actions logs - Automation status

## 🔒 Security & Privacy

- **No PII Collection**: System doesn't collect personal information
- **Public Data Only**: All tracked information from public sources
- **Read-Only Access**: Public dashboard has read-only database access
- **Admin Authentication**: Secure admin functions with service keys
- **Rate Limiting**: API calls limited to prevent abuse

## 🤝 Contributing

### How to Contribute
1. Fork the repository
2. Create feature branch from `test`
3. Make changes with clear commits
4. Test thoroughly on test environment
5. Submit pull request to `test` branch
6. After review, changes cherry-picked to `main`

### Contribution Guidelines
- Follow existing code style
- Add comments for complex logic
- Update documentation for new features
- Include source attribution for all data
- Test on multiple devices/browsers

## 📋 Categories Tracked

- **Financial**: Business dealings, conflicts of interest
- **Civil Liberties**: Privacy, surveillance, constitutional rights
- **Platform Manipulation**: Social media policies, algorithms
- **Government Oversight**: Agency actions, policy changes
- **Election Integrity**: Campaign finance, voting rights
- **Corporate Ethics**: Lobbying, regulatory violations
- **Legal Proceedings**: Court cases, investigations

## 🎨 Verification Levels

- ✅ **Verified**: Confirmed by multiple reputable sources
- ⚠️ **Unverified**: Notable claims requiring confirmation
- 🔍 **Under Review**: Being fact-checked

## 📊 Severity Scale

- 🔴 **High**: Major legal, financial, or civil liberties implications
- 🟡 **Medium**: Significant but localized impact
- 🟢 **Low**: Noteworthy but minimal immediate impact

## 💰 Cost Management

Target: Under $20/month total
- **Supabase**: Free tier (up to 500MB)
- **Netlify**: Free tier (100GB bandwidth)
- **GitHub Actions**: Free tier (2000 minutes/month)
- **OpenAI API**: ~$5-10/month for daily processing

## 📞 Contact & Support

- **Email**: contact.trumpytracker@gmail.com
- **GitHub Issues**: Report bugs or request features
- **Jira Board**: Internal project management

## 📜 License

This project is dedicated to the public domain. Data collected is from public sources and organized for public benefit.

## ⚠️ Disclaimer

This tracker aggregates information from public sources for transparency and accountability purposes. Users should verify important information independently. The automated nature means some entries may require human review for context and accuracy.

---

**Last Updated**: August 17, 2025  
**Version**: 2.0 (Post-Migration)  
**Status**: Active Development