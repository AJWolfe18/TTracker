-- DIAGNOSE EXECUTIVE ORDERS PROBLEM
-- Run these queries in Supabase SQL Editor to find the issue

-- 1. Check date range of executive orders
SELECT 
    MIN(date) as earliest_date,
    MAX(date) as latest_date,
    COUNT(*) as total_count
FROM executive_orders;

-- 2. Count by year to see if we have old data
SELECT 
    EXTRACT(YEAR FROM date::date) as year,
    COUNT(*) as count
FROM executive_orders
GROUP BY year
ORDER BY year DESC;

-- 3. Check for duplicate order numbers
SELECT 
    order_number,
    COUNT(*) as duplicate_count
FROM executive_orders
WHERE order_number IS NOT NULL
GROUP BY order_number
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 10;

-- 4. Check sample of orders to see what's wrong
SELECT 
    date,
    order_number,
    title,
    source_url
FROM executive_orders
ORDER BY date DESC
LIMIT 20;

-- 5. Count orders that are actually from 2025
SELECT 
    COUNT(*) as orders_2025
FROM executive_orders
WHERE date >= '2025-01-20';

-- 6. Find any orders before Trump's inauguration
SELECT 
    COUNT(*) as orders_before_inauguration
FROM executive_orders
WHERE date < '2025-01-20';

-- 7. Check if we have Biden's orders by mistake
SELECT 
    date,
    order_number,
    title
FROM executive_orders
WHERE date BETWEEN '2021-01-20' AND '2025-01-19'
ORDER BY date DESC
LIMIT 10;

-- 8. Check unique order numbers vs total rows
SELECT 
    COUNT(DISTINCT order_number) as unique_order_numbers,
    COUNT(*) as total_rows,
    COUNT(*) - COUNT(DISTINCT order_number) as potential_duplicates
FROM executive_orders
WHERE order_number IS NOT NULL;