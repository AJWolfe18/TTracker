# RSS PROD: 2-hour trigger from Netlify (ADO-637)

**Why:** GitHub runs the `rss-tracker-prod.yml` schedule (`17 */2 * * *`) only 4-6 times a day instead of 12. It ran a steady 12 a day until August 26, 2026; on August 27 every scheduled workflow in the repo was hit at once (EO, pardons and SCOTUS skipped that day), and the 2-hour RSS job never recovered (usual gap about 5 hours, up to 9). Other projects report the same onset ([GitHub Community #206019](https://github.com/orgs/community/discussions/206019)). Nothing in our repo changed; moving off the top of the hour (#193) did not help. A `workflow_dispatch` call starts a run at once, so a Netlify scheduled function makes that call every 2 hours. The GitHub schedule stays as a backup.

**Why Netlify (decided November 7, 2026):** cron-job.org was the first plan. Josh chose Netlify instead: no new third-party account, and the token stays with a service we already trust (cron-job.org is a one-person service and its FAQ says it does not check certificates on its outgoing calls). Supabase pg_cron was rejected because the job would stop if PROD goes read-only on the free plan's size limit.

**Cost:** $0. 12 calls a day is far under Netlify's free function allowance; GitHub Actions minutes are free on this public repo.

**Code:** `netlify/functions/rss-prod-trigger.mjs` (tests: `npm run qa:rss-prod-trigger`, part of `qa:smoke`). The token, deploy check, error codes and dispatch call are shared with the second trigger (below) in `netlify/lib/github-dispatch.mjs`.
- Schedule `47 */2 * * *` UTC: half an hour off GitHub's :17 so the two rarely meet.
- Fires only on the published production deploy (`main`, trumpytracker.com). Netlify never runs scheduled functions on branch deploys (`test`) and never exposes them by URL, so nobody can call it from outside.
- "Run now" in the Netlify UI works on any deploy, so the code also checks it is running on the **current published production deploy**: on a branch deploy, deploy preview, local server, or an older production deploy from the history it skips without calling GitHub. If Netlify's deploy context or published flag is missing or unrecognized it starts nothing and alerts (fails closed, never silently).
- No raw error text or GitHub response body is ever logged or sent to Discord (fetch errors can quote the token): only the status code and a fixed reason code. The shared Discord helper scrubs the webhook URL from its own failure line.

**Safety built into the workflow:**
- `concurrency` group: a late GitHub schedule and the Netlify call never run together. GitHub keeps at most one waiting run (a newer one replaces it), which loses nothing because every run fetches everything new.
- The call sends `scheduled=true`, so it obeys the `ENABLE_PROD_SCHEDULES` kill switch like the cron. A manual "Run workflow" click (input left at `false`) still runs when the switch is off (TTRC-362).
- Only runs on `main` (the existing branch lock).

## Setup (Josh, about 5 minutes, after the function is on `main`)

### 1. GitHub token that can only start workflows
GitHub → profile picture → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
- Name: `rss-prod-trigger`
- Expiration: 1 year (put a reminder on the calendar)
- Repository access: **Only select repositories** → `AJWolfe18/TTracker`
- Permissions → Repository permissions → **Actions: Read and write**. Nothing else.
- Generate, then copy the token (it starts `github_pat_`).

Treat it as a real credential. GitHub has no "start this one workflow" permission, so Actions write covers every workflow on this repo: it can start any of the manual (`workflow_dispatch`) workflows on `main`, which run with PROD secrets and can spend AI budget (pardons, EO, SCOTUS, enrichment), and it can cancel or delete runs and logs or disable a workflow. It cannot read secrets, read or push code, or touch other repos. Keep it only in Netlify; revoke it at once if the Netlify account is ever in doubt. When it expires the function fails with 401 and posts to Discord (see Troubleshooting), so a lapsed reminder is still caught.

### 2. Netlify environment variable
Netlify → project `taupe-capybara-0ff2ed` (trumpytracker.com) → Project configuration → Environment variables → Add a variable:
- Key: `RSS_TRIGGER_GITHUB_TOKEN`
- Value: the token. Tick **Contains secret values**.
- Scopes: **Functions** (at least). Deploy contexts: **Production** only.
- Add a second variable the same way: Key `DISCORD_WEBHOOK_URL`, value = the same Discord webhook URL the GitHub `DISCORD_WEBHOOK_URL` secret holds (Discord → channel settings → Integrations → Webhooks → Copy Webhook URL; GitHub never shows a saved secret). Secret, Functions, Production. Without it a failed trigger only shows in Netlify's function log, which nobody reads.
- Save, then **Deploys → Trigger deploy → Deploy site** (variables are frozen per deploy, so the running function only sees them after a redeploy).

### 3. Check
- Netlify → Logs → Functions: `rss-prod-trigger` is listed and marked **Scheduled**. If it is missing, the build did not pick up `netlify/functions` (see `[functions]` in `netlify.toml`).
- On that page, **Run now** (or wait for the next :47 after an even UTC hour). No error line = started.
- `gh run list --workflow rss-tracker-prod.yml --limit 5` shows a new run with event `workflow_dispatch`.
- The first **scheduled** call (not Run now) is the end-to-end check of Netlify's deploy metadata. Netlify's runtime turns a missing "published" signal into `published: false`, which this function treats as a quiet skip. If the function log shows `skipped: unpublished production deploy` on the live site and no `workflow_dispatch` run appears, the runtime is not passing the flag: fix the check in a PR (Codex recheck, November 7, 2026).
- After a day, count runs per day: expect about 12 from Netlify plus GitHub's 4-6 late ones. A run that was waiting and got replaced by a newer one shows as **cancelled**: expected, not a trigger failure (count only `success` runs). Extra runs are cheap (a feed with nothing new costs no OpenAI call). If GitHub's late runs ever crowd the Netlify ones, drop the `schedule:` block in a PR and keep only this trigger.

## Second function: daily RSS health check (ADO-639)

**Why:** the RSS Pipeline Health Check (`rss-health-check.yml`, GitHub cron `41 */6 * * *`) runs two once-a-day checks: RSS ingest health (ADO-597) and the Stories flag digest (ADO-602). They used to run only on the scheduled run starting 12:00-17:59 UTC. Since November 7, 2026 GitHub has started that cron only around 07:00 and 20:00 UTC, so neither check ran November 8-24, 2026 and nothing said so.

**What it does:** `netlify/functions/health-check-trigger.mjs` dispatches `rss-health-check.yml` on `main` once a day. That `workflow_dispatch` run (or a manual "Run workflow" click) does the two daily checks. GitHub's scheduled runs still do the rest (preflight, job queue, routine silence check); after 14:00 UTC they also offer to do the daily checks as a backup (below), and the daily claim makes sure only one run a day does them. Push runs skip them, as before.
- Schedule `23 13 * * *` UTC: 7:23 AM Central in winter (CST), 8:23 AM in summer (CDT). After 12:00 UTC so the digest slots that end at 12:00 and 06:00 UTC are complete; minute 23 stays off the top of the hour and off the other crons (:17, :41, :47).
- Same token and the same two Netlify variables (`RSS_TRIGGER_GITHUB_TOKEN`, `DISCORD_WEBHOOK_URL`) as the RSS trigger: the token's Actions write already covers every workflow in the repo. **Nothing to set up**; it starts on the first production deploy that includes it.
- Same rules as the RSS trigger: only the current published production deploy dispatches, unknown deploy context fails closed and alerts, and no raw error text or response body is ever logged or sent.
- The call sends only `ref: main`: the workflow's one input, `force` (below), is optional and stays off. No kill switch: `ENABLE_PROD_SCHEDULES` does not cover this workflow, which only reads and alerts.
- **Once per day, whichever run starts it (ADO-645):** before it does anything, each daily check claims the day in the PROD table `daily_check_claims` (migration 139, `scripts/lib/daily-check-claim.js`). The claim is atomic, so of two runs for the same day (any order, or at the same moment) only one checks; the other logs `[daily-claim] ... skipped, run N already did this check` and leaves a `pipeline_skips` row (`daily_health_check` / `already_claimed`, admin Skips tab). The "day" is the date of the 12:00 UTC boundary that ends the digest slot, so a manual run before 12:00 UTC belongs to the previous day, which normally already ran. A run that fails (crash, failed query, Discord did not take the message) marks its claim `failed` and the next run takes it over; a claim left `running` for 30 minutes (the run was killed) is taken over too. Both check steps time out first (10 and 2 minutes). If the claim cannot be read (database error), the checks run anyway with a `::warning::` (a repeated digest beats a missing one). **Migration 139 is a hard prerequisite: apply it on PROD before this code ships** (it only adds a table and two functions, so applying early is safe). Without it every scheduled run after 14:00 UTC fails open and posts the digests again.
- Cost: $0 (one call a day; Actions minutes are free on this public repo).
- Tests: `npm run qa:health-check-trigger` (`scripts/tests/health-check-trigger.test.mjs`) and `npm run qa:daily-check-claims` (`scripts/tests/daily-check-claims-pglite.test.mjs`, migration 139 on PGlite), both part of `qa:smoke`.

**Check after deploy:**
- Netlify → Logs → Functions: `health-check-trigger` is listed and marked **Scheduled**, next to `rss-prod-trigger`.
- The next day after 13:23 UTC: `gh run list --workflow rss-health-check.yml --limit 5` shows a run with event `workflow_dispatch`. In its log, the "Ingest health check" step shows `[ingest-health] recent=... content=...` (not `[ingest-health] skipped`), and the "Stories flagged enrichments" step shows `[needs-review] stories: N flagged, created ... to ...` (not `not the daily check run`). Each of the two steps starts with `[daily-claim] <check> <date>: claimed by run ...`; a `::warning:: ... could not claim the day` line means migration 139 is not applied on PROD.
- GitHub's own scheduled runs of the same workflow before 14:00 UTC log `[ingest-health] skipped (... this is a schedule run)` and `[needs-review] stories: not the daily check run ...`; after 14:00 UTC they normally log `[daily-claim] <check> <date>: skipped, run N already did this check`. Both are expected.
- **Backup if this function never fires, or its checks did not finish:** the "Daily run watchdog" step runs on GitHub's scheduled runs on `main`. Every one at or after 14:00 UTC (lately around 20:00 UTC, 2 PM Central) offers to do both daily checks (`DAILY_CHECK_FALLBACK=1`), and the daily claim alone decides: if today's checks are done or still running, they skip; if no run did them, or the run that tried failed (claim `failed`) or died (claim stuck at `running` for 30 minutes), this run does them. The watchdog no longer reads the run list (ADO-645 review): a Netlify run whose check failed still ends in success (the daily steps are continue-on-error), so counting successful runs stopped every later backup and the day was never retried. Only a check that actually got the day this way posts **"Daily health check ran from the backup run"** (amber) to Discord, once per day. A Netlify start that comes late, after the fallback ran, skips instead of posting the digest a second time. Known gap: the digests post twice only if the claim cannot be read (database down, or migration 139 missing); then every scheduled run after 14:00 UTC checks again, each with a `::warning::`. The same flag runs either check locally: `DAILY_CHECK_FALLBACK=1 node scripts/monitoring/alert-needs-review.js --domain stories`.
- Want the checks today without waiting? Netlify → the function → **Run now** on the published production deploy, or `gh workflow run "RSS Pipeline Health Check" --ref main`. If today's checks already ran, that run skips them; to check again (it posts again), tick **force** in "Run workflow", or `gh workflow run "RSS Pipeline Health Check" --ref main -f force=true`. A forced run takes the day's claim, so later automatic runs that day still skip. A manual run before 12:00 UTC belongs to the previous day: it skips if that day ran, and recovers it if it did not.

**Failure alert:** **"RSS health check trigger (Netlify) failed"** in Discord (daily until fixed), and `[health-check-trigger] dispatch failed {...}` in the function log. The Troubleshooting table below applies, except 422 here means the workflow on `main` no longer accepts `workflow_dispatch` (or someone made an input required), and a network error is retried the next day, not 2 hours later.

**Turning it off:** remove the function in a PR. Before that, decide what runs the daily checks instead: with this function gone only the watchdog backup (and its daily "ran from the backup run" ping) or a manual "Run workflow" click does them. Revoking the token stops both triggers.

## Third function: daily SCOTUS fetch (ADO-644)

**Why:** GitHub's cron for the PROD SCOTUS fetch (`scotus-tracker.yml`, `47 18 * * *`) started 5 to 9 hours late every day November 20-27, 2026 (between 23:35 and 04:05 UTC, often the next UTC day). New rulings then reached the site, the tracker tally and the flagged-enrichments alert hours late.

**What it does:** `netlify/functions/scotus-trigger.mjs` dispatches `scotus-tracker.yml` on `main` once a day.
- Schedule `47 19 * * *` UTC: 1:47 PM Central in winter, 2:47 PM in summer. One hour after the old 18:47 cron, because 18:47 is also an RSS slot (the RSS trigger fires at :47 on even hours) and both workflows finish with `assign-fronts` and `refresh-tracker` in different concurrency groups. 19:47 sits exactly between two RSS runs, and is still after the Court's morning opinion releases and the SCOTUS agent's 16:00 UTC weekday run.
- Same token and Netlify variables (`RSS_TRIGGER_GITHUB_TOKEN`, `DISCORD_WEBHOOK_URL`) as the other two: the token's Actions write covers every workflow in the repo. **Nothing to set up**; it starts on the first production deploy that includes it.
- The call sends only `ref: main`. The workflow's one input, `skip_fetch`, defaults to `false`, so it is a full run. The `ENABLE_PROD_SCHEDULES` kill switch sits on the job itself and covers every SCOTUS run, this one, the cron and manual clicks alike.
- Same deploy and no-leak rules as the other triggers. Cost: $0 (one call a day; the extra guard job is a few seconds of free Actions time).
- Tests: `npm run qa:scotus-trigger` (`scripts/tests/scotus-trigger.test.mjs`), part of `qa:smoke`.

**GitHub's cron is the backup, and does not repeat the run:** the cron moved to `47 21 * * *` (ADO-644 review), two hours after the Netlify run, so even an on-time cron run comes second (at 18:47 an on-time cron ran first and both ran); 21:47 is an odd hour, clear of the RSS runs. The workflow's first job, "Backup guard", runs for scheduled runs only. If a `workflow_dispatch` run of the workflow was created in the last 20 hours, has finished, and its "Fetch cases (CourtListener → Supabase PROD via TEST-named env vars)" step succeeded, the cron run skips the pipeline and leaves a `pipeline_skips` row (`scotus_fetch` / `backup_run_skipped`, admin Skips tab). A later step failing (fronts, refresh) does not undo that: the flag alert already posted (code review, November 28, 2026). A manual run with `skip_fetch` does not count, since it did not fetch (Codex, November 27, 2026); the guard reads each candidate run's steps with `gh run view`, and any `gh` error means the pipeline runs. Why 20 hours: a cron run d hours late finds that day's Netlify run 2+d hours old (counted for delays up to 18 hours) and the previous day's 26+d hours old (never counted). A Netlify run whose fetch failed, was cancelled or never happened leaves the cron run to do the full pipeline, late but not lost. A run still in progress does not count (it could still fail), so a cron run that arrives while the Netlify run is going runs too: rare, since the Netlify run takes minutes and the cron is due two hours later. If the run list cannot be read, or the guard job itself fails, the pipeline runs. A repeat fetch alone would be harmless (`fetch-cases.js --resume` starts from the last decision date, stored rows only get their fetch-owned columns refreshed, the new-case alert fires only on insert), but "Alert flagged enrichments" posts on every run while a flag from the last 7 days is open, so a second run would post it twice a day. Known gap: when the two runs overlap that way, or the guard fails open, that alert posts twice that day.

**Check after deploy:**
- Netlify → Logs → Functions: `scotus-trigger` is listed and marked **Scheduled**.
- `curl -s -o /dev/null -w '%{http_code}\n' https://trumpytracker.com/.netlify/functions/scotus-trigger` prints `403`: deployed, and not callable from outside.
- After 19:47 UTC: `gh run list --workflow scotus-tracker.yml --limit 5` shows a `workflow_dispatch` run created within about 10 minutes of 19:47, with the "SCOTUS pipeline" job run in full.
- The next GitHub run (event `schedule`, due 21:47 UTC) shows "Backup guard" green with `skipping this backup run` and `skip recorded` in its log, and "SCOTUS pipeline" skipped. That is expected.

**Failure alert:** **"SCOTUS trigger (Netlify) failed"** in Discord, and `[scotus-trigger] dispatch failed {...}` in the function log. The Troubleshooting table below applies, except 422 here means the workflow on `main` no longer accepts `workflow_dispatch` (or someone made an input required), and a network error is retried the next day; that day's fetch then comes from GitHub's late cron run.

**Turning it off:** remove the function in a PR. GitHub's cron then does the fetch again (late), and the guard lets it run because no `workflow_dispatch` run happened.

## Turning it off
- **Pause both schedules:** set the GitHub variable `ENABLE_PROD_SCHEDULES` to anything but `true`. Runs this function starts are then skipped, and so are GitHub's cron runs. Manual "Run workflow" clicks still work.
- **Stop this trigger for good:** revoke the token (GitHub → Fine-grained tokens → Revoke) and remove the function in a PR. Do not just delete the Netlify variable: the function would report `missing_token` (Discord ping included) every 2 hours.
- The kill switch only binds callers that send `scheduled=true`. Anyone holding the token could send `false` and start PROD runs anyway, so revoking the token is the real off switch.

## Troubleshooting
On failure the function posts **"RSS PROD trigger (Netlify) failed"** to Discord (repeats every 2 hours until fixed) and logs `[rss-prod-trigger] dispatch failed {...}` in Netlify's function log:

| `status` / `reason` | Meaning |
|---|---|
| `missing_token` | Variable not set, not scoped to Functions/Production, or no redeploy since it was added |
| 401 | Token expired or revoked: make a new one, update the variable, redeploy |
| 403 / 404 | Token lacks Actions write, or is not scoped to TTracker |
| 422 | The workflow's `scheduled` input is not on `main` (GitHub's "Unexpected inputs provided") |
| `network_error` / `timeout` or `fetch_failed` | GitHub unreachable or slower than 15 seconds; the next run 2 hours later retries |
| `network_error` / `invalid_token_format` | The saved token has a stray character (line break, odd symbol): re-paste it in Netlify and redeploy |
| `unknown_deploy_context` | Netlify did not say which deploy is running or whether it is published; the function refused to dispatch. Check Netlify's runtime changelog |
