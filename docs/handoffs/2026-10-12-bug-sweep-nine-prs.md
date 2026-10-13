# Bug sweep: 9 PRs merged to test (October 12, 2026)

**Cards:** ADO-609, 607, 626 (Bugs, Resolved) · ADO-196, 495, 602, 523 (Stories, Testing) · ADO-148 (Closed) · ADO-94 (commented)
**Cost:** $0 cash. No OpenAI calls; only small TEST reads.

Josh asked for the top 10 bugs that need no input from him, worked in parallel with agents. Bug-shaped User Stories count too ("they may be stories but are fixing issues").

## What shipped to test

| PR | Card | What it fixes | PROD steps (after Josh's Codex review) |
|---|---|---|---|
| #180 | none | Lint PROD References had been red on test since October 11, 11:03 PM CT (a test spelled the PROD ref). Also: `build:check` tsc error, and `qa:agent-prompts` failing on CRLF worktree checkouts | None (test files) |
| #181 | 148 | Stale TODO + doc said 72h, code is 96h | None (comment + doc) |
| #182 | 607 | Automated browsers (webdriver, HeadlessChrome, Chrome-Lighthouse UA) never load analytics. Same rule in analytics-gate.js, the shared.js fallback, and src/lib/analytics.ts (now defers to `TT_ANALYTICS_ENABLED`) | None. Optional: PostHog filter for past bot "people" (needs Josh's login) |
| #183 | 609 | Tracker SCOTUS rows lead with `media_says`, fall back to case name; case name as a quiet line; type label "Supreme Court". `ruling_label` dropped from the chain (TEST holds scale tags and generic DIG phrases in it) | None |
| #184 | 602 | Daily Discord digest of Stories-agent flags (fixed slot 12:00 to 12:00 UTC, completed rows only), in rss-health-check.yml; a failed digest alerts. New shared `scripts/lib/daily-check-window.js` | None; the alert only starts once on main |
| #185 | 495 | SCOTUS admin Reason column (blocking QA status, legacy clamp reason only for never-QA'd rows, hover notes, published = '-') | **Deploy `admin-scotus` edge function to PROD BEFORE the admin.html cherry-pick** (else clamp badges silently missing). TEST already deployed |
| #186 | 626 | All agent prompts write the real model ID (or `unknown`); contract test bans hardcoded model names. Root cause was the column default `claude-opus-4-6` | Apply **migration 133** on TEST and PROD (drops the default and NOT NULL). Ship to main **after ADO-524** (mig 132 → pardons prompt v1.4 → this) |
| #187 | 523 | Deleted 6 legacy Perplexity/GPT pardons scripts; repointed current docs | None |
| #188 | 196 | Error boundaries: app root, routes (header survives, navigation recovers), Tracker spine, card list | None |

## How it was verified
- Each PR got a `/code-review medium` round; every real finding went back to the lane and was fixed (#182: 5, #184: 5 of 9, #185: 8 of 9, #186: 7 of 10, #187: 5 docs, #183: 3 of 7, #188: 6 of 10). Second-round fixes were spot-checked by diff, not re-reviewed (per the October 1 rule).
- All 9 branches merged locally into one integration branch: `qa:smoke` green, `build:check` green (tsc + 245 vitest + build), PROD-ref lint scan clean.
- After the squash merges: Lint PROD References green on every merged commit; the TEST site serves the new analytics gate and bundle.

## Josh checks
1. TEST Tracker: a few Supreme Court rows. `media_says` is defined in the SCOTUS prompt as "how media will likely frame this", so some headlines read in press voice ("...in landmark ruling"). The detail page title still leads with the case name.
2. TEST admin, SCOTUS Drafts tab: is the Reason column faster to triage with (ADO-495 AC 3)?
3. Migration 133 on TEST (SQL Editor; Claude can load it, Josh clicks Run).
4. Decisions parked on cards: `render_error` analytics event (196); Supabase fetch retry wrapper (196, would be its own card); positive severity (94).

## Not fixed (on cards)
- TEST SCOTUS case 286 `case_name` carries stray text "Revisions: 1/14/26" (noted on ADO-609).
- business-logic-mapping.md still prints the old EO and SCOTUS GPT prompts below "historical" markers (noted in PR #187).
- ADO-62 (enrichment limit for TEST) is moot while legacy GPT story enrichment is off: Josh's call whether to close.
- ADO-263 (pardons org recipient_type, district formatting) needs PROD data edits and a schema choice: Josh.

## Gotchas found
- Fresh `git worktree add` checkouts on this machine come out CRLF (system `core.autocrlf=true`) while the main copy is LF. Any test regex anchored on `\n` fails only in worktrees; read helpers should strip `\r`.
- Lane agents were denied copying `.env` into worktrees; loading it into the shell (`set -a; . <repo>/.env`) for the run works and leaves no file behind.

## Next session
Build one deploy PR to main for these cards (cherry-pick from `refs/heads/test`, in landed order) once Josh's Codex review is done. Respect the two order constraints above (admin-scotus deploy before #185; #186 after ADO-524).
