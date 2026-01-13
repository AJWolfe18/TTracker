# Session Handoff: 2026-01-13 (ADO-253)

## Summary
Built Perplexity research integration for pardons AI enrichment (ADO-253). Code complete with extensive expert review. Migration pending application, then ready for testing.

---

## Completed

### 1. Migration 057 (Production-Ready)
**File:** `migrations/057_pardon_research_tables.sql`

**Features:**
- Idempotency columns on `pardons`: `research_prompt_version`, `researched_at`
- Cost tracking table: `pardon_research_costs`
- Error tracking table with dedupe: `pardon_research_errors`
- RLS + REVOKE (tables AND sequences)
- Data integrity constraints (idempotent DO blocks with table-specific checks)
- Optimized indexes for worker queries

### 2. Perplexity Research Script
**File:** `scripts/enrichment/perplexity-research.js`

**Features:**
- Perplexity Sonar API client
- JSON validation (connection types, corruption levels, dates, URLs)
- UPSERT error handling with attempt_count increment
- Cost tracking per pardon
- CLI: `--dry-run`, `--force`, `--limit=N`
- Runtime guard (4 min)
- 2s delay between API calls

### 3. GitHub Actions Workflow
**File:** `.github/workflows/research-pardons.yml`

**Features:**
- Manual-only (no cron - runs from test branch)
- Inputs: `limit` (default 20), `force` (default false)
- Concurrency guard (cancel-in-progress)
- 10 min timeout
- Passes RUN_ID for attribution

### 4. npm Scripts
```json
"research:pardons": "node scripts/enrichment/perplexity-research.js",
"research:pardons:dry-run": "node scripts/enrichment/perplexity-research.js --dry-run"
```

---

## Files Changed

| File | Action |
|------|--------|
| `migrations/057_pardon_research_tables.sql` | NEW |
| `scripts/enrichment/perplexity-research.js` | NEW |
| `.github/workflows/research-pardons.yml` | NEW |
| `package.json` | MODIFIED (added npm scripts) |
| `scripts/apply-057-migration.js` | NEW (helper, test-only) |
| `.claude/test-only-paths.md` | MODIFIED |

---

## NOT Completed

| Task | Status | Next Step |
|------|--------|-----------|
| Apply migration 057 | PENDING | Run SQL in Supabase Dashboard |
| Test with 3 pardons | PENDING | After migration |
| Full backfill (92) | PENDING | After testing |
| ADO-253 status update | PENDING | After backfill |

---

## Expert Review Fixes Applied

1. **Prompt versioning on pardons table** - Not just in cost table
2. **Error dedupe with UPSERT** - Increment attempt_count, update timestamps
3. **RLS + REVOKE** - Tables AND sequences, including PUBLIC role
4. **Data integrity constraints** - Idempotent DO blocks with table-specific conrelid checks
5. **Selective index** - `WHERE is_public = false AND research_status IN ('pending', 'in_progress')`
6. **Manual-only workflow** - Cron doesn't work on non-default branch
7. **Concurrency guard** - Prevent overlapping runs

---

## Migration SQL (Final Version)

Copy `migrations/057_pardon_research_tables.sql` contents into Supabase Dashboard SQL Editor for TrumpyTracker-Test.

---

## Startup Prompt for Next Session

```
ADO-253 Perplexity Research: Code complete, migration pending.

Current state:
- Script: scripts/enrichment/perplexity-research.js ✅
- Workflow: .github/workflows/research-pardons.yml ✅
- Migration: migrations/057_pardon_research_tables.sql ✅ (NOT APPLIED)
- 92 pardons with research_status='pending'

Next steps:
1. Apply migration 057 via Supabase Dashboard SQL Editor
2. Test: npm run research:pardons:dry-run -- --limit=3
3. Test live: npm run research:pardons -- --limit=3
4. Backfill: npm run research:pardons -- --limit=92
5. Update ADO-253 status, create PR if ready

Read: docs/handoffs/2026-01-13-ado-253-perplexity-research.md
Plan: C:\Users\Josh\.claude\plans\cheerful-wiggling-puddle.md
Migration: migrations/057_pardon_research_tables.sql
```

---

## Cost Estimate

| Operation | Est. Cost |
|-----------|-----------|
| Test (3 pardons) | ~$0.02 |
| Full backfill (92) | ~$0.60 |
| Monthly ongoing | ~$0.10 |

**Budget impact:** Negligible (<1% of $50/month)
