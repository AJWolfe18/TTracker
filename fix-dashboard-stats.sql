-- fix-dashboard-stats.sql
-- SQL script to fix the dashboard_stats view in Supabase
-- Run this in the Supabase SQL editor

-- First, drop the existing view if it exists
DROP VIEW IF EXISTS dashboard_stats;

-- Create the corrected dashboard_stats view
CREATE OR REPLACE VIEW dashboard_stats AS
SELECT 
    -- Count political entries (excluding archived)
    (SELECT COUNT(*) 
     FROM political_entries 
     WHERE archived != true OR archived IS NULL) as total_entries,
    
    -- Count high severity political entries (excluding archived)
    (SELECT COUNT(*) 
     FROM political_entries 
     WHERE severity IN ('high', 'critical') 
     AND (archived != true OR archived IS NULL)) as high_severity_count,
    
    -- Count all executive orders
    (SELECT COUNT(*) 
     FROM executive_orders) as total_executive_orders,
    
    -- Get the most recent date from either table
    (SELECT MAX(date) FROM (
        SELECT date FROM political_entries 
        WHERE archived != true OR archived IS NULL
        UNION ALL 
        SELECT date FROM executive_orders
    ) combined_dates) as latest_entry_date;

-- Grant appropriate permissions
GRANT SELECT ON dashboard_stats TO anon;
GRANT SELECT ON dashboard_stats TO authenticated;

-- Verify the view works correctly
SELECT * FROM dashboard_stats;

-- Also create indexes for better performance if they don't exist
CREATE INDEX IF NOT EXISTS idx_political_entries_archived ON political_entries(archived);
CREATE INDEX IF NOT EXISTS idx_political_entries_severity ON political_entries(severity);
CREATE INDEX IF NOT EXISTS idx_political_entries_date ON political_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_executive_orders_date ON executive_orders(date DESC);
CREATE INDEX IF NOT EXISTS idx_executive_orders_number ON executive_orders(order_number);

-- Show the counts for verification
SELECT 
    'Current Counts:' as info,
    (SELECT COUNT(*) FROM political_entries WHERE archived != true OR archived IS NULL) as political_entries,
    (SELECT COUNT(*) FROM executive_orders) as executive_orders,
    (SELECT COUNT(*) FROM political_entries WHERE severity IN ('high', 'critical') AND (archived != true OR archived IS NULL)) as high_severity;
