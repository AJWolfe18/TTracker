# Handoff: ADO-571 - Share card renderer + og:image swap (August 29, 2026)

**Ticket:** ADO-571 (Ready for Prod) · **Epic:** 299 (social automation) · **Plan:** `docs/features/growth/plan-social-automation.md` S1 (Tasks 1-3) · **Cost:** $0/month

## What shipped (on `test`, commits 0b22fc1, 39f6c48, eede553)

| Piece | File | Notes |
|---|---|---|
| Card renderer | `netlify/edge-functions/og-image.ts` | `GET /api/og-image/{detail\|eos\|scotus\|pardons}/{id}.png` → 1200x630 PNG via `og_edge@0.0.6` (Satori + resvg in Deno). Immutable 1-year cache, `cache: "manual"` so the Netlify CDN honors it. Any error / unknown id / non-public record → 302 `/og-default.png`. |
| Card tree | `netlify/edge-functions/_shared/og-card.mjs` | The receipt design as a plain Satori element tree (no JSX). `Card(props)` and `DefaultCard()`. |
| Props mapper + gates | `netlify/edge-functions/_shared/og-card-props.mjs` | `buildCardProps(type,row)`, `ROUTES` (tables + publish filters, must equal og-tags.ts), spicy labels mirrored from `tone-system.json`. |
| og:image swap | `netlify/edge-functions/og-tags.ts` | Behind `share_cards` flag (TEST on, PROD off; `?ff_share_cards=true` overrides). URL carries `?v=<updated_at unix>`. |
| Test | `scripts/tests/og-image-card.test.mjs` (`npm run qa:og-card`, in `qa:smoke`) | Props mapping, headline size steps 44/36/32, fallback level 2/NOTABLE, no em dashes, gate parity by parsing og-tags.ts, label parity with tone-system.json. |
| Local render | `scripts/social/render-og-card.mjs` | `default` regenerates `public/og-default.png`; `sample`, `sample-long`, `sample-pardon` write PNGs for eyeballing. Uses the `satori` devDependency (already in package.json). |
| Reference | `docs/features/growth/receipt-card-reference.md` | Canvas markup exported so the build does not depend on the design artifact. |
| Flag docs | `docs/guides/feature-flags.md` | Current Flags table added. |

## Verification done (all 6 AC MET - record on the ADO card)

TEST site `test--taupe-capybara-0ff2ed.netlify.app`:
- `/api/og-image/detail/16936.png` → 200 image/png, `Cache-Control: public, max-age=31536000, immutable`, `Cache-Status: "Netlify Edge"; hit`
- `/api/og-image/detail/999999999.png` and `/api/og-image/pardons/99.png` (non-public) → 302 `/og-default.png`
- Crawler UA (`facebookexternalhit/1.1`) on `/detail/16936`, `/eos/288`, `/scotus/286`, `/pardons/83` → `og:image` = card URL; all four PNGs render 200
- Facebook Sharing Debugger on the TEST story URL: Josh confirmed the card preview
- `npm run qa:smoke` green

## Gotchas learned (also in memory `share-card-renderer`)

- Satori throws `Expected <div> to have explicit "display: flex"` when a div has an **empty children array** - leaf nodes must omit `children` entirely. Cost 20 minutes to bisect.
- Satori cannot parse woff2. Google Fonts returns TTF when fetched with `curl -A "Mozilla/4.0"`; those are the URLs in `og-image.ts` and `render-og-card.mjs` (keep both lists in sync).
- Satori has no line-clamp; the headline is boxed with `maxHeight = size * 1.08 * 4` + `overflow: hidden`.
- Netlify edge functions are never CDN-cached unless `config.cache = "manual"`.
- The plan's hardcoded story labels for levels 0/1 were wrong; the test now sources every label from `tone-system.json`.
- Edge functions cannot read `/public`, so spicy labels are mirrored by hand in `og-card-props.mjs`; the test fails on drift.

## PROD deployment (when promoting)

1. Cherry-pick `0b22fc1`, `39f6c48`, `eede553` onto the deployment branch. No migrations, no new secrets (uses existing `SUPABASE_URL` / `SUPABASE_ANON_KEY` Netlify env vars set for ADO-515).
2. `share_cards` is `false` in `flags-prod.json` - ship as is.
3. Verify one PROD URL in the FB debugger with `?ff_share_cards=true`, then flip the flag and run the debugger again (Scrape Again) on a couple of stories so FB refreshes its cache.

## Next session

- **ADO-572** (S2: `social_posts` migration 114, `scripts/social/draft-posts.js`, admin Social tab) - plan Tasks 4-6.
- ADO-570 was committed by a parallel session (`78d0329`) and pushed with this work; its ADO card was still "New" at end of session - that session owns the update.
- ADO-573 needs Josh to mint the Facebook Page token first (checklist on the card).
