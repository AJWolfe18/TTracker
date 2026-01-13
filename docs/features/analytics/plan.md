# Analytics Enhancement Plan

**Epic:** ADO-254
**Status:** In Progress (Story 1 of 5)
**Full Plan:** `C:\Users\Josh\.claude\plans\soft-sparking-barto.md`

---

## Overview

Comprehensive analytics tracking, newsletter signup, and retention/loyalty metrics to understand user behavior and gauge merch readiness.

**Cost:** $0/month (GA4 + Supabase free tier + Cloudflare Turnstile free)

---

## Stories (Under Epic 254)

| ADO | Title | Points | Status |
|-----|-------|--------|--------|
| 255 | Analytics DB Schema + GA4 Setup | 2 | **Ready for Prod** |
| 256 | Newsletter Backend (Edge Functions) | 3 | **Ready for Prod** |
| 257 | Newsletter Frontend (UI Components) | 2 | **Ready for Prod** |
| 258 | Frontend Analytics Events | 3 | New |
| 259 | Pre-Commerce + Search Intelligence | 2 | New |

**Total:** 12 points | **Ready for Prod:** 7 points (58%)

---

## Feature Files

| File | Purpose |
|------|---------|
| `ga4-turnstile-setup.md` | Manual GA4 + Turnstile configuration |
| `migrations/058_analytics_tables.sql` | Database schema |
| `.claude/plans/soft-sparking-barto.md` | Full implementation plan (800+ lines) |

---

## Key Decisions

1. **No RPCs** - Rate limit cleanup and search_gaps upsert done inline in Edge Functions
2. **UUID unsubscribe tokens** - NOT email_hash (prevents dictionary attacks)
3. **bucket_type column** - Single rate_limits table handles minute + day limits
4. **Beacon transport** - For reliable outbound click tracking
5. **sessionStorage** - Enforces once-per-session event firing

---

## Quick Reference

### Event Schema (5 core events)
- `outbound_click` - External link clicks
- `detail_toggle` - Modal open/close with duration
- `content_interaction` - Scroll depth, filters, tabs
- `newsletter_signup` - Form submissions
- `search_action` - Search with term hashing

### Pre-Commerce Events
- `merch_impression` - Ghost button visible (IntersectionObserver)
- `merch_interest` - Ghost button clicked

### Error Tracking
- `error_logged` - API/JS errors by type

---

See full plan for implementation details, code patterns, and security considerations.
