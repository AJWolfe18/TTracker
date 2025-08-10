-- STEP 1: Create tables first (run this alone first)
-- This creates the basic structure

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Main political entries table
CREATE TABLE IF NOT EXISTS political_entries (
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
CREATE TABLE IF NOT EXISTS executive_orders (
    id VARCHAR(50) PRIMARY KEY,
    title TEXT NOT NULL,
    order_number VARCHAR(20),
    date DATE NOT NULL,
    summary TEXT,
    category VARCHAR(100),
    agencies_affected TEXT[],
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

-- Audit log table
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    table_name VARCHAR(50) NOT NULL,
    record_id VARCHAR(50) NOT NULL,
    action VARCHAR(20) NOT NULL,
    old_data JSONB,
    new_data JSONB,
    user_id VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pending submissions table
CREATE TABLE IF NOT EXISTS pending_submissions (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    url TEXT NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    submitted_by VARCHAR(100),
    processed BOOLEAN DEFAULT false,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    result_id VARCHAR(50)
);