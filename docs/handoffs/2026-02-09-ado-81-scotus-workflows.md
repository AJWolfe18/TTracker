# ADO-81: SCOTUS GitHub Actions Workflows

**Date:** 2026-02-09 | **ADO:** 81 (Active) | **Branch:** test | **Commit:** f9c5531

Created `scotus-tracker.yml` (daily PROD pipeline: fetch + budget guard + enrich), `enrich-scotus.yml` (single-case re-enrichment for admin dashboard), and added scotus to trigger-enrichment edge function WORKFLOW_CONFIG (deployed to TEST). Code review caught and fixed command injection in case_id input + hardened budget guard error handling. Pushed to test.

## Next Session Testing

1. **Test `enrich-scotus.yml` workflow on test branch:**
   ```bash
   # Pick a SCOTUS case ID from TEST DB, then:
   gh workflow run "Enrich SCOTUS (single case)" --ref test -f case_id=<ID> -f environment=test
   gh run watch
   ```

2. **Test edge function trigger on TEST:**
   ```bash
   curl -X POST "https://wnrjrywpcadwutfykflu.supabase.co/functions/v1/trigger-enrichment" \
     -H "Content-Type: application/json" \
     -H "x-admin-password: <ADMIN_PASSWORD>" \
     -d '{"entity_type":"scotus","entity_id":<ID>}'
   ```

3. **After both pass → PR to main** (cherry-pick f9c5531), then test PROD dispatch:
   ```bash
   gh workflow run "SCOTUS Tracker (PROD scheduled)" --ref main -f skip_fetch=true -f limit=1
   ```

4. **Pre-PR checklist:** Verify `COURTLISTENER_API_TOKEN` secret exists in GitHub repo settings.

## Next Card
Check ADO backlog for the next prioritized item after ADO-81 moves to Testing.
