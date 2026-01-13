-- Migration 058: Analytics Enhancement Tables
-- Epic: ADO-254 | Story: ADO-255
-- Purpose: Newsletter subscribers, rate limiting, search gap tracking
--
-- Tables:
--   newsletter_subscribers - Email collection with secure unsubscribe tokens
--   rate_limits - DB-based rate limiting for Edge Functions (minute + day buckets)
--   search_gaps - Zero-result search terms for editorial content roadmap
--
-- Security: NO anon access - Edge Functions use service_role only

-- ============================================
-- NEWSLETTER SUBSCRIBERS
-- ============================================
-- Stores email signups with attribution data
-- unsubscribe_token (UUID) used for secure unsubscribe links (NOT email_hash - dictionary attack risk)

CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  -- MD5 hash for deduplication lookups (NOT for unsubscribe - use token instead)
  email_hash TEXT GENERATED ALWAYS AS (md5(lower(trim(email)))) STORED,

  -- Attribution (actionable, not raw referrer)
  signup_page TEXT NOT NULL DEFAULT 'unknown',  -- 'stories' | 'eos' | 'pardons'
  signup_source TEXT DEFAULT 'footer',          -- 'footer' | 'inline_50pct'
  referrer_domain TEXT,                         -- NOT full URL (privacy + cardinality)
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,

  -- Status & lifecycle
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed', 'bounced')),
  confirmed_at TIMESTAMPTZ,          -- For future double opt-in
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Security: UUID token for unsubscribe (NOT email_hash - dictionary attacks possible)
  unsubscribe_token UUID DEFAULT gen_random_uuid() NOT NULL,

  -- Dedupe constraints
  CONSTRAINT uq_newsletter_email_hash UNIQUE (email_hash),
  CONSTRAINT uq_newsletter_unsub_token UNIQUE (unsubscribe_token)
);

-- Index for status queries (active subscribers count, etc.)
CREATE INDEX IF NOT EXISTS idx_newsletter_status ON newsletter_subscribers(status);

-- Index for created_at (time-based queries)
CREATE INDEX IF NOT EXISTS idx_newsletter_created ON newsletter_subscribers(created_at);


-- ============================================
-- RATE LIMITS
-- ============================================
-- DB-based rate limiting for Edge Functions
-- Uses bucket_type ('minute' | 'day') to track both limits independently
-- Cleanup: Edge Functions delete rows older than 2 hours probabilistically (1-in-50 requests)

CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash TEXT NOT NULL,              -- SHA-256 of IP + secret salt (never store raw IP)
  bucket_type TEXT NOT NULL CHECK (bucket_type IN ('minute', 'day')),
  bucket INT NOT NULL,                -- Minute bucket (Unix ms / 60000) or Day bucket (Unix ms / 86400000)
  request_count INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Allows independent minute AND day tracking per IP
  CONSTRAINT uq_rate_limit_bucket UNIQUE (ip_hash, bucket_type, bucket)
);

-- Index for cleanup job (delete old rows)
CREATE INDEX IF NOT EXISTS idx_rate_limits_created ON rate_limits(created_at);


-- ============================================
-- SEARCH GAPS
-- ============================================
-- Zero-result search terms for editorial content roadmap
-- Raw terms (sanitized) stored here, NOT GA4 (you control retention)
-- Upsert pattern: ON CONFLICT (term_hash) DO UPDATE increments count

CREATE TABLE IF NOT EXISTS search_gaps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term_sanitized TEXT NOT NULL,       -- Sanitized search term (no PII, max 40 chars, etc.)
  term_hash TEXT NOT NULL,            -- SHA-256 for deduplication
  search_count INT DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_search_gap_hash UNIQUE (term_hash)
);

-- Index for ordering by popularity (editorial view)
CREATE INDEX IF NOT EXISTS idx_search_gaps_count ON search_gaps(search_count DESC);


-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
-- NO anon access at all - Edge Functions use service_role key

ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_gaps ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if re-running migration
DROP POLICY IF EXISTS newsletter_service_role_all ON newsletter_subscribers;
DROP POLICY IF EXISTS rate_limits_service_role_all ON rate_limits;
DROP POLICY IF EXISTS search_gaps_service_role_all ON search_gaps;

-- service_role has full access (Edge Functions)
CREATE POLICY newsletter_service_role_all ON newsletter_subscribers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY rate_limits_service_role_all ON rate_limits
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY search_gaps_service_role_all ON search_gaps
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ============================================
-- GRANTS
-- ============================================
-- Explicit grants for service_role (Edge Functions)

GRANT ALL ON newsletter_subscribers TO service_role;
GRANT ALL ON rate_limits TO service_role;
GRANT ALL ON search_gaps TO service_role;

-- No grants to anon or authenticated - intentionally blocked


-- ============================================
-- VERIFICATION QUERIES (run after migration)
-- ============================================
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('newsletter_subscribers', 'rate_limits', 'search_gaps');
-- SELECT * FROM pg_policies WHERE tablename IN ('newsletter_subscribers', 'rate_limits', 'search_gaps');
