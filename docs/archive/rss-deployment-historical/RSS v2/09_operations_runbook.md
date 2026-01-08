# Operations Runbook (RSS v2)

## Purpose
Daily/weekly operational procedures for the RSS pipeline.

## Dashboards to check (daily)
1) `admin.feed_health_overview` — error_rate_24h, fetches_24h, articles_24h
2) `admin.feed_activity_hints` — suggested_interval_human
3) Legacy debt: `SELECT COUNT(*) FROM job_queue WHERE feed_id IS NULL AND processed_at IS NULL;`

## Common actions
- Disable a noisy feed: `UPDATE feed_registry SET is_active = FALSE WHERE id = $1;`
- Re-enable: `UPDATE feed_registry SET is_active = TRUE WHERE id = $1;`
- Purge queued jobs for a feed (careful): `DELETE FROM job_queue WHERE processed_at IS NULL AND feed_id = $1;`

## Adding a feed
1) Insert into `feed_registry`.
2) Add compliance rule in `feed_compliance_rules` (max_chars=1200 unless allowed).
3) Seed a fetch job via:
```sql
SELECT public.enqueue_fetch_job(
  p_feed_id := $id,
  p_job_type := 'rss_fetch_feed',
  p_payload := jsonb_build_object('feed_id',$id),
  p_run_at := NOW()
);
```

## Alerts (phase 4)
- Email via IFTTT: set env `IFTTT_WEBHOOK_URL` in Edge Function.
- Later: Slack webhook for richer notifications.

## SLOs
- Error rate < 3% over 24h
- 304 rate trending upward for mature feeds
- Cost < $50/month total

## On-call checklist
1) Check health overview; if a feed is CRITICAL, set inactive and file a ticket.
2) Review `feed_errors` for the last 24h by feed.
3) If budget approaches 80%, pause lowest-ROI feeds.
