-- STEP 2: Add indexes (run after tables are created)

-- Indexes for political_entries
CREATE INDEX IF NOT EXISTS idx_political_entries_date ON political_entries(date DESC);
CREATE INDEX IF NOT EXISTS idx_political_entries_category ON political_entries(category);
CREATE INDEX IF NOT EXISTS idx_political_entries_severity ON political_entries(severity);
CREATE INDEX IF NOT EXISTS idx_political_entries_archived ON political_entries(archived);
CREATE INDEX IF NOT EXISTS idx_political_entries_actor ON political_entries(actor);

-- Indexes for executive_orders
CREATE INDEX IF NOT EXISTS idx_executive_orders_date ON executive_orders(date DESC);
CREATE INDEX IF NOT EXISTS idx_executive_orders_order_number ON executive_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_executive_orders_category ON executive_orders(category);