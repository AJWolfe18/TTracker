# RSS PROD: external 2-hour trigger (cron-job.org)

**Why:** GitHub runs the `rss-tracker-prod.yml` schedule (`17 */2 * * *`) only 4-5 times a day instead of 12. Measured October 19-24, 2026, after #193 moved it off the top of the hour: the usual gap was 5.2 hours and the longest 8.7. A free outside scheduler calls GitHub's "run workflow" API every 2 hours instead. The GitHub schedule stays as a backup.

**Cost:** $0 (cron-job.org free tier, GitHub Actions minutes are free on this public repo).

**Safety built into the workflow:**
- `concurrency` group: a late GitHub schedule and the external call queue instead of running together.
- The external call sends `scheduled=true`, so it obeys the `ENABLE_PROD_SCHEDULES` kill switch like the cron. A manual "Run workflow" click (input left at `false`) still runs when the switch is off (TTRC-362).
- Only runs on `main` (the existing branch lock).

## Setup (about 10 minutes, Josh)

Do this only after the workflow change (concurrency + `scheduled` input) is on `main`. Before that, the API rejects the `scheduled` input with HTTP 422.

### 1. GitHub token that can only start workflows
GitHub → profile picture → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
- Name: `rss-prod-trigger`
- Expiration: 1 year (put a reminder on the calendar)
- Repository access: **Only select repositories** → `AJWolfe18/TTracker`
- Permissions → Repository permissions → **Actions: Read and write**. Nothing else.
- Generate, then copy the token (it starts `github_pat_`).

This token can start, rerun or cancel workflows on this one repo. It cannot read secrets, read or push code, or touch other repos.

### 2. cron-job.org job
Sign up free at cron-job.org → **Create cronjob**:
- Title: `TTracker RSS PROD`
- URL: `https://api.github.com/repos/AJWolfe18/TTracker/actions/workflows/rss-tracker-prod.yml/dispatches`
- Schedule: **Custom** → every 2 hours, minute **47** (half an hour off GitHub's :17, so the two rarely meet)
- **Advanced** tab:
  - Request method: **POST**
  - Headers:
    - `Authorization`: `Bearer <the token>`
    - `Accept`: `application/vnd.github+json`
    - `X-GitHub-Api-Version`: `2022-11-28`
    - `Content-Type`: `application/json`
  - Request body: `{"ref":"main","inputs":{"scheduled":"true"}}`
- Notifications: turn on "notify me when the job fails".
- Save, then **Test run**. Expect **HTTP 204** (no body).

### 3. Check
`gh run list --workflow rss-tracker-prod.yml --limit 5` shows a new run with event `workflow_dispatch`. After a day, count runs per day: expect about 12 or more.

## Turning it off
Pause the job in cron-job.org (or set `ENABLE_PROD_SCHEDULES` to anything but `true`, which stops both). To kill the token: GitHub → Fine-grained tokens → Revoke.

## Troubleshooting
| cron-job.org shows | Meaning |
|---|---|
| 204 | Started |
| 401 | Token expired or revoked: make a new one, update the header |
| 403 / 404 | Token lacks Actions write, or is not scoped to TTracker |
| 422 `Unexpected inputs provided` | The workflow change is not on `main` yet |
