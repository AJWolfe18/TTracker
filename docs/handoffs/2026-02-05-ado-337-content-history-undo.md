# Handoff: ADO-337 Content History & Undo Support

**Date:** 2026-02-05
**ADO:** #337 (State: Testing)
**Branch:** test
**Commit:** 62512a4

## Summary

Implemented content history tracking and undo support for the Admin Dashboard. Edits now log previous values to `admin.content_history` table, and users see a 10-second undo toast after saving.

## What Was Done

1. **Migrations 081-083:** Created `admin` schema with `content_history` and `action_log` tables, plus RPC functions
2. **admin-update-story edge function:** Now logs changes and supports optimistic locking
3. **UndoToast component:** 10-second countdown, calls `undo_content_change` RPC
4. **Optimistic locking:** Checks `last_updated_at` before save to prevent overwriting concurrent edits

## Before Testing

**Apply migrations to TEST database:**
```sql
-- Run in Supabase SQL Editor for TEST project (wnrjrywpcadwutfykflu)
-- Execute migrations 081, 082, 083 in order
```

**Deploy edge function to TEST:**
```bash
supabase functions deploy admin-update-story --project-ref wnrjrywpcadwutfykflu
```

## Test Checklist

- [ ] Edit story → Save → Undo toast appears with 10-second countdown
- [ ] Click Undo within 10 seconds → Field reverts
- [ ] Let timer expire → Toast dismisses automatically
- [ ] Query `admin.content_history` → Changes are logged
- [ ] Check undo creates new history record with `change_source = 'undo'`

## Files Changed

- `migrations/081_admin_content_history.sql` - Content history table
- `migrations/082_admin_action_log.sql` - Action audit log table
- `migrations/083_admin_rpc_functions.sql` - RPC functions
- `supabase/functions/admin-update-story/index.ts` - History logging + optimistic locking
- `public/admin.html` - UndoToast component + handleUndo logic
