-- Migration 062: Add wealthy_unknown and missing connection types
-- ADO-264: Corruption scoring overhaul
--
-- Adds: wealthy_unknown, cabinet_connection, lobbyist to primary_connection_type CHECK constraint
-- These were missing from original migration but used in research prompts

-- Drop the old constraint (PostgreSQL doesn't support ALTER CONSTRAINT for CHECK)
ALTER TABLE public.pardons DROP CONSTRAINT IF EXISTS pardons_primary_connection_type_check;

-- Add updated constraint with all connection types
ALTER TABLE public.pardons ADD CONSTRAINT pardons_primary_connection_type_check
  CHECK (primary_connection_type IS NULL OR primary_connection_type IN (
    'mar_a_lago_vip', 'major_donor', 'family', 'political_ally',
    'campaign_staff', 'business_associate', 'jan6_defendant',
    'fake_electors', 'celebrity', 'cabinet_connection', 'lobbyist',
    'wealthy_unknown', 'no_connection'
  ));

-- Note: This migration is idempotent - safe to run multiple times
