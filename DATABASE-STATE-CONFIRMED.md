# DATABASE STATE TRACKER
**LAST VERIFIED:** September 24, 2025
**ENVIRONMENT:** TEST

## CONFIRMED Database State:

### ✅ ACTUAL Column Names:

#### job_queue table has BOTH:
- `type` (column exists)
- `job_type` (column exists)
- `run_at` (YES - exists)
- `run_after` (NO - does not exist)
- `payload_hash` (exists)
- `last_error` (exists)
- `error` (also exists)

#### articles table:
- `title` (YES - correct column name)
- `headline` (NO - does not exist)
- `url_hash` (YES - exists)
- `published_date` (YES - GENERATED column)
- `content_type` (exists)
- `source_name` (exists)
- `source_domain` (exists)

#### feed_registry table:
- `feed_url` (YES - correct column name)
- `url` (NO - does not exist)
- `feed_name` (exists)
- `is_active` (exists)

### ✅ CONFIRMED RPC Functions:
- `claim_next_job` - WORKS, returns full job record
- `upsert_article_and_enqueue_jobs` - EXISTS but parameter signature unknown

### ❌ PROBLEM TO FIX:
The RPC function exists but Supabase can't find it with our parameters. This means:
1. Wrong parameter names (not p_)
2. Wrong parameter order
3. Missing required parameters
4. OR the function needs ALL parameters

## NEXT STEP:
Run the SQL query above to get exact function signature, then update fetch_feed.js to match EXACTLY.
