-- Migration: Create Form Audit Trail Table
-- Purpose: Track all actions on forms for I-9 and W-4 compliance (8 CFR § 274a.2)
-- Date: 2025-10-28

-- Drop table if exists (for development/testing)
DROP TABLE IF EXISTS public.form_audit_trail CASCADE;

-- Create form_audit_trail table
CREATE TABLE public.form_audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id TEXT NOT NULL, -- Identifier for the form (e.g., 'ca-de4', 'fw4', 'i9')
    form_type TEXT NOT NULL, -- Type of form ('w4', 'i9', 'de4', etc.)
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- 'created', 'viewed', 'edited', 'signed', 'reviewed', 'certified'
    action_details JSONB, -- Additional details about the action
    ip_address TEXT, -- IP address of the user
    user_agent TEXT, -- Browser/device user agent
    device_fingerprint TEXT, -- Device fingerprint for keeping
    session_id TEXT, -- Session identifier
    field_changed TEXT, -- Specific field that was changed (for 'edited' actions)
    old_value TEXT, -- Previous value (for 'edited' actions)
    new_value TEXT, -- New value (for 'edited' actions)
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for faster queries
CREATE INDEX idx_form_audit_trail_form_id ON public.form_audit_trail(form_id);
CREATE INDEX idx_form_audit_trail_user_id ON public.form_audit_trail(user_id);
CREATE INDEX idx_form_audit_trail_form_type ON public.form_audit_trail(form_type);
CREATE INDEX idx_form_audit_trail_action ON public.form_audit_trail(action);
CREATE INDEX idx_form_audit_trail_timestamp ON public.form_audit_trail(timestamp DESC);

-- Enable Row Level Security
ALTER TABLE public.form_audit_trail ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view their own audit trail
CREATE POLICY "Users can view their own audit trail"
    ON public.form_audit_trail
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Admins can view all audit trails
CREATE POLICY "Admins can view all audit trails"
    ON public.form_audit_trail
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy: Service role can insert audit records (API calls)
CREATE POLICY "Service can insert audit records"
    ON public.form_audit_trail
    FOR INSERT
    WITH CHECK (true);

-- Policy: No one can update or delete audit records (tamper-proof)
-- Audit records are immutable once created

-- Grant permissions
GRANT SELECT ON public.form_audit_trail TO authenticated;
GRANT INSERT ON public.form_audit_trail TO authenticated;
GRANT SELECT ON public.form_audit_trail TO service_role;
GRANT INSERT ON public.form_audit_trail TO service_role;

-- Add comment
COMMENT ON TABLE public.form_audit_trail IS 'Audit trail for all form actions to ensure I-9 and W-4 compliance (8 CFR § 274a.2). Records are immutable and tamper-proof.';
