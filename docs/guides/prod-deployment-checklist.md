# PROD Deployment Checklist Template

Copy this section into your feature plan (`/docs/features/[feature]/`) to track deployment requirements.

---

## Pre-Deployment Planning

### Feature Flag Strategy
- [ ] Is this a new feature? → Add flag to `flags-prod.json` (OFF)
- [ ] Is this replacing existing functionality (v1→v2)?
  - [ ] Old data can coexist with new?
  - [ ] Backend writes to both old and new fields?
  - [ ] Frontend has flag-controlled rendering?
  - [ ] Rollback plan documented?
- [ ] Is this a bug fix? → No flag needed, just deploy

### Version Compatibility (if v1→v2)
- [ ] Database: New columns added, old columns kept
- [ ] Backend: Writes to both old and new fields during transition
- [ ] Frontend: Flag controls which version renders
- [ ] Tested: URL override `?ff_feature=true` works on PROD

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
5. [ ] Feature flag set to OFF in `flags-prod.json` (if new feature)

---

## Post-Merge: Feature Flag Flip

After code is deployed to PROD (flag OFF):

1. [ ] Test on PROD with URL override: `trumpytracker.com/?ff_feature=true`
2. [ ] Verify all functionality works
3. [ ] Flip flag ON in `flags-prod.json`
4. [ ] Deploy flag change (separate commit/PR)
5. [ ] Monitor for issues
6. [ ] Update ADO ticket to Closed

### Rollback (if issues)

1. Flip flag back to OFF in `flags-prod.json`
2. Deploy flag change
3. Investigate issue on TEST with flag ON
4. Fix, re-test, re-flip

---

## Weekly Deploy Cadence

Every Friday (or chosen day):
1. Query ADO for "Ready for PROD" items
2. For each: cherry-pick commits, create focused PR
3. Merge PRs (code deploys with flags OFF)
4. Test each feature with URL override
5. Flip flags ON for verified features
6. Move ADO tickets to Closed

This keeps TEST and PROD within ~1 week of each other.
