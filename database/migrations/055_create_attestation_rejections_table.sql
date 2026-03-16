-- Migration: attestation_rejections table
-- Stores the reason and optional notes when a worker rejects a clock-out attestation.
-- Run this in your Supabase SQL editor

CREATE TABLE IF NOT EXISTS attestation_rejections (
    id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    time_entry_id    UUID        NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
    event_id         UUID        REFERENCES events(id)                ON DELETE SET NULL,
    rejection_reason TEXT        NOT NULL,
    rejection_notes  TEXT,
    signature_data   TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup by time entry
CREATE INDEX IF NOT EXISTS idx_attestation_rejections_time_entry_id
    ON attestation_rejections (time_entry_id);

-- Fast lookup by worker
CREATE INDEX IF NOT EXISTS idx_attestation_rejections_user_id
    ON attestation_rejections (user_id);

-- Fast lookup by event
CREATE INDEX IF NOT EXISTS idx_attestation_rejections_event_id
    ON attestation_rejections (event_id);

-- RLS
ALTER TABLE attestation_rejections ENABLE ROW LEVEL SECURITY;

-- Execs can read all rejections
CREATE POLICY "Exec can read all attestation rejections" ON attestation_rejections
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'exec')
    );

-- Workers can read their own rejections
CREATE POLICY "Users can read own attestation rejections" ON attestation_rejections
    FOR SELECT USING (user_id = auth.uid());

-- Insert is handled server-side via service role (no direct client insert)
