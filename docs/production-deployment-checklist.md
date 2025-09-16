# Production Deployment Checklist

## Pre-Deployment Verification
- [ ] Confirm production has `political_entries.id` as TEXT type
- [ ] Backup production database
- [ ] Test migration ran successfully on TEST environment

## Migration Steps
1. [ ] Run `001_rss_system_production.sql` on production DB
2. [ ] Run `migration_verification_web.sql` to confirm all checks pass
3. [ ] Deploy Edge Functions to production
4. [ ] Update GitHub Actions with production secrets

## Key Differences: Test vs Production
- **TEST**: Required aggressive table recreation due to INTEGER id issue
- **PRODUCTION**: Clean migration, just adding new tables/columns
- **DATA**: Production has real data to preserve, test had minimal data

## Edge Functions Deployment
```bash
# For production deployment:
supabase link --project-ref osjbulmltfpcoldydexg
supabase functions deploy
supabase secrets set ADMIN_API_KEY=<production-key>
```

## Verification After Deployment
- [ ] All 6 tables exist
- [ ] Edge Functions responding
- [ ] No disruption to existing functionality
- [ ] Cost tracking working