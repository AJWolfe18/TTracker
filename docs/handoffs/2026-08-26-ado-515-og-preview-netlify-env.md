# Handoff - ADO-515: OG link previews fixed on PROD (Netlify env)

**Date:** August 26, 2026
**Type:** Config fix, no code changes. Cost $0.
**Ticket:** ADO-515 (two comments added, state unchanged - share UI scope remains)

## Problem
Every trumpytracker.com link shared on X/Facebook/Slack/Discord showed the generic
"TrumpyTracker" card. `netlify/edge-functions/og-tags.ts` was deployed but reads
`SUPABASE_URL` + `SUPABASE_ANON_KEY` from Netlify env, and both held **TEST** values
(set May 26, 2026), so it looked up PROD story ids in the TEST DB and found nothing.

## Fix
1. Netlify site `taupe-capybara-0ff2ed`: upserted both vars with **production-context**
   PROD values (`osjbulmltfpcoldydexg` + public anon key from
   `public/supabase-browser-config.js`). dev / branch-deploy / deploy-preview contexts
   keep TEST, so the TEST branch site is unchanged. Done via Netlify MCP
   `manage-env-vars` (needed the auto-mode classifier off; MCP 502s are transient - retry).
2. Redeploy: Netlify MCP cannot trigger builds and Chrome is not logged into Netlify, so
   PROD was rebuilt by merging docs-only PR #133 (`aba03f1`) - synced the Aug 23-24
   handoffs + growth kickoff to main. Edge functions read env at deploy time; the var
   change alone did nothing until this.

## Verified (Twitterbot UA, PROD)
- `/detail/14111` -> story headline, "LEVEL 5 · CRISIS — 1 sources cited"
- `/eos/eo_1755289236225_96xp8yl9x` -> EO title, "LEVEL 3 · SERIOUS — Executive Order #14224"
- `/scotus/2074` -> "Monsanto"; `/pardons/138` -> "Griffin Transportation Inc."
- `test--taupe-capybara-0ff2ed.netlify.app/detail/14111` still generic (TEST DB, expected)

Re-check command: `curl -s -A "Twitterbot/1.0" https://trumpytracker.com/detail/<id> | grep og:title`

## Gotchas
- EO ids are strings (`eo_<ts>_<rand>`), not integers - don't grep digits out of them.
- `git checkout` to a deploy branch in the main working copy fails on Windows (locked
  dirs, partial checkout). Use a worktree in the scratchpad instead.
- Platforms cache previews per URL; previously shared links may show the old card until
  their cache expires.

## Left open
- `og:image` is still `og-default.png` everywhere - per-story card image = Epic 299 / ADO-566.
- Nit for that story: "1 sources cited" pluralization in og-tags.ts buildDescription.
- `.agents/skills/` untracked dir (copy of `.claude/skills/`) - Josh to decide delete vs gitignore.
- Next per Aug 24 plan: alerts (pipeline-failure email, PostHog spike/drop), then ADO-566.

## Addendum (end of night) - Facebook not yet confirmed
Josh shared an article on Facebook after the fix and saw only the black default image with
no title (and the FB sharer hung). Re-tested server-side with `facebookexternalhit/1.1` and
`Facebot` UAs: og:title / og:description / og:image all correct. Most likely cause is
Facebook's per-URL scrape cache from a pre-fix share.

**Tomorrow, first:** Josh pastes the URL into https://developers.facebook.com/tools/debug/
and clicks **Scrape Again** (needs his FB login). If the title shows -> done. If not ->
investigate FB-specific requirements (og:image:width/height, image >= 200x200, fb:app_id
warnings) in `netlify/edge-functions/og-tags.ts` + `index.html`.
