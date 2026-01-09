# RSS Job Queue Worker Automation Plan

**Date:** 2025-11-12
**Status:** Planning
**Environment:** TEST → PROD
**Goal:** Automate RSS job queue worker for production deployment

---

## Executive Summary

**Problem:** RSS job queue worker (`scripts/job-queue-worker.js`) currently runs manually on local machine. This blocks PROD deployment of RSS system.

**Solution:** Deploy worker as automated cloud service using one of 3 approaches (recommendation: GitHub Actions with self-hosted runner or scheduled workflow).

**Timeline:** 2-5 days depending on approach
**Cost:** $0-20/month (well under $50 budget)
**Risk:** Medium (new infrastructure)
**Blocker:** This blocks TTRC-250 (RSS Feed Expansion) PROD deployment

---

## Current State

### What Works in TEST
- ✅ GitHub Actions triggers RSS jobs every 2 hours
- ✅ Edge function (`rss-enqueue`) creates jobs in `job_queue` table
- ✅ Worker processes jobs when manually started: `node scripts/job-queue-worker.js`
- ✅ Articles fetch, cluster, enrich correctly

### What's Missing for PROD
- ❌ No automated worker execution
- ❌ Jobs pile up unprocessed in database
- ❌ RSS system non-functional without manual intervention
- ❌ Can't deploy to PROD until worker is automated

### Why EOs Don't Need This
**Executive Orders already solved** (TTRC-223):
- GitHub Actions runs daily collection script
- Enrichment happens inline (sequential, not queued)
- No separate worker needed - all-in-one approach
- **Key difference:** EOs use synchronous enrichment, RSS uses async job queue

---

## Job Queue Worker Architecture

### What the Worker Does

```
Continuous Loop (every 5 seconds):
  1. Poll job_queue table for pending jobs
  2. Claim job atomically (prevents race conditions)
  3. Execute job handler based on job_type:
     - fetch_feed → Pull RSS articles
     - story.enrich → OpenAI enrichment
     - story.cluster → Group related articles
     - story.lifecycle → Transition story states
     - story.split → Break up over-clustered stories
     - story.merge → Combine similar stories
     - article.enrich → Generate embeddings
  4. Update job status (completed/failed)
  5. Retry failed jobs with exponential backoff
  6. Repeat forever
```

### Worker Configuration

**Environment Variables:**
- `WORKER_POLL_INTERVAL_MS` - Poll frequency (default: 5000ms)
- `WORKER_MAX_CONCURRENT` - Parallel jobs (default: 2)
- `WORKER_RATE_LIMIT_MS` - Delay between jobs (default: 500ms)
- `WORKER_MAX_RETRIES` - Retry attempts (default: 3)
- `SUPABASE_URL` - Database connection
- `SUPABASE_SERVICE_ROLE_KEY` - Database writes
- `OPENAI_API_KEY` - Story enrichment

### Dependencies
- Node.js v22+
- `@supabase/supabase-js`
- `openai` (GPT-4o-mini)
- `rss-parser`
- `dotenv`

---

## Solution Options

### Option 1: GitHub Actions Self-Hosted Runner ⭐ **RECOMMENDED**

**How it works:**
1. Set up self-hosted runner on your machine or VM
2. Create GitHub Actions workflow that runs continuously
3. Worker executes on self-hosted runner
4. GitHub manages scheduling/restarts

**Pros:**
- ✅ Free (uses self-hosted runner)
- ✅ Full control over environment
- ✅ Easy debugging (access to logs)
- ✅ Already using GitHub Actions for triggers
- ✅ Can run 24/7 on your machine or cheap VM

**Cons:**
- ❌ Requires self-hosted runner setup
- ❌ Need to keep runner online
- ❌ Single point of failure (if runner goes down, no processing)

**Cost:** $0-5/month
- $0 if running on your machine
- $5/month for small VM (DigitalOcean, Hetzner)

**Implementation Steps:**
1. Create `.github/workflows/rss-worker.yml`
2. Set up self-hosted runner
3. Configure workflow to run worker continuously
4. Add health checks and auto-restart

**Effort:** 3-4 hours

---

### Option 2: Supabase Edge Function with Database Triggers

**How it works:**
1. Create Edge Function that processes single job
2. Use PostgreSQL `pg_cron` or triggers to call function every minute
3. Function claims job, processes, exits
4. Database scheduler handles continuous execution

**Pros:**
- ✅ Serverless (no infrastructure management)
- ✅ Scales automatically
- ✅ Already using Supabase
- ✅ High availability

**Cons:**
- ❌ 60-second timeout per invocation (Supabase limit)
- ❌ Can't handle long-running enrichment jobs
- ❌ Complex retry logic needed
- ❌ Cold starts may cause delays

