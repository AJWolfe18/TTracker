-- TrumpyTracker - Seed Feed Registry with Initial 5 RSS Feeds
-- This script populates the feed_registry table with the core political news feeds
-- Run with: psql $DATABASE_URL < scripts/seed/seed_feed_registry.sql

BEGIN;

-- Ensure the GIN index exists for topic searches
CREATE INDEX IF NOT EXISTS idx_feed_registry_topics ON feed_registry USING GIN (topics);

-- Insert the initial 5 RSS feeds with proper conflict handling
INSERT INTO feed_registry (url, source_name, source_domain, topics, is_opinion_source, failure_count)
VALUES
  ('https://www.reuters.com/rss/world',            'Reuters World',     'reuters.com',           ARRAY['world','politics'],       false, 0),
  ('https://apnews.com/hub/apf-usnews?output=rss', 'AP News - U.S.',    'apnews.com',            ARRAY['us','politics'],          false, 0),
  ('https://www.federalregister.gov/documents/search.rss?conditions%5Bagency_ids%5D%5B%5D=executive-office-of-the-president',
                                                   'Federal Register',  'federalregister.gov',   ARRAY['executive_orders'],       false, 0),
  ('https://www.politico.com/rss/politics-news.xml','POLITICO',         'politico.com',          ARRAY['politics'],               false, 0),
  ('https://thehill.com/feed',                     'The Hill',          'thehill.com',           ARRAY['politics'],               false, 0)
ON CONFLICT (url) DO UPDATE SET
  source_name        = EXCLUDED.source_name,
  source_domain      = EXCLUDED.source_domain,
  topics             = EXCLUDED.topics,
  is_opinion_source  = EXCLUDED.is_opinion_source,
  failure_count      = 0;  -- Reset failure count on reseed

COMMIT;

-- Verify the seeded data
SELECT 
  url,
  source_name,
  topics,
  failure_count,
  is_active
FROM feed_registry
ORDER BY source_name;

SELECT COUNT(*) as total_feeds FROM feed_registry;
