-- TrumpyTracker Test Data Fixtures
-- Run this after migration to add sample data for development

BEGIN;

-- ================================================
-- Clear existing test data (safe for development)
-- ================================================
DELETE FROM article_story WHERE story_id IN (
  SELECT id FROM stories WHERE story_hash LIKE 'test-%'
);
DELETE FROM stories WHERE story_hash LIKE 'test-%';
DELETE FROM political_entries WHERE id LIKE 'test-%';
DELETE FROM job_queue WHERE type = 'test';
DELETE FROM feed_registry WHERE feed_url LIKE '%test%';

-- ================================================
-- Insert Test Feeds
-- ================================================
INSERT INTO feed_registry (
  feed_url, feed_name, topics, tier, is_active
) VALUES
  -- Tier 1 feeds (wire services)
  ('https://feeds.reuters.com/Reuters/PoliticsNews', 
   'Reuters Politics', ARRAY['congress', 'executive'], 1, true),
  
  ('https://feeds.apnews.com/rss/apf-usnews', 
   'AP News US', ARRAY['congress', 'courts', 'executive'], 1, true),
  
  -- Tier 2 feeds (major nationals)
  ('https://rss.nytimes.com/services/xml/rss/nyt/Politics.xml', 
   'New York Times Politics', ARRAY['congress', 'executive', 'elections'], 2, true),
  
  ('https://feeds.washingtonpost.com/rss/politics', 
   'Washington Post Politics', ARRAY['congress', 'investigations'], 2, true),
  
  -- Tier 3 feeds (others)
  ('https://www.politico.com/rss/politicopicks.xml', 
   'Politico Top Stories', ARRAY['congress', 'executive'], 3, true),
  
  -- Test feed (for development)
  ('https://test.example.com/rss', 
   'Test Feed', ARRAY['test'], 3, false)
ON CONFLICT (feed_url) DO NOTHING;

-- ================================================
-- Insert Test Stories
-- ================================================
INSERT INTO stories (
  story_hash, primary_headline, primary_source, primary_source_url, 
  primary_source_domain, primary_actor, status, severity, topic_tags, 
  source_count, first_seen_at, last_updated_at, 
  summary_neutral, summary_spicy
) VALUES
  -- Active story (recent)
  ('test-active-1', 
   'Trump Announces Major Immigration Policy Shift', 
   'Reuters Politics', 
   'https://reuters.com/politics/trump-immigration-2025',
   'reuters.com',
   'Donald Trump',
   'active', 
   'severe', 
   ARRAY['executive', 'immigration'],
   3,
   NOW() - INTERVAL '4 hours',
   NOW() - INTERVAL '30 minutes',
   'Former President Trump announced new immigration policies at a campaign rally.',
   'Trump SHOCKS with radical immigration plan that could affect MILLIONS!'),
   
  -- Closed story (24h old)
  ('test-closed-1', 
   'Congress Passes Infrastructure Bill', 
   'AP News', 
   'https://apnews.com/congress-infrastructure',
   'apnews.com',
   'Congress',
   'closed', 
   'moderate', 
   ARRAY['congress', 'infrastructure'],
   5,
   NOW() - INTERVAL '3 days',
   NOW() - INTERVAL '25 hours',
   'Congress passed a bipartisan infrastructure bill worth $1.2 trillion.',
   'Congress FINALLY agrees on infrastructure after MONTHS of gridlock!'),
   
  -- Opinion story
  ('test-opinion-1', 
   'Supreme Court Decision Raises Constitutional Questions', 
   'New York Times Opinion', 
   'https://nytimes.com/opinion/scotus-decision',
   'nytimes.com',
   'Supreme Court',
   'active', 
   'critical', 
   ARRAY['courts', 'constitution'],
   2,
   NOW() - INTERVAL '2 hours',
   NOW() - INTERVAL '1 hour',
   'Legal experts debate the implications of the latest Supreme Court ruling.',
   'SCOTUS abortion case could OVERTURN everything we know about reproductive rights!'),
   
  -- Archived story (very old)
  ('test-archived-1', 
   'Infrastructure Bill Passes Senate', 
   'CNN Politics', 
   'https://cnn.com/politics/infrastructure-passed',
   'cnn.com',
   'Joe Biden',
   'archived', 
   'minor', 
   ARRAY['congress', 'infrastructure'],
   12,
   NOW() - INTERVAL '100 days',
   NOW() - INTERVAL '95 days',
   'Senate passes infrastructure bill with bipartisan support.',
   'Infrastructure bill FINALLY passes after months of drama!');

