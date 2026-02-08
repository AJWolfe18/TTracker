# Handoff: ADO-338 Pardons Admin List View

**Date:** 2026-02-07
**ADO:** 338 → Testing
**Branch:** test (commit f106c49)

## What was done

Built the Pardons list view for the admin dashboard (Phase 3, Session 1):

- **`supabase/functions/admin-pardons/index.ts`** (new) — Edge function with keyset cursor pagination for all sort modes, search by name/ID, filters (isPublic, connectionType, crimeCategory, corruptionLevel, researchStatus, enrichment). Deployed to TEST.
- **`public/admin.html`** — Added PardonsTab component with Draft/Published/All sub-tabs, 6 filter dropdowns, sort selector, race condition protection (fetchTokenRef), Load More guard. Enabled Pardons tab in navigation.
- **Spicy corruption labels** — Matches public site (Pay 2 Win, Cronies-in-Chief, etc.)

Also fixed a pre-existing re-enrichment bug:
- **Root cause:** `enrichment_status` column rejected by PostgREST inside `.or()` on PATCH operations (schema cache issue). Replaced with `.is('enrichment_status', null)`.
- **Also fixed:** `enrich-single-story.js` failure path now clears `enrichment_status` back to null (was leaving stories stuck as 'pending').

## Next: ADO-339 (Session 2)

Build the edit modal, re-enrich button, and publish/unpublish toggle for pardons. Plan already exists at `/docs/features/` or in ADO-338's plan (the "Out of scope (Session 2)" section).
