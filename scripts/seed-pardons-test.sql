-- TEST ONLY - Do not run in PROD
-- Seed data for pardons table testing
--
-- Run manually after migration 056:
--   psql $DATABASE_URL -f scripts/seed-pardons-test.sql
-- Or via Supabase MCP postgrestRequest
--
-- Created: 2026-01-12
-- ADO-241: Story 1.1 - Database Schema & Migrations

INSERT INTO public.pardons (
  recipient_name,
  pardon_date,
  clemency_type,
  is_public,
  primary_connection_type,
  corruption_level,
  crime_description,
  crime_category,
  source_system,
  research_status,
  recipient_type,
  recipient_count,
  recipient_criteria,
  trump_connection_detail,
  summary_spicy
) VALUES
-- 1. Rudy Giuliani (person)
(
  'Rudy Giuliani',
  '2025-01-20',
  'pardon',
  true,
  'mar_a_lago_vip',
  5,
  'Conspiracy to violate FARA, false statements',
  'obstruction',
  'manual',
  'complete',
  'person',
  NULL,
  NULL,
  'Personal attorney to Trump during presidency. Led legal challenges to 2020 election results.',
  'Trump''s personal fixer who knew where all the bodies were buried. Pre-emptive pardon ensures he never testifies.'
),
-- 2. Steve Bannon (person)
(
  'Steve Bannon',
  '2025-01-20',
  'pardon',
  true,
  'political_ally',
  4,
  'Contempt of Congress',
  'obstruction',
  'manual',
  'complete',
  'person',
  NULL,
  NULL,
  'Former White House Chief Strategist. Convicted for refusing to comply with Jan 6 subpoena.',
  'Ignored Congress, got pardoned anyway. Democracy optional.'
),
-- 3. January 6th Mass Pardon (GROUP - must have count + criteria)
(
  'January 6th Mass Pardon',
  '2025-01-20',
  'pardon',
  true,
  'jan6_defendant',
  3,
  'Various Jan 6 related offenses',
  'jan6',
  'manual',
  'complete',
  'group',
  1500,
  'Jan 6 defendants convicted of non-violent offenses',
  'Mass pardon covering approximately 1,500 individuals charged in connection with January 6th.',
  'Blanket pardon for people who stormed the Capitol. "Law and order" president, folks.'
),
-- 4. Ross Ulbricht (person)
(
  'Ross Ulbricht',
  '2025-01-21',
  'pardon',
  true,
  'celebrity',
  2,
  'Drug trafficking, money laundering, computer hacking',
  'drug',
  'manual',
  'complete',
  'person',
  NULL,
  NULL,
  'Creator of Silk Road dark web marketplace. Libertarian cause celebre.',
  'Founded a drug marketplace, became a libertarian martyr, got pardoned. The system works... for some.'
),
-- 5. Unpublished test pardon (for testing is_public gate)
(
  'Test Unpublished Person',
  '2025-01-22',
  'pardon',
  false,  -- NOT public - should not appear in anon queries
  'no_connection',
  1,
  'Test offense for development',
  'other',
  'manual',
  'pending',
  'person',
  NULL,
  NULL,
  'This is a test record that should not be visible to anonymous users.',
  'Test spicy summary'
);
