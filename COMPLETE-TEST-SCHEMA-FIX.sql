-- COMPLETE TEST DATABASE SCHEMA FIX
-- This will make your test database match production exactly
-- Run this entire script in your TEST Supabase SQL Editor

-- Step 1: Drop existing tables and views to start fresh
DROP VIEW IF EXISTS dashboard_stats CASCADE;
DROP VIEW IF EXISTS recent_political_entries CASCADE;
DROP VIEW IF EXISTS high_severity_entries CASCADE;
DROP VIEW IF EXISTS recent_executive_orders CASCADE;

-- Step 2: Add all missing columns to political_entries
ALTER TABLE political_entries 
ADD COLUMN IF NOT EXISTS source_url TEXT,
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'published',
ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS manual_submission BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS submitted_by VARCHAR(100),
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS archive_reason TEXT;

-- Step 3: Add all missing columns to executive_orders
ALTER TABLE executive_orders 
ADD COLUMN IF NOT EXISTS summary TEXT,
ADD COLUMN IF NOT EXISTS agencies_affected TEXT[],
ADD COLUMN IF NOT EXISTS policy_direction VARCHAR(50),
ADD COLUMN IF NOT EXISTS implementation_timeline VARCHAR(100),
ADD COLUMN IF NOT EXISTS severity_rating VARCHAR(20),
ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS source_url TEXT,
ADD COLUMN IF NOT EXISTS pdf_url TEXT,
ADD COLUMN IF NOT EXISTS citation VARCHAR(100),
ADD COLUMN IF NOT EXISTS publication_date DATE,
ADD COLUMN IF NOT EXISTS document_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS source VARCHAR(100),
ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'executive_order',
ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS impact_score INTEGER,
ADD COLUMN IF NOT EXISTS implementation_status VARCHAR(50),
ADD COLUMN IF NOT EXISTS legal_challenges JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS related_orders TEXT[];

-- Step 4: Create missing tables if they don't exist
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_data JSONB,
    new_data JSONB,
    user_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pending_submissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    url TEXT NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    submitted_by VARCHAR(100),
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    result_id VARCHAR(50)
);

-- Step 5: Create all the indexes
CREATE INDEX IF NOT EXISTS idx_political_entries_date ON political_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_political_entries_category ON political_entries(category);
CREATE INDEX IF NOT EXISTS idx_political_entries_severity ON political_entries(severity);
CREATE INDEX IF NOT EXISTS idx_political_entries_archived ON political_entries(archived);
CREATE INDEX IF NOT EXISTS idx_political_entries_actor ON political_entries(actor);

CREATE INDEX IF NOT EXISTS idx_executive_orders_date ON executive_orders(date DESC);
CREATE INDEX IF NOT EXISTS idx_executive_orders_order_number ON executive_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_executive_orders_category ON executive_orders(category);

-- Step 6: Create the views
CREATE VIEW recent_political_entries AS
SELECT * FROM political_entries 
WHERE archived = false OR archived IS NULL
ORDER BY date DESC, created_at DESC 
LIMIT 100;

CREATE VIEW high_severity_entries AS
SELECT * FROM political_entries 
WHERE severity IN ('high', 'critical') 
  AND (archived = false OR archived IS NULL)
ORDER BY date DESC;

CREATE VIEW recent_executive_orders AS
SELECT * FROM executive_orders 
WHERE archived = false OR archived IS NULL
ORDER BY date DESC, order_number DESC 
LIMIT 50;

-- Step 7: Create the dashboard_stats view (MOST IMPORTANT)
CREATE VIEW dashboard_stats AS
SELECT 
    (SELECT COUNT(*) FROM political_entries WHERE archived = false OR archived IS NULL) as total_entries,
    (SELECT COUNT(*) FROM political_entries WHERE severity IN ('high', 'critical') AND (archived = false OR archived IS NULL)) as high_severity_count,
    (SELECT COUNT(*) FROM executive_orders WHERE archived = false OR archived IS NULL) as total_executive_orders,
    (SELECT COUNT(DISTINCT category) FROM political_entries WHERE archived = false OR archived IS NULL) as category_count,
    (SELECT MAX(date) FROM political_entries) as latest_entry_date,
    (SELECT MAX(date) FROM executive_orders) as latest_order_date;

-- Step 8: Verify everything was created
SELECT 'Tables:' as check_type, table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

SELECT 'Views:' as check_type, table_name 
FROM information_schema.views 
WHERE table_schema = 'public'
ORDER BY table_name;

SELECT 'Political Entries Columns:' as check_type, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'political_entries' 
ORDER BY ordinal_position;

SELECT 'Executive Orders Columns:' as check_type, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'executive_orders' 
ORDER BY ordinal_position;