# PROD Deployment Checklist Template

Copy this section into your feature plan (`/docs/plans/`) to track deployment requirements.

---

## PROD Deployment Requirements

### Database
- [ ] Migrations applied to PROD Supabase
- [ ] RLS policies verified
- [ ] Indexes created

### Edge Functions
- [ ] Functions deployed to PROD (`--project-ref osjbulmltfpcoldydexg`)
- [ ] CORS headers configured
- [ ] Tested via curl

### GitHub Actions Workflows
- [ ] Workflows support `main` branch (not just `test`)
- [ ] PROD secrets configured in repo settings
- [ ] Workflow tested on main

### Secrets & Environment
- [ ] `SUPABASE_URL` (PROD) configured
- [ ] `SUPABASE_SERVICE_ROLE_KEY` (PROD) configured
- [ ] Any new API keys added to GitHub Secrets

### Frontend
- [ ] HTML/JS deployed via Netlify (auto on merge to main)
- [ ] Environment-specific config (if any)

### Data
- [ ] Seed data imported (if applicable)
- [ ] Pipeline runs scheduled or triggered

---

## Pre-Merge Checklist

Before merging feature PR to main:

1. [ ] All items above checked
2. [ ] Workflows work on both `test` AND `main`
3. [ ] No hardcoded TEST URLs in code
4. [ ] Edge functions tested on PROD
