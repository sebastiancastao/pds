-- Create table to store PDF form progress for users
CREATE TABLE IF NOT EXISTS pdf_form_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  form_name VARCHAR(255) NOT NULL,
  form_data BYTEA NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, form_name)
);

-- Create index for faster lookups
CREATE INDEX idx_pdf_form_progress_user_id ON pdf_form_progress(user_id);
CREATE INDEX idx_pdf_form_progress_form_name ON pdf_form_progress(form_name);

-- Add RLS policies
ALTER TABLE pdf_form_progress ENABLE ROW LEVEL SECURITY;

-- Users can only see their own form progress
CREATE POLICY "Users can view their own PDF form progress"
  ON pdf_form_progress
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own form progress
CREATE POLICY "Users can insert their own PDF form progress"
  ON pdf_form_progress
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own form progress
CREATE POLICY "Users can update their own PDF form progress"
  ON pdf_form_progress
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own form progress
CREATE POLICY "Users can delete their own PDF form progress"
  ON pdf_form_progress
  FOR DELETE
  USING (auth.uid() = user_id);
