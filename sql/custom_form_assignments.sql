-- custom_form_assignments table
-- Tracks which custom PDF forms have been specifically assigned to individual users.
-- Run this in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS custom_form_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       UUID NOT NULL REFERENCES custom_pdf_forms(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by   UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (form_id, user_id)
);

-- Index for fast lookups by user
CREATE INDEX IF NOT EXISTS idx_cfa_user_id ON custom_form_assignments(user_id);
-- Index for fast lookups by form
CREATE INDEX IF NOT EXISTS idx_cfa_form_id ON custom_form_assignments(form_id);

-- RLS: service role can do everything (API routes use service role key)
ALTER TABLE custom_form_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON custom_form_assignments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
