# TrumpyTracker Technical Architecture v1 (GitHub Actions System)

**ARCHIVED:** This document describes the legacy architecture using GitHub Actions for direct data processing.  
**Superseded By:** `/docs/architecture/ARCHITECTURE.md` (RSS + Story Clustering system)  
**Archive Date:** October 2, 2025

---

## System Architecture Diagram (Legacy)

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

## Legacy System Description

This architecture represented TrumpyTracker's original design where:
- GitHub Actions ran processing scripts directly
- OpenAI API was called synchronously during Action runs
- Data was written directly to Supabase tables
- Individual articles were tracked (no story clustering)

### Why It Was Replaced

**Problems:**
- Each article processed individually (high cost, duplication)
- No content aggregation or story clustering
- Processing tightly coupled to GitHub Actions execution time
- Difficult to retry failures or handle rate limits
- Could not process RSS feeds at scale

**Solution:**
- Migrated to RSS + Story Clustering architecture
- Introduced Job Queue for async processing
- Added dedicated worker for RSS feed handling
- Implemented story aggregation to reduce duplicates

---

*Archived: October 2, 2025*  
*Original Version: 2.0 (August 17, 2025)*
