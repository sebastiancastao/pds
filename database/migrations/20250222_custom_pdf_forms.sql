-- Migration: custom_pdf_forms table
-- Run this in your Supabase SQL editor

-- Table to store admin-uploaded custom PDF forms
CREATE TABLE IF NOT EXISTS custom_pdf_forms (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    requires_signature BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Also create the storage bucket via Supabase dashboard or CLI:
-- Bucket name: custom-forms
-- Public: false (private bucket, access via signed URLs)

-- Optional: RLS policies
ALTER TABLE custom_pdf_forms ENABLE ROW LEVEL SECURITY;

-- Exec/admin can do everything
CREATE POLICY "Exec can manage custom forms" ON custom_pdf_forms
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM users WHERE id = auth.uid() AND role = 'exec'
        )
    );

-- All authenticated users can read active forms
CREATE POLICY "Authenticated users can read active forms" ON custom_pdf_forms
    FOR SELECT USING (
        is_active = true AND auth.uid() IS NOT NULL
    );
