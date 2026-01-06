# PROD Migration Progress - 2026-01-06

## Status: PAUSED at Group E (024)

### Completed Migrations

| Group | Migrations | Status |
|-------|-----------|--------|
| A | 001-007 | ✅ Complete |
| B | 008-017 | ✅ Complete |
| C | 018a-019 | ✅ Complete |
| D | 020-022_1 | ✅ Complete |
| D GATE | pgvector | ✅ v0.8.0 |
| E | 023 | ✅ Complete |
| E | 024 | ❌ ERROR |

### Error on 024

```
ERROR: 42703: column s.primary_source_domain does not exist
LINE 23: s.top_entities, s.last_updated_at, s.primary_source_domain...
```

**Fix needed:** Remove `primary_source_domain` from the SELECT in 024 (column doesn't exist in PROD stories table).

### Remaining Work

**Group E (024-027):**
- 024 - FIX NEEDED (remove primary_source_domain)
- 025_story_merge_audit.sql
- 026_story_split_audit.sql
- 026.1_story_split_audit_hardening.sql
- 027_add_merged_into_status.sql

**Group F (030-045):**
- 030_fix_upsert_rpc_return_type.sql
- 031_fix_digest_schema_qualification.sql
- 032_fix_digest_migration_028.sql
- 033_validation_helpers.sql
- 034_rss_tracker_inline.sql
- 035_fix_unclustered_articles_rpc.sql
- 036_move_run_stats_to_public.sql
- 037_enrichment_failed_tracking.sql
- 038_smart_error_tracking.sql
- 039_fix_enqueue_rpc_partial_index.sql
- 040_fix_payload_hash_generated_column.sql
- 041_add_articles_unique_constraint.sql
- 042_unclustered_articles_require_embedding.sql
- 043_increment_story_entities.sql
- 044_run_stats_entities_extracted.sql
- 045_add_topic_slug.sql

**Phase 4 - Security (046-049):**
- 046_security_lockdown.sql
- 047_fix_rls_policies.sql
- 048_add_latest_article_published_at.sql
- 049_security_revoke_public_execute.sql

### Key Files

- Runbook: `docs/plans/prod-deployment-runbook.md`
- JIRA: TTRC-360 (Phase 0-1), TTRC-361 (Phase 2-3)

### Resume Instructions

After compacting, paste this prompt:

---

## Resume Prompt for Next Session

```
Resume PROD deployment from docs/handoffs/2026-01-06-prod-migration-progress.md

Status: Paused at Group E migration 024
- Groups A-D complete, pgvector GATE passed
- 023 complete
- 024 FAILED: "column s.primary_source_domain does not exist"

Need to:
1. Fix 024 (remove primary_source_domain from SELECT)
2. Continue 025, 026, 026.1, 027
3. Run Group F (030-045)
4. Run Phase 4 Security (046-049)

Runbook: docs/plans/prod-deployment-runbook.md
```

---

*Session ended due to context limit. JIRA update deferred to next session.*
