# Discord alerts: what pings, when, and the rules

The one place for how TrumpyTracker talks to Josh's Discord channel. Code comments and other docs
point here; if a rule below changes, change it here in the same commit.

All alerts go through `scripts/lib/discord.js` (webhook only, secret `DISCORD_WEBHOOK_URL`), except the
workflow failure steps, which `curl` the same webhook from YAML.

## What pings

| Alert | Sent by | When | Color |
|---|---|---|---|
| Pipeline failed | `Discord alert (on failure)` step in every scheduled workflow: RSS Tracker PROD + TEST, Track Pardons, Judge Executor, and (ADO-349, same step copied from Track Pardons) Track Executive Orders, SCOTUS Tracker, Pipeline Skips Cleanup; RSS Health Check alerts when its silence check cannot run | the job fails or is cancelled | red |
| New work landed (ADO-577) | `executive-orders-tracker-supabase.js`, `ingest/doj-pardons-scraper.js`, `scotus/fetch-cases.js` | a fetch inserts at least one new row | blue |
| Waiting for review (ADO-577) | `monitoring/alert-needs-review.js --domain scotus\|eo\|pardons`, last step of the three fetch workflows | see "Review queue rules" below | amber |
| Routine went silent (ADO-586) | `monitoring/alert-routine-silence.js`, in RSS Pipeline Health Check | Judge log older than 12h, Stories log older than 6h | red |
| Judge uncertain verdicts (ADO-583) | `clustering/execute-judge-verdicts.js` | the Judge left verdicts it was unsure of for the admin Judge tab | amber |
| Social drafts waiting (ADO-572) | `social/draft-posts.js` | new drafts need approval in the admin Social tab | amber |

A run with nothing to say posts nothing. Manual-only workflows (Enrich Single Story, the manual
article workflows, Test Secrets) have no failure alert: whoever dispatched them is watching.

## Rules (decided, do not revisit without Josh)

**1. An alert never fails the pipeline, and a lost alert is never silent.** (Codex review on PR #151,
September 25, 2026.) `postDiscord` never throws and never changes the caller's exit code, so a
Discord outage cannot turn a good ingest red. But when an alert that matters is not delivered:
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
- `scripts/monitoring/alert-needs-review.js` (queue rules, `isReminderDay`)
- Tests: `npm run qa:alerts` (`scripts/tests/discord-alerts.test.mjs`), part of `qa:smoke`

_Last updated: September 25, 2026_
