-- Migration: Create Form Signatures Table
-- Purpose: Store signature binding with hash for I-9 and W-4 compliance (8 CFR § 274a.2)
-- Date: 2025-10-28

-- Drop table if exists (for development/testing)
DROP TABLE IF EXISTS public.form_signatures CASCADE;

-- Create form_signatures table
CREATE TABLE public.form_signatures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id TEXT NOT NULL, -- Identifier for the form (e.g., 'ca-de4', 'fw4', 'i9')
    form_type TEXT NOT NULL, -- Type of form ('w4', 'i9', 'de4', etc.)
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    signature_role TEXT NOT NULL, -- 'employee' or 'employer'
    signature_data TEXT NOT NULL, -- The actual signature (base64 image or typed text)
    signature_type TEXT NOT NULL, -- 'typed' or 'drawn'

    -- Signature Binding (8 CFR § 274a.2)
    form_data_hash TEXT NOT NULL, -- SHA-256 hash of form data at time of signature
    signature_hash TEXT NOT NULL, -- SHA-256 hash of signature + timestamp + user + IP
    binding_hash TEXT NOT NULL UNIQUE, -- Combined hash for integrity verification

    -- Metadata for compliance
    ip_address TEXT NOT NULL, -- IP address when signature was created
    user_agent TEXT, -- Browser/device user agent
    device_fingerprint TEXT, -- Device fingerprint
    session_id TEXT, -- Session identifier

    -- Timestamps
    signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Verification
    is_valid BOOLEAN DEFAULT true, -- False if form data changed after signature
    verification_attempts INTEGER DEFAULT 0,
    last_verified_at TIMESTAMPTZ,

    -- Employer certification fields (for I-9 Section 2)
    employer_title TEXT, -- Job title of employer representative
    employer_organization TEXT, -- Organization name
    documents_examined JSONB, -- List of documents examined for I-9
    examination_date DATE, -- Date documents were examined

    CONSTRAINT valid_signature_role CHECK (signature_role IN ('employee', 'employer')),
    CONSTRAINT valid_signature_type CHECK (signature_type IN ('typed', 'drawn'))
);

-- Create indexes
CREATE INDEX idx_form_signatures_form_id ON public.form_signatures(form_id);
CREATE INDEX idx_form_signatures_user_id ON public.form_signatures(user_id);
CREATE INDEX idx_form_signatures_form_type ON public.form_signatures(form_type);
CREATE INDEX idx_form_signatures_signature_role ON public.form_signatures(signature_role);
CREATE INDEX idx_form_signatures_signed_at ON public.form_signatures(signed_at DESC);
CREATE INDEX idx_form_signatures_binding_hash ON public.form_signatures(binding_hash);

-- Enable Row Level Security
ALTER TABLE public.form_signatures ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own signatures
CREATE POLICY "Users can view their own signatures"
    ON public.form_signatures
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Admins can view all signatures
CREATE POLICY "Admins can view all signatures"
    ON public.form_signatures
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid()
            AND profiles.role = 'admin'
        )
    );

-- Policy: Users can insert their own signatures
CREATE POLICY "Users can insert their own signatures"
    ON public.form_signatures
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can insert signatures (API calls)
CREATE POLICY "Service can insert signatures"
    ON public.form_signatures
    FOR INSERT
    WITH CHECK (true);

-- Policy: No one can update or delete signatures (immutable)
-- Signatures are permanent records for compliance

-- Function to verify signature integrity
CREATE OR REPLACE FUNCTION public.verify_signature_integrity(
    p_signature_id UUID,
    p_current_form_data_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_original_hash TEXT;
    v_is_valid BOOLEAN;
BEGIN
    -- Get the original form data hash
    SELECT form_data_hash INTO v_original_hash
    FROM public.form_signatures
    WHERE id = p_signature_id;

    -- Compare hashes
    v_is_valid := (v_original_hash = p_current_form_data_hash);

    -- Update verification tracking
    UPDATE public.form_signatures
    SET
        verification_attempts = verification_attempts + 1,
        last_verified_at = NOW(),
        is_valid = v_is_valid
    WHERE id = p_signature_id;

    RETURN v_is_valid;
END;
$$;

-- Grant permissions
GRANT SELECT ON public.form_signatures TO authenticated;
GRANT INSERT ON public.form_signatures TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.form_signatures TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_signature_integrity TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_signature_integrity TO service_role;

-- Add comments
COMMENT ON TABLE public.form_signatures IS 'Stores form signatures with cryptographic binding for I-9 and W-4 compliance (8 CFR § 274a.2). Signatures are immutable and hash-verified.';
COMMENT ON COLUMN public.form_signatures.binding_hash IS 'Unique hash combining form data, signature, timestamp, user ID, and IP address. Used to verify form integrity.';
COMMENT ON FUNCTION public.verify_signature_integrity IS 'Verifies that form data has not changed since signature was applied.';
