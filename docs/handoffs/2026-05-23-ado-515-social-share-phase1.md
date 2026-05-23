# Handoff: ADO #515 — Social Media Share Infrastructure Phase 1

**Date:** 2026-05-23
**Branch:** test (pushed)
**Status:** Code complete, awaiting Netlify env var setup + verification

## What Was Done

Brainstormed, designed, reviewed (3 passes), planned, and implemented Phase 1 of social media sharing:

1. **Netlify Edge Function** (`netlify/edge-functions/og-tags.ts`) — detects social crawlers, fetches record from Supabase, replaces OG meta tags in HTML response with per-story data
2. **netlify.toml** — registered edge function for `/detail/*`, `/eos/*`, `/scotus/*`, `/pardons/*`
3. **index.html** — added `og:url`, `twitter:title`, `twitter:description` as replacement targets
4. **og-default.png** — branded 1200x630 static fallback OG image (fixes pre-existing broken reference)
5. **Detail page share panel** — replaced "Generate Share Card" toggle with direct platform buttons: X, Threads, Facebook, Reddit, Copy Link, Report Correction + Web Share API for mobile

## What's NOT Done

- **Netlify env vars** — Josh must set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Netlify dashboard for the test site
- **Verification** — curl tests with crawler User-Agents, Facebook Sharing Debugger, X Card Validator
- **ADO state** — still at New, move to Testing after env vars + verification
- **Phase 2** — dynamic per-story OG image generation (specced but no plan/implementation yet)

## Key Files

| File | What |
|------|------|
| `netlify/edge-functions/og-tags.ts` | Core edge function |
| `netlify.toml` | Edge function route declarations |
| `public/og-default.png` | Static fallback OG image |
| `src/pages/Detail.tsx` | Refactored share panel |
| `index.html` | Added meta tag targets |
| `scripts/generate-og-default.js` | One-time image generation script (test-only) |

## Docs

- **Spec:** `docs/superpowers/specs/2026-05-23-social-share-infrastructure-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-23-social-share-phase1.md`

## Next Session Tasks

1. Josh sets Netlify env vars in dashboard
2. Verify OG tags: `curl -s -A "Twitterbot/1.0" "https://TEST_URL/detail/1" | grep "og:title"`
3. Test with Facebook Sharing Debugger + X Card Validator
4. Test share buttons on live test site (click each platform button)
5. Test mobile Web Share API (Chrome DevTools mobile emulation)
6. Move ADO #515 to Testing
7. If all good → plan PROD deployment (cherry-pick to main via PR)

## Decisions Made

- **Phased approach:** OG meta tags first (Phase 1), dynamic OG images later (Phase 2) — 80% of engagement value with 40% of effort
- **Threads is best-effort:** Undocumented Meta endpoint, may break — graceful degradation
- **Copy Link stays:** Universal share path for Slack/Discord/email/iMessage
- **ShareCard.tsx kept:** Not deleted — preserved as Phase 2 visual reference for Satori comparison
- **Origin from request:** All OG URLs derived from `new URL(req.url).origin`, never hardcoded
