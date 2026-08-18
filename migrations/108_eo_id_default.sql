-- Migration 108: Give executive_orders.id a database default (PROD fix)
--
-- Context: PR #110 (ADO-540) removed script-side id generation from
-- executive-orders-tracker-supabase.js, assuming the DB auto-generates ids.
-- That was true on TEST (id is INTEGER with identity) but NOT on PROD
-- (id is TEXT, no default) - so every new-EO insert on PROD failed with
-- 23502 not-null violations starting 2026-08-06.
--
-- Fix: give PROD's TEXT id column a default, matching the pattern the
-- articles table uses (migration 001: 'art-' || gen_random_uuid()).
-- Existing PROD ids (eo_<timestamp>_<suffix>) are untouched; new ids are
-- eo_<uuid>, format-compatible (string starting with 'eo_').
--
-- Idempotent and env-safe: the type guard makes this a no-op on TEST,
-- where id is INTEGER and already auto-generates. PROD's column is
-- VARCHAR(50) (see migration 091 notes), which information_schema reports
-- as 'character varying' - guard covers both string types. 'eo_' + uuid
-- is 39 chars, within the 50-char limit.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'executive_orders'
      AND column_name = 'id'
      AND data_type IN ('text', 'character varying')
  ) THEN
    ALTER TABLE public.executive_orders
      ALTER COLUMN id SET DEFAULT ('eo_' || gen_random_uuid()::text);
  END IF;
END $$;
