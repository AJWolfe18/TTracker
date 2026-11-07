# RSS PROD: 2-hour trigger from Netlify (ADO-637)

**Why:** GitHub runs the `rss-tracker-prod.yml` schedule (`17 */2 * * *`) only 4-6 times a day instead of 12. It ran a steady 12 a day until August 26, 2026; on August 27 every scheduled workflow in the repo was hit at once (EO, pardons and SCOTUS skipped that day), and the 2-hour RSS job never recovered (usual gap about 5 hours, up to 9). Other projects report the same onset ([GitHub Community #206019](https://github.com/orgs/community/discussions/206019)). Nothing in our repo changed; moving off the top of the hour (#193) did not help. A `workflow_dispatch` call starts a run at once, so a Netlify scheduled function makes that call every 2 hours. The GitHub schedule stays as a backup.

**Why Netlify (decided November 7, 2026):** cron-job.org was the first plan. Josh chose Netlify instead: no new third-party account, and the token stays with a service we already trust (cron-job.org is a one-person service and its FAQ says it does not check certificates on its outgoing calls). Supabase pg_cron was rejected because the job would stop if PROD goes read-only on the free plan's size limit.

**Cost:** $0. 12 calls a day is far under Netlify's free function allowance; GitHub Actions minutes are free on this public repo.

**Code:** `netlify/functions/rss-prod-trigger.mjs` (tests: `npm run qa:rss-prod-trigger`, part of `qa:smoke`).
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
