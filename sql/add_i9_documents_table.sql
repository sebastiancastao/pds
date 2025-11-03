-- Create table for storing I-9 verification documents
-- This table stores uploaded documents for identity and employment eligibility verification

CREATE TABLE IF NOT EXISTS i9_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Driver's License / ID Document
  drivers_license_url TEXT,
  drivers_license_filename TEXT,
  drivers_license_uploaded_at TIMESTAMPTZ,

  -- SSN / Social Security Card Document
  ssn_document_url TEXT,
  ssn_document_filename TEXT,
  ssn_document_uploaded_at TIMESTAMPTZ,

  -- Additional verification documents (if needed)
  additional_doc_url TEXT,
  additional_doc_filename TEXT,
  additional_doc_uploaded_at TIMESTAMPTZ,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure one record per user
  CONSTRAINT unique_user_i9_documents UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_i9_documents_user_id ON i9_documents(user_id);

-- Enable RLS (Row Level Security)
ALTER TABLE i9_documents ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own documents
CREATE POLICY "Users can view own I-9 documents"
  ON i9_documents
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own documents
CREATE POLICY "Users can insert own I-9 documents"
  ON i9_documents
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own documents
CREATE POLICY "Users can update own I-9 documents"
  ON i9_documents
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Create storage bucket for I-9 documents (if not exists)
INSERT INTO storage.buckets (id, name, public)
VALUES ('i9-documents', 'i9-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policy: Users can upload their own documents
CREATE POLICY "Users can upload own I-9 documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'i9-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage policy: Users can view their own documents
CREATE POLICY "Users can view own I-9 documents"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'i9-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage policy: Users can update their own documents
CREATE POLICY "Users can update own I-9 documents"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'i9-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Storage policy: Users can delete their own documents
CREATE POLICY "Users can delete own I-9 documents"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'i9-documents' AND
    (storage.foldername(name))[1] = auth.uid()::text
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_i9_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_i9_documents_timestamp ON i9_documents;
CREATE TRIGGER update_i9_documents_timestamp
  BEFORE UPDATE ON i9_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_i9_documents_updated_at();

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON i9_documents TO authenticated;
