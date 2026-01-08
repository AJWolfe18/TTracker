# RPC API Reference (RSS v2)

## enqueue_fetch_job (new)
**Signature:** `(p_feed_id BIGINT, p_job_type TEXT, p_payload JSONB, p_run_at TIMESTAMPTZ DEFAULT NOW(), p_payload_hash TEXT DEFAULT NULL) RETURNS BIGINT`  
**Purpose:** Enqueue a job with optional schedule.  
**Idempotency:** Partial unique index on (job_type, payload_hash) WHERE processed_at IS NULL.

**Example**
```sql
SELECT public.enqueue_fetch_job(
  p_feed_id := 3,
  p_job_type := 'rss_fetch_feed',
  p_payload := jsonb_build_object('feed_id', 3),
  p_run_at := NOW() + INTERVAL '10 minutes'
);
```

## enqueue_fetch_job (legacy)
**Signature:** `(p_type TEXT, p_payload JSONB, p_hash TEXT DEFAULT NULL) RETURNS BIGINT`  
**Note:** Delegates to new version with `feed_id=NULL`.

## record_feed_success
**Signature:** `(p_feed_id BIGINT, p_duration_ms INTEGER) RETURNS void`  
**Effect:** Increments fetch_count & success_count; updates latest duration and success streak.

## record_feed_not_modified
**Signature:** `(p_feed_id BIGINT, p_duration_ms INTEGER) RETURNS void`  
**Effect:** Increments fetch_count & not_modified_count; counts as success.

## record_feed_error
**Signature:** `(p_feed_id BIGINT, p_error TEXT) RETURNS void`  
**Effect:** Increments fetch_count & error_count; logs error; resets success streak.