-- ================================================
-- Insert Test Articles (political_entries)
-- ================================================
INSERT INTO political_entries (
  id, title, url, url_canonical, url_hash, source_domain, source_name,
  published_at, content_type, category, created_at, severity_level
) VALUES
  -- Articles for active story
  ('test-article-1',
   'Trump Announces Major Policy Change on Immigration',
   'https://reuters.com/politics/trump-immigration-2025',
   'https://reuters.com/politics/trump-immigration-2025',
   MD5('https://reuters.com/politics/trump-immigration-2025'),
   'reuters.com',
   'Reuters Politics',
   NOW() - INTERVAL '2 hours',
   'news_report',
   'Executive Actions',
   NOW() - INTERVAL '2 hours',
   3),
   
  ('test-article-2',
   'Trump Immigration Plan Draws Republican Criticism',
   'https://politico.com/news/trump-immigration-critics',
   'https://politico.com/news/trump-immigration-critics',
   MD5('https://politico.com/news/trump-immigration-critics'),
   'politico.com',
   'Politico',
   NOW() - INTERVAL '1 hour',
   'analysis',
   'Executive Actions',
   NOW() - INTERVAL '1 hour',
   3),
   
  -- Unmatched article (should create new story)
  ('test-article-unmatched',
   'Biden Announces Climate Initiative',
   'https://cnn.com/biden-climate-2025',
   'https://cnn.com/biden-climate-2025',
   MD5('https://cnn.com/biden-climate-2025'),
   'cnn.com',
   'CNN Politics',
   NOW() - INTERVAL '30 minutes',
   'news_report',
   'Executive Actions',
   NOW() - INTERVAL '30 minutes',
   2),
   
  -- Opinion piece
  ('test-article-opinion',
   'Why Trump Immigration Policy Will Fail',
   'https://nytimes.com/opinion/trump-immigration',
   'https://nytimes.com/opinion/trump-immigration',
   MD5('https://nytimes.com/opinion/trump-immigration'),
   'nytimes.com',
   'New York Times Opinion',
   NOW() - INTERVAL '45 minutes',
   'opinion',
   'Executive Actions',
   NOW() - INTERVAL '45 minutes',
   2);

-- ================================================
-- Link Articles to Stories
-- ================================================
INSERT INTO article_story (
  article_id, story_id, is_primary_source, similarity_score, matched_at
) 
SELECT 
  'test-article-1',
  id,
  true,
  0.95,
  NOW() - INTERVAL '2 hours'
FROM stories WHERE story_hash = 'test-active-1'
UNION ALL
SELECT 
  'test-article-2',
  id,
  false,
  0.72,
  NOW() - INTERVAL '1 hour'
FROM stories WHERE story_hash = 'test-active-1';

-- ================================================
-- Insert Test Job Queue Items
-- ================================================
INSERT INTO job_queue (
  type, payload, status, attempts, run_after
) VALUES
  -- Pending enrichment job
  ('enrich_story', 
   jsonb_build_object('story_id', (SELECT id FROM stories WHERE story_hash = 'test-active-1')),
   'pending',
   0,
   NOW()),
   
  -- Failed job (for testing retry logic)
  ('enrich_story',
   jsonb_build_object('story_id', (SELECT id FROM stories WHERE story_hash = 'test-closed-1')),
   'failed',
   3,
   NOW() - INTERVAL '1 hour'),
   
  -- Completed job
  ('enrich_story',
   jsonb_build_object('story_id', (SELECT id FROM stories WHERE story_hash = 'test-opinion-1')),
   'completed',
   1,
   NOW() - INTERVAL '2 hours');

-- ================================================
-- Insert Test Budget Entry
-- ================================================
INSERT INTO budgets (day, cap_usd, spent_usd, openai_calls) VALUES
  (CURRENT_DATE, 50.00, 2.37, 15),
  (CURRENT_DATE - INTERVAL '1 day', 50.00, 48.92, 312),
  (CURRENT_DATE - INTERVAL '2 days', 50.00, 12.15, 89)
ON CONFLICT (day) DO NOTHING;

COMMIT;

-- ================================================
-- Verification Queries
-- ================================================
SELECT 'Stories created:' as metric, COUNT(*) as count FROM stories WHERE story_hash LIKE 'test-%'
UNION ALL
SELECT 'Articles created:', COUNT(*) FROM political_entries WHERE id LIKE 'test-%'
UNION ALL
SELECT 'Article-Story links:', COUNT(*) FROM article_story WHERE article_id LIKE 'test-%'
UNION ALL
SELECT 'Job queue items:', COUNT(*) FROM job_queue
UNION ALL
SELECT 'Feed registry entries:', COUNT(*) FROM feed_registry
UNION ALL
SELECT 'Budget days:', COUNT(*) FROM budgets;