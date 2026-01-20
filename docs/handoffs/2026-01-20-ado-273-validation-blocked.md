# Handoff: ADO-273 EO Tone Variation - Validation Blocked

**Date:** 2026-01-20
**Branch:** test
**Status:** BLOCKED - Supabase schema cache issue

---

## Summary

Attempted to run validation testing for ADO-273 EO tone variation system. Blocked by Supabase JS client schema cache not recognizing `alarm_level` column.

---

## The Problem

The `alarm_level` column exists in the database (verified via SQL and MCP):
```sql
SELECT id, title, alarm_level FROM executive_orders WHERE alarm_level IS NOT NULL LIMIT 5;
-- Returns data successfully
```

But the Supabase JS client throws:
```
Could not find the 'alarm_level' column of 'executive_orders' in the schema cache
```

**Tried:**
1. `NOTIFY pgrst, 'reload schema';` - Executed successfully but didn't help
2. Direct MCP PATCH works fine - confirms DB column exists
3. Issue is specifically with supabase-js client schema introspection

---

## Fix Options (Try Tomorrow)

### Option 1: Restart PostgREST (Simplest)
- Supabase Dashboard > Project Settings > Pause project > Resume project
- This restarts all services including PostgREST

### Option 2: Force Client Schema Refresh
- Add `db: { schema: 'public' }` to client options
- Or try creating client with explicit headers

### Option 3: Bypass Schema Cache
- Use raw fetch/axios to call PostgREST directly (like MCP does)
- Or use RPC function wrapper

### Option 4: Workaround
- Temporarily remove `alarm_level` from update to test variation system
- Re-enable after fixing cache issue

---

## Next Steps

1. Fix schema cache issue (try Option 1 first - pause/resume project)
2. Re-run: `node scripts/enrichment/enrich-executive-orders.js 30`
3. Verify acceptance criteria:
   - No repeated variation.id within batch
   - 0 banned phrase starts in sections
   - Frame distribution (mostly critical)
4. If passes → update plan, resolve ADO-273

---

## Context Files

- Handoff: `docs/handoffs/2026-01-19-ado-273-phase1-complete.md`
- Plan: `docs/features/labels-tones-alignment/tone-variation-fix-plan.md`

---

## Quick Resume Prompt

```
Continue ADO-273: Fix schema cache issue and run validation.

Issue: Supabase JS client can't see alarm_level column (exists in DB).
Fix: Try pause/resume project in Supabase dashboard, then:
  node scripts/enrichment/enrich-executive-orders.js 30
```
