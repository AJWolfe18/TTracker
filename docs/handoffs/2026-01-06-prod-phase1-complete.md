# PROD Deployment Phase 1 Complete - 2026-01-06

## Status: Phase 1 COMPLETE

### What Was Done
- **Groups A-F migrations** (001-045) applied to PROD
- **Phase 4 Security** (046-049) applied
- **Security GATE** verification passed

### Schema Drift Encountered & Fixed

| Issue | Migration | Fix Applied |
|-------|-----------|-------------|
| `stories.primary_source_domain` missing | 024, 048 | Removed from function RETURNS/SELECT |
| `feed_registry.last_fetched_at` missing | 034 | Added via `ALTER TABLE ADD COLUMN` |
| `admin` schema missing | 034 | Added via `CREATE SCHEMA IF NOT EXISTS` |

### Function Name Differences (Runbook vs PROD)

| Runbook Says | PROD Has |
|--------------|----------|
| `claim_runnable_job()` | `claim_next_job(text)` |

### Security GATE Results
- service_role claim_next_job(text): PASS
- anon SELECT stories/articles: PASS
- anon INSERT/UPDATE: BLOCKED (correct)

---

## Next Session: Phase 2 (Edge Functions)

**JIRA:** TTRC-361

### Resume Prompt
```
Resume PROD deployment from docs/plans/prod-deployment-runbook.md

Phase 1 (Schema Migrations) is COMPLETE - GATE passed.
Now starting Phase 2 (Edge Functions) per TTRC-361.

See plan doc: C:\Users\Josh\.claude\plans\gentle-fluttering-mccarthy.md
- Contains drift log of TEST vs PROD differences
- Continue adding to drift log if more issues found
```

### Phase 2 Steps
1. Set Edge Function secrets in Supabase Dashboard
2. Deploy 5 functions (stories-active, stories-detail, stories-search, queue-stats, rss-enqueue)
3. Smoke test endpoints
4. Continue to Phase 3 (Frontend + RSS)

---

## Lessons Learned

### Runbook Gap
The runbook's Appendix A audit was **observational only** - it lists what exists but doesn't validate that columns/schemas required by migrations actually exist.

### Recommendation for Future Deployments
1. Run comprehensive schema audit BEFORE starting migrations
2. Compare expected columns/schemas to actual PROD state
3. Create fix-up SQL for gaps BEFORE running migration groups

### Audit Query (use before future migrations)
```sql
SELECT category, item, status FROM (
  SELECT 1 as sort, 'SCHEMA' as category, s.expected as item,
         CASE WHEN n.nspname IS NOT NULL THEN 'exists' ELSE 'MISSING' END as status
  FROM (VALUES ('public'), ('admin'), ('extensions')) s(expected)
  LEFT JOIN pg_namespace n ON n.nspname = s.expected
  UNION ALL
  SELECT 2, 'TABLE', t.expected,
         CASE WHEN c.relname IS NOT NULL THEN 'exists' ELSE 'MISSING' END
  FROM (VALUES ('articles'), ('stories'), ('article_story'), ('feed_registry'),
               ('job_queue'), ('budgets')) t(expected)
  LEFT JOIN pg_class c ON c.relname = t.expected AND c.relkind = 'r'
) audit ORDER BY sort, category, item;
```

---

*JIRA TTRC-360 updated with completion comment.*
