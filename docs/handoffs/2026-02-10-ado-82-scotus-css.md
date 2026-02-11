# ADO-82: SCOTUS CSS Components — Testing

**Date:** 2026-02-10 | **ADO:** 82 → Testing | **Branch:** test | **Latest commit:** 1e79506

## What Shipped

1. **Vote fracture badge** — `tt-vote-fracture` with `data-fracture` attribute (unanimous=green, tight=amber). Pill-shaped, computed once via `getVoteFractureType()`.
2. **Dissent block** — `tt-dissent-block` with conditional authors header + highlights body. Robust "null" string normalization.
3. **Section reorder** — "Why It Matters" moved to top of modal. Order: Why It Matters → Summary → Who Wins → Who Loses → Dissent → Sources.
4. **DB migration** — `media_says TEXT` + `actually_means TEXT` columns added (applied to TEST via `npx supabase db push`). Columns exist but are NOT displayed in UI.
5. **Enrichment** — `media_says`/`actually_means` added to prompt schemas + validation + writeEnrichment payload. Fields write to DB but aren't rendered.
6. **Seed data** — Case 285: 5-4 tight + dissent. Case 286: 9-0 unanimous (`is_public=true`).

## Dropped During Review

- **Media spin panel** — two-column grid didn't fit the section-based modal layout. Josh decided "Why It Matters" covers it. "Actually Means" to be folded into "Why It Matters" at prompt level (see ADO-354).

## Created This Session

- **ADO-354**: SCOTUS enrichment prompt quality — fold `actually_means` into `why_it_matters`, add concrete facts alongside editorial tone. Under SCOTUS epic (#10).

## PROD Deployment

Migration `084_scotus_media_spin.sql` must be applied to PROD DB before deploying. Cherry-pick commits to deployment branch + PR to main.

## Commits (in order)

- `76830f7` feat: add vote fracture badge, dissent block, media spin panel
- `ea723d1` fix: vote fracture badge pill sizing + section spacing
- `4016473` fix: replace media spin grid with standard sections
- `3792cdc` fix: drop Media Says + Actually Means sections from modal
- `1e79506` fix: move Why It Matters to top of SCOTUS modal sections
