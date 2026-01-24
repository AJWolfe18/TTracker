# SCOTUS Tracker Feature

**Status:** Frontend Development Phase
**Epic:** [ADO-106](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/106)
**Last Updated:** 2026-01-23

---

## Overview

Track Supreme Court decisions with AI-powered editorial analysis. Fetches cases from CourtListener API, enriches with GPT analysis (two-pass architecture), and displays with impact ratings.

---

## Current Status

| Component | Status | ADO | Notes |
|-----------|--------|-----|-------|
| Database Schema | ✅ Complete | ADO-87 | Migrations 066-069 applied |
| CourtListener API | ✅ Complete | ADO-86 | fetch-cases.js working |
| Full Opinion Architecture | ✅ Testing | ADO-283 | 25-92K char opinions stored |
| Two-Pass Enrichment | ✅ Complete | ADO-280 | Fact extraction + editorial |
| Enrichment Script | ✅ Complete | ADO-85 | enrich-scotus.js working |
| Tone/Voice | ✅ Complete | ADO-272 | "The Betrayal" voice ready |
| Tone Variation | 🔲 Not Started | ADO-275 | Frame bucket architecture |
| Frontend UI | 🔲 Not Started | ADO-83 | **NEXT** |
| CSS Additions | 🔲 Not Started | ADO-82 | Impact badges, etc. |
| Backfill | 🔲 Not Started | ADO-80 | ~50 cases for 2024-25 term |
| GitHub Workflow | 🔲 Not Started | ADO-81 | Automation |

---

## Implementation Plan (Agreed 2026-01-23)

### Phase 1: Make It Visible
1. **#83 - Frontend page** - List view + detail modal
2. **#82 - CSS additions** - Impact badge colors, styling

### Phase 2: Content
3. **#80 - Partial backfill** - 10-15 cases to verify display

### Phase 3: Quality
4. **#275 - Tone variation** - Apply frame bucket architecture

### Phase 4: Scale
5. **#80 - Full backfill** - Remaining 2024-25 term cases
6. **#81 - GitHub workflow** - Automated ingestion

### Deferred
- #77 QA, #78 SEO, #79 Admin - After MVP working

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `scotus_cases` | Main case data + enrichment results |
| `scotus_opinions` | Full opinion text (ADO-283) - for enrichment only |
| `scotus_sync_state` | Cursor tracking for incremental fetch |

---

## Key Files

| File | Purpose |
|------|---------|
| `scripts/scotus/fetch-cases.js` | CourtListener API fetcher |
| `scripts/scotus/enrich-scotus.js` | GPT enrichment (two-pass) |
| `scripts/scotus/backfill-opinions.js` | Backfill full opinions for v1 cases |
| `scripts/scotus/opinion-utils.js` | Shared utilities |
| `scripts/enrichment/scotus-gpt-prompt.js` | GPT prompt templates |
| `scripts/enrichment/scotus-fact-extraction.js` | Pass 1 fact extraction |
| `scripts/enrichment/scotus-variation-pools.js` | Anti-repetition pools |

---

## Quick Commands

```bash
# Fetch recent SCOTUS cases
node scripts/scotus/fetch-cases.js --since=2024-06-01 --limit=10

# Enrich pending cases
node scripts/scotus/enrich-scotus.js --limit=5

# Backfill full opinions for existing cases
node scripts/scotus/backfill-opinions.js --limit=10

# Check database
SELECT id, case_name, ruling_impact_level, ruling_label, enrichment_status
FROM scotus_cases
WHERE is_public = true
ORDER BY decided_at DESC;
```

---

## Data Pipeline

```
CourtListener API
    ↓ fetch-cases.js
scotus_cases + scotus_opinions (is_public = false)
    ↓ enrich-scotus.js (two-pass: facts → editorial)
scotus_cases (enriched, is_public = true)
    ↓ Frontend query
SCOTUS page (list + detail modal)
```

---

## Related Docs

- [PRD](./prd.md) - Product requirements & ruling impact scale
- [Frontend Spec](./frontend-spec.md) - UI field mapping & acceptance criteria
- [Field Mapping](./field-mapping.md) - CourtListener API field mapping
- [ADO-85 Plan](./ado-85-plan.md) - Detailed enrichment implementation plan

---

## ADO Items Under Feature #106

| ID | Title | State |
|----|-------|-------|
| 77 | QA: End-to-end flow | New |
| 78 | SEO: URLs + sitemap | New |
| 79 | Admin review queue | New |
| 80 | Backfill 2024-25 term | New |
| 81 | GitHub Actions workflow | New |
| 82 | CSS additions | New |
| 83 | Frontend page | New |
| 85 | Evidence anchoring | Active |
| 86 | CourtListener API | Resolved |
| 87 | Database schema | Resolved |
| 272 | Enable profanity/betrayal | Ready for Prod |
| 274 | Stories tone variation | Testing |
| 275 | SCOTUS tone variation | New |
| 277 | Improve syllabus extraction | New (may be obsolete) |
| 278 | Harden regex | New (may be obsolete) |
| 279 | Request queue | New |
| 280 | Two-pass architecture | Closed |
| 281 | Code quality fixes | Closed |
| 283 | Full opinion input | Testing |
