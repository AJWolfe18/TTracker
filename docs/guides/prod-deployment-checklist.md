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

#### GitHub Secrets (EXACT names)
| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | PROD Supabase URL |
| `SUPABASE_SERVICE_KEY` | PROD service role key |
| `SUPABASE_ANON_KEY` | PROD anon key |
| `SUPABASE_TEST_URL` | TEST Supabase URL |
| `SUPABASE_TEST_SERVICE_KEY` | TEST service role key |
| `SUPABASE_TEST_ANON_KEY` | TEST anon key |
| `OPENAI_API_KEY` | OpenAI (shared) |
| `PERPLEXITY_API_KEY` | Perplexity — **no active consumers since ADO-553** (legacy pardons phases removed); safe to delete from GitHub secrets |
| `EDGE_CRON_TOKEN` | Edge function auth (TEST) |
| `EDGE_CRON_TOKEN_PROD` | Edge function auth (PROD) |
| `DISCORD_WEBHOOK_URL` | Discord alerts (shared) — used by rss-tracker-test/prod + pardons-tracker workflows; alerts are non-blocking if unset |
| `COURTLISTENER_API_TOKEN` | SCOTUS case fetch (CourtListener API) |

**Important:** Workflows inject secrets into `SUPABASE_SERVICE_ROLE_KEY`. The secret NAME is `SUPABASE_SERVICE_KEY` but scripts read `SUPABASE_SERVICE_ROLE_KEY`.

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
