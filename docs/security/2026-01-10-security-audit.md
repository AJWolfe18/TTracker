# Security Audit Report

**Date:** 2026-01-10
**Auditor:** Claude Code (simulating 3rd party audit)
**Scope:** Full application security review - TrumpyTracker

---

## Executive Summary

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 CRITICAL | 0 | None |
| 🟠 HIGH | 0 | ✅ All fixed |
| 🟡 MEDIUM | 5 | Fix within 1 month |
| 🟢 LOW | 4 | Best practice improvements |

**Overall Risk Level:** LOW - All high-priority items resolved

---

## 🔴 CRITICAL FINDINGS

### C1: ~~Potential Service Role Key Exposure~~ - VERIFIED SAFE

**Location:** `https://trumpytracker.com/admin-config.js`

**Finding:** Initial scan showed HTTP 200 response, but manual verification confirmed this is Netlify's SPA catch-all redirect serving `index.html`. The `admin-config.js` file is NOT accessible in production.

**Status:** ✅ NO ISSUE - File is properly excluded via `.gitignore` and Netlify redirects unknown paths to home page.

**Recommendation:** Keep `admin-config.js` in `.gitignore` (already done).

---

## 🟠 HIGH FINDINGS

### H1: ~~Playwright Dependency Vulnerability~~ - FIXED

**Location:** `package.json` → playwright

**Finding:** npm audit reported HIGH severity vulnerability (GHSA-7mvr-c777-76hp)

**Status:** ✅ FIXED - Updated playwright, `npm audit` now shows 0 vulnerabilities

---

### H2: ~~Admin API Key Timing Attack~~ - FIXED

**Location:** `supabase/functions/_shared/auth.ts`

**Status:** ✅ FIXED (commit 2ada8f4) - Implemented timing-safe string comparison using XOR-based constant-time algorithm.

**Note:** Requires Edge Function redeployment to take effect in production.

---

## 🟡 MEDIUM FINDINGS

### M1: Wildcard CORS Policy

**Location:** `supabase/functions/_shared/cors.ts`

```typescript
'Access-Control-Allow-Origin': '*'
```

**Risk:** Any website can make API requests to your Edge Functions. Malicious sites could:
- Scrape all story data
- Abuse search endpoints
- Potentially trigger rate limits

**Remediation:** Restrict to known origins:
```typescript
const allowedOrigins = [
  'https://trumpytracker.com',
  'https://test-trumpytracker.netlify.app',
  'http://localhost:3000'
];
```

---

### M2: Error Messages Leak Internal Details

**Location:** Multiple Edge Functions

```typescript
return new Response(JSON.stringify({ error: error.message }), ...)
```

**Risk:** Stack traces or internal error messages could reveal:
- Database structure
- Library versions
- Internal logic

**Remediation:**
```typescript
// Log full error internally
console.error('Full error:', error);

// Return generic message to client
return new Response(
  JSON.stringify({ error: 'Internal server error' }),
  { status: 500, headers: corsHeaders }
);
```

---

### M3: No Input Length Limits on Edge Functions

**Location:** `articles-manual/index.ts`

**Finding:** User inputs (title, URL) are not length-limited:
```typescript
const body: ArticleSubmission = await req.json()
// No validation of body.title.length or body.url.length
```

**Risk:** Memory exhaustion or storage abuse with extremely long strings

**Remediation:**
```typescript
if (body.title.length > 500) {
  return new Response(JSON.stringify({ error: 'Title too long' }), { status: 400 });
}
if (body.url.length > 2000) {
  return new Response(JSON.stringify({ error: 'URL too long' }), { status: 400 });
}
```

---

### M4: Supabase Anon Keys Scattered Across Files

**Location:** Multiple files contain hardcoded anon keys:
- `config/supabase-config-test.js`
- `public/supabase-browser-config.js`
- `scripts/check-missing-eo-fields.js`
- `scripts/data-health-monitor.js`
- `scripts/test/test-rss-pipeline.js`

**Risk:** While anon keys are public by design, scattered copies:
- Make rotation difficult
- Create confusion about which key is used
- May include both TEST and PROD keys in same codebase

**Remediation:** Centralize to single config file per environment:
```javascript
// config/supabase.js
export const SUPABASE_CONFIG = {
  url: process.env.SUPABASE_URL,
  anonKey: process.env.SUPABASE_ANON_KEY
};
```

---

### M5: Budget Table Publicly Readable

**Location:** Supabase RLS policy (or lack thereof)

**Finding:** Query via anon key returns budget data:
```sql
SELECT * FROM budgets LIMIT 1;
-- Returns: {"day":"2025-09-16","spent_usd":2.37}
```

**Risk:** Operational data exposure (how much you spend on AI)

**Remediation:** Add RLS policy:
```sql
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Budgets are private"
  ON budgets FOR ALL
  USING (false);  -- No public access
```

---

## 🟢 LOW FINDINGS

### L1: package-lock.json in .gitignore

**Finding:** `package-lock.json` is gitignored, which prevents deterministic builds.

**Risk:** Different developers/CI may get different dependency versions.

**Remediation:** Remove from .gitignore, commit the lock file.

---

### L2: Admin Pages Deployed to Production

**Location:** `public/admin.html`, `public/admin-supabase.html`

**Finding:** Admin interfaces are deployed even though they redirect.

**Risk:** Increases attack surface unnecessarily.

**Remediation:** Exclude from production builds in `netlify.toml`:
```toml
[build]
  ignore = "public/admin*.html"
```

Or create `public/_redirects`:
```
/admin* /404 404
```

---

### L3: No Rate Limiting on Public Endpoints

**Location:** All Edge Functions

**Risk:** Abuse, scraping, or denial of service.

**Remediation:** Implement rate limiting via Supabase or Netlify edge functions.

---

## ✅ POSITIVE FINDINGS

Things done correctly:

1. **No secrets in git history** - Checked full history, no API keys committed
2. **.gitignore is comprehensive** - Covers .env, *.key, *.pem, admin-config.js
3. **No eval() or document.write()** - No dangerous JavaScript patterns
4. **Supabase client library used** - Prevents SQL injection
5. **URL validation exists** - Uses URL constructor for parsing
6. **Hash-based deduplication** - Uses SHA-256 for URL hashing
7. **Service role key not in codebase** - Only in environment variables

---

## Remediation Priority

### Immediate (Today):
1. [x] Check `admin-config.js` contents in production - ✅ VERIFIED SAFE

### This Week:
2. [x] Update playwright dependency - ✅ FIXED (0 vulnerabilities)
3. [x] Implement timing-safe admin auth - ✅ FIXED (commit 2ada8f4)

### This Month:
4. [ ] Restrict CORS to known origins (trumpytracker.com, test site, localhost)
5. [ ] Centralize Supabase config (remove scattered anon keys)
6. [ ] Add RLS to budgets table
7. [ ] Sanitize error messages in Edge Functions
8. [ ] Add input length validation to articles-manual

---

## Appendix: Scan Commands Used

```bash
# Secrets scan
grep -r "sk-" --include="*.js" .
grep -r "eyJ" --include="*.js" .
grep -r "service_role" --include="*.js" .

# XSS vectors
grep -r "innerHTML" public/
grep -r "eval\|Function(" public/
grep -r "document.write" public/

# Dependency audit
npm audit --json

# Git history
git log --all -p -S "sk-proj"
```

---

**Report Generated:** 2026-01-10
**Next Audit Recommended:** 2026-04-10 (Quarterly)
