# PROD Deployment Phase 2 - Partial Complete

**Date:** 2026-01-06
**Status:** IN PROGRESS - Security fix pending
**JIRA:** TTRC-361

---

## What Was Completed

### Schema Fixes Applied to PROD
All via SQL Editor in PROD Supabase Dashboard:

```sql
-- Stories table - added these columns:
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS primary_source_domain TEXT;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS primary_source_url TEXT;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS source_count INTEGER DEFAULT 0;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS has_opinion BOOLEAN DEFAULT false;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS reopen_count INTEGER DEFAULT 0;

-- Feed registry table - added:
ALTER TABLE public.feed_registry ADD COLUMN IF NOT EXISTS source_name TEXT;
```

### Edge Functions Deployed to PROD
All 5 functions deployed via `npx supabase functions deploy`:
- `stories-active` ✅
- `stories-detail` ✅
- `stories-search` ✅
- `queue-stats` ✅
- `rss-enqueue` ✅ (deployed with `--no-verify-jwt`)

### Smoke Test Results
| Endpoint | Status | Notes |
|----------|--------|-------|
| stories-active | ✅ PASS | Returns empty items (expected) |
| stories-detail | ✅ PASS | Returns "Story not found" (expected) |
| stories-search | ✅ PASS | Returns empty items (expected) |
| queue-stats | ✅ PASS | Returns 401 (requires JWT - expected) |
| rss-enqueue | ⚠️ ISSUE | Was open to public, security fix in progress |

---

## What Is In Progress

### Security Fix for rss-enqueue

**Issue Found:** `rss-enqueue` was deployed with `--no-verify-jwt` to allow GitHub Actions to call it with `EDGE_CRON_TOKEN`. But the function code didn't verify this token, meaning ANYONE could trigger job enqueueing.

**Fix Applied (LOCAL ONLY - NOT YET DEPLOYED):**
Added auth check to `supabase/functions/rss-enqueue/index.ts`:
```typescript
// SECURITY: Verify EDGE_CRON_TOKEN before processing any requests
const authHeader = req.headers.get('Authorization');
const expectedToken = Deno.env.get('EDGE_CRON_TOKEN');

if (!expectedToken) {
  return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500 });
}

if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
}
```

**File Modified:** `supabase/functions/rss-enqueue/index.ts` (lines 22-41)

---

## What Needs To Be Done Next

### 1. Set EDGE_CRON_TOKEN Secret in PROD
Go to: Supabase Dashboard > Edge Functions > Manage Secrets
Add: `EDGE_CRON_TOKEN` with a secure random value (must match GitHub Secret)

### 2. Redeploy rss-enqueue with the security fix
```bash
npx supabase functions deploy rss-enqueue --project-ref osjbulmltfpcoldydexg --no-verify-jwt
```

### 3. Test rss-enqueue with token
```bash
curl -X POST "https://osjbulmltfpcoldydexg.supabase.co/functions/v1/rss-enqueue" \
  -H "Authorization: Bearer YOUR_EDGE_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"fetch_all_feeds"}'
```

### 4. Verify GitHub Secret exists
Ensure `EDGE_CRON_TOKEN` exists in GitHub Secrets for the repo and matches the Supabase secret.

### 5. Update JIRA TTRC-361
Add comment documenting Phase 2 completion.

### 6. Continue to Phase 3
Per runbook: Frontend deployment + First RSS run

---

## Resume Prompt for Next Session

```
Resume PROD deployment Phase 2 from docs/handoffs/2026-01-06-prod-phase2-partial.md

Status:
- Schema fixes: COMPLETE
- Edge Functions deployed: COMPLETE
- Security fix for rss-enqueue: CODE DONE, NOT YET DEPLOYED

Next steps:
1. Set EDGE_CRON_TOKEN secret in Supabase PROD Dashboard
2. Redeploy rss-enqueue: npx supabase functions deploy rss-enqueue --project-ref osjbulmltfpcoldydexg --no-verify-jwt
3. Test with token
4. Update JIRA TTRC-361
5. Continue to Phase 3 (Frontend + First RSS Run)
```

---

## Key Files Modified This Session

| File | Change |
|------|--------|
| `supabase/functions/rss-enqueue/index.ts` | Added EDGE_CRON_TOKEN auth check (lines 22-41) |

---

## Schema Drift Log (Updated)

Added to PROD stories table:
- `primary_source_domain`
- `primary_source_url`
- `source_count`
- `has_opinion`
- `closed_at`
- `reopen_count`

Added to PROD feed_registry table:
- `source_name`

---

## Important URLs

- PROD Supabase: https://supabase.com/dashboard/project/osjbulmltfpcoldydexg
- PROD Edge Functions: https://supabase.com/dashboard/project/osjbulmltfpcoldydexg/functions
- Runbook: docs/plans/prod-deployment-runbook.md
- Plan doc: C:\Users\Josh\.claude\plans\gentle-fluttering-mccarthy.md
