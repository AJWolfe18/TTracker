# Handoff: ADO-256 Newsletter Backend (Edge Functions)

**Date:** 2026-01-13
**Epic:** ADO-254 (Analytics Enhancement)
**Story:** ADO-256 (Newsletter Backend)
**Status:** Closed

---

## What Was Done

### Edge Functions Created & Deployed to TEST

| Function | Purpose | Status |
|----------|---------|--------|
| `newsletter-signup` | Email signup with Turnstile + rate limiting + honeypot | Deployed ✓ |
| `newsletter-unsubscribe` | UUID token-based unsubscribe (CAN-SPAM compliant) | Deployed ✓ |
| `log-search-gap` | Zero-result search term logging for editorial | Deployed ✓ |

### Security Layers Implemented

**newsletter-signup:**
1. Turnstile CAPTCHA verification (when configured)
2. DB-based rate limiting (5/min, 20/day per IP)
3. Honeypot field detection
4. Email format validation
5. Generic response (no duplicate status leakage)

**newsletter-unsubscribe:**
- UUID token validation (NOT email_hash - prevents dictionary attacks)
- Returns HTML page for email link clicks

**log-search-gap:**
- Fail-closed sanitization (blocks PII patterns)
- Atomic upsert with count increment

### Secrets Configured

- `TURNSTILE_SECRET_KEY` ✓
- `RATE_LIMIT_SALT` ✓

---

## Story Progress

| ADO | Title | Points | Status |
|-----|-------|--------|--------|
| 255 | Analytics DB Schema + GA4 Setup | 2 | **Closed** |
| 256 | Newsletter Backend (Edge Functions) | 3 | **Closed** |
| 257 | Newsletter Frontend (UI Components) | 2 | New |
| 258 | Frontend Analytics Events | 3 | New |
| 259 | Pre-Commerce + Search Intelligence | 2 | New |

---

## Next Story: ADO-257 Newsletter Frontend

### What It Needs

1. **Footer newsletter component** - All 3 pages (Stories, EOs, Pardons)
2. **Inline 50% scroll CTA** - Higher conversion placement
3. **Turnstile widget integration** - Get Site Key from Cloudflare dashboard
4. **GA4 user property** - Set `newsletter_subscriber: true` on success

### Turnstile Site Key

You'll need your Turnstile **Site Key** (public) for the frontend widget.
Find it at: https://dash.cloudflare.com/?to=/:account/turnstile

---

## API Endpoints (for Frontend)

**Signup:**
```javascript
POST /functions/v1/newsletter-signup
{
  email: "user@example.com",
  turnstile_token: "token-from-widget",
  honeypot: "",  // Hidden field, should be empty
  signup_page: "stories",  // or "eos" | "pardons"
  signup_source: "footer",  // or "inline_50pct"
  utm_source: "twitter",  // optional
  utm_medium: "social",   // optional
  utm_campaign: "launch"  // optional
}
```

**Unsubscribe (for future emails):**
```
GET /functions/v1/newsletter-unsubscribe?token={unsubscribe_token}
```

**Search Gap (from frontend search):**
```javascript
POST /functions/v1/log-search-gap
{
  term: "search query",
  result_count: 0
}
```

---

## Key Files

| File | Purpose |
|------|---------|
| `supabase/functions/newsletter-signup/index.ts` | Signup Edge Function |
| `supabase/functions/newsletter-unsubscribe/index.ts` | Unsubscribe Edge Function |
| `supabase/functions/log-search-gap/index.ts` | Search gap logging |
| `docs/features/analytics/plan.md` | Feature plan overview |

---

## Prompt to Continue

```
Start ADO-257: Newsletter Frontend (UI Components)

Using the endpoints from ADO-256:
1. Add footer newsletter form to all 3 pages
2. Add inline 50% scroll CTA
3. Integrate Turnstile widget (Site Key needed from Cloudflare)
4. Set GA4 user property on successful signup
5. Style with existing theme patterns
```
