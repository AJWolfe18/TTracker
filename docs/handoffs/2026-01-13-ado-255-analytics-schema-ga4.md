# Handoff: ADO-255 Analytics DB Schema + GA4 Setup

**Date:** 2026-01-13
**Epic:** ADO-254 (Analytics Enhancement)
**Story:** ADO-255 (Analytics DB Schema + GA4 Setup)
**Status:** In Progress - Waiting on manual steps

---

## What Was Done

### ADO Stories Created (All 5 under Epic 254)
| ADO ID | Title | Points | Status |
|--------|-------|--------|--------|
| **255** | Analytics DB Schema + GA4 Setup | 2 | Active |
| 256 | Newsletter Backend (Edge Functions) | 3 | New |
| 257 | Newsletter Frontend (UI Components) | 2 | New |
| 258 | Frontend Analytics Events | 3 | New |
| 259 | Pre-Commerce + Search Intelligence | 2 | New |

### Files Created
1. `migrations/058_analytics_tables.sql` - All 3 tables with RLS
2. `scripts/apply-058-migration.js` - Verification script
3. `docs/features/analytics/ga4-turnstile-setup.md` - Manual setup instructions
4. `docs/features/analytics/plan.md` - Feature plan overview

### Schema Created (in migration 058)
- `newsletter_subscribers` - Email signups with UUID unsubscribe tokens
- `rate_limits` - DB-based rate limiting with bucket_type (minute|day)
- `search_gaps` - Zero-result search terms for editorial roadmap

---

## YOUR ACTION REQUIRED (Manual Steps)

### 1. Apply Migration to TEST
```
https://supabase.com/dashboard/project/wnrjrywpcadwutfykflu/sql
```
Copy contents of `migrations/058_analytics_tables.sql` and Run.

Then verify:
```bash
node scripts/apply-058-migration.js
```

### 2. Configure GA4 (Property 498284230)
Follow `docs/features/analytics/ga4-turnstile-setup.md` Part 1:
- [ ] Change data retention: 2 months → 14 months
- [ ] Register 13 custom dimensions
- [ ] Create `newsletter_subscriber` user property

### 3. Set Up Turnstile (Before Story 2)
Follow `docs/features/analytics/ga4-turnstile-setup.md` Part 2:
- [ ] Create Turnstile widget at cloudflare.com
- [ ] Note Site Key (for frontend later)
- [ ] Add `TURNSTILE_SECRET_KEY` to Supabase secrets
- [ ] Add `RATE_LIMIT_SALT` to Supabase secrets

---

## Next Story: ADO-256 Newsletter Backend

Once manual setup complete, Story 2 creates:
- `supabase/functions/newsletter-signup/index.ts`
- `supabase/functions/newsletter-unsubscribe/index.ts`
- `supabase/functions/log-search-gap/index.ts`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/features/analytics/plan.md` | Feature plan overview |
| `.claude/plans/soft-sparking-barto.md` | Master plan (800+ lines) |
| `migrations/058_analytics_tables.sql` | Schema definition |
| `docs/features/analytics/ga4-turnstile-setup.md` | Manual setup guide |

---

## Prompt to Continue (After Manual Steps Done)

```
Manual setup complete for ADO-255. Migration applied, GA4 configured, Turnstile created.

Start ADO-256: Newsletter Backend (Edge Functions)
- Create newsletter-signup Edge Function with Turnstile + rate limiting
- Create newsletter-unsubscribe Edge Function with UUID token
- Create log-search-gap Edge Function
```

---

## Notes

- No RPCs needed - rate limit cleanup and search_gaps upsert done inline in Edge Functions
- Turnstile Site Key needed for Story 3 (frontend)
- GA4 custom dimensions may take 24-48hrs to appear in reports
