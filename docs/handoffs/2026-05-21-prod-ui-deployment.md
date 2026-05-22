# Handoff: PROD UI Deployment + Storage Cleanup

**Date:** 2026-05-21
**PRs:** #91 (UI Phases 0-6), #92 (EO hotfix)
**Status:** Deployed to PROD, hotfixes applied, index cleanup done

## What Was Done

### PROD Deployment
- Cherry-picked 16 commits (Phases 0-6 + QA polish) to deployment branch from main
- Had to include Phases 0-3 since main had no React frontend at all (only legacy vanilla JS)
- PR #91 merged (squash) — React frontend live on trumpytracker.com

### Hotfixes (found during PROD testing)
1. **Stories detail broken** — `stories-detail` edge function on PROD was stale, referenced `articles.headline` (doesn't exist). Redeployed via `npx supabase functions deploy stories-detail --project-ref osjbulmltfpcoldydexg`
2. **EO detail broken** — PROD EO IDs are strings (`eo_1755289236225_...`) but `validateId()` only accepted integers. Replaced with `encodeURIComponent`. PR #92 merged.
3. **Mailto encoding** — AI review caught incomplete URL encoding in Report Correction mailto href. Fixed on both branches.

### Storage Cleanup (Migration 093)
- Applied to TEST then PROD via SQL Editor
- Dropped: duplicate HNSW index (~78MB), duplicate article_story/feed/political_entries indexes, fixed RLS policies
- PROD storage was 570MB (over 500MB limit) — freed ~85MB

### Storage Audit
- PROD: 9,895 stories (261MB), 14,176 articles (245MB), HNSW indexes (264MB combined)
- Supabase perf advisor found 47 unused indexes — potential for major additional savings
- Two biggest unused indexes (articles HNSW 108MB, stories centroid HNSW 78MB) need verification — may be used internally by RPCs

## What's NOT Done
- TEST data cleanup (only deleted some article_story links, stories/articles not yet cleaned up)
- 47 unused indexes need review and safe deletion (some may be RPC-internal)
- Security warnings: 6 SECURITY DEFINER functions callable by anon, wide-open RLS on EOs/political_entries
- Postgres version upgrade available
- Extensions in public schema (pg_trgm, vector, fuzzystrmatch)

## Next Session
1. **Create ADO ticket** for storage/index cleanup workstream
2. **Verify HNSW index usage** — test pipeline with indexes present, check if `find_similar_stories` RPC actually uses `ix_stories_centroid_emb_v1_hnsw` or `ix_articles_emb_v1_hnsw`
3. **Drop safe unused indexes** — the ~30 small ones on legacy/admin tables are safe
4. **TEST data cleanup** — delete stories/articles older than 30 days
5. **Security hardening** — lock down SECURITY DEFINER functions, fix RLS policies