**Cost:** $0-10/month
- Free tier: 500K function invocations/month
- ~43K invocations/month (1/min) = FREE

**Implementation Steps:**
1. Create `supabase/functions/rss-worker/index.ts`
2. Migrate worker logic to Edge Function
3. Set up `pg_cron` schedule: `SELECT cron.schedule('*/1 * * * *', 'http://...')`
4. Test with 60s timeout constraint

**Effort:** 6-8 hours

**Blocker:** 60-second timeout may not be enough for enrichment jobs

---

### Option 3: GitHub Actions Scheduled Workflow (Hybrid)

**How it works:**
1. Create workflow that runs every 5-10 minutes
2. Each run processes N pending jobs (batch mode)
3. Exits after batch complete or timeout
4. Next run picks up remaining jobs

**Pros:**
- ✅ Free (GitHub Actions free tier: 2000 minutes/month)
- ✅ No infrastructure management
- ✅ Simple setup (just YAML file)
- ✅ Good for lower-frequency processing

**Cons:**
- ❌ Not continuous (5-10 min gaps between runs)
- ❌ May miss time-sensitive jobs
- ❌ Less efficient than continuous polling
- ❌ 2000 min/month = ~1.4 days of 24/7 runtime (may exceed free tier)

**Cost:** $0-8/month
- Free if <2000 minutes/month
- $0.008/minute after free tier
- Estimated: ~4000 min/month = ~$16/month **OVER BUDGET**

**Implementation Steps:**
1. Create `.github/workflows/rss-worker-scheduled.yml`
2. Set cron: `*/5 * * * *` (every 5 minutes)
3. Worker runs in batch mode (process 10 jobs, exit)
4. Add timeout and error handling

**Effort:** 2-3 hours

**Blocker:** May exceed GitHub Actions free tier

---

### Option 4: Docker Container on Cloud VPS (Premium)

**How it works:**
1. Package worker as Docker container
2. Deploy to cloud VPS (DigitalOcean, Railway, Fly.io)
3. Use Docker restart policies for reliability
4. Monitor with health checks

**Pros:**
- ✅ Production-grade reliability
- ✅ Auto-restart on failures
- ✅ Easy scaling (add more workers)
- ✅ Full control

**Cons:**
- ❌ Monthly cost ($5-10 VPS + $5 Railway/Fly.io)
- ❌ More complex setup (Docker, deployment)
- ❌ Overkill for current needs

**Cost:** $10-15/month

**Implementation Steps:**
1. Create `Dockerfile`
2. Set up Railway.io or Fly.io account
3. Deploy container
4. Configure environment variables
5. Set up monitoring

**Effort:** 4-6 hours

**Blocker:** Exceeds $50/month budget if combined with other services

---

## Comparison Matrix

| Feature | Self-Hosted Runner | Edge Function | Scheduled Workflow | Docker VPS |
|---------|-------------------|---------------|-------------------|------------|
| **Cost** | $0-5/mo | $0-10/mo | $0-16/mo | $10-15/mo |
| **Effort** | 3-4 hours | 6-8 hours | 2-3 hours | 4-6 hours |
| **Reliability** | Medium | High | Medium | High |
| **Continuous** | ✅ Yes | ✅ Yes | ❌ No (5min gaps) | ✅ Yes |
| **Timeout Risk** | ✅ No | ❌ Yes (60s) | ✅ No | ✅ No |
| **Budget Friendly** | ✅ Yes | ✅ Yes | ⚠️ May exceed | ❌ No |
| **Easy Debug** | ✅ Yes | ⚠️ Medium | ✅ Yes | ⚠️ Medium |

---

## Recommendation: Option 1 (Self-Hosted Runner)

**Why:**
1. ✅ Free or <$5/month (well under budget)
2. ✅ No timeout constraints (can run enrichment jobs)
3. ✅ Continuous processing (no gaps)
4. ✅ Easy debugging (local or VM access)
5. ✅ Already using GitHub Actions ecosystem
6. ✅ Simple to set up and maintain

**Two Sub-Options:**

### 1A: Self-Hosted on Your Local Machine (TEST)
- Free
- Good for TEST environment
- Already doing this manually
- Just need to automate startup

### 1B: Self-Hosted on Cloud VM (PROD)
- $5/month for DigitalOcean Droplet (1GB RAM)
- Production-grade reliability
- Independent of your local machine
- Recommended for PROD

---

## Implementation Plan: Self-Hosted Runner

### Phase 1: Local Self-Hosted Runner (TEST)

**Goal:** Automate worker on your local machine for TEST

**Steps:**

1. **Install self-hosted runner** (one-time setup)
   ```bash
   # Download runner
   mkdir actions-runner && cd actions-runner
   curl -o actions-runner-win-x64-2.311.0.zip -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-win-x64-2.311.0.zip
   unzip actions-runner-win-x64-2.311.0.zip

   # Configure runner (follow GitHub prompts)
   ./config.cmd --url https://github.com/AJWolfe18/TTracker --token YOUR_TOKEN

   # Install as Windows service
   ./svc.cmd install
   ./svc.cmd start
   ```

