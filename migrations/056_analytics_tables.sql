-- Migration 056: Analytics Tables (Epic 254)
-- Newsletter subscribers, rate limiting, and search gaps
-- Apply to PROD before merging Epic 254 PR

-- Newsletter subscribers
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL,
  email_hash TEXT GENERATED ALWAYS AS (md5(lower(trim(email)))) STORED,

  -- Attribution
  signup_page TEXT NOT NULL DEFAULT 'unknown',
  signup_source TEXT DEFAULT 'footer',
  referrer_domain TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,

  -- Status & lifecycle
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'unsubscribed', 'bounced')),
  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Security: UUID token for unsubscribe
  unsubscribe_token UUID DEFAULT gen_random_uuid() NOT NULL,

  -- Dedupe
  CONSTRAINT uq_newsletter_email_hash UNIQUE (email_hash),
  CONSTRAINT uq_newsletter_unsub_token UNIQUE (unsubscribe_token)
);

-- Rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  bucket_type TEXT NOT NULL CHECK (bucket_type IN ('minute', 'day')),
  bucket INT NOT NULL,
  request_count INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_rate_limit_bucket UNIQUE (ip_hash, bucket_type, bucket)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_created ON rate_limits(created_at);

-- Search gaps table (editorial content roadmap)
CREATE TABLE IF NOT EXISTS search_gaps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term_sanitized TEXT NOT NULL,
  term_hash TEXT NOT NULL,
  search_count INT DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_search_gap_hash UNIQUE (term_hash)
);

CREATE INDEX IF NOT EXISTS idx_search_gaps_count ON search_gaps(search_count DESC);

-- RLS: NO anon access (Edge Functions use service_role)
ALTER TABLE newsletter_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE search_gaps ENABLE ROW LEVEL SECURITY;

-- Grant access to service_role only
GRANT ALL ON newsletter_subscribers TO service_role;
GRANT ALL ON rate_limits TO service_role;
GRANT ALL ON search_gaps TO service_role;

-- Verification
DO $$
BEGIN
  RAISE NOTICE 'Migration 056 complete: newsletter_subscribers, rate_limits, search_gaps tables created';
END $$;
