# SCOTUS Tracker Feature

**Status:** In Development (ADO-86, ADO-87 Active)
**Epic:** [ADO-106](https://dev.azure.com/AJWolfe92/TTracker/_workitems/edit/106)
**Last Updated:** 2026-01-20

---

## Overview

Track Supreme Court decisions with AI-powered editorial analysis. Fetches cases from CourtListener API, enriches with GPT analysis, and displays with impact ratings.

---

## Current Status

| Component | Status | ADO | Notes |
|-----------|--------|-----|-------|
| Database Schema | ✅ Complete | ADO-87 | Migration 066 applied to TEST |
| CourtListener API | ✅ Complete | ADO-86 | fetch-cases.js working |
| Enrichment Script | 🔲 Not Started | ADO-85 | Blocked by ADO-275 (tone guide) |
| Edge Functions | 🔲 Not Started | TBD | Need scotus-list, scotus-detail |
| Frontend UI | 🔲 Not Started | TBD | Need page design |

---

## Files

| File | Purpose |
|------|---------|
| `migrations/066_scotus_cases.sql` | Schema for scotus_cases + sync_state |
| `scripts/scotus/fetch-cases.js` | CourtListener API fetcher |
| `scripts/scotus/README.md` | Script usage documentation |
| `scripts/enrichment/scotus-gpt-prompt.js` | GPT enrichment prompt (exists, needs tone update) |
| `docs/features/scotus-tracker/prd.md` | Product requirements |
| `docs/features/scotus-tracker/field-mapping.md` | API field mapping notes |

---

## Quick Commands

```bash
# Fetch recent SCOTUS cases
COURTLISTENER_API_TOKEN=<token> node scripts/scotus/fetch-cases.js --since=2024-01-01 --limit=20

# Dry run (no DB writes)
COURTLISTENER_API_TOKEN=<token> node scripts/scotus/fetch-cases.js --since=2024-01-01 --limit=5 --dry-run

# Check database
SELECT id, case_name, term, decided_at, majority_author, syllabus
FROM scotus_cases
ORDER BY decided_at DESC
LIMIT 10;
```

---

## Data Pipeline

```
CourtListener API
    ↓ fetch-cases.js (3 endpoints per case)
    │   ├── /clusters/ - Main case data
    │   ├── /dockets/{id}/ - Argued date, docket number
    │   └── /opinions/?cluster={id} - Syllabus, authors
    ↓
scotus_cases table (is_public = false)
    ↓ [ADO-85] enrich-scotus.js (future)
    ↓
scotus_cases (enriched, is_public = true)
    ↓ [TBD] Edge functions
    ↓
Frontend UI
```

---

## Key Technical Notes

1. **Author Resolution**: CourtListener returns `author_id` not `author_str` - script resolves via `/people/{id}/` endpoint with caching

2. **Syllabus Extraction**: SCOTUS opinions have complex formatting with multiple "Syllabus" headers - regex targets content after "SUPREME COURT" header

3. **Idempotent Upserts**: Uses `courtlistener_cluster_id` as unique key for safe re-fetching

4. **Pagination**: `scotus_sync_state` table tracks `next_url` for resumable fetching

5. **RLS Gate**: `is_public = false` by default - cases need enrichment/review before publishing

---

## Dependencies

- **ADO-275**: Tone/style guide must be complete before ADO-85 (enrichment)
- **CourtListener Token**: Required in environment or GitHub secrets

---

## Next Steps

1. ~~Quality review fetch script~~ ✅ (Fixed author + syllabus extraction)
2. Wait for ADO-275 completion (tone guide)
3. Implement ADO-85 (enrichment script)
4. Create edge functions (scotus-list, scotus-detail)
5. Build frontend UI page

---

## Related Docs

- [PRD](./prd.md) - Full product requirements
- [Field Mapping](./field-mapping.md) - CourtListener API field mapping
- [Database Schema](/docs/database/database-schema.md#scotus-tracker-tables) - Table definitions
