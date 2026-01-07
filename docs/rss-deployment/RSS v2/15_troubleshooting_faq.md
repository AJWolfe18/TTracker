# Troubleshooting FAQ

**Q: Duplicate jobs keep appearing.**  
A: Ensure full-table unique index `job_queue_type_payload_hash_key` is DROPPED. Keep partial index `ux_job_queue_payload_hash_active` only.

**Q: New jobs missing feed_id.**  
A: Update callers to use 5-arg `enqueue_fetch_job`. The optional trigger that copies `payload.feed_id` → `job_queue.feed_id` helps during transition.

**Q: Views showing NULLs.**  
A: After install there may be no metrics yet. Run `07_post_deployment_verification.sql` to seed test metrics.

**Q: Backfill mapped too few articles.**  
A: Inspect `03_backfill_articles_feed_id.sql` STEP 2 outputs. Add manual rows to `admin.article_feed_map` and re-apply STEP 3.

**Q: Costs look off.**  
A: Cost view uses placeholders. Adjust unit costs or implement per-action logging for precise attribution.
