# Manual Cleanup Guide - Executive Orders via Supabase Dashboard

## Option 2: Manual Cleanup Steps (Safest Approach)

This is IN ADDITION to the automated script - use this if you prefer manual control or if the script has issues.

### Step 1: Backup Your Data First
1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to your project
3. Go to **Table Editor** → **executive_orders**
4. Click **Export** → **Export as CSV**
5. Save this file as `executive_orders_backup_[date].csv`

### Step 2: Identify Problem Records
Run this SQL in the SQL Editor to see what needs cleaning:

```sql
-- Find orders WITHOUT order numbers (361+ records)
SELECT id, title, date, source 
FROM executive_orders 
WHERE order_number IS NULL 
   OR order_number = ''
ORDER BY date DESC;

-- Count them
SELECT COUNT(*) as orders_without_number
FROM executive_orders 
WHERE order_number IS NULL 
   OR order_number = '';

-- Find duplicate order numbers
SELECT order_number, COUNT(*) as count
FROM executive_orders
WHERE order_number IS NOT NULL
GROUP BY order_number
HAVING COUNT(*) > 1
ORDER BY count DESC;
```

### Step 3: Investigate Root Cause
Check when the bad data was added:

```sql
-- See when bulk imports happened
SELECT 
    DATE(added_at) as import_date,
    COUNT(*) as orders_added,
    COUNT(CASE WHEN order_number IS NULL THEN 1 END) as without_number
FROM executive_orders
GROUP BY DATE(added_at)
HAVING COUNT(*) > 10
ORDER BY COUNT(*) DESC;

-- Check sources of bad data
SELECT 
    source,
    COUNT(*) as total,
    COUNT(CASE WHEN order_number IS NULL THEN 1 END) as without_number
FROM executive_orders
GROUP BY source
ORDER BY without_number DESC;
```

### Step 4: Clean Up Bad Data (Choose One Approach)

#### Option A: Delete All Without Order Numbers
```sql
-- First, verify what you're deleting
SELECT * FROM executive_orders 
WHERE order_number IS NULL OR order_number = ''
LIMIT 20;

-- If looks right, delete them
DELETE FROM executive_orders 
WHERE order_number IS NULL OR order_number = '';
```

#### Option B: Delete by Date Range (if bad import on specific date)
```sql
-- Example: Delete orders added on August 5 without order numbers
DELETE FROM executive_orders 
WHERE DATE(added_at) = '2025-08-05'
  AND (order_number IS NULL OR order_number = '');
```

#### Option C: Nuclear Option - Start Fresh
```sql
-- Export good records first!
SELECT * FROM executive_orders 
WHERE order_number IS NOT NULL 
  AND order_number != ''
  AND date >= '2025-01-20'
ORDER BY order_number;

-- Then truncate and reimport
TRUNCATE TABLE executive_orders;
-- Reimport the good records via CSV
```

### Step 5: Remove Duplicates
```sql
-- Keep oldest version of each order number
DELETE FROM executive_orders a
USING executive_orders b
WHERE a.order_number = b.order_number
  AND a.added_at > b.added_at;
```

### Step 6: Fix the Dashboard Stats View
Run the fix-dashboard-stats.sql content:

```sql
DROP VIEW IF EXISTS dashboard_stats;

CREATE VIEW dashboard_stats AS
SELECT 
    (SELECT COUNT(*) FROM political_entries WHERE archived != true OR archived IS NULL) as total_entries,
    (SELECT COUNT(*) FROM political_entries WHERE severity IN ('high', 'critical') AND (archived != true OR archived IS NULL)) as high_severity_count,
    (SELECT COUNT(*) FROM executive_orders) as total_executive_orders,
    (SELECT MAX(date) FROM (
        SELECT date FROM political_entries WHERE archived != true OR archived IS NULL
        UNION ALL 
        SELECT date FROM executive_orders
    ) combined_dates) as latest_entry_date;

GRANT SELECT ON dashboard_stats TO anon;
GRANT SELECT ON dashboard_stats TO authenticated;
```

### Step 7: Add Constraints to Prevent Future Issues
```sql
-- Add unique constraint on order_number
ALTER TABLE executive_orders 
ADD CONSTRAINT unique_order_number 
UNIQUE (order_number);

-- Make order_number required for new entries
ALTER TABLE executive_orders 
ALTER COLUMN order_number SET NOT NULL;

-- Add check constraint for valid dates
ALTER TABLE executive_orders 
ADD CONSTRAINT valid_date 
CHECK (date >= '2025-01-20' AND date <= CURRENT_DATE + interval '1 day');
```

### Step 8: Verify Results
```sql
-- Check final counts
SELECT 
    'Total Orders' as metric,
    COUNT(*) as count
FROM executive_orders
UNION ALL
SELECT 
    'Orders with Numbers' as metric,
    COUNT(*) as count
FROM executive_orders
WHERE order_number IS NOT NULL
UNION ALL
SELECT 
    'Unique Order Numbers' as metric,
    COUNT(DISTINCT order_number) as count
FROM executive_orders
WHERE order_number IS NOT NULL;
```

### Expected Results After Cleanup:
- Total Orders: ~190 (not 551)
- All orders should have order_numbers
- No duplicates
- All dates after January 20, 2025
- Dashboard shows correct counts

### If Something Goes Wrong:
1. Import your backup CSV via Table Editor
2. Contact support with the audit logs
3. The data is still there until you delete it

## Root Cause Analysis Results

Based on the investigation, the 361 extra orders likely came from:

1. **Initial Import Issue**: The tracker might have imported non-EO documents
2. **API Parsing Error**: Federal Register API might have returned articles that weren't executive orders
3. **Missing Deduplication**: Early version didn't check for existing orders before adding
4. **Date Format Issue**: Orders might have been reimported due to date comparison bugs

## Prevention Going Forward:

1. **Add Database Constraints** (see Step 7)
2. **Validate API Responses**: Only accept documents with executive_order_number field
3. **Check Before Insert**: Always verify order doesn't exist before adding
4. **Monitor Daily Runs**: Set up alerts if more than 10 orders added in one run
5. **Use Federal Register's EO-specific endpoint**: Not the general presidential documents endpoint
