-- RE-ENABLE RLS WITH PROPER POLICIES
-- Run this AFTER migration is complete

-- Re-enable RLS
ALTER TABLE political_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_submissions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies first (if any)
DROP POLICY IF EXISTS "Public can read non-archived political entries" ON political_entries;
DROP POLICY IF EXISTS "Public can read all executive orders" ON executive_orders;
DROP POLICY IF EXISTS "Authenticated users can manage political entries" ON political_entries;
DROP POLICY IF EXISTS "Authenticated users can manage executive orders" ON executive_orders;
DROP POLICY IF EXISTS "Authenticated users can manage submissions" ON pending_submissions;
DROP POLICY IF EXISTS "Anon users can insert political entries" ON political_entries;
DROP POLICY IF EXISTS "Anon users can insert executive orders" ON executive_orders;

-- Allow public to read non-archived political entries
CREATE POLICY "Public can read non-archived political entries" ON political_entries
    FOR SELECT 
    USING (archived = false OR archived IS NULL);

-- Allow public to read all executive orders
CREATE POLICY "Public can read all executive orders" ON executive_orders
    FOR SELECT 
    USING (true);

-- For GitHub Actions (using anon key) - allow inserts and updates
CREATE POLICY "Service can insert political entries" ON political_entries
    FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Service can update political entries" ON political_entries
    FOR UPDATE 
    USING (true);

CREATE POLICY "Service can insert executive orders" ON executive_orders
    FOR INSERT 
    WITH CHECK (true);

CREATE POLICY "Service can update executive orders" ON executive_orders
    FOR UPDATE 
    USING (true);

-- For pending submissions
CREATE POLICY "Service can manage submissions" ON pending_submissions
    FOR ALL 
    USING (true);

-- Note: For production, you'll want to use a service_role key in GitHub Actions
-- which bypasses RLS entirely. But this works for now with the anon key.