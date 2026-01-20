# Handoff: SCOTUS Schema + API Integration

**Date:** 2026-01-19
**ADO Items:** 86, 87
**Branch:** test
**Status:** Code Complete - Awaiting Manual Migration

---

## Summary

Implemented Phase 3 & 4 of SCOTUS MVP plan:
- **Migration 066** - Schema for `scotus_cases` and `scotus_sync_state` tables
- **fetch-cases.js** - CourtListener API integration script

---

## Files Created/Modified

| File | Action | Purpose |
|------|--------|---------|
| `migrations/066_scotus_cases.sql` | Created | Schema, RLS, indexes, triggers |
| `scripts/scotus/fetch-cases.js` | Created | CourtListener API fetcher |
| `scripts/scotus/README.md` | Created | Usage documentation |
| `scripts/apply-066-migration.js` | Created | Migration verification script |
| `docs/features/scotus-tracker/field-mapping.md` | Updated | Verified API field mappings |

---

## Manual Steps Required

### 1. Apply Migration 066 (BLOCKING)

The migration must be applied via Supabase Dashboard:

1. Open [Supabase Dashboard](https://supabase.com/dashboard)
2. Select **TrumpyTracker-Test** project
3. Navigate to **SQL Editor**
4. Copy contents of `migrations/066_scotus_cases.sql`
5. Run the SQL
6. Verify with: `node scripts/apply-066-migration.js`

### 2. Add CourtListener Token to Environment

**Local (.env):**
```
COURTLISTENER_API_TOKEN=c9c7c709e6307c0a5b04476644beb57ad2c3a894
```

**GitHub Secret (for future workflow):**
- Name: `COURTLISTENER_API_TOKEN`
- Value: `c9c7c709e6307c0a5b04476644beb57ad2c3a894`

**Security Note:** This token was shown in chat. Consider rotating it after adding to secrets if concerned about exposure.

---

## Testing After Migration

Once migration 066 is applied:

```bash
# Test with dry run (no writes)
COURTLISTENER_API_TOKEN=c9c7c709e6307c0a5b04476644beb57ad2c3a894 \
  node scripts/scotus/fetch-cases.js --dry-run --limit=2

# Fetch 2 real cases
COURTLISTENER_API_TOKEN=c9c7c709e6307c0a5b04476644beb57ad2c3a894 \
  node scripts/scotus/fetch-cases.js --limit=2

# Verify cases in database
node scripts/apply-066-migration.js
```

---

## Schema Overview

**scotus_cases table:**
- CourtListener IDs (cluster_id, docket_id)
- Case metadata (name, docket_number, term, decided_at, argued_at)
- Vote data (vote_split, majority_author, dissent_authors) - nullable
- Content (syllabus, opinion_excerpt)
- Enrichment fields (ruling_impact_level, summary_spicy, etc.)
- `is_public` gate for frontend visibility

**scotus_sync_state table (singleton):**
- `next_url` - Pagination checkpoint
- `last_date_filed` - Most recent case date
- `total_fetched` - Running count

---

## API Integration Details

**3-Endpoint Fetch Pattern:**
1. `/clusters/` - Main case data
2. `/dockets/{id}/` - Argued date, docket number
3. `/opinions/?cluster={id}` - Syllabus, author, dissents

**Key Findings from API Verification:**
- Syllabus is in `opinion.plain_text`, NOT `cluster.syllabus`
- SCDB vote data (`scdb_votes_majority`) is mostly NULL - unreliable
- Opinion types are strings like "020majority", not enum values
- `argued_at` is on docket, not cluster

---

## Next Steps

1. **Apply migration 066** (Josh - Supabase Dashboard)
2. **Test fetch script** with `--limit=5`
3. **Add GitHub secret** for workflow automation
4. **ADO-85** - Enrichment prompt (exists but needs tone updates per ADO-275)
5. **Frontend** - Edge function and UI (future tickets)

---

## ADO Status

| ADO | Title | Status |
|-----|-------|--------|
| 86 | CourtListener API integration | Resolved (code complete) |
| 87 | Create SCOTUS database schema | Resolved (code complete) |

Both await manual migration application to be fully testable.

---

## Verification Checklist

**After Migration:**
- [ ] `node scripts/apply-066-migration.js` shows all green
- [ ] `SELECT count(*) FROM scotus_cases` returns 0
- [ ] `SELECT * FROM scotus_sync_state` returns singleton row

**After Fetch Test:**
- [ ] Cases appear in `scotus_cases` table
- [ ] `updated_at` trigger fires on re-fetch
- [ ] `is_public = false` by default
- [ ] Sync state tracks pagination
