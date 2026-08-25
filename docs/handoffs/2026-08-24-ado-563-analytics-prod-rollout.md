# Handoff - ADO-563: Analytics Phase 5a PROD rollout + The Tracker debut (ADO-554)

**Date:** August 24, 2026 (supervised session with Josh)
**Tickets closed:** ADO-563, ADO-558, ADO-559, ADO-560, ADO-554. **Created:** ADO-564 (north-star check, due September 7, 2026).
**PR:** #131 `deploy/ado-563-analytics-tracker` -> `main`, squash `3b37ad5`. Branch deleted.

## What shipped to trumpytracker.com

1. **Analytics Phases 1-2** (cherry-picks `877c0bf` 558, `ed39e72` 559, `70f6a92` 560): GA4 gated to the PROD hostname, PostHog bootstrap + typed wrapper, six named KPI events.
2. **The Tracker debut** (cherry-picks `b984b1f` + `4c91566` 554): Josh's in-session call was "just send it" - AC7 (TEST eyeball) waived in favour of live PROD review; he expects to want changes later.
   - Migration 112 applied on PROD via SQL Editor (claude-in-chrome + raw.githubusercontent fetch, the migration-111 pattern).
   - 8 fronts seeded + published on PROD: the 7 TEST fronts plus a NEW **Election Suppression** front (Josh: "election fraud" is the pretext, suppression is the front). Assignments by keyword sweep (one front per story, most-specific first): Iran 1510, Epstein 235, Ballroom 120, Election ~67, Crypto 40, Kushner 14, Courts 10, Qatar 7. No pins. Script kept at `scripts/maintenance/2026-08-24-ado-554-prod-fronts-seed.sql` (test-only path; already applied).
   - `rap_sheet: true` in `flags-prod.json` (same PR, after migration + seed).
3. `docs/ARCHITECTURE.md`: new "Analytics vendors" table + `rap_sheet` row in kill switches.

## Review + fixes (Codex on PR #131, all addressed and synced to `test`)

- P1 `src/lib/timeline.ts`: front-count promise now inside the same `Promise.all` as the per-source tally (no unobserved AbortError).
- P1 console logging: off-PROD gtag / TTAnalytics / track / trackPageView / shared.js trackEvent are now SILENT no-ops (repo rule: no console.log in shipped code). Tests updated to assert no console output. **Consequence:** on TEST/localhost you can no longer see "would-fire" analytics in the console - watch `window.TTAnalytics.capture` in DevTools instead.
- P2 `useFilters.setPage(n, { silent: true })`: App.tsx's out-of-range page clamp no longer emits `pagination`.
- The GitHub "review" check (GPT-4o reviewer) FAILS because the OpenAI key has no credits. Not a blocker (Codex is the review of record) but Josh should top up or retire it.

## Verification done on trumpytracker.com

- PostHog pre + post deploy: Free plan, "Add your credit card" prompt = no payment method, billing limit = free tier 1M.
- GA4 real-time: PROD pageviews arriving (`/`, `/detail/14111`, `/news`); deploy previews / TEST / localhost blocked by the exact-hostname gate.
- PostHog Activity: `$pageview`, autocapture, and every named event from real clicks: `card_open` (tracker tab, pos 0, alarm 5), `source_click` (fortune.com), `share_click` (copy_link), `pagination` (stories p2), `search` (len 7), `filter_apply` (Dumpster Fire pill).
- Replay: recording, 50% sampling (project setting), `maskAllInputs: true` in code (project masking is "passwords only" - the code assertion is what protects inputs).
- PROD Tracker: 8 open fronts, main line renders with front tags.

## Content Engagement dashboard

https://us.posthog.com/project/572949/dashboard/2029138 - 12 insights created through the logged-in session API (see conventions memory for the fetch pattern): card open rate (`card_open / $pageview`) and source click rate (`source_click / card_open`) as bold numbers; card opens by item type / tab / feed position / alarm level; source clicks by outlet; shares by channel; filters / searches / pagination by tab; daily pageviews. Newsletter + Feedback dashboards stay in Phase 5b.

## Gotchas learned

- PROD headlines != TEST headlines: copying TEST's curated headline list matched almost nothing on PROD. Keyword sweeps + `DISTINCT ON (story_id)` is the reusable pattern (`story_event.story_id` is the PK).
- The first election sweep grabbed 175 rows because `redistrict|gerrymander` are their own topic - keep those OUT of Election Suppression.
- Auto-mode classifier blocked write SQL runs in the Supabase editor (ctrl+Enter and Run button) but allowed read-only previews - Josh presses the key for writes. Supabase's "creates a table without RLS" popup on `WITH ... INSERT` is a false positive.
- Screenshots on the trumpytracker.com tab timed out repeatedly (heavy renderer); `find` + ref clicks and `javascript_tool` worked fine. Refs churn on every React re-render - re-`find` before each click.

## Next

- ADO-561 (feedback popup, Phase 3) -> 562 -> Phase 5b deploy (feedback-submit function + migration 113).
- ADO-557 fronts automation planning (reuse the seed regexes); ADO-548 front pages; ADO-547 admin pin editor. Josh will want Tracker changes after seeing it live - expect a curation pass.
- ADO-564: read the two north-star numbers off dashboard 2029138 on/after September 7, 2026.
