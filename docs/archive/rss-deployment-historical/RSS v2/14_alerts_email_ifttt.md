# Alerts via Email (IFTTT Webhooks)

## Why this
Zero-cost email or push notifications while we stabilize RSS v2.

## Setup (5 minutes)
1) Go to ifttt.com → Create applet.
2) IF (Webhooks: receive a web request with JSON) → THEN (Email or Notifications).
3) Name the event "rss_alert".
4) Copy the webhook URL and add it as Edge Function env: `IFTTT_WEBHOOK_URL`.

## Payload format
```json
{ "type": "error|budget|info", "message": "text", "feed_id": 3 }
```

## Test
```sql
SELECT public.enqueue_fetch_job(
  0, 'send_alert',
  jsonb_build_object('type','info','message','Test alert','feed_id',0),
  NOW()
);
```

## Migration to Slack (later)
Swap `deliverAlertIFTTT` for Slack webhook; no DB changes needed.
