# TTracker
Tracking Current Events
Political Accountability Tracker
An automated system that tracks and documents political developments, government actions, and accountability issues using AI-powered daily monitoring.

🎯 Purpose
This tracker monitors and documents:

Political Figures: Donald Trump, Elon Musk, and other key political actors
Federal Agencies: DOJ, FBI, ICE, DHS, Department of Education actions
Civil Liberties: Surveillance programs, court rulings, privacy issues
Corporate Accountability: Financial conflicts, lobbying, ethical violations
Election Integrity: Campaign finance, voting rights, election interference
Legal Proceedings: Court cases, investigations, regulatory actions
🤖 How It Works
Daily Automation: Runs every day at 9:00 AM EST via GitHub Actions
AI Analysis: Uses OpenAI's GPT-4 to search and analyze recent developments
Data Collection: Structures findings into standardized JSON format
Historical Archive: Maintains cumulative database of all tracked events
Public Access: All data available for download and analysis
📊 Data Structure
Each entry contains:

Date: When the event occurred
Actor: Person or agency involved
Category: Type of issue (Financial, Civil Liberties, etc.)
Title: Brief headline
Description: 2-3 sentence summary
Source URL: Link to original reporting
Verified: Whether claims are confirmed
Severity: Impact level (low/medium/high)
📁 Files
daily-tracker.js - Main automation script
tracker-data-YYYY-MM-DD.json - Daily findings
master-tracker-log.json - Complete historical database
.github/workflows/daily-tracker.yml - Automation configuration
🚀 Usage
Accessing Data
Browse Online: View files directly in this GitHub repository
Download JSON: Click any data file → "Raw" → Save to computer
Import to Spreadsheet: Copy JSON data into Google Sheets or Excel
API Access: Use GitHub's API to programmatically access data
Manual Trigger
You can manually run the tracker anytime:

Go to "Actions" tab
Click "Daily Political Tracker"
Click "Run workflow"
📈 Sample Output
json
[
  {
    "date": "2025-06-28",
    "actor": "Department of Justice",
    "category": "Civil Liberties",
    "title": "New surveillance program announced",
    "description": "DOJ announces expanded digital monitoring capabilities under revised guidelines.",
    "source_url": "https://example.com/news-article",
    "verified": true,
    "severity": "high"
  }
]
🔧 Technical Details
Platform: GitHub Actions (free tier)
AI Model: OpenAI GPT-4
Schedule: Daily at 9:00 AM EST
Data Format: JSON
Cost: ~$1-5/month for API usage
📋 Categories Tracked
Financial: Business dealings, conflicts of interest, financial violations
Civil Liberties: Privacy, surveillance, constitutional rights
Platform Manipulation: Social media policies, content moderation, algorithms
Government Oversight: Agency actions, policy changes, regulatory decisions
Election Integrity: Campaign finance, voting rights, election interference
Corporate Ethics: Lobbying, unethical practices, regulatory violations
Legal Proceedings: Court cases, investigations, legal developments
🎨 Verification Levels
Verified: Confirmed by reputable news sources
Unverified: Notable claims requiring further confirmation
Multiple Sources: Corroborated across several outlets
📊 Severity Scale
High: Major legal, financial, or civil liberties implications
Medium: Significant but localized impact
Low: Noteworthy but minimal immediate impact
🔍 Data Quality
Focuses on reputable news sources
Flags unverified claims clearly
Prioritizes factual reporting over speculation
Maintains source attribution
Regular quality monitoring
📞 Contact & Contributions
This is an open project focused on government transparency and accountability. The data collected here serves as a public resource for:

Journalists and researchers
Civic organizations
Academic analysis
Public awareness
📜 License
This project is dedicated to the public domain. Data collected is from public sources and organized for public benefit.

⚠️ Disclaimer
This tracker aggregates information from public sources. Users should verify important information independently. The automated nature means some entries may require human review for context and accuracy.

Last Updated: Daily via automated process
Data Coverage: Ongoing since project start
Repository: Automatically maintained

### January 27, 2025 - Queue Management MVP
- **Submission Queue Interface**: View pending and failed article submissions
- **Queue Operations**: Delete individual items or clear entire queues
- **Visual Status Tracking**: Color-coded badges and error message display
- **Tabbed Admin Interface**: Switch between entry management and queue management
- **Real-time Queue Refresh**: Manual refresh to check processing status
- **Integration Ready**: Uses existing GitHub API and authentication patterns

### Queue Management Features
- View articles waiting for processing (pending submissions)
- See failed submissions with specific error messages
- Remove problematic articles from processing queue
- Clear entire queue when needed
- Statistics display showing queue health