2. **Create workflow file**

   **File:** `.github/workflows/rss-worker-self-hosted.yml`
   ```yaml
   name: RSS Worker (Self-Hosted)

   on:
     push:
       branches: [test]
     workflow_dispatch:

   jobs:
     worker:
       runs-on: self-hosted
       timeout-minutes: 1440  # 24 hours

       steps:
         - name: Checkout code
           uses: actions/checkout@v4

         - name: Setup Node.js
           uses: actions/setup-node@v4
           with:
             node-version: '22'

         - name: Install dependencies
           run: npm ci

         - name: Run RSS Worker
           env:
             SUPABASE_URL: ${{ secrets.SUPABASE_TEST_URL }}
             SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_TEST_SERVICE_ROLE_KEY }}
             OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
           run: node scripts/job-queue-worker.js
   ```

3. **Add health check** (optional)
   - Create `scripts/worker-health-check.js`
   - Pings worker every 5 minutes
   - Sends alert if worker down

4. **Test**
   - Push to `test` branch
   - Verify worker starts automatically
   - Check logs in GitHub Actions UI

**Effort:** 2 hours
**Cost:** $0

---

### Phase 2: Cloud VM Self-Hosted Runner (PROD)

**Goal:** Production-grade worker on cloud VPS

**Steps:**

1. **Provision VM**
   ```bash
   # Create DigitalOcean Droplet (or equivalent)
   # - OS: Ubuntu 22.04
   # - Size: Basic ($5/mo - 1GB RAM, 1 vCPU)
   # - Region: US East (closest to Supabase)
   ```

2. **Install Node.js and dependencies**
   ```bash
   ssh root@your-vm-ip

   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
   sudo apt install -y nodejs git

   # Install PM2 (process manager)
   sudo npm install -g pm2
   ```

3. **Install GitHub Actions runner**
   ```bash
   mkdir actions-runner && cd actions-runner
   curl -o actions-runner-linux-x64-2.311.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-linux-x64-2.311.0.tar.gz
   tar xzf actions-runner-linux-x64-2.311.0.tar.gz

   # Configure runner
   ./config.sh --url https://github.com/AJWolfe18/TTracker --token YOUR_TOKEN --labels prod-worker

   # Install as systemd service
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

4. **Clone repo and set up worker**
   ```bash
   cd ~
   git clone https://github.com/AJWolfe18/TTracker.git
   cd TTracker
   git checkout main
   npm ci
   ```

5. **Create workflow for PROD**

   **File:** `.github/workflows/rss-worker-prod.yml`
   ```yaml
   name: RSS Worker (PROD)

   on:
     push:
       branches: [main]
     workflow_dispatch:

   jobs:
     worker:
       runs-on: [self-hosted, prod-worker]
       timeout-minutes: 1440  # 24 hours

       steps:
         - name: Checkout code
           uses: actions/checkout@v4

         - name: Setup Node.js
           uses: actions/setup-node@v4
           with:
             node-version: '22'

         - name: Install dependencies
           run: npm ci

         - name: Run RSS Worker
           env:
             SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
             SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
             OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
           run: node scripts/job-queue-worker.js
   ```

6. **Set up monitoring**
   - Install monitoring script
   - Configure alerts (email/Discord/Slack)
   - Set up auto-restart on failure

7. **Deploy**
   - Push to `main` branch
   - Verify worker starts on VM
   - Monitor logs

**Effort:** 4 hours
**Cost:** $5/month

---

## Monitoring & Alerts

### Health Checks

**Worker status:**
```sql
-- Check worker is processing jobs
SELECT
  job_type,
  COUNT(*) FILTER (WHERE status = 'pending') as pending,
  COUNT(*) FILTER (WHERE status = 'claimed') as claimed,
  COUNT(*) FILTER (WHERE status = 'completed') as completed,
  MAX(completed_at) as last_completed
