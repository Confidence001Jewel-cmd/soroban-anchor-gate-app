-- 000001_initial_schema.up.sql
CREATE TABLE IF NOT EXISTS processed_events (
    event_id VARCHAR(128) PRIMARY KEY,
    state VARCHAR(32) NOT NULL,
    updated_at BIGINT NOT NULL,
    error TEXT
);

CREATE TABLE IF NOT EXISTS relay_cursor (
    id INT PRIMARY KEY DEFAULT 1,
    last_ledger BIGINT NOT NULL
);
