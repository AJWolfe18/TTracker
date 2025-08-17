-- First, drop the existing view if it exists
DROP VIEW IF EXISTS dashboard_stats;

-- Then create the new view with the correct structure
CREATE VIEW dashboard_stats AS
SELECT 
    (SELECT COUNT(*) FROM political_entries WHERE archived = false OR archived IS NULL) as total_entries,
    (SELECT COUNT(*) FROM political_entries WHERE (severity = 'high' OR severity = 'critical') AND (archived = false OR archived IS NULL)) as high_severity_count,
    (SELECT COUNT(*) FROM executive_orders WHERE archived = false OR archived IS NULL) as total_executive_orders,
    (SELECT MAX(latest_date) FROM (
        SELECT MAX(date) as latest_date FROM political_entries 
        UNION ALL 
        SELECT MAX(date) as latest_date FROM executive_orders
    ) as combined_dates) as latest_entry_date;