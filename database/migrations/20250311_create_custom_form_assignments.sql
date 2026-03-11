-- Migration: custom_form_assignments table
-- Run this in your Supabase SQL editor
-- This table restricts specific custom PDF forms to specific users.

CREATE TABLE IF NOT EXISTS custom_form_assignments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    form_id     UUID NOT NULL REFERENCES custom_pdf_forms(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (form_id, user_id)
);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_custom_form_assignments_user_id
    ON custom_form_assignments (user_id);

-- Index for fast lookup by form
CREATE INDEX IF NOT EXISTS idx_custom_form_assignments_form_id
    ON custom_form_assignments (form_id);

-- RLS
ALTER TABLE custom_form_assignments ENABLE ROW LEVEL SECURITY;

-- Execs can manage all assignments
CREATE POLICY "Exec can manage form assignments" ON custom_form_assignments
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'exec')
    );

-- Users can read their own assignments
CREATE POLICY "Users can read own assignments" ON custom_form_assignments
    FOR SELECT USING (user_id = auth.uid());
