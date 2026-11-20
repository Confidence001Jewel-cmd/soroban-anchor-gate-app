-- 000002_add_anchor_transactions.up.sql
CREATE TABLE IF NOT EXISTS anchor_transactions (
    id VARCHAR(128) PRIMARY KEY,
    escrow_id VARCHAR(128) NOT NULL,
    anchor_domain VARCHAR(255) NOT NULL,
    status VARCHAR(64) NOT NULL,
    amount NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
