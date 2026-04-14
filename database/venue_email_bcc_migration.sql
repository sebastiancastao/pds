-- Migration: Add venue_email_bcc table
-- Purpose: Store per-venue manager BCC settings for event-dashboard emails
-- Run this in your Supabase SQL editor before using the venue BCC settings page.

CREATE TABLE IF NOT EXISTS venue_email_bcc (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    venue_id UUID NOT NULL REFERENCES venue_reference(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (venue_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_venue_email_bcc_venue_id ON venue_email_bcc(venue_id);
CREATE INDEX IF NOT EXISTS idx_venue_email_bcc_user_id ON venue_email_bcc(user_id);

ALTER TABLE venue_email_bcc ENABLE ROW LEVEL SECURITY;

-- Exec/admin can read and write; service role bypasses RLS
CREATE POLICY "venue_email_bcc_read" ON venue_email_bcc
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('exec', 'admin')
        )
    );

CREATE POLICY "venue_email_bcc_insert" ON venue_email_bcc
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('exec', 'admin')
        )
    );

CREATE POLICY "venue_email_bcc_delete" ON venue_email_bcc
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role IN ('exec', 'admin')
        )
    );