FROM job_queue
WHERE created_at > NOW() - INTERVAL '1 hour'
GROUP BY job_type;
```

**Red flags:**
- No completed jobs in last 10 minutes
- `claimed` jobs older than 5 minutes (worker stuck)
- Pending jobs piling up (worker down)

### Alerts

**Option 1: Simple email alert**
- Create `scripts/worker-alert.js`
- Run via cron every 5 minutes
- Send email if worker down

**Option 2: UptimeRobot (Free)**
- Monitor worker health endpoint
- Alerts via email/SMS if down
- Free tier: 50 monitors

**Option 3: GitHub Actions notify**
- Send notification if workflow fails
- Use `actions/slack@v1` or similar

---

## Rollback Plan

**If worker automation fails:**

1. **Immediate:** Restart manual worker on local machine
   ```bash
   node scripts/job-queue-worker.js
   ```

2. **Disable automation:**
   - Stop GitHub Actions workflow
   - Stop self-hosted runner service
   - Revert commits if needed

3. **Verify:**
   - Check jobs processing manually
   - Monitor queue depth decreasing

**Recovery time:** <5 minutes

---

## Testing Plan

### Local Testing (TEST Environment)

1. **Stop manual worker** (if running)
2. **Deploy self-hosted runner workflow**
3. **Trigger RSS job**:
   ```bash
   bash scripts/monitoring/trigger-rss.sh
   ```
4. **Verify:**
   - Jobs appear in `job_queue` table
   - Worker claims and processes jobs
   - Articles appear in `articles` table
   - Stories cluster correctly

### Production Testing (PROD Environment)

1. **Set up cloud VM with runner**
2. **Deploy PROD workflow**
3. **Wait for scheduled RSS trigger** (every 2 hours)
4. **Monitor for 48 hours:**
   - Check job queue processing
   - Verify no errors
   - Confirm cost within budget
5. **Smoke test:**
   - Manually trigger RSS job
   - Verify end-to-end flow

---

## Cost Analysis

### Option 1A: Local Self-Hosted (TEST)
- **Setup:** $0
- **Monthly:** $0
- **Total:** $0/month

### Option 1B: Cloud VM (PROD)
- **Setup:** $0 (DigitalOcean credit possible)
- **Monthly:** $5 (Basic Droplet)
- **Total:** $5/month

### Combined TEST + PROD
- **Total:** $5/month
- **Budget Remaining:** $45/month (RSS costs ~$35/month)
- **Well under $50/month budget ✅**

---

## Timeline

### Week 1: Local Self-Hosted (TEST)
- **Day 1:** Set up local self-hosted runner (2 hours)
- **Day 2:** Create and test workflow (2 hours)
- **Day 3-7:** Monitor stability

### Week 2: Cloud VM (PROD)
- **Day 1:** Provision VM, install runner (2 hours)
- **Day 2:** Deploy PROD workflow (2 hours)
- **Day 3-7:** Monitor stability, tune as needed

**Total Effort:** 8 hours
**Total Timeline:** 2 weeks

---

## Success Criteria

- ✅ Worker runs continuously without manual intervention
- ✅ Jobs process within 5 minutes of creation
- ✅ Zero downtime (or <1% downtime with auto-restart)
- ✅ Cost <$50/month
- ✅ Easy to debug (access to logs)
- ✅ Can deploy to PROD with confidence

---

## Dependencies

- GitHub account with Actions enabled
- Self-hosted runner capability (local or VM)
- Access to TEST and PROD environments
- Monitoring tools (UptimeRobot or equivalent)

---

## Risks & Mitigations

### Risk 1: Self-hosted runner goes offline
**Mitigation:**
- Set up health checks and auto-restart
- Use cloud VM with high uptime SLA
- Configure alerts for runner downtime

### Risk 2: Worker crashes or hangs
**Mitigation:**
- Use PM2 or systemd for auto-restart
- Add timeout monitoring
- Implement graceful shutdown handlers

### Risk 3: Cost exceeds budget
**Mitigation:**
- Use free tier (local runner) for TEST
- Monitor cloud VM costs monthly
- Set billing alerts at $10/month

### Risk 4: Job queue backlog during downtime
**Mitigation:**
- Keep manual worker procedure documented
- Can always fall back to manual processing
- Job queue handles backlog gracefully

---

## Next Steps

1. **Decision:** Choose Option 1A (local) or 1B (cloud VM)
2. **Create JIRA ticket:** "Automate RSS Worker for PROD" (if not exists)
3. **Set up self-hosted runner** (TEST first, then PROD)
4. **Create workflow files**
5. **Test in TEST environment** (1 week monitoring)
6. **Deploy to PROD** (after TEST validation)
7. **Monitor and tune** (ongoing)

---

## Questions to Answer

1. **Hosting preference:** Your local machine (free) or cloud VM ($5/mo)?
2. **TEST first:** Should we test locally for 1 week before cloud VM?
3. **Monitoring:** Email alerts, Discord, Slack, or UptimeRobot?
4. **Backup plan:** Keep manual worker documented for emergencies?

---

**Status:** Ready for implementation
**Recommended Start:** Option 1A (local self-hosted runner for TEST)
**Est. Cost:** $0-5/month
**Est. Effort:** 8 hours over 2 weeks
**Risk Level:** Medium (new infrastructure)

---

**Document Created:** 2025-11-12
**Last Updated:** 2025-11-12
**Owner:** Josh
**Next Review:** After TEST deployment
