# GA4 + Turnstile Manual Setup Guide

**Epic:** ADO-254 (Analytics Enhancement)
**Story:** ADO-255 (Analytics DB Schema + GA4 Setup)
**Property ID:** 498284230

---

## Part 1: GA4 Configuration

### 1.1 Change Data Retention (CRITICAL - Do First!)

**Why:** Default 2-month retention prevents year-over-year funnel analysis.

1. Go to **GA4 Admin** → **Data Settings** → **Data Retention**
   - Direct link: https://analytics.google.com/analytics/web/#/a498284230p498284230/admin/dataretsettings
2. Change "Event data retention" from **2 months** → **14 months**
3. Toggle ON "Reset user data on new activity"
4. Click **Save**

### 1.2 Register Custom Dimensions

**Why:** Simply sending params in code isn't enough - GA4 collects data but won't let you use it in reports unless registered.

1. Go to **GA4 Admin** → **Custom Definitions** → **Custom Dimensions**
   - Direct link: https://analytics.google.com/analytics/web/#/a498284230p498284230/admin/customdefinitions/hub

2. Click **Create custom dimension** for each:

| Dimension Name | Scope | Event Parameter | Description |
|----------------|-------|-----------------|-------------|
| target_type | Event | target_type | Type of outbound link (article, source, etc.) |
| source_domain | Event | source_domain | Domain of external link clicked |
| content_type | Event | content_type | Content type (story, eo, pardon) |
| object_type | Event | object_type | Modal object type |
| action | Event | action | Action performed (open, close) |
| type | Event | type | Interaction type (scroll_25, filter, etc.) |
| page | Event | page | Page where interaction occurred |
| result | Event | result | Operation result (success, error) |
| signup_source | Event | signup_source | Newsletter signup location |
| signup_page | Event | signup_page | Page where signup occurred |
| has_results | Event | has_results | Whether search returned results |
| location | Event | location | UI element location (nav, inline) |
| error_type | Event | error_type | Error category (API_FAIL, JS_ERROR, etc.) |

### 1.3 Create User Property

**Why:** Enables segmentation by newsletter subscriber status in all reports.

1. Go to **GA4 Admin** → **Custom Definitions** → **Custom user properties**
2. Click **Create custom user property**
3. Fill in:
   - **Property name:** newsletter_subscriber
   - **Scope:** User
   - **Description:** User has signed up for newsletter
4. Click **Save**

### 1.4 Verify Setup (After Events Are Deployed)

1. Go to **GA4 DebugView**: Realtime → DebugView
2. Test each event type appears with correct parameters
3. Verify custom dimensions populate in reports (may take 24-48hrs)

---

## Part 2: Cloudflare Turnstile Setup

**Why:** Bot protection for newsletter signup (free CAPTCHA alternative). Required before Story 2 (Newsletter Backend).

### 2.1 Create Turnstile Widget

1. Go to https://dash.cloudflare.com/ → **Turnstile**
   - Or direct: https://dash.cloudflare.com/?to=/:account/turnstile
2. Click **Add site**
3. Fill in:
   - **Site name:** TrumpyTracker Newsletter
   - **Hostname:** `trumpytracker.com` (add both prod and test domains)
   - **Widget Mode:** Managed (recommended)
   - **Pre-Clearance:** Disabled
4. Click **Create**

### 2.2 Get Keys

After creation, you'll see:
- **Site Key** (public): For frontend widget - goes in HTML
- **Secret Key** (private): For Edge Function verification - goes in Supabase secrets

### 2.3 Add Secret to Supabase Edge Functions

**For TEST environment:**
```bash
supabase secrets set TURNSTILE_SECRET_KEY=your_secret_key_here --project-ref wnrjrywpcadwutfykflu
```

**For PROD environment (later):**
```bash
supabase secrets set TURNSTILE_SECRET_KEY=your_secret_key_here --project-ref osjbulmltfpcoldydexg
```

### 2.4 Also Add Rate Limit Salt

Generate a random string for IP hashing:
```bash
# Generate a random salt
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Set it in Supabase
supabase secrets set RATE_LIMIT_SALT=your_generated_salt_here --project-ref wnrjrywpcadwutfykflu
```

---

## Part 3: Verification Checklist

After completing manual setup:

- [ ] GA4 data retention changed to 14 months
- [ ] 13 custom dimensions registered
- [ ] `newsletter_subscriber` user property created
- [ ] Turnstile widget created
- [ ] Turnstile Site Key noted (for frontend)
- [ ] `TURNSTILE_SECRET_KEY` added to Supabase secrets
- [ ] `RATE_LIMIT_SALT` added to Supabase secrets

---

## Quick Reference: Supabase Secrets Commands

```bash
# List current secrets (TEST)
supabase secrets list --project-ref wnrjrywpcadwutfykflu

# Set a secret
supabase secrets set KEY_NAME=value --project-ref wnrjrywpcadwutfykflu

# Remove a secret
supabase secrets unset KEY_NAME --project-ref wnrjrywpcadwutfykflu
```

---

## Troubleshooting

### Custom dimensions not showing in reports
- Wait 24-48 hours for processing
- Verify events are firing in DebugView
- Check dimension name matches event parameter exactly

### Turnstile widget not loading
- Verify hostname is added to Turnstile widget settings
- Check browser console for errors
- Ensure Site Key is correct in frontend code

### Edge Function returning 401/403 on Turnstile verify
- Verify Secret Key is correct
- Check `TURNSTILE_SECRET_KEY` secret is set
- Ensure you're sending the token correctly from frontend

---

**Last Updated:** 2026-01-13
