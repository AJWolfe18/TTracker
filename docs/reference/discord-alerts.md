# Discord alerts: what pings, when, and the rules

The one place for how TrumpyTracker talks to Josh's Discord channel. Code comments and other docs
point here; if a rule below changes, change it here in the same commit.

All alerts go through `scripts/lib/discord.js` (webhook only, secret `DISCORD_WEBHOOK_URL`), except the
workflow failure steps, which `curl` the same webhook from YAML.

## What pings

| Alert | Sent by | When | Color |
|---|---|---|---|
| Pipeline failed | `Discord alert (on failure)` step in every scheduled workflow: RSS Tracker PROD + TEST, Track Pardons, Judge Executor, and (ADO-349, same step copied from Track Pardons) Track Executive Orders, SCOTUS Tracker, Pipeline Skips Cleanup; RSS Health Check alerts when its silence check cannot run | the job fails or is cancelled | red |
| New work landed (ADO-577) | `executive-orders-tracker-supabase.js`, `ingest/doj-pardons-scraper.js`, `scotus/fetch-cases.js` | a fetch inserts at least one new row; SCOTUS also posts when a later decision lands on an existing case and re-queues it (ADO-603) | blue |
| Waiting for review (ADO-577) | `monitoring/alert-needs-review.js --domain scotus\|eo\|pardons`, last step of the three fetch workflows | see "Review queue rules" below | amber |
| Stories agent flagged its copy (ADO-602) | `monitoring/alert-needs-review.js --domain stories`, in RSS Pipeline Health Check (main only; the same once-a-day run as ingest health) | a completed Stories log row with `needs_manual_review = true`, created yesterday 06:00 UTC to today 06:00 UTC; see rule 2b | amber |
| Routine went silent (ADO-586, ADO-624) | `monitoring/alert-routine-silence.js`, in RSS Pipeline Health Check | Judge log older than 12h, Stories log older than 6h; SCOTUS, EO, Pardons and Election front older than 30h (SCOTUS and EO count weekday hours only). EO and fronts read `routine_heartbeats` (migration 129), one row per run | red |
| RSS ingest health (ADO-597) | `monitoring/alert-ingest-health.js`, in RSS Pipeline Health Check (main only; once a day on the `workflow_dispatch` run the Netlify function `health-check-trigger` starts at 13:23 UTC, or a manual run; GitHub's scheduled and push runs skip, ADO-639) | no article from the last 24h stored `content`, articles with an empty excerpt, an active feed's source silent for `FEED_SILENT_DAYS` (default 7), feeds failing every fetch (5+ in a row, retried daily), or a working feed whose newest item is older than that window (ADO-625) | amber (red if every read failed) |
| Netlify trigger failed (ADO-637, ADO-639) | `netlify/functions/rss-prod-trigger.mjs` ("RSS PROD trigger (Netlify) failed", every 2 hours until fixed) and `netlify/functions/health-check-trigger.mjs` ("RSS health check trigger (Netlify) failed", daily until fixed), on the published PROD deploy | GitHub did not start the workflow (expired token, wrong scope, GitHub down) or Netlify's deploy context is unknown; status code and a fixed reason only. Fixes: `docs/guides/rss-prod-external-trigger.md` (Troubleshooting) | red |
| Daily health check ran from the backup run (ADO-639, ADO-645) | "Discord alert (daily checks ran from the backup run)" step in RSS Pipeline Health Check (main, scheduled runs only) | a scheduled run after 14:00 UTC offered to do the daily checks ("Daily run watchdog", `DAILY_CHECK_FALLBACK=1`) and its ingest health check or Stories digest got the day's claim (`daily_check_claims`): the Netlify start never ran, or its check did not finish (claim failed, or stuck at running for 30 minutes). Once per day: a later run finds the claim taken. Not sent when the claim cannot be read | amber |
| Homepage refresh failed / fell behind (ADO-638) | `maintenance/refresh-tracker.js`, the last step of all five pipeline workflows (RSS PROD + TEST, SCOTUS, Pardons, EO; TEST runs titled [TEST]) | failed: `refresh_tracker_derived` errored, so the homepage main line and counters are stale (says how many stories earlier batches already updated). Fell behind: the 4-minute budget ran out with rows still pending; the next run continues. Also a `pipeline_skips` row (`tracker_refresh` / `refresh_failed` or `refresh_behind`). Repeats every run until fixed | red / amber |
| Judge uncertain verdicts (ADO-583) | `clustering/execute-judge-verdicts.js` | the Judge left verdicts it was unsure of for the admin Judge tab | amber |
| Social drafts waiting (ADO-572) | `social/draft-posts.js` | new drafts need approval in the admin Social tab | amber |

A run with nothing to say posts nothing. Manual-only workflows (Enrich Single Story, the manual
article workflows, Test Secrets) have no failure alert: whoever dispatched them is watching.

## Rules (decided, do not revisit without Josh)

**1. An alert never fails the pipeline, and a lost alert is never silent.** (Codex review on PR #151,
September 25, 2026.) `postDiscord` never throws and never changes the caller's exit code, so a
Discord outage cannot turn a good ingest red. Each webhook POST is aborted after 10 seconds (Codex,
October 2, 2026), so a hung Discord connection cannot hold a pipeline step until the job timeout; a
timeout counts as not delivered. But when an alert that matters is not delivered:
- New-work alerts use `postDiscordReported`: one stderr line plus a GitHub Actions error annotation
  on the run, so a green run shows it. In Actions a missing `DISCORD_WEBHOOK_URL` counts as not
  delivered. Local runs without the secret stay silent.
- The review-queue check exits 1 when an alert was due and not delivered. Its workflow step is
  `continue-on-error`, so the step goes red and the job stays green.
- A check that cannot run at all (no credentials, failed query) posts its own "could not run" message.

**2. Review queue rules.** (Josh, September 25, 2026.) A flagged enrichment is one the agent marked
`needs_manual_review` (SCOTUS, EO) or `needs_review` (pardons) and nobody has reviewed yet.
- **Nothing ages out.** The queue is every still-flagged row, whatever its age. It leaves the queue
  only when it is reviewed in admin.
- **Recent flags ping every run.** A flag from the last 7 days (`ALERT_WINDOW_HOURS`, default 168)
  makes the run post, so a late or skipped workflow run cannot lose it. Flags from the last 26 hours
  are marked NEW.
- **Older flags ping weekly.** If only older flags are open, the reminder posts on Mondays (Central
  time) and stays quiet the rest of the week. Every message says how many older flags are open.
- **Why weekly and not every run:** on September 25, 2026 PROD had 36 published SCOTUS cases with
  low-confidence flags dating back to April. Posting all of them on every run (twice a day for
  SCOTUS) would train everyone to ignore the channel. Letting them age out after 7 days (the first
  version) meant an unreviewed item could vanish from the reminder for good.
- Note: SCOTUS and EO agents publish flagged output (the flag means "check this"); pardons agents
  hide it (`is_public = false` until approved). Both count the same here.

**2b. Stories flags are a daily digest, not a queue.** (ADO-602, October 12, 2026.) The Stories agent
writes `needs_manual_review` and `notes` on its own `stories_enrichment_log` row (about 10-15% of
completions). Stories have no reviewed state in admin, so an open queue would repeat forever.
- Once a day the check lists the flagged, completed log rows created in a fixed slot: yesterday
  06:00 UTC to today 06:00 UTC (1 AM CT in summer, midnight in winter). The daily run is the RSS
  health check's `workflow_dispatch` run that the Netlify function `health-check-trigger` starts at
  13:23 UTC (7:23 AM CT in winter, 8:23 AM in summer), or a manual run. GitHub's scheduled runs and
  push runs never check (ADO-639, November 25, 2026): until then the daily run was GitHub's scheduled
  run starting 12:00-17:59 UTC, and since November 7, 2026 GitHub has started that cron only around
  07:00 and 20:00 UTC, so no digest ran November 8-24. The slot ends 6 hours before the 12:00 UTC
  slot boundary because a log row is created when a story starts and only turns
  completed when it finishes: a slot ending at the check hour missed a story still running when the
  digest looked, on both days (Codex, PR #190). Six hours on, every story in the slot has finished
  (one takes minutes), and the bucketing uses only the database clock (`created_at`). Because the
  slot is fixed rather than "the last N hours", every flag appears in exactly one digest whenever
  after 12:00 UTC the daily run starts. Each slot is also posted by only one run (ADO-645): the
  digest claims its day in `daily_check_claims` first, so a second run for the same slot (a late
  Netlify start after the GitHub fallback, overlapping runs, a second manual click) skips and leaves
  a `pipeline_skips` row. A run whose digest did not reach Discord leaves the day open for the next
  run. A manual run before 12:00 UTC belongs to the previous day's slot: it recovers that slot if its
  run was dropped and skips if it was not. To post a slot again, run the workflow with **force**.
- Known limit: a story whose log row turns completed more than 6 hours after its slot ends is never
  reported. The agent treats a run over 30 minutes as dead, so this needs a hung run that later
  resumes. The root fix is a database-set completion time on `stories_enrichment_log` (a migration).
- Every flag is named, because a slot is never reported again: the first ten with headline and note,
  the remaining flags by story id, grouped ("Story 123 (2 flags)"). If even the ids do not fit
  Discord's embed, the message says how many flags are left, with the `stories_enrichment_log` filter
  that returns all of the slot's flags. If the query hits its 500-row cap, the check reports that it
  could not run rather than send a partial digest.
- Known gap: if a day's daily run never happens at all (the Netlify trigger fails, which posts its
  own "trigger failed" alert), that day's slot is skipped. A manual run of the health check on the
  same day recovers it.
- Only the flag counts. A `thin_source` note without the flag never alerts, and neither do `failed`
  runs (only `completed` rows are read).
- Nothing flagged in the slot, no message. Could-not-run handling is rule 1, plus a follow-up
  workflow step that reports a failed check, the same as the routine silence check.

**3. TEST never looks like PROD.** Runs on the `test` branch set `ALERT_ENV=test`, which prefixes the
title with `[TEST]` and links the TEST site's admin.

**4. No em or en dashes in alert text.** Reasons copied from agent output are rewritten to hyphens.

## Related rules that live elsewhere

- Pardons rows the scraper cannot type (a mixed DOJ section whose warrant cannot be read) are held
  for up to 3 runs, then inserted as `pardon` and flagged: `docs/common-issues.md`, "Pardons: a pardon
  shows as a commutation".
- Every skipped item writes a `pipeline_skips` row (admin, Skips tab): `CLAUDE.md`, anti-patterns.

## Where this is enforced

- `scripts/lib/discord.js` (`postDiscord`, `postDiscordReported`)
- `scripts/monitoring/alert-needs-review.js` (queue rules, `isReminderDay`, the Stories daily digest)
- Tests: `npm run qa:alerts` (`scripts/tests/discord-alerts.test.mjs`), part of `qa:smoke`

_Last updated: November 25, 2026_
