-- TRUMPYTRACKER DATABASE SCHEMA
-- Run this in Supabase SQL Editor

-- Enable UUID extension for better IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main political entries table
CREATE TABLE political_entries (
    id VARCHAR(50) PRIMARY KEY,
    date DATE NOT NULL,
    actor VARCHAR(255),
    category VARCHAR(100),
    title TEXT NOT NULL,
    description TEXT,
    source_url TEXT,
    verified BOOLEAN DEFAULT false,
    severity VARCHAR(20) CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(20) DEFAULT 'published',
    added_at TIMESTAMPTZ DEFAULT NOW(),
    manual_submission BOOLEAN DEFAULT false,
    submitted_by VARCHAR(100),
    processed_at TIMESTAMPTZ,
    archived BOOLEAN DEFAULT false,
    archived_at TIMESTAMPTZ,
    archive_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Executive orders table
CREATE TABLE executive_orders (
    id VARCHAR(50) PRIMARY KEY,
    title TEXT NOT NULL,
    order_number VARCHAR(20),
    date DATE NOT NULL,
    summary TEXT,
    category VARCHAR(100),
    agencies_affected TEXT[], -- Array of agencies
    policy_direction VARCHAR(50),
    implementation_timeline VARCHAR(100),
    severity_rating VARCHAR(20),
    verified BOOLEAN DEFAULT true,
    source_url TEXT,
    pdf_url TEXT,
    citation VARCHAR(100),
    publication_date DATE,
    document_number VARCHAR(100),
    source VARCHAR(100),
    type VARCHAR(50) DEFAULT 'executive_order',
    added_at TIMESTAMPTZ DEFAULT NOW(),
    impact_score INTEGER,
    implementation_status VARCHAR(50),
    legal_challenges JSONB DEFAULT '[]',
    related_orders TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for better query performance
CREATE INDEX idx_political_entries_date ON political_entries(date DESC);
CREATE INDEX idx_political_entries_category ON political_entries(category);
CREATE INDEX idx_political_entries_severity ON political_entries(severity);
CREATE INDEX idx_political_entries_archived ON political_entries(archived);
CREATE INDEX idx_political_entries_actor ON political_entries(actor);
CREATE INDEX idx_political_entries_search ON political_entries USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));

CREATE INDEX idx_executive_orders_date ON executive_orders(date DESC);
CREATE INDEX idx_executive_orders_order_number ON executive_orders(order_number);
CREATE INDEX idx_executive_orders_category ON executive_orders(category);
CREATE INDEX idx_executive_orders_search ON executive_orders USING gin(to_tsvector('english', title || ' ' || COALESCE(summary, '')));

-- Audit log table for tracking changes
CREATE TABLE audit_log (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_data JSONB,
    new_data JSONB,
    user_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pending submissions table (for manual article processing)
CREATE TABLE pending_submissions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    url TEXT NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    submitted_by VARCHAR(100),
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    result_id VARCHAR(50) -- Links to political_entries.id if successful
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at trigger to tables
CREATE TRIGGER update_political_entries_updated_at BEFORE UPDATE ON political_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_executive_orders_updated_at BEFORE UPDATE ON executive_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) - Important for public access
ALTER TABLE political_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_submissions ENABLE ROW LEVEL SECURITY;

-- Public read access for non-archived entries
CREATE POLICY "Public can read non-archived political entries" ON political_entries
    FOR SELECT USING (archived = false OR archived IS NULL);

CREATE POLICY "Public can read all executive orders" ON executive_orders
    FOR SELECT USING (true);

-- Authenticated users can do everything (for your admin panel)
CREATE POLICY "Authenticated users can manage political entries" ON political_entries
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage executive orders" ON executive_orders
    FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage submissions" ON pending_submissions
    FOR ALL USING (auth.role() = 'authenticated');

-- Create views for common queries
CREATE VIEW recent_political_entries AS
SELECT * FROM political_entries 
WHERE archived = false 
ORDER BY date DESC, added_at DESC 
LIMIT 100;

CREATE VIEW high_severity_entries AS
SELECT * FROM political_entries 
WHERE severity IN ('high', 'critical') 
  AND archived = false 
ORDER BY date DESC;

CREATE VIEW recent_executive_orders AS
SELECT * FROM executive_orders 
ORDER BY date DESC, order_number DESC 
LIMIT 50;

-- Stats view for dashboard
CREATE VIEW dashboard_stats AS
SELECT 
    (SELECT COUNT(*) FROM political_entries WHERE archived = false) as total_entries,
    (SELECT COUNT(*) FROM political_entries WHERE severity IN ('high', 'critical') AND archived = false) as high_severity_count,
    (SELECT COUNT(*) FROM executive_orders) as total_executive_orders,
    (SELECT COUNT(DISTINCT category) FROM political_entries WHERE archived = false) as category_count,
    (SELECT MAX(date) FROM political_entries) as latest_entry_date,
    (SELECT MAX(date) FROM executive_orders) as latest_order_date;

COMMENT ON TABLE political_entries IS 'Main table for political accountability tracking entries';
COMMENT ON TABLE executive_orders IS 'Table for tracking executive orders and presidential actions';
COMMENT ON TABLE pending_submissions IS 'Queue for manually submitted articles awaiting processing';
COMMENT ON TABLE audit_log IS 'Audit trail for all data modifications';