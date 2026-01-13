# Session Handoff: 2026-01-13 (ADO-253)

## Summary
ADO-253 Perplexity Research Integration - **COMPLETE**. Migration applied, workflow deployed to main + test, tested with 4 pardons successfully. Ready for Prod.

---

## Completed

### 1. Migration 057 (Applied to TEST)
**File:** `migrations/057_pardon_research_tables.sql`

- Idempotency columns on `pardons`: `research_prompt_version`, `researched_at`
- Cost tracking table: `pardon_research_costs`
- Error tracking table with dedupe: `pardon_research_errors`
- RLS + REVOKE (tables AND sequences)
- Data integrity constraints (idempotent DO blocks with table-specific checks)
- Selective index for worker queries

### 2. Perplexity Research Script
**File:** `scripts/enrichment/perplexity-research.js`

- Perplexity Sonar API client
- JSON validation (connection types, corruption levels, dates, URLs)
- UPSERT error handling with attempt_count increment
- Cost tracking per pardon
- CLI: `--dry-run`, `--force`, `--limit=N`
- Runtime guard (4 min), 2s delay between API calls

### 3. GitHub Actions Workflow
**File:** `.github/workflows/research-pardons.yml`

- Manual-only (workflow_dispatch)
- Inputs: `limit` (default 20), `force` (default false)
- Security hardened (4 rounds of AI code review):
  - Input validation (numeric check + default)
  - MAX_LIMIT cap (100)
  - Least-privilege permissions
  - Scoped concurrency group by ref_name
- Branch guard: only runs on `test`
- 10 min timeout
- Deployed to **main** (PR #48) and **test**

### 4. npm Scripts
```json
"research:pardons": "node scripts/enrichment/perplexity-research.js",
"research:pardons:dry-run": "node scripts/enrichment/perplexity-research.js --dry-run"
```

### 5. Testing Results
| Pardon | Connection | Corruption | Cost |
|--------|------------|------------|------|
| Rudy Giuliani | political_ally | 4 | $0.017 |
| Steve Bannon | campaign_staff | 4 | $0.008 |
| Jan 6 Mass Pardon | political_ally | 3 | $0.010 |
| Ross Ulbricht | no_connection | 2 | $0.010 |

**Total:** 4 researched, $0.045 spent

---

## Files Changed

| File | Action |
|------|--------|
| `migrations/057_pardon_research_tables.sql` | NEW |
| `scripts/enrichment/perplexity-research.js` | NEW |
| `.github/workflows/research-pardons.yml` | NEW (main + test) |
| `package.json` | MODIFIED (npm scripts) |
| `.claude/test-only-paths.md` | MODIFIED |
| `docs/features/pardons-tracker/epic-breakdown.md` | MODIFIED |

---

## ADO Status
- **ADO-253:** Ready for Prod

---

## Backfill (Operational Task)

Not a separate card - just running the completed work when ready:
```bash
gh workflow run "Research Pardons (Perplexity)" --ref test -f limit=93
```
- **Remaining:** 93 pardons
- **Est. cost:** ~$1.16
- **Est. time:** ~5 min

---

## Expert Review Fixes Applied

1. **Prompt versioning on pardons table** - Not just in cost table
2. **Error dedupe with UPSERT** - Increment attempt_count, update timestamps
3. **RLS + REVOKE** - Tables AND sequences, including PUBLIC role
4. **Data integrity constraints** - Idempotent DO blocks with table-specific conrelid checks
5. **Selective index** - `WHERE is_public = false AND research_status IN ('pending', 'in_progress')`
6. **Manual-only workflow** - Cron doesn't work on non-default branch
7. **Concurrency guard** - Prevent overlapping runs

### AI Code Review Fixes (4 rounds)
1. Shell injection prevention (input validation, bash arrays)
2. Least-privilege permissions (contents: read, actions: read)
3. Default limit fallback for empty inputs
4. MAX_LIMIT cap (100) to prevent runaway costs

---

## Startup Prompt for Next Session

```
ADO-253 Perplexity Research: COMPLETE, Ready for Prod.

Completed:
- Migration 057 applied to TEST
- Research script + workflow deployed (main + test)
- 4 pardons tested successfully ($0.045)
- 93 pardons pending backfill (~$1.16)

Options for this session:
1. Expert code review of ADO-253 work (recommended)
2. Run backfill: gh workflow run "Research Pardons (Perplexity)" --ref test -f limit=93
3. Start next story (check epic-breakdown.md)

Read: docs/handoffs/2026-01-13-ado-253-perplexity-research.md
Epic: docs/features/pardons-tracker/epic-breakdown.md
```

---

## Cost Summary

| Operation | Cost |
|-----------|------|
| Test (4 pardons) | $0.045 |
| Full backfill (93) | ~$1.16 est |
| Monthly ongoing | ~$0.10 est |

**Budget impact:** <3% of $50/month
