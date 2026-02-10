# ADO-81: SCOTUS GitHub Actions Workflows

**Date:** 2026-02-09 | **ADO:** 81 | **Branch:** test

Created 2 workflow files + edited trigger-enrichment edge function. `scotus-tracker.yml` is the daily PROD pipeline (fetch from CourtListener + budget guard + enrich). `enrich-scotus.yml` is the single-case re-enrichment workflow triggered by the admin dashboard. Both deployed to test branch; trigger-enrichment edge function deployed to TEST Supabase. **Next:** Push to test, then PR to main — both workflow files must reach main for the scheduled SCOTUS pipeline to activate (gated by `ENABLE_PROD_SCHEDULES` var + `refs/heads/main` check). Verify `COURTLISTENER_API_TOKEN` secret exists in GitHub repo settings before first PROD run.
