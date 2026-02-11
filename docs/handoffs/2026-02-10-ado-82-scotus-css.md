# ADO-82: SCOTUS CSS Components (Vote Fracture, Dissent Block, Media Spin Panel)

**Date:** 2026-02-10 | **ADO:** 82 (Ready for Prod → Active) | **Branch:** test

## What Happened This Session

### ADO-81 (SCOTUS Workflows) — Done
- PR #76 merged to main (squash). Code review passed (gpt-5).
- ADO-81 moved to Testing. Workflow dispatch test FAILED: `enrich-scotus.js` not on main (only test branch has scripts/scotus/). Workflows are shells without engines until SCOTUS scripts are promoted.
- Missing secrets: `COURTLISTENER_API_TOKEN`, `ENABLE_PROD_SCHEDULES` var.

### ADO-82 — In Progress (partially implemented)
Started implementing but ran out of context. **Plan is approved and locked in.**

## What's Done
- **CSS complete**: All 3 components added to `public/themes.css` (vote fracture, dissent block, media spin panel) with dark mode `[data-theme="dark"]` and mobile responsive
- **JS helper added**: `getVoteFractureType()` function added to `public/app.js` near line 795
- **Plan file**: `C:\Users\Josh\.claude\plans\polished-brewing-pizza.md` — full approved plan with user's 5 edits

## What's Left (execute the plan)

### 1. DB Migration
- Create `migrations/084_scotus_media_spin.sql` (ADD COLUMN media_says TEXT, actually_means TEXT)
- Supabase MCP can't run ALTER TABLE — need Supabase dashboard SQL Editor or CLI
- Columns must exist before adding them to the JS fetch query

### 2. JS Changes in app.js (React.createElement pattern, NO innerHTML)
- **Vote fracture** (~line 989): Replace `tt-scotus-meta-value` with `tt-vote-fracture` span. Only set `data-fracture` attribute when `getVoteFractureType()` returns truthy.
- **Dissent block** (~line 1020): Replace `tt-scotus-section tt-scotus-dissent` with `tt-dissent-block`. Always show "Dissent" title, authors node ONLY if present, body ONLY if highlights present. Gate on `(dissentAuthors || dissentHighlights)`. Normalize "null" string: `dissentHighlightsRaw && String(dissentHighlightsRaw).trim().toLowerCase() !== 'null'`
- **Media spin panel** (insert after "Why It Matters", before dissent): Conditional on `(scotusCase.media_says || scotusCase.actually_means)`. Each column renders ONLY if its field exists (no "—" placeholders).
- **Select query** (~line 1096): Add `,media_says,actually_means` — ONLY after migration applied

### 3. Enrichment (media fields only — do NOT touch vote_split rules)
- `scripts/enrichment/scotus-gpt-prompt.js`: Add media_says + actually_means to SYSTEM_PROMPT (~line 199) and PASS2_SYSTEM_PROMPT (~line 677) output schemas. Add validation (optional, max 500 chars).
- `scripts/enrichment/scotus-fact-extraction.js`: Add to writeEnrichment() payload (~line 1186)

### 4. Seed Test Data (after migration)
```sql
UPDATE public.scotus_cases SET
  vote_split = '5-4',
  dissent_authors = ARRAY['Sotomayor','Kagan','Jackson'],
  dissent_highlights = 'The dissent warned this ruling opens the door to unchecked executive power.',
  media_says = 'Court sides with administration in landmark power grab ruling.',
  actually_means = 'The holding is narrow: it only applies to emergency declarations under the specific statute at issue, not broad executive authority.'
WHERE id = 285;

UPDATE public.scotus_cases SET vote_split = '9-0' WHERE id = 286;
```

### 5. Verify
- Case 285: amber tight badge, dissent callout with authors, media spin panel
- Case 286: green unanimous badge
- Other cases: no components render, no crashes
- Dark mode + mobile responsive

## Key Decisions (locked in)
- Vote fracture is UI-ready only — do NOT change pipeline to populate vote_split
- Dissent block: always show "Dissent" title, authors conditional, body conditional
- Media spin columns: don't render placeholders, only show if field has content
- Only set `data-fracture` attribute when value is truthy
- Dark mode uses `[data-theme="dark"]` (not `.dark`)
- All JS is React.createElement (no innerHTML/template literals)

## OpenAI Billing Note
- Review workflow uses gpt-5; user topped up account. Working now.
- Enrichment (gpt-4o-mini) was never broken.
- Budget tracking (ADO-223) underreports by ~92% — PROD pipeline calls aren't logged to budgets table.
